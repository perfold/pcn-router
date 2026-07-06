import RBush from "rbush";

let tree = null; // rtree to find nearest node to clicked coord

// graph states from bin
let numNodes = 0;
let numEdges = 0;
let coordScale = 1; // fixed-point scale
let nodeOsm = null; // BigUint64Array: dense idx -> original osm id (public interface still speaks osm ids)
let nodeLat = null; // Float64Array: dense idx -> lat (degrees, unpacked once)
let nodeLng = null; // Float64Array: dense idx -> lng (degrees, unpacked once)
let edgeWeight = null; // Float32Array: edge idx -> routing weight
let edgeFrom = null; // Uint32Array: edge idx -> 'from' node idx (for stitch orientation)
let edgeTo = null; // Uint32Array: edge idx -> 'to' node idx
let coordOffsets = null; // Uint32Array: edge i's packed coords are [off[i], off[i+1])
let packLat = null; // Int32Array: packed lat stream (fixed-point), shared by all edges
let packLng = null; // Int32Array: packed lng stream (fixed-point)

// csr adjacency list
let adjHead = null; // Uint32Array (numNodes+1): node u's neighbours are [head[u], head[u+1])
let adjNode = null; // Uint32Array: neighbour node idx
let adjEdge = null; // Uint32Array: edge idx for that neighbour link (for weight + geometry)

// a* search
let gScore = null; // Float64Array: best known cost to reach node
let cameFrom = null; // Int32Array: predecessor node idx in the path
let cameEdge = null; // Int32Array: edge idx used to arrive (so we can fetch its geometry)
let seenEpoch = null; // Int32Array: last epoch this node was discovered
let closedEpoch = null; // Int32Array: last epoch this node was finalised
let epoch = 0;

let osmToIdx = null; // Map osm id -> dense idx, for the public snap/find interface

const HEURISTIC_SCALE = 0.68;

// function to calc haversine distance (accounts for curvature) euclidean assumes plane is flat, not good for long distances
// takes raw numbers so both callers (node idx heuristic, and findRoute) can share it without building {lat,lng} objects in the hot path
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      sinLng *
      sinLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

// heuristic helper: haversine between two node indices
function havIdx(i, j) {
  return haversine(nodeLat[i], nodeLng[i], nodeLat[j], nodeLng[j]);
}

// binary min-heap keyed on fScore
class MinHeap {
  constructor(cap) {
    this.f = new Float64Array(cap); // fScore
    this.n = new Uint32Array(cap); // node idx
    this.size = 0;
  }
  push(f, node) {
    let i = this.size++;
    this.f[i] = f;
    this.n[i] = node;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      this._swap(i, p);
      i = p;
    }
  }
  pop() {
    const top = this.n[0];
    this.size--;
    this.f[0] = this.f[this.size];
    this.n[0] = this.n[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let s = i;
      if (l < this.size && this.f[l] < this.f[s]) s = l;
      if (r < this.size && this.f[r] < this.f[s]) s = r;
      if (s === i) break;
      this._swap(i, s);
      i = s;
    }
    return top;
  }
  _swap(a, b) {
    const tf = this.f[a];
    this.f[a] = this.f[b];
    this.f[b] = tf;
    const tn = this.n[a];
    this.n[a] = this.n[b];
    this.n[b] = tn;
  }
}

function readSection(ab, meta, name) {
  const s = meta.sections.find((x) => x.name === name);
  const ctors = {
    uint64: BigUint64Array,
    uint32: Uint32Array,
    int32: Int32Array,
    float32: Float32Array,
  };
  return new ctors[s.dtype](ab, s.byte_offset, s.count);
}

