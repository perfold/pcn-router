export default function SearchPanel({ from, to, onFromChange, onToChange }) {
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
      <input
        type="text"
        placeholder="start"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        style={inputStyle}
      />
      <input
        type="text"
        placeholder="end"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

const inputStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit", // use Monserrat (best font)
};
