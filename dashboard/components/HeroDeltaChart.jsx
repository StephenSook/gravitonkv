"use client";

import {
  Bar,
  BarChart,
  Cell,
  ErrorBar,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const BETTER = "#0072B2";
const WORSE = "#D55E00";
const TEXT_SECONDARY = "#b7bcce";
const TEXT_MUTED = "#7a8098";
const HAIRLINE = "#1e2440";
const SURFACE_RAISED = "#101430";

// 4px rounded data-end, square at the zero baseline, whichever way the bar grows.
function DivergingBar(props) {
  const { x, y, width, height, fill } = props;
  if (height === 0) return null;
  const up = height > 0; // positive value: rect drawn downward from y? Recharts gives
  // y = top of rect and height >= 0 for positive, and for negative values y = baseline
  // with height > 0 drawn below. Determine direction from payload value instead.
  const positive = props.payload.value >= 0;
  const r = 4;
  const h = Math.abs(height);
  const top = Math.min(y, y + height);
  const path = positive
    ? `M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${top + h} Z`
    : `M${x},${top} L${x + width},${top} L${x + width},${top + h - r} Q${x + width},${top + h} ${x + width - r},${top + h} L${x + r},${top + h} Q${x},${top + h} ${x},${top + h - r} Z`;
  return <path d={path} fill={fill} />;
}

// Value labels ride the data end of each bar: above positive bars, below
// negative ones, so nothing collides with the zero baseline.
function DeltaLabel(props) {
  const { x, y, width, height, value } = props;
  const positive = value >= 0;
  const top = Math.min(y, y + height);
  const h = Math.abs(height);
  const ly = positive ? top - 8 : top + h + 16;
  return (
    <text
      x={x + width / 2}
      y={ly}
      textAnchor="middle"
      fill={TEXT_SECONDARY}
      fontSize={13}
      fontWeight={600}
    >
      {`${value >= 0 ? "+" : ""}${value.toFixed(1)}%`}
    </text>
  );
}

function DeltaTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: SURFACE_RAISED,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 3,
        padding: "10px 12px",
        fontSize: 12,
        color: TEXT_SECONDARY,
      }}
    >
      <div style={{ color: "#fff", marginBottom: 4 }}>{d.metric}</div>
      <div>
        f16: {d.baseline} {d.unit}
      </div>
      <div>
        {d.configLabel}: {d.quantized} {d.unit}
      </div>
      <div style={{ marginTop: 4 }}>
        {d.value >= 0 ? "+" : ""}
        {d.value.toFixed(1)}% (propagated stdev {d.stdev.toFixed(2)}, N={d.n})
      </div>
    </div>
  );
}

export default function HeroDeltaChart({ hero }) {
  const data = [
    {
      metric: "Prefill throughput",
      value: hero.prefill_pct,
      stdev: hero.prefill_pct_stdev,
      better: hero.prefill_pct >= 0,
      baseline: hero.baseline.prefill_tok_s.toFixed(1),
      quantized: hero.quantized.prefill_tok_s.toFixed(1),
      unit: "tok/s",
    },
    {
      metric: "Decode throughput",
      value: hero.decode_pct,
      stdev: hero.decode_pct_stdev,
      better: hero.decode_pct >= 0,
      baseline: hero.baseline.decode_tok_s.toFixed(1),
      quantized: hero.quantized.decode_tok_s.toFixed(1),
      unit: "tok/s",
    },
    {
      metric: "Peak memory",
      value: hero.memory_pct,
      stdev: hero.memory_pct_stdev,
      // less memory is better, so a negative delta is the good direction
      better: hero.memory_pct <= 0,
      baseline: Math.round(hero.baseline.peak_memory_mb),
      quantized: Math.round(hero.quantized.peak_memory_mb),
      unit: "MiB",
    },
  ].map((d) => ({ ...d, n: hero.n, configLabel: hero.config }));

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={data} margin={{ top: 28, right: 12, bottom: 4, left: 8 }} barSize={24}>
        <XAxis
          dataKey="metric"
          tick={{ fill: TEXT_SECONDARY, fontSize: 13 }}
          axisLine={{ stroke: HAIRLINE }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: TEXT_MUTED, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={52}
          label={{
            value: "% vs f16",
            angle: -90,
            position: "insideLeft",
            fill: TEXT_MUTED,
            fontSize: 12,
          }}
        />
        <ReferenceLine
          y={0}
          stroke={TEXT_MUTED}
          strokeWidth={1}
          label={{ value: "f16 baseline", position: "insideBottomRight", fill: TEXT_MUTED, fontSize: 11, dy: 12 }}
        />
        <Tooltip content={<DeltaTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar dataKey="value" shape={<DivergingBar />} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.metric} fill={d.better ? BETTER : WORSE} />
          ))}
          <LabelList dataKey="value" content={<DeltaLabel />} />
          <ErrorBar dataKey="stdev" width={5} strokeWidth={1.5} stroke={TEXT_SECONDARY} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
