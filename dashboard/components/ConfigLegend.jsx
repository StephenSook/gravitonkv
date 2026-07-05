import { CONFIG_ORDER, configColor } from "./configPalette";

export default function ConfigLegend({ configs }) {
  const list = CONFIG_ORDER.filter((c) => configs.includes(c));
  return (
    <div className="legend">
      {list.map((c) => (
        <span key={c}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: configColor(c),
              border: c === "f16" ? "2px solid #7a8098" : "none",
              boxSizing: "border-box",
            }}
          />
          {c === "f16" ? "f16 (baseline)" : c}
        </span>
      ))}
    </div>
  );
}
