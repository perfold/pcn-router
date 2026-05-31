import { geocode } from "../lib/geocode";
import { useState } from "react";

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
    if (e.key === "Enter") handleSubmit(field, query);
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

  const hasRoute = !!getRouteCoords();

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        background: "white",
        borderRadius: 8,
        padding: "16px 16px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 220,
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
            style={inputStyle}
          />

          {/* input end pt */}
          <input
            type="text"
            placeholder="end"
            value={toText}
            onChange={(e) => onToChange(e.target.value)}
            onKeyDown={(e) => handleKeyDown("to", toText, e)}
            style={inputStyle}
          />
        </div>
        {/* flip button on the right */}
        <button onClick={onFlip} style={flipButtonStyle}>
          ⇅
        </button>
      </div>
      <button onClick={onReset} style={actionButtonStyle}>
        clear
      </button>

      {/* copy link + export gpx button side by side */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={copyLink}
          style={{
            ...actionButtonStyle,
            flex: 1,
            opacity: hasRoute ? 1 : 0.4,
            cursor: hasRoute ? "pointer" : "default",
          }}
        >
          {copied ? "copied!" : "copy link"}
        </button>
        <button
          onClick={exportGpx}
          style={{
            ...actionButtonStyle,
            flex: 1,
            opacity: hasRoute ? 1 : 0.4,
            cursor: hasRoute ? "pointer" : "default",
          }}
        >
          export .gpx
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 16,
  outline: "none",
  fontFamily: "inherit",
};

const actionButtonStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "8px 0",
  fontSize: 16,
  cursor: "pointer",
  background: "#f9fafb",
  fontFamily: "inherit",
};

const flipButtonStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "0 8px",
  fontSize: 16,
  cursor: "pointer",
  background: "#f9fafb",
  fontFamily: "inherit",
  alignSelf: "stretch",
};
