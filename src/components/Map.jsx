import { useEffect, useRef, useState } from "react";
import { Map as MaplibreMap, NavigationControl, Marker } from "maplibre-gl";
import { loadGraph, snapToNode, findRoute } from "../lib/graph";
import StatsPanel from "./StatsPanel";
import SearchPanel from "./SearchPanel";
import { useIsMobile } from "../lib/isMobile";
import { useStore } from "../store";

const SINGAPORE = { lng: 103.8198, lat: 1.3521 }; // map centres here on load
const ZOOM = 11;

function clearUrl() {
  history.replaceState(null, "", window.location.pathname);
}

// encode all waypoints into url params for sharing
function updateUrl(waypoints) {
  const params = new URLSearchParams();
  waypoints.forEach((wp) => {
    const [lng, lat] = wp.lngLat;
    params.append("wp", `${lat},${lng},${encodeURIComponent(wp.label)}`);
  });
  history.replaceState(null, "", `?${params.toString()}`);
}

function fmtCoord(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`; // display text for click-placed coords
}

export default function Map() {
  const container = useRef(null);
  const map = useRef(null);
  const graphReady = useRef(false); // true once graph.geojson is loaded
  const markers = useRef([]); // [{ id, marker }], parallel to storedWaypoints
  const [networkVisible, setNetworkVisible] = useState(false); // pcn network layer visibility toggle
  const [loading, setLoading] = useState(true); // used for loading message
  const [error, setError] = useState(null);
  const [speed, setSpeed] = useState(15); // km/h, user adjustable (slider)

  const {
    setTotalDistanceM,
    setRouteCoords,
    addWaypoint,
    setWaypoints,
    removeWaypoint,
    waypoints: storedWaypoints,
  } = useStore();

  const isMobile = useIsMobile(); // for mobile layouts

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
      {
        padding: isMobile
          ? { top: 40, bottom: 40, left: 40, right: 40 } // smaller padding on mobile
          : { top: 80, bottom: 80, left: 280, right: 260 },
        duration: 1000,
      },
    );
  }

  // recompute all segments whenever storedWaypoints changes
  useEffect(() => {
    if (!graphReady.current) return;

    if (storedWaypoints.length < 2) {
      // not enough points, clear route
      map.current
        ?.getSource("route")
        ?.setData({ type: "FeatureCollection", features: [] });
      setTotalDistanceM(null);
      setRouteCoords(null);
    } else {
      // compute each segment and concat coords
      let totalDist = 0;
      const allCoords = [];

      for (let i = 0; i < storedWaypoints.length - 1; i++) {
        const from = storedWaypoints[i];
        const to = storedWaypoints[i + 1];
        const result = findRoute(from.nodeId, to.nodeId);
        if (result) {
          totalDist += result.distanceM;
          allCoords.push(...result.geometry.coordinates);
        }
      }

      map.current.getSource("route").setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: allCoords },
      });
      setTotalDistanceM(totalDist);
      setRouteCoords(allCoords);
      if (allCoords.length) fitToRoute(allCoords);
    }

    // sync marker colors: first=green, last=red, middle=gray
    markers.current.forEach(({ id, marker }, i) => {
      const color =
        i === 0
          ? "#008000"
          : i === markers.current.length - 1
            ? "#D30000"
            : "#9ca3af";
      const lngLat = marker.getLngLat();
      marker.remove(); // maplibre markers don't support color updates, recreate
      const newMarker = new Marker({ color })
        .setLngLat(lngLat)
        .addTo(map.current);
      markers.current[i] = { id, marker: newMarker };
    });

    // update url to reflect current waypoints
    if (storedWaypoints.length > 0) {
      updateUrl(storedWaypoints);
    } else {
      clearUrl();
    }
  }, [storedWaypoints]);

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
      setLoading(false);

      // read url params and auto-route on load
      const params = new URLSearchParams(window.location.search);
      const wpParams = params.getAll("wp");
      if (wpParams.length > 0) {
        const restored = [];
        for (const raw of wpParams) {
          const firstComma = raw.indexOf(",");
          const secondComma = raw.indexOf(",", firstComma + 1);
          const lat = Number(raw.slice(0, firstComma));
          const lng = Number(raw.slice(firstComma + 1, secondComma));
          const label = decodeURIComponent(raw.slice(secondComma + 1));
          if (isNaN(lat) || isNaN(lng)) continue;

          const nodeId = snapToNode(lat, lng);
          if (!nodeId) continue;

          const id = crypto.randomUUID();
          const marker = new Marker().setLngLat([lng, lat]).addTo(map.current);
          markers.current.push({ id, marker });
          restored.push({ id, nodeId, lngLat: [lng, lat], label });
        }
        if (restored.length > 0) {
          setWaypoints(restored); // load route
        }
      }
    });

    // handle clicks, each click appends a waypoint
    map.current.on("click", (e) => {
      if (!graphReady.current) return;

      const { lat, lng } = e.lngLat;
      const nodeId = snapToNode(lat, lng); // snaps click to closest graph node
      if (!nodeId) return;

      setError(null);

      const id = crypto.randomUUID();
      const label = fmtCoord(lat, lng);

      // place marker (color will be corrected by the storedWaypoints useEffect)
      const marker = new Marker().setLngLat([lng, lat]).addTo(map.current);
      markers.current.push({ id, marker });

      addWaypoint({ id, nodeId, lngLat: [lng, lat], label });
    });
  }, []);

  // handle error message
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500); // error lasts 2.5s
    return () => clearTimeout(t);
  }, [error]);

  // geocode search result and append as a new waypoint
  function handleGeocode(lat, lng, name) {
    setError(null);
    if (!graphReady.current) return;

    const nodeId = snapToNode(lat, lng);
    if (!nodeId) return;

    const id = crypto.randomUUID();

    // place marker
    const marker = new Marker().setLngLat([lng, lat]).addTo(map.current);
    markers.current.push({ id, marker });

    map.current.flyTo({ center: [lng, lat], zoom: 14 }); // fly to added point
    addWaypoint({ id, nodeId, lngLat: [lng, lat], label: name });
  }

  // remove a waypoint by id, also removes its marker
  function handleRemoveWaypoint(id) {
    const entry = markers.current.find((m) => m.id === id);
    if (entry) entry.marker.remove();
    markers.current = markers.current.filter((m) => m.id !== id);
    removeWaypoint(id);
  }

  // reorder waypoints (from drag), markers array stays in sync
  function handleReorder(reordered) {
    // reorder markers.current to match new waypoint order
    markers.current = reordered.map((wp) =>
      markers.current.find((m) => m.id === wp.id),
    );
    setWaypoints(reordered);
  }

  // flip waypoint order (reverse the list)
  function flip() {
    const reversed = [...storedWaypoints].reverse();
    markers.current = [...markers.current].reverse();
    setWaypoints(reversed);
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

  // reset. clear all waypoints, markers, and route
  function reset() {
    markers.current.forEach(({ marker }) => marker.remove());
    markers.current = [];
    setWaypoints([]);
    setTotalDistanceM(null);
    setError(null);
    setRouteCoords(null);
    clearUrl();
    map.current
      .getSource("route")
      ?.setData({ type: "FeatureCollection", features: [] });
    map.current.flyTo({
      center: [SINGAPORE.lng, SINGAPORE.lat],
      zoom: ZOOM,
    }); // zoom back to default
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={container} style={{ width: "100%", height: "100%" }} />

      <SearchPanel
        onGeocode={handleGeocode}
        onError={setError}
        onReset={reset}
        onFlip={flip}
        onRemoveWaypoint={handleRemoveWaypoint}
        onReorder={handleReorder}
      />

      {/* loading message */}
      {loading && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: isMobile ? "50%" : 16,
            transform: isMobile ? "translate(-50%, -50%)" : "translateX(-50%)",
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: isMobile ? 10 : 16,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          loading map...
        </div>
      )}

      {/* error message at the top middle of the screen */}
      {error && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: isMobile ? "50%" : 16,
            transform: isMobile ? "translate(-50%, -50%)" : "translateX(-50%)",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#D30000",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: isMobile ? 10 : 16,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {error}
        </div>
      )}

      <StatsPanel
        speed={speed}
        onSpeedChange={setSpeed}
        networkVisible={networkVisible}
        onToggleNetwork={toggleNetwork}
      />
    </div>
  );
}
