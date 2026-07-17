import { useEffect, useRef, useState } from "react";
import { Map as MaplibreMap, NavigationControl, Marker } from "maplibre-gl";
import { loadGraph, snapToNode, findRoute } from "../lib/graph";
import { findNearest } from "../lib/geocode";
import { haversineM } from "../lib/nearest";
import StatsPanel from "./StatsPanel";
import SearchPanel from "./SearchPanel";
import NavPanel from "./NavPanel";
import { useIsMobile } from "../lib/isMobile";
import { useStore } from "../store";

const SINGAPORE = { lng: 103.8198, lat: 1.3521 }; // map centres here on load
const ZOOM = 11;
const NAV_ZOOM = 18; // zoom level during nav mode (higher = more zoomed in)
const OFF_ROUTE_M = 50; // 'off route' threshold
const LEADIN_MIN_M = 80; // dont prepend a lead-in if youre alr this close to the first waypoint
const ACCURACY_GATE_M = 40; // ignore gps fixes less accurate than this
const MAX_KMH = 60; // prevent crazy speed spikes from gps noise
const STATIONARY_KMH = 5; // treat anything slower as not moving

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

// cumulative distance, to check remaining distance in a route
function buildCumulative(coords) {
  const cumulative = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) {
    cumulative[i] =
      cumulative[i - 1] +
      haversineM(
        coords[i - 1][1],
        coords[i - 1][0],
        coords[i][1],
        coords[i][0],
      );
  }
  return cumulative;
}

function nearestCoordIdx(coords, lat, lng) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const dLng = (coords[i][0] - lng) * cosLat;
    const dLat = coords[i][1] - lat;
    const d = dLng * dLng + dLat * dLat;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// location dot with a heading arrow for nav mode
function makeUserDot() {
  const el = document.createElement("div");
  el.style.cssText = "width:22px;height:30px;position:relative;";
  el.innerHTML =
    '<div style="position:absolute;left:50%;top:1px;transform:translateX(-50%);width:0;height:0;' +
    'border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:9px solid #750000;"></div>' +
    '<div style="position:absolute;left:0;top:8px;width:22px;height:22px;border-radius:50%;' +
    'background:#750000;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>';
  return el;
}

