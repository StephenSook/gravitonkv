"use client";

import { useState } from "react";
import { configColor, HAIRLINE, TEXT_MUTED, TEXT_SECONDARY } from "./configPalette";

const CTX_LABEL = { 2048: "2k", 8192: "8k", 16384: "16k", 32768: "32k", 131072: "128k" };

function RepStrip({ raw, color }) {
  // 1-D dot strip of the kept reps, min..max mapped across the width
  const w = 120, h = 18, pad = 6;
  const min = Math.min(...raw), max = Math.max(...raw);
  const span = max - min || 1;
  return (
    <svg width={w} height={h} role="img" aria-label={`${raw.length} rep values`}>
      <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke={HAIRLINE} strokeWidth={1} />
      {raw.map((v, i) => (
        <circle key={i} cx={pad + ((v - min) / span) * (w - 2 * pad)} cy={h / 2} r={4}
          fill={color} stroke="#0b0e1e" strokeWidth={1.5}
          className="rep-dot" style={{ "--i": i }} />
      ))}
    </svg>
  );
}

const td = { padding: "7px 10px", borderBottom: `1px solid ${HAIRLINE}`, fontSize: 13, color: TEXT_SECONDARY, fontVariantNumeric: "tabular-nums" };
const th = { ...td, color: TEXT_MUTED, fontWeight: 500, textAlign: "left", fontSize: 12 };

export default function ExplorerBand({ cells }) {
  const [open, setOpen] = useState(null);
  const sorted = [...cells].sort((a, b) => a.context - b.context || a.config.localeCompare(b.config));
  const toggle = (key) => setOpen(open === key ? null : key);
  return (
    <div className="scroll-x">
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>config</th>
            <th style={th}>context</th>
            <th style={th}>prefill tok/s</th>
            <th style={th}>decode tok/s</th>
            <th style={th}>peak MiB</th>
            <th style={th}>KV MiB</th>
            <th style={th}>N</th>
            <th style={th}>worst CV</th>
            <th style={th}><span className="sr-only">rep details</span></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => {
            const key = `${c.config}|${c.context}`;
            const worstCv = Math.max(c.prefill.cv, c.decode.cv, c.memory.cv);
            return [
              <tr key={key} className="x-row" onClick={() => toggle(key)}>
                <td style={td}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 5, background: configColor(c.config), border: c.config === "f16" ? "2px solid #7a8098" : "none", boxSizing: "border-box" }} />
                    {c.config}
                  </span>
                </td>
                <td style={td}>{CTX_LABEL[c.context] ?? c.context}</td>
                <td style={td}>{c.prefill.median.toFixed(1)}</td>
                <td style={td}>{c.decode.median.toFixed(1)}</td>
                <td style={td}>{Math.round(c.memory.median)}</td>
                <td style={td}>{c.kv_buffer_mb != null ? Math.round(c.kv_buffer_mb) : "–"}</td>
                <td style={td}>{c.n}</td>
                <td style={td}>{(worstCv * 100).toFixed(2)}%</td>
                <td style={{ ...td, color: TEXT_MUTED }}>
                  <button
                    className="row-toggle"
                    aria-expanded={open === key}
                    aria-controls={`detail-${i}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(key);
                    }}
                  >
                    {open === key ? "close" : "reps"}
                  </button>
                </td>
              </tr>,
              open === key && (
                <tr key={`${key}-detail`} id={`detail-${i}`}>
                  <td style={{ ...td, background: "#0a0d1c" }} colSpan={9}>
                    <div className="x-detail-inner">
                      <span>prefill reps <RepStrip raw={c.prefill.raw} color={configColor(c.config)} /></span>
                      <span>decode reps <RepStrip raw={c.decode.raw} color={configColor(c.config)} /></span>
                      <span style={{ color: TEXT_MUTED, fontSize: 12 }}>
                        {c.quality ? `NIAH ${c.quality.niah != null ? (c.quality.niah * 100).toFixed(0) + "%" : "–"} · ppl ${c.quality.perplexity ?? "–"}` : "quality battery pending"}
                        {c.anomalies.length > 0 ? ` · anomalies: ${c.anomalies.join("; ")}` : ""}
                      </span>
                    </div>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
      <p className="chart-note">
        Click a row for rep-level values. Medians of N kept reps, first rep always
        discarded as warmup. A table view of every chart on this page.
      </p>
    </div>
  );
}
