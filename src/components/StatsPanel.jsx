export default function StatsPanel({
  distanceM,
  speed,
  onSpeedChange,
  onToggleNetwork,
  networkVisible,
}) {
  const distanceKm = distanceM ? (distanceM / 1000).toFixed(1) : "—";
  const minutes = distanceM ? Math.round((distanceM / 1000 / speed) * 60) : "—";

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

      {/* km and minute display*/}
      <div>
        <strong>{distanceKm} km</strong>
      </div>
      <div>{minutes} min</div>
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
      {/* future export .gpx feature
      <button
        style={{
          marginTop: 10,
          width: "100%",
          padding: "6px 0",
          borderRadius: 6,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
          fontSize: 16,
          cursor: "pointer",
        }}
        onClick={() => console.log("gpx export (wip)")}
      >
        download .gpx (wip)
      </button>
      */}
    </div>
  );
}
