import { useIsMobile } from "../lib/isMobile";

export default function NavPanel({ stats, onExit }) {
  const isMobile = useIsMobile();
  const fs = isMobile ? 22 : 34;
  const fsSmall = isMobile ? 11 : 14;
  const pad = isMobile ? "8px 8px" : "16px 16px";

  const km = stats ? (stats.remainingM / 1000).toFixed(1) : "-";
  const eta = stats?.etaMin ?? "-";
  const speed = stats ? Math.round(stats.speedKmh) : "-";

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        background: "white",
        borderRadius: 6,
        padding: pad,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: isMobile ? 8 : 10,
        whiteSpace: "nowrap",
        minWidth: isMobile ? "70vw" : 420,
      }}
    >
      {/* metrics: distance, speed, eta */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          gap: isMobile ? 16 : 32,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <strong style={{ fontSize: fs }}>{km} km</strong>
          <div style={{ fontSize: fsSmall, color: "#6b7280" }}>left</div>
        </div>

        <div style={{ textAlign: "center" }}>
          <strong style={{ fontSize: fs }}>{speed} km/h</strong>
          <div style={{ fontSize: fsSmall, color: "#6b7280" }}>speed</div>
        </div>

        <div style={{ textAlign: "center" }}>
          <strong style={{ fontSize: fs }}>{eta} min</strong>
          <div style={{ fontSize: fsSmall, color: "#6b7280" }}>eta</div>
        </div>
      </div>

      {/* off route message */}
      {stats?.offRoute && (
        <span
          style={{ color: "#D30000", fontSize: fsSmall, textAlign: "center" }}
        >
          off route
        </span>
      )}

      {/* exit button */}
      <button
        onClick={onExit}
        style={{
          alignSelf: "center",
          fontSize: isMobile ? 12 : 14,
          padding: "2px 8px",
          lineHeight: 1.2,
        }}
      >
        exit
      </button>
    </div>
  );
}
