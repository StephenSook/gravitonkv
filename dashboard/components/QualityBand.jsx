"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HAIRLINE, SURFACE_RAISED, TEXT_MUTED, TEXT_SECONDARY, CONFIG_ORDER } from "./configPalette";

// This band colors by KEY-cache precision, not by config identity, because the
// finding it shows is that the key cache dominates quality. Blue = 8-bit key
// (safe), orange = 4-bit key (at risk); f16 is the open baseline bar.
const KEY8 = new Set(["f16", "q8_0", "q8_0/q4_0"]);
const SAFE = "#0072B2";
const RISK = "#D55E00";
const KV_LABEL = { f16: "K16 V16", q8_0: "K8 V8", q4_0: "K4 V4", "q8_0/q4_0": "K8 V4", "q4_0/q8_0": "K4 V8" };

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function QTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: SURFACE_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 3, padding: "10px 12px", fontSize: 12, color: TEXT_SECONDARY }}>
      <div style={{ color: "#fff", marginBottom: 4 }}>{d.config} ({d.kv})</div>
      <div>KL divergence vs f16: {d.config === "f16" ? "baseline" : d.kld != null ? d.kld.toFixed(4) : "n/a"}</div>
      <div>NIAH mean: {d.niah != null ? (d.niah * 100).toFixed(0) + "%" : "n/a"}</div>
      <div>RULER-vt mean: {d.ruler != null ? (d.ruler * 100).toFixed(0) + "%" : "n/a"}</div>
    </div>
  );
}

export default function QualityBand({ cells }) {
  const data = useMemo(() => {
    const withQ = cells.filter((c) => c.quality);
    return CONFIG_ORDER.map((config) => {
      const cc = withQ.filter((c) => c.config === config);
      if (!cc.length) return null;
      const kld = cc.map((c) => c.quality.kld).find((v) => typeof v === "number") ?? null;
      const niah = mean(cc.map((c) => c.quality.niah).filter((v) => typeof v === "number"));
      const ruler = mean(cc.map((c) => c.quality.ruler_vt).filter((v) => typeof v === "number"));
      return { config, kv: KV_LABEL[config], kld: config === "f16" ? 0 : kld, niah, ruler, key8: KEY8.has(config) };
    }).filter(Boolean);
  }, [cells]);

  if (!data.length) return <p className="chart-note">Quality battery pending for this model.</p>;

  const maxKld = Math.max(...data.map((d) => d.kld ?? 0), 0.01);

  return (
    <div>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 12, right: 20, bottom: 14, left: 8 }}>
          <CartesianGrid stroke={HAIRLINE} strokeWidth={1} vertical={false} />
          <XAxis dataKey="config" tick={{ fill: TEXT_MUTED, fontSize: 12 }} axisLine={{ stroke: HAIRLINE }} tickLine={false} />
          <YAxis
            domain={[0, Math.ceil(maxKld * 10) / 10]}
            tick={{ fill: TEXT_MUTED, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={52}
            label={{ value: "KL divergence vs f16", angle: -90, position: "insideLeft", fill: TEXT_MUTED, fontSize: 12 }}
          />
          <Tooltip content={<QTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          <Bar dataKey="kld" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.config === "f16" ? "transparent" : d.key8 ? SAFE : RISK}
                stroke={d.config === "f16" ? "#ffffff" : "none"}
                strokeWidth={d.config === "f16" ? 1.5 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8, fontSize: 12, color: TEXT_SECONDARY }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: SAFE, borderRadius: 2, marginRight: 5, verticalAlign: "middle" }} />8-bit key (safe)</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: RISK, borderRadius: 2, marginRight: 5, verticalAlign: "middle" }} />4-bit key (at risk)</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, border: "1.5px solid #fff", borderRadius: 2, marginRight: 5, verticalAlign: "middle" }} />f16 baseline</span>
      </div>
      <p className="chart-note">
        KL divergence of the quantized-KV output distribution against f16, one measurement at c512. The key cache dominates: 8-bit-key configs stay low while 4-bit-key configs can collapse on the small Qwen models. Switch models to see where the cliff appears. NIAH and RULER-lite pass rates (means over the context ladder) are in the tooltip. Bars start at zero.
      </p>
    </div>
  );
}
