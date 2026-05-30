import { useEffect, useRef } from "react";
import { Map as MaplibreMap, NavigationControl } from "maplibre-gl";
import { loadGraph, snapToNode, findRoute } from "../lib/graph";

const SINGAPORE = { lng: 103.8198, lat: 1.3521 }; // map centres here on load
const ZOOM = 11;

export default function Map() {
  const container = useRef(null);
  const map = useRef(null);
  const graphReady = useRef(false); // true once graph.geojson is loaded
  const waypoints = useRef([]); // [start node, end node]

  useEffect(() => {
    if (map.current) return; // prevent reinitialising on re-render

    map.current = new MaplibreMap({
      container: container.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [SINGAPORE.lng, SINGAPORE.lat],
      zoom: ZOOM,
    });

    map.current.addControl(new NavigationControl(), "top-right");

    // wait for base map to finish loading before adding layers
    map.current.on("load", async () => {
      const res = await fetch("/data/graph.geojson");
      const geojson = await res.json();

      map.current.addSource("graph", {
        type: "geojson",
        data: geojson,
      });

      // paths that overlap with nparks/lta/ura reference data (preferred by router)
      map.current.addLayer({
        id: "graph-dedicated",
        type: "line",
        source: "graph",
        filter: ["==", ["get", "path_type"], "dedicated"],
        paint: {
          "line-color": "#750000",
          "line-width": 2,
        },
      });

      // osm-only paths used to connect dedicated segments
      map.current.addLayer({
        id: "graph-footway",
        type: "line",
        source: "graph",
        filter: ["==", ["get", "path_type"], "footway"],
        paint: {
          "line-color": "#808080",
          "line-width": 1,
        },
      });
      // add an empty source for the route, updated when route is found
      map.current.addSource("route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.current.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#FF6E00",
          "line-width": 4,
        },
      });

      await loadGraph();
      graphReady.current = true;
    });

    // handle clicks
    map.current.on("click", (e) => {
      if (!graphReady.current) return;

      const { lat, lng } = e.lngLat; // first click selects start pt, second click selects end pt

      const nodeId = snapToNode(lat, lng); // snaps clicks to closest node

      if (!nodeId) return;

      waypoints.current.push(nodeId);

      if (waypoints.current.length === 2) {
        // if 2 points (start and end) selected, find route
        const [startId, endId] = waypoints.current;
        const route = findRoute(startId, endId);

        if (route) {
          map.current.getSource("route").setData({
            // push route to GUI
            type: "Feature",
            geometry: route,
          });
        } else {
          console.log("no route found between these points");
        }
        waypoints.current = []; // reset for next route
      }
    });
  }, []);

  return <div ref={container} style={{ width: "100%", height: "100%" }} />;
}
