import { useEffect, useRef, useState } from "react";
import { Map as MaplibreMap, NavigationControl, Marker } from "maplibre-gl";
import { loadGraph, snapToNode, findRoute } from "../lib/graph";
import StatsPanel from "./StatsPanel";
import SearchPanel from "./SearchPanel";

const SINGAPORE = { lng: 103.8198, lat: 1.3521 }; // map centres here on load
const ZOOM = 11;

export default function Map() {
  const container = useRef(null);
  const map = useRef(null);
  const graphReady = useRef(false); // true once graph.geojson is loaded
  const waypoints = useRef([]); // [start node, end node]
  const markers = useRef({ start: null, end: null });

  const [distanceM, setDistanceM] = useState(null); // dist in metres, used to calc time
  const [speed, setSpeed] = useState(15); // km/h, user adjustable (slider)
  const geocodedWaypoints = useRef([null, null]); // [fromNodeId, toNodeId] set by search

  useEffect(() => {
    if (map.current) return; // prevent reinitialising on re-render

    map.current = new MaplibreMap({
      container: container.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [SINGAPORE.lng, SINGAPORE.lat],
      zoom: ZOOM,
    });

    map.current.addControl(new NavigationControl(), "bottom-right");

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
          "line-opacity": 0.5,
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
          "line-opacity": 0.5,
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
          "line-width": 6,
        },
      });

      await loadGraph(geojson);
      graphReady.current = true;
    });

    // handle clicks
    map.current.on("click", (e) => {
      if (!graphReady.current) return;

      const { lat, lng } = e.lngLat; // first click selects start pt, second click selects end pt

      const nodeId = snapToNode(lat, lng); // snaps clicks to closest node

      if (!nodeId) return;

      waypoints.current.push(nodeId);

      if (waypoints.current.length === 1) {
        // 1st click, place start marker and clear any previous route and markers
        if (markers.current.start) markers.current.start.remove();
        if (markers.current.end) markers.current.end.remove();
        markers.current.start = new Marker({ color: "#008000" })
          .setLngLat([lng, lat])
          .addTo(map.current);
        setDistanceM(null);
        map.current
          .getSource("route")
          .setData({ type: "FeatureCollection", features: [] });
      }

      if (waypoints.current.length === 2) {
        // if 2nd click, place end marker and find route
        markers.current.end = new Marker({ color: "#D30000" })
          .setLngLat([lng, lat])
          .addTo(map.current);

        // find route
        const [startId, endId] = waypoints.current;
        const result = findRoute(startId, endId);

        if (result) {
          map.current.getSource("route").setData({
            // push route to GUI
            type: "Feature",
            geometry: result.geometry,
          });
          setDistanceM(result.distanceM);

          // zoom out to show the entire extent of the route
          const coords = result.geometry.coordinates;

          let minLng = Infinity,
            maxLng = -Infinity;
          let minLat = Infinity,
            maxLat = -Infinity;

          coords.forEach(([lng, lat]) => {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          });

          map.current.fitBounds(
            [
              [minLng, minLat],
              [maxLng, maxLat],
            ],
            { padding: 80, duration: 1000 },
          );
        } else {
          console.log("no route found between these points");
        }
        waypoints.current = []; // reset for next route
      }
    });
  }, []);

  function handleGeocode(field, lat, lng) {
    if (!graphReady.current) return;

    const nodeId = snapToNode(lat, lng);
    if (!nodeId) return;

    if (field === "from") {
      if (markers.current.start) markers.current.start.remove();
      markers.current.start = new Marker({ color: "#008000" })
        .setLngLat([lng, lat])
        .addTo(map.current);
      geocodedWaypoints.current[0] = nodeId;
      map.current.flyTo({ center: [lng, lat], zoom: 14 }); // move to start pt
    } else {
      if (markers.current.end) markers.current.end.remove();
      markers.current.end = new Marker({ color: "#D30000" })
        .setLngLat([lng, lat])
        .addTo(map.current);
      geocodedWaypoints.current[1] = nodeId;
    }

    // route automatically once both fields are geocoded
    const [fromId, toId] = geocodedWaypoints.current;
    if (fromId && toId) {
      const result = findRoute(fromId, toId);
      if (result) {
        map.current
          .getSource("route")
          .setData({ type: "Feature", geometry: result.geometry });
        setDistanceM(result.distanceM);

        // zoom out to show the entire extent of the route
        const coords = result.geometry.coordinates;

        let minLng = Infinity,
          maxLng = -Infinity;
        let minLat = Infinity,
          maxLat = -Infinity;

        coords.forEach(([lng, lat]) => {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        });

        map.current.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 80, duration: 1000 },
        );
      }
    }
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={container} style={{ width: "100%", height: "100%" }} />
      <SearchPanel onGeocode={handleGeocode} />
      <StatsPanel
        distanceM={distanceM}
        speed={speed}
        onSpeedChange={setSpeed}
      />
    </div>
  );
}