export async function loadGraph(meta, arrayBuffer) {
  numNodes = meta.num_nodes;
  numEdges = meta.num_edges;
  coordScale = meta.coord_scale;

  // read the binary
  nodeOsm = readSection(arrayBuffer, meta, "node_osm");
  const nodeLatI = readSection(arrayBuffer, meta, "node_lat");
  const nodeLngI = readSection(arrayBuffer, meta, "node_lng");
  edgeWeight = readSection(arrayBuffer, meta, "edge_weight");
  coordOffsets = readSection(arrayBuffer, meta, "coord_offsets");
  packLat = readSection(arrayBuffer, meta, "packed_lat");
  packLng = readSection(arrayBuffer, meta, "packed_lng");
  edgeFrom = readSection(arrayBuffer, meta, "edge_from");
  edgeTo = readSection(arrayBuffer, meta, "edge_to");

  nodeLat = new Float64Array(numNodes);
  nodeLng = new Float64Array(numNodes);
  for (let i = 0; i < numNodes; i++) {
    nodeLat[i] = nodeLatI[i] / coordScale;
    nodeLng[i] = nodeLngI[i] / coordScale;
  }

  // build rtree
  tree = new RBush();
  const rbushItems = new Array(numNodes);
  osmToIdx = new Map();
  for (let i = 0; i < numNodes; i++) {
    const osm = Number(nodeOsm[i]);
    osmToIdx.set(osm, i);
    rbushItems[i] = {
      minX: nodeLng[i],
      minY: nodeLat[i],
      maxX: nodeLng[i],
      maxY: nodeLat[i],
      id: osm,
    };
  }
  tree.load(rbushItems); // bulk build the rtree in one go

  // build undirected CSR adjacency via counting sort
  adjHead = new Uint32Array(numNodes + 1);
  for (let i = 0; i < numEdges; i++) {
    adjHead[edgeFrom[i] + 1]++;
    adjHead[edgeTo[i] + 1]++;
  }
  for (let i = 0; i < numNodes; i++) adjHead[i + 1] += adjHead[i]; // prefix sum -> row pointers
  adjNode = new Uint32Array(numEdges * 2);
  adjEdge = new Uint32Array(numEdges * 2);
  const cursor = adjHead.slice(0, numNodes); // per-node write head, consumed during fill
  for (let i = 0; i < numEdges; i++) {
    const a = edgeFrom[i];
    const b = edgeTo[i];
    let p = cursor[a]++;
    adjNode[p] = b;
    adjEdge[p] = i;
    p = cursor[b]++;
    adjNode[p] = a;
    adjEdge[p] = i;
  }

  gScore = new Float64Array(numNodes);
  cameFrom = new Int32Array(numNodes);
  cameEdge = new Int32Array(numNodes);
  seenEpoch = new Int32Array(numNodes).fill(-1);
  closedEpoch = new Int32Array(numNodes).fill(-1);
  epoch = 0;

  console.log(`graph loaded: ${numNodes} nodes, ${numEdges} edges`);
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

// runs a* over the CSR arrays
function runAStar(start, goal) {
  epoch++;
  const heap = new MinHeap(numNodes);
  gScore[start] = 0;
  seenEpoch[start] = epoch;
  cameFrom[start] = -1;
  cameEdge[start] = -1;
  heap.push(havIdx(start, goal) * HEURISTIC_SCALE, start);

  while (heap.size > 0) {
    const u = heap.pop();
    if (u === goal) break;
    if (closedEpoch[u] === epoch) continue; // stale heap entry, already finalised
    closedEpoch[u] = epoch;

    for (let k = adjHead[u]; k < adjHead[u + 1]; k++) {
      const v = adjNode[k];
      if (closedEpoch[v] === epoch) continue;
      const tentative = gScore[u] + edgeWeight[adjEdge[k]];
      if (seenEpoch[v] !== epoch || tentative < gScore[v]) {
        gScore[v] = tentative;
        seenEpoch[v] = epoch;
        cameFrom[v] = u;
        cameEdge[v] = adjEdge[k]; // remember which edge we came in on, for geometry
        heap.push(tentative + havIdx(v, goal) * HEURISTIC_SCALE, v);
      }
    }
  }

  if (seenEpoch[goal] !== epoch) return null; // never reached goal

  const path = [];
  let cur = goal;
  while (cur !== -1) {
    path.push(cur);
    cur = cameFrom[cur];
  }
  path.reverse();
  return path;
}

// returns a geojson linestring of the route between two node ids, or null if no path
export function findRoute(startId, endId) {
  const start = osmToIdx.get(startId);
  const end = osmToIdx.get(endId);
  if (start === undefined || end === undefined) return null;

  const path = runAStar(start, end);
  if (!path || path.length === 0) return null;

  // stitch together edge geometries for accurate path drawing
  const coords = [];
  for (let i = 0; i < path.length - 1; i++) {
    const u = path[i];
    const v = path[i + 1];
    // cameEdge[v] is the edge used to reach v from u
    const e = cameEdge[v];
    const a = coordOffsets[e];
    const b = coordOffsets[e + 1];

    const forward = edgeFrom[e] === u;

    if (forward) {
      for (let k = a; k < b; k++) {
        coords.push([packLng[k] / coordScale, packLat[k] / coordScale]);
      }
    } else {
      for (let k = b - 1; k >= a; k--) {
        coords.push([packLng[k] / coordScale, packLat[k] / coordScale]);
      }
    }
  }

  let distanceM = 0; // calc distance in metres, so we can display it in the GUI
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    distanceM += haversine(lat1, lng1, lat2, lng2);
  }

  return {
    geometry: { type: "LineString", coordinates: coords },
    distanceM,
  };
}
