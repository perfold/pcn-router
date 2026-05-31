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
  const [networkVisible, setNetworkVisible] = useState(false); // pcn network layer visibility toggle

  const [error, setError] = useState(null);
  const [resetKey, setResetKey] = useState(0);

  const [distanceM, setDistanceM] = useState(null); // dist in metres, used to calc time
  const [speed, setSpeed] = useState(15); // km/h, user adjustable (slider)
  const geocodedWaypoints = useRef([null, null]); // [fromNodeId, toNodeId] set by search

  const currentRoute = useRef({
    fromId: null,
    toId: null,
    fromLngLat: null,
    toLngLat: null,
  }); // used for flip
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");

  // zooms map to fit a route's coordinate array
  function fitToRoute(coords) {
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

  useEffect(() => {
    if (map.current) return; // prevent reinitialising on re-render

    map.current = new MaplibreMap({
      container: container.current,
      style: "https://tiles.openfreemap.org/styles/bright", // purely 2d map, better performance
      center: [SINGAPORE.lng, SINGAPORE.lat],
      zoom: ZOOM,
    });

    map.current.addControl(new NavigationControl(), "bottom-right");

    // wait for base map to finish loading before adding layers
    map.current.on("load", async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}data/graph.geojson`);
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
        layout: { visibility: "none" }, // hidden by default until user toggles it on
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
        setError(null);
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

          currentRoute.current.toId = endId;
          currentRoute.current.toLngLat = [lng, lat];

          // zoom out to show the entire extent of the route
          fitToRoute(result.geometry.coordinates);
        } else {
          setError("no route found");
        }
        waypoints.current = []; // reset for next route
      }
    });
  }, []);

  function handleGeocode(field, lat, lng) {
    setError(null);
    if (!graphReady.current) return;

    const nodeId = snapToNode(lat, lng);
    if (!nodeId) return;

    if (field === "from") {
      if (markers.current.start) markers.current.start.remove();
      markers.current.start = new Marker({ color: "#008000" })
        .setLngLat([lng, lat])
        .addTo(map.current);
      geocodedWaypoints.current[0] = nodeId;
      currentRoute.current.fromId = nodeId; // store node for flip
      currentRoute.current.fromLngLat = [lng, lat];
      map.current.flyTo({ center: [lng, lat], zoom: 14 }); // move to start pt
    } else {
      if (markers.current.end) markers.current.end.remove();
      markers.current.end = new Marker({ color: "#D30000" })
        .setLngLat([lng, lat])
        .addTo(map.current);
      geocodedWaypoints.current[1] = nodeId;
      currentRoute.current.toId = nodeId; // store for flip
      currentRoute.current.toLngLat = [lng, lat];
      if (!geocodedWaypoints.current[0])
        // only fly if 'from' isn't set yet
        map.current.flyTo({ center: [lng, lat], zoom: 14 });
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
        fitToRoute(result.geometry.coordinates);
      } else {
        setError("no route found");
      }
    }
  }

  // pcn visibility toggle
  function toggleNetwork() {
    const next = !networkVisible;
    setNetworkVisible(next);
    map.current.setLayoutProperty(
      "graph-dedicated",
      "visibility",
      next ? "visible" : "none",
    );
  }

  // reset navigation / clear start/end fields
  function reset() {
    if (markers.current.start) markers.current.start.remove();
    if (markers.current.end) markers.current.end.remove();
    markers.current = { start: null, end: null };
    waypoints.current = [];
    geocodedWaypoints.current = [null, null];
    setDistanceM(null);
    setError(null);
    map.current
      .getSource("route")
      ?.setData({ type: "FeatureCollection", features: [] });
    setResetKey((k) => k + 1); // clear search panel text fields
  }

  // swap the start and end pts
  function flip() {
    const { fromId, toId, fromLngLat, toLngLat } = currentRoute.current;

    // swap stored state
    currentRoute.current = {
      fromId: toId,
      toId: fromId,
      fromLngLat: toLngLat,
      toLngLat: fromLngLat,
    };
    geocodedWaypoints.current = [toId ?? null, fromId ?? null];

    // if both points exist, just move markers to swapped positions
    if (fromLngLat && toLngLat) {
      markers.current.start?.setLngLat(toLngLat);
      markers.current.end?.setLngLat(fromLngLat);
    }
    // if only start exists, remove start and create end at that position
    else if (fromLngLat && !toLngLat) {
      markers.current.start?.remove();
      markers.current.start = null;
      markers.current.end = new Marker({ color: "#D30000" })
        .setLngLat(fromLngLat)
        .addTo(map.current);
    }
    // if only end exists, remove end and create start at that position
    else if (!fromLngLat && toLngLat) {
      markers.current.end?.remove();
      markers.current.end = null;
      markers.current.start = new Marker({ color: "#008000" })
        .setLngLat(toLngLat)
        .addTo(map.current);
    }

    // swap text fields
    setFromText(toText);
    setToText(fromText);

    // re-route if both points exist after flip
    const [newFromId, newToId] = geocodedWaypoints.current;
    if (newFromId && newToId) {
      const result = findRoute(newFromId, newToId);
      if (result) {
        map.current
          .getSource("route")
          .setData({ type: "Feature", geometry: result.geometry });
        setDistanceM(result.distanceM);
        fitToRoute(result.geometry.coordinates);
      } else {
        setError("no route found");
      }
    } else {
      // if only a single point after flip, clear any existing route
      map.current
        .getSource("route")
        ?.setData({ type: "FeatureCollection", features: [] });
      setDistanceM(null);
    }
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={container} style={{ width: "100%", height: "100%" }} />

      <SearchPanel
        key={resetKey}
        onGeocode={handleGeocode}
        onError={setError}
        onReset={reset}
        onFlip={flip}
        fromText={fromText}
        toText={toText}
        onFromChange={setFromText}
        onToChange={setToText}
      />

      {/* error message shown below search panel */}
      {error && (
        <div
          style={{
            position: "absolute",
            top: 110,
            left: 16,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#dc2626",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 13,
            maxWidth: 220,
          }}
        >
          {error}
        </div>
      )}

      <StatsPanel
        distanceM={distanceM}
        speed={speed}
        onSpeedChange={setSpeed}
        networkVisible={networkVisible}
        onToggleNetwork={toggleNetwork}
      />
    </div>
  );
}
