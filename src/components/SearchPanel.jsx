import { geocode } from "../lib/geocode";
import { useState } from "react";
import { useIsMobile } from "../lib/isMobile";

export default function SearchPanel({
  fromText,
  toText,
  onFromChange,
  onToChange,
  onGeocode,
  onError,
  onReset,
  onFlip,
  getRouteCoords,
}) {
  const [copied, setCopied] = useState(false);

  async function handleSubmit(field, query) {
    if (!query.trim()) return;

    const result = await geocode(query);

    if (!result) {
      onError(`no results for "${query}"`);
      return;
    }

    onGeocode(field, result.lat, result.lng, query);
  }

  function handleKeyDown(field, query, e) {
    if (e.key === "Enter") {
      e.preventDefault(); // prevents the "move to next field" behaviour
      if (field === "to") e.target.blur(); // if done typing end point, hide keyboard
      handleSubmit(field, query);
    }
  }

  // export gpx function
  function exportGpx() {
    const coords = getRouteCoords();
    if (!coords) return;
    const trackpoints = coords
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
    const from = fromText.trim().replace(/\s+/g, "_") || "start";
    const to = toText.trim().replace(/\s+/g, "_") || "end";
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

  const isMobile = useIsMobile();
  const hasRoute = !!getRouteCoords();
  const fs = isMobile ? 10 : 16; // font size
  const pad = isMobile ? "4px 4px" : "16px 16px"; // panel padding

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
      {/* input start point */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div
          style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}
        >
          <input
            type="text"
            placeholder="start"
            value={fromText}
            onChange={(e) => onFromChange(e.target.value)}
            onKeyDown={(e) => handleKeyDown("from", fromText, e)}
            enterKeyHint="search"
            style={{
              fontSize: fs,
              padding: pad,
              width: "100%",
              boxSizing: "border-box",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              outline: "none",
            }}
          />

          {/* input end pt */}
          <input
            type="text"
            placeholder="end"
            value={toText}
            onChange={(e) => onToChange(e.target.value)}
            onKeyDown={(e) => handleKeyDown("to", toText, e)}
            enterKeyHint="search"
            style={{
              fontSize: fs,
              padding: pad,
              width: "100%",
              boxSizing: "border-box",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              outline: "none",
            }}
          />
        </div>

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
    </div>
  );
}
