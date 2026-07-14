"use client";

import { useMemo } from "react";
import pricing from "../public/data/pricing.json";

// Cost and recommendations are derived from the committed cells and the sourced
// hourly rate, the same transparent logic the recommend_config MCP tool uses.
const RATE = pricing.instances[pricing.measured_instance].usd_per_hour;
const perM = (tps) => (RATE * 1e6) / (tps * 3600);
const KV = { f16: "K16 V16", q8_0: "K8 V8", q4_0: "K4 V4", "q8_0/q4_0": "K8 V4", "q4_0/q8_0": "K4 V8" };
const CTX_LABEL = { 2048: "2k", 8192: "8k", 16384: "16k", 32768: "32k", 131072: "128k" };

function pct(v, base) {
  return (v / base - 1) * 100;
}
function fmtPct(p) {
  return `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`;
}

export default function RecommendCards({ cells }) {
  const cards = useMemo(() => {
    // Per-config KL divergence (context-independent). A config whose keys
    // collapse on this model must never be recommended, so guard every card
    // by a KLD safety threshold.
    const kldByCfg = {};
    for (const c of cells) if (c.config !== "f16" && c.quality?.kld != null) kldByCfg[c.config] = c.quality.kld;
    const COLLAPSE = 0.5;
    const isSafe = (config) => kldByCfg[config] == null || kldByCfg[config] <= COLLAPSE;

    const at = (ctx) => cells.filter((c) => c.context === ctx);
    const baseAt = (ctx) => at(ctx).find((c) => c.config === "f16");
    const quantAt = (ctx) => at(ctx).filter((c) => c.config !== "f16" && isSafe(c.config));
    const out = [];

    const b8 = baseAt(8192);
    if (b8) {
      const w = quantAt(8192)
        .map((c) => ({ c, p: pct(c.prefill.median, b8.prefill.median) }))
        .sort((a, b) => b.p - a.p)[0];
      if (w)
        out.push({
          q: "Fastest prefill at 8k",
          config: w.c.config,
          kv: KV[w.c.config],
          takeaway: `${fmtPct(w.p)} prefill vs f16, and the prefill bill drops to $${perM(w.c.prefill.median).toFixed(2)} per 1M tokens.`,
          tags: ["8k", "speed", "prefill"],
        });
    }

    const b32 = baseAt(32768);
    if (b32) {
      const w = quantAt(32768)
        .map((c) => ({ c, m: pct(c.memory.median, b32.memory.median) }))
        .sort((a, b) => a.m - b.m)[0];
      if (w)
        out.push({
          q: "Biggest memory saving at 32k",
          config: w.c.config,
          kv: KV[w.c.config],
          takeaway: `${fmtPct(w.m)} peak memory vs f16, the most room for long context on small RAM.`,
          tags: ["32k", "memory"],
        });
    }

    const safe = Object.entries(kldByCfg).sort((a, b) => a[1] - b[1])[0];
    if (safe)
      out.push({
        q: "Safest quality",
        config: safe[0],
        kv: KV[safe[0]],
        takeaway: `Lowest divergence from f16 (KLD ${safe[1].toFixed(4)}). 8-bit keys stay safe on every model measured.`,
        tags: ["quality", "8-bit key"],
      });

    const b16 = baseAt(16384);
    if (b16) {
      const w = quantAt(16384)
        .map((c) => {
          const p = pct(c.prefill.median, b16.prefill.median);
          const d = pct(c.decode.median, b16.decode.median);
          const m = pct(c.memory.median, b16.memory.median);
          return { c, p, d, m, score: -m + d / 2 + p / 4 };
        })
        .sort((a, b) => b.score - a.score)[0];
      if (w)
        out.push({
          q: "Best all-around at 16k",
          config: w.c.config,
          kv: KV[w.c.config],
          takeaway: `${fmtPct(w.p)} prefill, ${fmtPct(w.d)} decode, ${fmtPct(w.m)} memory vs f16.`,
          tags: ["16k", "balanced"],
        });
    }

    return out;
  }, [cells]);

  if (!cards.length) return null;
  return (
    <section id="recommend">
      <div className="band-head">
        <span className="band-no">00</span>
        <span className="band-kicker">start here</span>
      </div>
      <h2>Which config for your job?</h2>
      <div className="rec-grid">
        {cards.map((c) => (
          <div key={c.q} className="rec-card">
            <div className="rec-q">{c.q}</div>
            <div className="rec-config">
              {c.config} <span className="rec-kv">{c.kv}</span>
            </div>
            <div className="rec-takeaway">{c.takeaway}</div>
            <div className="rec-tags">
              {c.tags.map((t) => (
                <span key={t} className="rec-tag">{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="chart-note">
        Computed from the measured cells for this model, the same transparent logic the recommend_config MCP tool uses. Switch models above to rescope.
      </p>
    </section>
  );
}
