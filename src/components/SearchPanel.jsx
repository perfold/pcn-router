import { geocode } from "../lib/geocode";
import { useState } from "react";
import { useIsMobile } from "../lib/isMobile";
import { useStore } from "../store";
import WaypointList from "./WaypointList";

export default function SearchPanel({
  onGeocode,
  onError,
  onReset,
  onFlip,
  onRemoveWaypoint,
  onReorder,
}) {
  const [query, setQuery] = useState(""); // single search input
  const [copied, setCopied] = useState(false);
  const routeCoords = useStore((s) => s.routeCoords);
  const waypoints = useStore((s) => s.waypoints);
  const [listOpen, setListOpen] = useState(true);

  const isMobile = useIsMobile();
  const hasRoute = !!routeCoords;
  const fs = isMobile ? 10 : 16; // font size
  const pad = isMobile ? "4px 4px" : "16px 16px"; // panel padding

  async function handleSubmit() {
    if (!query.trim()) return;

    const result = await geocode(query);

    if (!result) {
      onError(`no results for "${query}"`);
      return;
    }

    onGeocode(result.lat, result.lng, query);
    setQuery(""); // clear input after adding
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault(); // prevents the "move to next field" behaviour on phone keyboard
      handleSubmit();
    }
  }

  // export gpx function
  function exportGpx() {
    if (!routeCoords) return;
    const trackpoints = routeCoords
      .map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
      .join("\n");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="pcn-router" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>PCN Route</name>
    <trkseg>
${trackpoints}
    </trkseg>
  </trk>
</gpx>`;
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // use first and last waypoint labels for filename
    const from = (waypoints[0]?.label || "start").replace(/\s+/g, "_");
    const to = (waypoints[waypoints.length - 1]?.label || "end").replace(
      /\s+/g,
      "_",
    );
    a.download = `${from}_to_${to}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // copy link for this route
  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        background: "white",
        borderRadius: 8,
        padding: pad,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: isMobile ? 0 : 220,
        maxWidth: isMobile ? "calc(50vw - 24px)" : "none", // prevent overlap with stats panel
        fontSize: fs,
        font: "inherit",
      }}
    >
      {/* single search input + flip button */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          placeholder="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          enterKeyHint="search"
          style={{
            fontSize: fs,
            padding: pad,
            flex: 1,
            boxSizing: "border-box",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            outline: "none",
          }}
        />

        {/* flip button on the right */}
        <button onClick={onFlip} style={{ fontSize: fs, alignSelf: "stretch" }}>
          ⇅
        </button>
      </div>

      <button onClick={onReset} style={{ fontSize: fs }}>
        clear
      </button>

      {/* copy link + export gpx button side by side */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={copyLink}
          style={{
            flex: 1,
            opacity: hasRoute ? 1 : 0.4,
            cursor: hasRoute ? "pointer" : "default",
            fontSize: isMobile ? 8 : 16,
            padding: pad,
          }}
        >
          {copied ? "copied!" : "copy link"}
        </button>
        <button
          onClick={exportGpx}
          style={{
            flex: 1,
            opacity: hasRoute ? 1 : 0.4,
            cursor: hasRoute ? "pointer" : "default",
            fontSize: isMobile ? 8 : 16,
            padding: pad,
          }}
        >
          export .gpx
        </button>
      </div>

      {/* collapsible waypoint list with drag to reorder*/}
      {waypoints.length > 0 && (
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 4 }}>
          {listOpen && (
            <WaypointList
              waypoints={waypoints}
              onReorder={onReorder}
              onRemove={onRemoveWaypoint}
            />
          )}
          <button
            onClick={() => setListOpen((v) => !v)}
            style={{
              width: "100%",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: fs,
              color: "#6b7280",
              padding: "2px 0",
            }}
          >
            {listOpen
              ? "▲"
              : `▼ ${waypoints.length} stop${waypoints.length > 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}
