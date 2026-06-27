import { useIsMobile } from "../lib/isMobile";
import { useStore } from "../store";

export default function StatsPanel({
  speed,
  onSpeedChange,
  onToggleNetwork,
  networkVisible,
  onToggleSatellite,
  satelliteVisible,
}) {
  const totalDistanceM = useStore((s) => s.totalDistanceM);
  const distanceKm = totalDistanceM ? (totalDistanceM / 1000).toFixed(1) : "—";
  const minutes = totalDistanceM
    ? Math.round((totalDistanceM / 1000 / speed) * 60)
    : "—";
  const isMobile = useIsMobile();
  const fs = isMobile ? 10 : 16; // font size
  const fsSmall = isMobile ? 6 : 12; // font size
  const pad = isMobile ? "4px 4px" : "16px 16px"; // panel padding

  // style for the satellite view and pcn buttons
  function toggleStyle(active) {
    return {
      padding: "4px 4px",
      borderRadius: 6,
      borderWidth: 1,
      borderStyle: "solid",
      fontSize: fsSmall,
      cursor: "pointer",
      background: active ? "#374151" : "#f9fafb",
      color: active ? "white" : "#374151",
      borderColor: active ? "#374151" : "#e5e7eb",
    };
  }

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
      {/* satellite and pcn toggle buttons */}
      <div
        style={{
          position: "absolute", // positions relative to the panel
          top: isMobile ? 10 : 16,
          right: isMobile ? 12 : 16,
          display: "flex",
          flexDirection: "column", // stack instead of side-by-side
          gap: 4,
          alignItems: "stretch", // both buttons same width
        }}
      >
        {/* satellite view toggle */}
        <button
          style={toggleStyle(satelliteVisible)}
          onClick={onToggleSatellite}
        >
          satellite
        </button>

        {/* show/hide PCN button */}
        <button style={toggleStyle(networkVisible)} onClick={onToggleNetwork}>
          PCN
        </button>
      </div>

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
        />
      </div>
    </div>
  );
}
