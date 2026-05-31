import { useIsMobile } from "../lib/isMobile";

export default function StatsPanel({
  distanceM,
  speed,
  onSpeedChange,
  onToggleNetwork,
  networkVisible,
}) {
  const distanceKm = distanceM ? (distanceM / 1000).toFixed(1) : "—";
  const minutes = distanceM ? Math.round((distanceM / 1000 / speed) * 60) : "—";
  const isMobile = useIsMobile();
  const fs = isMobile ? 10 : 16; // font size
  const pad = isMobile ? "4px 4px" : "16px 16px"; // panel padding

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        background: "white",
        borderRadius: 8,
        padding: pad,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        fontSize: fs,
        minWidth: isMobile ? 0 : 220,
        maxWidth: isMobile ? "calc(50vw - 24px)" : "none", // prevent overlap with search panel
      }}
    >
      {/* show/hide PCN button */}
      <button
        style={{
          position: "absolute", // positions relative to the panel
          top: isMobile ? 10 : 16,
          right: isMobile ? 12 : 16,
          padding: "4px 4px",
          borderRadius: 6,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
          fontSize: fs,
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

      {/* minutes display */}
      <span>{minutes} min</span>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: fs, display: "block", marginBottom: 4 }}>
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
