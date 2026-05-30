import createGraph from "ngraph.graph";
import { aStar } from "ngraph.path";
import RBush from "rbush";

let graph = null;
let finder = null;
let tree = null;
let edgeLookup = null;

// function to calc haversine distance (accounts for curvature)
// euclidean assumes plane is flat, not good for long distances
function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng *
      sinLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

export async function loadGraph() {
  const res = await fetch("/data/graph.geojson");
  const geojson = await res.json();
  const features = geojson.features;

  graph = createGraph(); // creates graph object, for a*
  tree = new RBush(); // creates R-tree, to find nearest node to clicked coord
  edgeLookup = new Map();

  const nodes = new Map();

  features.forEach((f) => {
    const { from, to, weight } = f.properties;
    const coords = f.geometry.coordinates;
    const [fromLng, fromLat] = coords[0];
    const [toLng, toLat] = coords[coords.length - 1];

    // turn geojson's edges (from and to) to nodes
    if (!nodes.has(from)) nodes.set(from, { lat: fromLat, lng: fromLng });
    if (!nodes.has(to)) nodes.set(to, { lat: toLat, lng: toLng });

    edgeLookup.set(`${from}-${to}`, coords); // save the coord arrays of each edge from geojson into edgeLookup so we can use it to draw the route
  });

  // add all nodes to graph and R-tree
  const rbushItems = [];
  nodes.forEach(({ lat, lng }, id) => {
    graph.addNode(id, { lat, lng });
    rbushItems.push({ minX: lng, minY: lat, maxX: lng, maxY: lat, id });
  }); // add coords of nodes
  tree.load(rbushItems);

  // add all edges to graph
  features.forEach((f) => {
    const { from, to, weight } = f.properties;
    graph.addLink(from, to, { weight });
  });

  // a* finder, uses weight as cost and haversine as heuristic
  finder = aStar(graph, {
    distance: (_, __, link) => link.data.weight,
    heuristic: (a, b) => haversine(a.data, b.data),
  });

  console.log(`graph loaded: ${nodes.size} nodes, ${features.length} edges`);
}

// returns the nearest graph node id to a given lat/lng
export function snapToNode(lat, lng) {
  let delta = 0.001; // 100m search radius, doubles if nothing found
  while (delta < 1) {
    const results = tree.search({
      minX: lng - delta,
      minY: lat - delta,
      maxX: lng + delta,
      maxY: lat + delta,
    });
    if (results.length > 0) {
      // find closest by euclidean distance
      return results.reduce(
        (best, n) => {
          const d = Math.hypot(n.minX - lng, n.minY - lat);
          return d < best.d ? { id: n.id, d } : best;
        },
        { id: null, d: Infinity },
      ).id;
    }
    delta *= 2;
  }
  return null; // no node found anywhere nearby, somehow
}

// returns a geojson linestring of the route between two node ids, or null if no path
export function findRoute(startId, endId) {
  const result = finder.find(startId, endId);
  if (!result || result.length === 0) return null;

  // ngraph returns nodes end→start, so we need to reverse it
  const nodeIds = result.map((n) => n.id).reverse();

  // stitch together edge geometries for accurate path drawing
  const coords = [];
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const key = `${nodeIds[i]}-${nodeIds[i + 1]}`;
    const edgeCoords = edgeLookup.get(key);
    if (edgeCoords) coords.push(...edgeCoords);
  }

  return { type: "LineString", coordinates: coords };
}