export default function Map() {
  const container = useRef(null);
  const map = useRef(null);
  const graphReady = useRef(false); // true once the graph binary is loaded
  const markers = useRef([]); // [{ id, marker }], parallel to storedWaypoints
  const [networkVisible, setNetworkVisible] = useState(false); // pcn network layer visibility toggle
  const [satelliteVisible, setSatelliteVisible] = useState(false); // esri satellite layer visibility toggle
  const [loading, setLoading] = useState(true); // used for loading message
  const [error, setError] = useState(null);
  const [speed, setSpeed] = useState(15); // km/h, user adjustable (slider)

  const [navigating, setNavigating] = useState(false);
  const [navStats, setNavStats] = useState(null); // { remainingM, speedKmh, etaMin, offRoute }
  const nav = useRef(null);

  const {
    setTotalDistanceM,
    setRouteCoords,
    addWaypoint,
    setWaypoints,
    removeWaypoint,
    waypoints: storedWaypoints,
    routeCoords: storedRouteCoords,
  } = useStore();

  const isMobile = useIsMobile(); // for mobile layouts

  const speedRef = useRef(speed);
  speedRef.current = speed;

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
      // esri satellite map
      map.current.addSource("satellite", {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
      });

      map.current.addLayer({
        id: "satellite",
        type: "raster",
        source: "satellite",
        layout: { visibility: "none" },
      });

      // load pcn overlay
      console.time("fetch overlay");
      const overlayRes = await fetch(
        `${import.meta.env.BASE_URL}data/pcn-overlay.geojson`,
      );
      const overlay = await overlayRes.json();
      console.timeEnd("fetch overlay");

      map.current.addSource("graph", {
        type: "geojson",
        data: overlay,
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

      // grey dashed line from current location to closest point on route (if you are offroute)
      map.current.addSource("offroute", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.current.addLayer({
        id: "offroute-line",
        type: "line",
        source: "offroute",
        paint: {
          "line-color": "#9ca3af",
          "line-width": 3,
          "line-dasharray": [2, 2],
        },
      });

      // routing graph
      console.time("loadGraph");
      const [meta, bin] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/graph.meta.json`).then((r) =>
          r.json(),
        ),
        fetch(`${import.meta.env.BASE_URL}data/graph.bin`).then((r) =>
          r.arrayBuffer(),
        ),
      ]);
      await loadGraph(meta, bin);
      console.timeEnd("loadGraph");

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
      if (nav.current) return; // prevent adding of waypoints during nav mode

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

  // stop sensors and remove the dot if the component ever unmounts mid-nav
  useEffect(
    () => () => {
      const session = nav.current;
      if (session) {
        if (session.watchId != null)
          navigator.geolocation.clearWatch(session.watchId);
        session.stopCompass?.();
        session.marker?.remove();
      }
    },
    [],
  );

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

  // add the user's current location as a waypoint
  function handleUseCurrentLocation() {
    if (!graphReady.current) return;
    if (!navigator.geolocation) {
      setError("geolocation not supported on this browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const nodeId = snapToNode(lat, lng);
        if (!nodeId) {
          setError("couldn't find a cycleable path near you");
          return;
        }

        setError(null);
        const id = crypto.randomUUID();

        // place marker
        const marker = new Marker().setLngLat([lng, lat]).addTo(map.current);
        markers.current.push({ id, marker });

        map.current.flyTo({ center: [lng, lat], zoom: 14 }); // fly to added point
        addWaypoint({ id, nodeId, lngLat: [lng, lat], label: "my location" });
      },
      () => setError("couldn't get your location, check permissions"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // find the nearest <place> to the last stop and add it
  async function handleFindNearest(query) {
    if (!graphReady.current) return;
    setError(null);

    // reference point is last waypoint, else current gps position
    let ref = null;
    if (storedWaypoints.length > 0) {
      const [lng, lat] = storedWaypoints[storedWaypoints.length - 1].lngLat;
      ref = { lat, lng };
    } else if (navigator.geolocation) {
      ref = await new Promise((resolve) =>
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000 },
        ),
      );
    }
    if (!ref) {
      setError("add a stop or allow location access first");
      return;
    }

    let hit = null;
    try {
      hit = await findNearest(query, ref.lat, ref.lng);
    } catch {}
    if (!hit) {
      setError(`no "${query}" found within 8km`);
      return;
    }

    const name = hit.label.split(",")[0].trim();
    handleGeocode(hit.lat, hit.lng, name);
  }

  // compass heading via deviceorientation, stored on the session
  function startCompass(session) {
    const handler = (e) => {
      let hdg = null;
      if (typeof e.webkitCompassHeading === "number") {
        hdg = e.webkitCompassHeading; // ios, already clockwise from north
      } else if (e.absolute && e.alpha != null) {
        hdg = (360 - e.alpha) % 360; // android absolute orientation
      }
      if (hdg == null || Number.isNaN(hdg)) return;
      session.heading = hdg;

      // rotate the map as the phone rotates
      const now = Date.now();
      if (
        nav.current === session &&
        session.marker &&
        now - session.lastRotateAt > 300
      ) {
        session.lastRotateAt = now;
        session.marker.setRotation(hdg);
        map.current.easeTo({ bearing: hdg, duration: 300 });
      }
    };

    const evt =
      "ondeviceorientationabsolute" in window
        ? "deviceorientationabsolute"
        : "deviceorientation";

    // ios 13+ gates the compass behind an explicit permission prompt
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      DeviceOrientationEvent.requestPermission()
        .then((p) => {
          if (p === "granted") window.addEventListener(evt, handler);
        })
        .catch(() => {}); // if no compass, its fine, gps course takes over
    } else {
      window.addEventListener(evt, handler);
    }
    return () => window.removeEventListener(evt, handler);
  }

  // padding to keep the nav dot centered at the bottom of the screen
  function navPadding() {
    const h = container.current?.clientHeight ?? 0;
    return { top: h * 0.35, bottom: 0, left: 0, right: 0 };
  }

  // per-gps-fix update: dot position, camera, remaining distance, speed, eta
  function handleFix(pos) {
    const session = nav.current;
    if (!session || !session.cumulative) return;
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const now = pos.timestamp ?? Date.now();

    // ignore low-accuracy fixes (common indoors)
    if (accuracy != null && accuracy > ACCURACY_GATE_M) return;

    session.marker.setLngLat([lng, lat]);

    // gps doppler when available, else distance over time between fixes
    let mps = pos.coords.speed;
    if ((mps == null || Number.isNaN(mps)) && session.lastFix) {
      const dt = (now - session.lastFix.t) / 1000;
      if (dt > 0.5)
        mps =
          haversineM(session.lastFix.lat, session.lastFix.lng, lat, lng) / dt;
    }
    if (mps != null && !Number.isNaN(mps)) {
      let kmh = Math.min(mps * 3.6, MAX_KMH); //
      if (kmh < STATIONARY_KMH) kmh = 0; // slow movement doesnt count (might be walking)
      session.emaSpeedKmh =
        session.emaSpeedKmh == null
          ? kmh
          : session.emaSpeedKmh * 0.8 + kmh * 0.2; // heavier smoothing to ride out gps jitter
    }
    session.lastFix = { lat, lng, t: now };

    // progress along the route
    const idx = nearestCoordIdx(session.coords, lat, lng);
    const [rLng, rLat] = session.coords[idx];
    const offM = haversineM(lat, lng, rLat, rLng);
    const remainingM = Math.max(0, session.totalM - session.cumulative[idx]);
    const offRoute = offM > OFF_ROUTE_M;

    // while off route, draw a straight grey dashed line from the user to the closest route point
    map.current.getSource("offroute")?.setData(
      offRoute
        ? {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [lng, lat],
                [rLng, rLat],
              ],
            },
          }
        : { type: "FeatureCollection", features: [] },
    );

    const speedKmh = session.emaSpeedKmh ?? 0;
    const etaSpeed = speedKmh > 2 ? speedKmh : speedRef.current;
    const etaMin =
      etaSpeed > 0 ? Math.round((remainingM / 1000 / etaSpeed) * 60) : null;

    setNavStats({
      remainingM,
      speedKmh,
      etaMin,
      offRoute,
    });

    // follow user on map
    let bearing = session.heading;
    if (
      bearing == null &&
      pos.coords.heading != null &&
      !Number.isNaN(pos.coords.heading) &&
      speedKmh > 5
    ) {
      bearing = pos.coords.heading;
    }
    const cam = {
      center: [lng, lat],
      zoom: NAV_ZOOM,
      padding: navPadding(),
      duration: 800,
    };
    if (bearing != null) {
      cam.bearing = bearing;
      session.marker.setRotation(bearing); // arrow points travel direction
    }
    map.current.easeTo(cam);
  }

  // start navigation along the current route
  function startNavigation() {
    if (!storedRouteCoords || nav.current) return;
    if (!navigator.geolocation) {
      setError("geolocation not supported on this browser");
      return;
    }

    const session = {
      coords: storedRouteCoords,
      cumulative: null,
      totalM: 0,
      watchId: null,
      stopCompass: null,
      heading: null, // compass heading, degrees clockwise from north
      lastFix: null, // { lat, lng, t } for fallback speed calc
      emaSpeedKmh: null, // smoothed current speed
      lastRotateAt: 0,
      marker: null,
    };
    nav.current = session;

    session.stopCompass = startCompass(session);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;

        // route the user to the first waypoint by prepending a lead-in segment
        const firstWp = storedWaypoints[0];
        const [fLng, fLat] = firstWp.lngLat;
        const distToFirstM = haversineM(lat, lng, fLat, fLng);
        const startNode = snapToNode(lat, lng);
        if (
          distToFirstM > LEADIN_MIN_M &&
          startNode &&
          firstWp &&
          startNode !== firstWp.nodeId
        ) {
          const leadIn = findRoute(startNode, firstWp.nodeId);
          if (leadIn)
            session.coords = [
              ...leadIn.geometry.coordinates,
              ...session.coords,
            ];
        }
        session.cumulative = buildCumulative(session.coords);
        session.totalM = session.cumulative[session.cumulative.length - 1];

        // show the lead-in on the map too
        map.current.getSource("route").setData({
          type: "Feature",
          geometry: { type: "LineString", coordinates: session.coords },
        });

        // user dot, map-aligned so the arrow rotates with the map plane
        session.marker = new Marker({
          element: makeUserDot(),
          rotationAlignment: "map",
        })
          .setLngLat([lng, lat])
          .addTo(map.current);

        setNavigating(true);

        map.current.easeTo({
          center: [lng, lat],
          zoom: NAV_ZOOM,
          padding: navPadding(),
          duration: 800,
        });
        setNavStats({
          remainingM: session.totalM,
          speedKmh: 0,
          etaMin: Math.round((session.totalM / 1000 / speedRef.current) * 60),
          offRoute: false,
        });

        handleFix(pos);

        session.watchId = navigator.geolocation.watchPosition(
          handleFix,
          () => {},
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
        );
      },
      () => {
        session.stopCompass?.();
        nav.current = null;
        setError("couldn't get your location, check permissions");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // exit nav mode: stop sensors, remove the dot, restore the planned route view
  function stopNavigation() {
    const session = nav.current;
    nav.current = null;
    if (session) {
      if (session.watchId != null)
        navigator.geolocation.clearWatch(session.watchId);
      session.stopCompass?.();
      session.marker?.remove();
    }
    setNavigating(false);
    setNavStats(null);

    // put the planned route (without the lead-in) back, reset the nav camera padding, face north
    map.current.easeTo({
      bearing: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      duration: 600,
    });
    if (storedRouteCoords) {
      map.current.getSource("route")?.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: storedRouteCoords },
      });
      map.current.getSource("offroute")?.setData({
        type: "FeatureCollection",
        features: [],
      });
      fitToRoute(storedRouteCoords);
    }
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

  // satellite visibility toggle
  function toggleSatellite() {
    const next = !satelliteVisible;
    setSatelliteVisible(next);
    map.current.setLayoutProperty(
      "satellite",
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

      {/* search panel hidden during navigation so the map is unobstructed */}
      {!navigating && (
        <SearchPanel
          onGeocode={handleGeocode}
          onError={setError}
          onReset={reset}
          onFlip={flip}
          onRemoveWaypoint={handleRemoveWaypoint}
          onReorder={handleReorder}
          onUseCurrentLocation={handleUseCurrentLocation}
          onFindNearest={handleFindNearest}
          onNavigate={startNavigation}
        />
      )}

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

      {!navigating && (
        <StatsPanel
          speed={speed}
          onSpeedChange={setSpeed}
          networkVisible={networkVisible}
          onToggleNetwork={toggleNetwork}
          satelliteVisible={satelliteVisible}
          onToggleSatellite={toggleSatellite}
        />
      )}

      {navigating && <NavPanel stats={navStats} onExit={stopNavigation} />}
    </div>
  );
}
