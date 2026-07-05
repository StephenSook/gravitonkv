"use client";

import {
  CartesianGrid,
  ErrorBar,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CONFIG_ORDER, configColor, HAIRLINE, SURFACE_RAISED, TEXT_MUTED, TEXT_SECONDARY } from "./configPalette";
import ConfigLegend from "./ConfigLegend";

const CTX_LABEL = { 2048: "2k", 8192: "8k", 16384: "16k", 32768: "32k", 131072: "128k" };

function seriesFor(cells, metric) {
  // one row per context, one column per config
  const contexts = [...new Set(cells.map((c) => c.context))].sort((a, b) => a - b);
  return contexts.map((ctx) => {
    const row = { context: ctx, label: CTX_LABEL[ctx] ?? String(ctx) };
    for (const c of cells.filter((x) => x.context === ctx)) {
      row[c.config] = c[metric].median;
      row[`${c.config}__stdev`] = c[metric].stdev;
      row[`${c.config}__n`] = c.n;
    }
    return row;
  });
}

function MultiTooltip({ active, payload, label, unit }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: SURFACE_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 3, padding: "10px 12px", fontSize: 12, color: TEXT_SECONDARY }}>
      <div style={{ color: "#fff", marginBottom: 4 }}>{label} context</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: p.stroke }} />
          {p.dataKey}: {Number(p.value).toFixed(1)} {unit} (N={p.payload[`${p.dataKey}__n`]})
        </div>
      ))}
    </div>
  );
}

function OneMetricChart({ cells, metric, title, unit }) {
  const data = seriesFor(cells, metric);
  const configs = CONFIG_ORDER.filter((c) => cells.some((x) => x.config === c));
  return (
    <div style={{ flex: "1 1 340px", minWidth: 300 }}>
      <p className="chart-title">{title}</p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} syncId="ctx-ladder" margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={HAIRLINE} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: TEXT_MUTED, fontSize: 12 }} axisLine={{ stroke: HAIRLINE }} tickLine={false} />
          <YAxis tick={{ fill: TEXT_MUTED, fontSize: 12 }} axisLine={false} tickLine={false} width={48}
            label={{ value: unit, angle: -90, position: "insideLeft", fill: TEXT_MUTED, fontSize: 11 }} />
          <Tooltip content={<MultiTooltip unit={unit} />} />
          {configs.map((c) => (
            <Line
              key={c}
              dataKey={c}
              stroke={configColor(c)}
              strokeWidth={2}
              strokeDasharray={c === "f16" ? "5 4" : undefined}
              dot={{ r: 4, fill: configColor(c), stroke: "#0b0e1e", strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls
            >
              <ErrorBar dataKey={`${c}__stdev`} width={4} strokeWidth={1} stroke={TEXT_SECONDARY} />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ScalingBand({ cells }) {
  const configs = CONFIG_ORDER.filter((c) => cells.some((x) => x.config === c));
  return (
    <div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <OneMetricChart cells={cells} metric="prefill" title="Prefill throughput vs context" unit="tok/s" />
        <OneMetricChart cells={cells} metric="decode" title="Decode throughput vs context" unit="tok/s" />
        <OneMetricChart cells={cells} metric="memory" title="Peak memory vs context" unit="MiB" />
      </div>
      <ConfigLegend configs={configs} />
      <p className="chart-note">
        Error bars: rep-level stdev. Dashed white line: the f16 baseline. Tooltips
        are synchronized across the three panels. Points fill in as sweep cells land.
      </p>
    </div>
  );
}
