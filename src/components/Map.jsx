import { useEffect, useRef, useState } from "react";
import { Map as MaplibreMap, NavigationControl, Marker } from "maplibre-gl";
import { loadGraph, snapToNode, findRoute } from "../lib/graph";
import StatsPanel from "./StatsPanel";
import SearchPanel from "./SearchPanel";

const SINGAPORE = { lng: 103.8198, lat: 1.3521 }; // map centres here on load
const ZOOM = 11;

// encode lat/lng into url params for sharing
function updateUrl(fromLngLat, toLngLat, fromName, toName) {
  const params = new URLSearchParams();
  if (fromName) params.set("fromName", fromName);
  if (toName) params.set("toName", toName);
  if (fromLngLat) params.set("from", `${fromLngLat[1]},${fromLngLat[0]}`);
  if (toLngLat) params.set("to", `${toLngLat[1]},${toLngLat[0]}`);
  history.replaceState(null, "", `?${params.toString()}`);
}

function clearUrl() {
  history.replaceState(null, "", window.location.pathname);
}

function fmtCoord(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`; // display text for click-placed coords
}

export default function Map() {
  const container = useRef(null);
  const map = useRef(null);
  const graphReady = useRef(false); // true once graph.geojson is loaded
  const waypoints = useRef([]); // [start node, end node]
  const markers = useRef({ start: null, end: null });
  const [networkVisible, setNetworkVisible] = useState(false); // pcn network layer visibility toggle

  const [error, setError] = useState(null);

  const [distanceM, setDistanceM] = useState(null); // dist in metres, used to calc time
  const [speed, setSpeed] = useState(15); // km/h, user adjustable (slider)
  const geocodedWaypoints = useRef([null, null]); // [fromNodeId, toNodeId] set by search

  const routeCoords = useRef(null); // for .gpx export

  const currentRoute = useRef({
    fromId: null,
    toId: null,
    fromLngLat: null,
    toLngLat: null,
    fromName: null, // name from search input, null if click-placed
    toName: null,
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

      // read url params and auto-route on load
      const params = new URLSearchParams(window.location.search);
      const fromParam = params.get("from");
      const toParam = params.get("to");
      const fromNameUrl = params.get("fromName");
      const toNameUrl = params.get("toName");
      if (fromParam && toParam) {
        const [fLat, fLng] = fromParam.split(",").map(Number);
        const [tLat, tLng] = toParam.split(",").map(Number);
        if (!isNaN(fLat) && !isNaN(fLng) && !isNaN(tLat) && !isNaN(tLng)) {
          // place start marker
          const fromNodeId = snapToNode(fLat, fLng);
          const toNodeId = snapToNode(tLat, tLng);
          if (fromNodeId && toNodeId) {
            markers.current.start = new Marker({ color: "#008000" })
              .setLngLat([fLng, fLat])
              .addTo(map.current);
            markers.current.end = new Marker({ color: "#D30000" })
              .setLngLat([tLng, tLat])
              .addTo(map.current);
            geocodedWaypoints.current = [fromNodeId, toNodeId];
            currentRoute.current = {
              fromId: fromNodeId,
              toId: toNodeId,
              fromLngLat: [fLng, fLat],
              toLngLat: [tLng, tLat],
              fromName: fromNameUrl,
              toName: toNameUrl,
            };
            setFromText(fromNameUrl || fmtCoord(fLat, fLng));
            setToText(toNameUrl || fmtCoord(tLat, tLng));
            const result = findRoute(fromNodeId, toNodeId);
            if (result) {
              map.current
                .getSource("route")
                .setData({ type: "Feature", geometry: result.geometry });
              setDistanceM(result.distanceM);
              routeCoords.current = result.geometry.coordinates;
              fitToRoute(result.geometry.coordinates);
            }
          }
        }
      }
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
        setFromText(fmtCoord(lat, lng));
        setToText("");
        currentRoute.current = {
          fromId: nodeId,
          toId: null,
          fromLngLat: [lng, lat],
          toLngLat: null,
          fromName: null, // click-placed, no name
          toName: null,
        }; // reset and store fromLngLat
        map.current
          .getSource("route")
          .setData({ type: "FeatureCollection", features: [] });
      }

      if (waypoints.current.length === 2) {
        // if 2nd click, place end marker and find route
        markers.current.end = new Marker({ color: "#D30000" })
          .setLngLat([lng, lat])
          .addTo(map.current);
        setToText(fmtCoord(lat, lng));

        // find route
        const [startId, endId] = waypoints.current;
        const result = findRoute(startId, endId);

        if (result) {
          routeCoords.current = result.geometry.coordinates;
          map.current.getSource("route").setData({
            // push route to GUI
            type: "Feature",
            geometry: result.geometry,
          });
          setDistanceM(result.distanceM);

          currentRoute.current.toId = endId;
          currentRoute.current.toLngLat = [lng, lat];
          updateUrl(currentRoute.current.fromLngLat, [lng, lat]); // write coords to url, no names for click-placed
          fitToRoute(result.geometry.coordinates); // zoom out to show the entire extent of the route
        } else {
          setError("no route found");
        }
        waypoints.current = []; // reset for next route
      }
    });
  }, []);

  // handle error message
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500); // error lasts 2.5s
    return () => clearTimeout(t);
  }, [error]);

  function handleGeocode(field, lat, lng, name) {
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
      currentRoute.current.fromName = name; // store search name
      map.current.flyTo({ center: [lng, lat], zoom: 14 }); // move to start pt
    } else {
      if (markers.current.end) markers.current.end.remove();
      markers.current.end = new Marker({ color: "#D30000" })
        .setLngLat([lng, lat])
        .addTo(map.current);
      geocodedWaypoints.current[1] = nodeId;
      currentRoute.current.toId = nodeId; // store for flip
      currentRoute.current.toLngLat = [lng, lat];
      currentRoute.current.toName = name; // store search name
      if (!geocodedWaypoints.current[0])
        // only fly if 'from' isn't set yet
        map.current.flyTo({ center: [lng, lat], zoom: 14 });
    }

    // route automatically once both fields are geocoded
    const [fromId, toId] = geocodedWaypoints.current;
    if (fromId && toId) {
      const result = findRoute(fromId, toId);
      if (result) {
        routeCoords.current = result.geometry.coordinates;
        map.current
          .getSource("route")
          .setData({ type: "Feature", geometry: result.geometry });
        setDistanceM(result.distanceM);
        updateUrl(
          currentRoute.current.fromLngLat,
          currentRoute.current.toLngLat,
          currentRoute.current.fromName,
          currentRoute.current.toName,
        ); // update url
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
    setFromText(""); // clear input fields
    setToText("");
    routeCoords.current = null; // get rid of coords
    clearUrl();
    map.current
      .getSource("route")
      ?.setData({ type: "FeatureCollection", features: [] });
    map.current.flyTo({
      center: [SINGAPORE.lng, SINGAPORE.lat],
      zoom: ZOOM,
    }); // zoom back to default
  }

  // swap the start and end pts
  function flip() {
    const { fromId, toId, fromLngLat, toLngLat, fromName, toName } =
      currentRoute.current;

    // swap stored state including names
    currentRoute.current = {
      fromId: toId,
      toId: fromId,
      fromLngLat: toLngLat,
      toLngLat: fromLngLat,
      fromName: toName,
      toName: fromName,
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
        routeCoords.current = result.geometry.coordinates;
        map.current
          .getSource("route")
          .setData({ type: "Feature", geometry: result.geometry });
        setDistanceM(result.distanceM);
        updateUrl(
          currentRoute.current.fromLngLat,
          currentRoute.current.toLngLat,
          currentRoute.current.fromName,
          currentRoute.current.toName,
        ); // update url after flip
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
      clearUrl();
    }
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={container} style={{ width: "100%", height: "100%" }} />

      <SearchPanel
        onGeocode={handleGeocode}
        onError={setError}
        onReset={reset}
        onFlip={flip}
        fromText={fromText}
        toText={toText}
        onFromChange={setFromText}
        onToChange={setToText}
        getRouteCoords={() => routeCoords.current}
      />

      {/* error message at the top middle of the screen */}
      {error && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#dc2626",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 16,
            whiteSpace: "nowrap",
            pointerEvents: "none",
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
