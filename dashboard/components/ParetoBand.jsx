"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { configColor, HAIRLINE, SURFACE_RAISED, TEXT_MUTED, TEXT_SECONDARY } from "./configPalette";
import ConfigLegend from "./ConfigLegend";

function paretoFrontier(points) {
  // Up-and-left is better: max decode, min memory. Sort by memory ascending,
  // keep points whose decode exceeds every point to their left.
  const sorted = [...points].sort((a, b) => a.memory - b.memory);
  const frontier = [];
  let best = -Infinity;
  for (const p of sorted) {
    if (p.decode > best) {
      frontier.push(p);
      best = p.decode;
    }
  }
  return frontier;
}

function PointTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: SURFACE_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 3, padding: "10px 12px", fontSize: 12, color: TEXT_SECONDARY }}>
      <div style={{ color: "#fff", marginBottom: 4 }}>{d.config} @ {d.contextLabel}</div>
      <div>decode: {d.decode.toFixed(1)} tok/s (stdev {d.decodeStdev.toFixed(2)})</div>
      <div>peak memory: {Math.round(d.memory)} MiB</div>
      <div>N={d.n}{d.quality?.niah != null ? ` · NIAH ${(d.quality.niah * 100).toFixed(0)}%` : " · quality battery pending"}</div>
    </div>
  );
}

const CTX_LABEL = { 2048: "2k", 8192: "8k", 16384: "16k", 32768: "32k", 131072: "128k" };

export default function ParetoBand({ cells }) {
  const contexts = [...new Set(cells.map((c) => c.context))].sort((a, b) => a - b);
  const [ctx, setCtx] = useState(contexts[contexts.length - 1]);
  const points = useMemo(
    () =>
      cells
        .filter((c) => c.context === ctx)
        .map((c) => ({
          config: c.config,
          contextLabel: CTX_LABEL[c.context] ?? c.context,
          memory: c.memory.median,
          decode: c.decode.median,
          decodeStdev: c.decode.stdev,
          n: c.n,
          quality: c.quality,
        })),
    [cells, ctx]
  );
  const frontier = useMemo(() => paretoFrontier(points), [points]);
  const configs = [...new Set(points.map((p) => p.config))];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {contexts.map((c) => (
          <button
            key={c}
            onClick={() => setCtx(c)}
            className={`ctx-btn${c === ctx ? " active" : ""}`}
            aria-pressed={c === ctx}
          >
            {CTX_LABEL[c] ?? c}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 12, right: 20, bottom: 14, left: 8 }}>
          <CartesianGrid stroke={HAIRLINE} strokeWidth={1} />
          <XAxis
            type="number"
            dataKey="memory"
            domain={["auto", "auto"]}
            tick={{ fill: TEXT_MUTED, fontSize: 12 }}
            axisLine={{ stroke: HAIRLINE }}
            tickLine={false}
            label={{ value: "peak memory (MiB)", position: "insideBottom", dy: 12, fill: TEXT_MUTED, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="decode"
            domain={["auto", "auto"]}
            tick={{ fill: TEXT_MUTED, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={52}
            label={{ value: "decode tok/s", angle: -90, position: "insideLeft", fill: TEXT_MUTED, fontSize: 12 }}
          />
          <Tooltip content={<PointTooltip />} cursor={{ strokeDasharray: "0" }} />
          {/* frontier as a custom polyline layer under the points */}
          <Scatter
            data={frontier}
            line={{ stroke: TEXT_MUTED, strokeWidth: 1.5 }}
            shape={() => null}
            isAnimationActive={false}
          />
          <Scatter data={points} isAnimationActive={false}>
            {points.map((p, i) => (
              <Cell
                key={i}
                fill={p.config === "f16" ? "transparent" : configColor(p.config)}
                stroke={p.config === "f16" ? "#ffffff" : "#0b0e1e"}
                strokeWidth={2}
                r={7}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <ConfigLegend configs={configs} />
      <p className="chart-note">
        Up and left is better: faster decode, less memory. The gray line is the
        Pareto frontier for the selected context. f16 is the open marker.
      </p>
    </div>
  );
}
