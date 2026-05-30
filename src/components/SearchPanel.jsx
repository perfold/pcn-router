import { useState } from "react";
import { geocode } from "../lib/geocode";

export default function SearchPanel({ onGeocode, onError, onReset }) {
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [loading, setLoading] = useState({ from: false, to: false }); // tracks which field is geocoding

  async function handleSubmit(field, query) {
    if (!query.trim()) return;
    setLoading((l) => ({ ...l, [field]: true }));

    const result = await geocode(query);
    setLoading((l) => ({ ...l, [field]: false }));

    if (!result) {
      onError(`no results for "${query}"`);
      return;
    }

    onGeocode(field, result.lat, result.lng);
  }

  function handleKeyDown(field, query, e) {
    if (e.key === "Enter") handleSubmit(field, query);
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        background: "white",
        borderRadius: 8,
        padding: "12px 16px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 220,
      }}
    >
      {/* input start point */}
      <input
        type="text"
        placeholder={loading.from ? "searching..." : "from"}
        value={fromText}
        onChange={(e) => setFromText(e.target.value)}
        onKeyDown={(e) => handleKeyDown("from", fromText, e)}
        style={inputStyle}
      />
      {/* input end pt */}
      <input
        type="text"
        placeholder={loading.to ? "searching..." : "to"}
        value={toText}
        onChange={(e) => setToText(e.target.value)}
        onKeyDown={(e) => handleKeyDown("to", toText, e)}
        style={inputStyle}
      />
      <button onClick={onReset} style={resetButtonStyle}>
        clear
      </button>
    </div>
  );
}

const inputStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
};

const resetButtonStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "6px 0",
  fontSize: 13,
  cursor: "pointer",
  background: "#f9fafb",
  fontFamily: "inherit",
};
