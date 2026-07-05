import { CONFIG_ORDER, configColor } from "./configPalette";

export default function ConfigLegend({ configs }) {
  const list = CONFIG_ORDER.filter((c) => configs.includes(c));
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "6px 0 2px", fontSize: 12, color: "#b7bcce" }}>
      {list.map((c) => (
        <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: configColor(c),
              border: c === "f16" ? "2px solid #8a897f" : "none",
              boxSizing: "border-box",
            }}
          />
          {c === "f16" ? "f16 (baseline)" : c}
        </span>
      ))}
    </div>
  );
}
