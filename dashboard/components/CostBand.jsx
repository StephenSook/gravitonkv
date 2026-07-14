"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HAIRLINE, SURFACE_RAISED, TEXT_MUTED, TEXT_SECONDARY, CONFIG_ORDER } from "./configPalette";
import pricing from "../public/data/pricing.json";

const CTX_LABEL = { 2048: "2k", 8192: "8k", 16384: "16k", 32768: "32k", 131072: "128k" };
const PREFILL = "#0072B2";
const DECODE = "#D55E00";

const RATE = pricing.instances[pricing.measured_instance].usd_per_hour;
// $/1M tokens for a single-stream (batch 1) throughput, in tokens per second.
const perM = (tps) => (RATE * 1e6) / (tps * 3600);

function CostTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: SURFACE_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 3, padding: "10px 12px", fontSize: 12, color: TEXT_SECONDARY }}>
      <div style={{ color: "#fff", marginBottom: 4 }}>{d.config}</div>
      <div>prefill: ${d.prefillCost.toFixed(2)} /1M {d.dPrefill != null ? `(${d.dPrefill})` : ""}</div>
      <div>decode: ${d.decodeCost.toFixed(2)} /1M {d.dDecode != null ? `(${d.dDecode})` : ""}</div>
    </div>
  );
}

function pctNum(v, base) {
  const p = (v / base - 1) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`;
}

export default function CostBand({ cells }) {
  const contexts = useMemo(() => [...new Set(cells.map((c) => c.context))].sort((a, b) => a - b), [cells]);
  const [ctx, setCtx] = useState(() => (contexts.includes(8192) ? 8192 : contexts[contexts.length - 1]));

  const data = useMemo(() => {
    const at = cells.filter((c) => c.context === ctx);
    const base = at.find((c) => c.config === "f16");
    const bp = base ? perM(base.prefill.median) : null;
    const bd = base ? perM(base.decode.median) : null;
    return CONFIG_ORDER.map((config) => {
      const c = at.find((x) => x.config === config);
      if (!c) return null;
      const prefillCost = perM(c.prefill.median);
      const decodeCost = perM(c.decode.median);
      return {
        config,
        prefillCost,
        decodeCost,
        dPrefill: config === "f16" || !bp ? null : pctNum(prefillCost, bp),
        dDecode: config === "f16" || !bd ? null : pctNum(decodeCost, bd),
      };
    }).filter(Boolean);
  }, [cells, ctx]);

  const headline = useMemo(() => {
    const f = data.find((d) => d.config === "f16");
    const q = data.find((d) => d.config === "q8_0");
    if (!f || !q) return null;
    return { prefill: pctNum(q.prefillCost, f.prefillCost), decode: pctNum(q.decodeCost, f.decodeCost) };
  }, [data]);

  if (!data.length) return <p className="chart-note">Cost data pending for this model.</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {contexts.map((c) => (
          <button key={c} onClick={() => setCtx(c)} className={`ctx-btn${c === ctx ? " active" : ""}`} aria-pressed={c === ctx}>
            {CTX_LABEL[c] ?? c}
          </button>
        ))}
      </div>
      {headline && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: TEXT_SECONDARY }}>
          At {CTX_LABEL[ctx] ?? ctx}, switching f16 to q8_0 KV moves prefill cost{" "}
          <span style={{ color: PREFILL }}>{headline.prefill}</span> and decode cost{" "}
          <span style={{ color: DECODE }}>{headline.decode}</span> per 1M tokens.
        </p>
      )}
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 12, right: 20, bottom: 14, left: 8 }} barGap={2}>
          <CartesianGrid stroke={HAIRLINE} strokeWidth={1} vertical={false} />
          <XAxis dataKey="config" tick={{ fill: TEXT_MUTED, fontSize: 12 }} axisLine={{ stroke: HAIRLINE }} tickLine={false} />
          <YAxis
            tick={{ fill: TEXT_MUTED, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v) => `$${v}`}
            label={{ value: "$ / 1M tokens", angle: -90, position: "insideLeft", fill: TEXT_MUTED, fontSize: 12 }}
          />
          <Tooltip content={<CostTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          <Bar dataKey="prefillCost" name="prefill $/1M" fill={PREFILL} isAnimationActive={false} radius={[2, 2, 0, 0]} />
          <Bar dataKey="decodeCost" name="decode $/1M" fill={DECODE} isAnimationActive={false} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8, fontSize: 12, color: TEXT_SECONDARY }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: PREFILL, borderRadius: 2, marginRight: 5, verticalAlign: "middle" }} />prefill $/1M</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: DECODE, borderRadius: 2, marginRight: 5, verticalAlign: "middle" }} />decode $/1M</span>
      </div>
      <p className="chart-note">
        Single-stream (batch 1) cost on {pricing.measured_instance} at ${RATE.toFixed(5)}/hr ({pricing.region}, on-demand, retrieved {pricing.retrieved}). $/1M tokens = hourly rate times 1e6 divided by (tokens per second times 3600). Quantizing the KV cache is a prefill-cost win and a decode-cost tax. These are not comparable to batched serverless GPU quotes, which reflect a saturated regime.
      </p>
    </div>
  );
}
