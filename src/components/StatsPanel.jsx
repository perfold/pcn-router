export default function StatsPanel({
  distanceM,
  speed,
  onSpeedChange,
  onToggleNetwork,
  networkVisible,
  getRouteCoords,
  fromText,
  toText,
}) {
  const distanceKm = distanceM ? (distanceM / 1000).toFixed(1) : "—";
  const minutes = distanceM ? Math.round((distanceM / 1000 / speed) * 60) : "—";

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
    a.download = `${from}_to_${to}.gpx`; // output .gpx file has start and end points in it's filename
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        background: "white",
        borderRadius: 8,
        padding: "16px 16px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        fontSize: 16,
        lineHeight: 1.8,
        minWidth: 220,
      }}
    >
      {/* show/hide PCN button */}
      <button
        style={{
          position: "absolute", // positions relative to the panel
          top: 16,
          right: 16,
          padding: "4px 4px",
          borderRadius: 6,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
          fontSize: 16,
          cursor: "pointer",
        }}
        onClick={onToggleNetwork}
      >
        {networkVisible ? "hide" : "show"} PCN
      </button>

      {/* km display */}
      <div>
        <strong>{distanceKm} km</strong>
      </div>

      {/* minutes + gpx button on the same row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>{minutes} min</span>
        <button
          onClick={exportGpx}
          style={{
            position: "absolute",
            top: 48, // sits just below the show pcn button
            right: 16,
            padding: "4px 4px",
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            fontSize: 16,
            fontFamily: "inherit",
            opacity: distanceM ? 1 : 0.5, // greyed out if no route shown
            cursor: distanceM ? "pointer" : "default",
          }}
        >
          export .gpx
        </button>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 16, display: "block", marginBottom: 4 }}>
          speed: {speed} km/h
        </label>
        {/* speed slider */}
        <input
          type="range"
          min={0}
          max={30}
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          style={{ width: "100%" }}
          color="#750000"
        />
      </div>
    </div>
  );
}
