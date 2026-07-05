#!/usr/bin/env node
// Generate the dashboard's pre-aggregated data slice from canonical results.
// Every number the dashboard shows originates here; nothing is hand-typed.
//
// Reads results/*.json (canonical schema), computes per-config deltas vs the
// f16 baseline at the same (model, context), and writes
// dashboard/public/data/hero.json. Percentage stdevs are propagated from the
// raw rep stdevs via the ratio approximation and labeled as propagated.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultsDir = join(root, "results");
const outDir = join(root, "dashboard", "public", "data");

function pctDelta(q, f) {
  return (q.median / f.median - 1) * 100;
}
function pctStdev(q, f) {
  const r = q.median / f.median;
  const rel = Math.sqrt((q.stdev / q.median) ** 2 + (f.stdev / f.median) ** 2);
  return Math.abs(r) * rel * 100;
}

const files = existsSync(resultsDir)
  ? readdirSync(resultsDir).filter((f) => f.endsWith(".json") && f !== "index.json")
  : [];

const rows = [];
const cells = [];
const sources = [];
for (const f of files) {
  const doc = JSON.parse(readFileSync(join(resultsDir, f), "utf8"));
  if (doc.fixture_note) continue;
  sources.push({
    file: `results/${f}`,
    sweep_instance: doc.environment.instance_type,
    cpu: doc.environment.cpu_model,
    commit: doc.environment.llama_cpp_commit,
    environment: doc.environment,
    model: doc.model,
  });
  for (const c of doc.cells) {
    const m = c.metrics;
    cells.push({
      model: doc.model.name,
      config: c.config,
      context: c.context,
      n: m.prefill_tok_s.raw.length,
      prefill: { median: m.prefill_tok_s.median, stdev: m.prefill_tok_s.stdev, cv: m.prefill_tok_s.cv, raw: m.prefill_tok_s.raw },
      decode: { median: m.decode_tok_s.median, stdev: m.decode_tok_s.stdev, cv: m.decode_tok_s.cv, raw: m.decode_tok_s.raw },
      memory: { median: m.peak_memory_mb.median, stdev: m.peak_memory_mb.stdev, cv: m.peak_memory_mb.cv, raw: m.peak_memory_mb.raw },
      kv_buffer_mb: m.kv_buffer_mb ? m.kv_buffer_mb.median : null,
      quality: c.quality ?? null,
      anomalies: c.anomalies ?? [],
    });
  }
  const byKey = new Map();
  for (const c of doc.cells) byKey.set(`${c.config}|${c.context}`, c);
  for (const c of doc.cells) {
    if (c.config === "f16") continue;
    const base = byKey.get(`f16|${c.context}`);
    if (!base) continue;
    rows.push({
      model: doc.model.name,
      config: c.config,
      context: c.context,
      n: c.metrics.prefill_tok_s.raw.length,
      prefill_pct: pctDelta(c.metrics.prefill_tok_s, base.metrics.prefill_tok_s),
      prefill_pct_stdev: pctStdev(c.metrics.prefill_tok_s, base.metrics.prefill_tok_s),
      decode_pct: pctDelta(c.metrics.decode_tok_s, base.metrics.decode_tok_s),
      decode_pct_stdev: pctStdev(c.metrics.decode_tok_s, base.metrics.decode_tok_s),
      memory_pct: pctDelta(c.metrics.peak_memory_mb, base.metrics.peak_memory_mb),
      memory_pct_stdev: pctStdev(c.metrics.peak_memory_mb, base.metrics.peak_memory_mb),
      baseline: {
        prefill_tok_s: base.metrics.prefill_tok_s.median,
        decode_tok_s: base.metrics.decode_tok_s.median,
        peak_memory_mb: base.metrics.peak_memory_mb.median,
        n: base.metrics.prefill_tok_s.raw.length,
      },
      quantized: {
        prefill_tok_s: c.metrics.prefill_tok_s.median,
        decode_tok_s: c.metrics.decode_tok_s.median,
        peak_memory_mb: c.metrics.peak_memory_mb.median,
      },
    });
  }
}

// Deterministic headline-cell selection: prefer the flagship config and the
// 8k tier when present, fall back down the lists. No numbers are typed here.
const CONFIG_PREF = ["q8_0", "q8_0/q4_0", "q4_0", "q4_0/q8_0"];
const CONTEXT_PREF = [8192, 16384, 32768, 2048];
let hero = null;
outer: for (const ctx of CONTEXT_PREF) {
  for (const cfg of CONFIG_PREF) {
    hero = rows.find((r) => r.context === ctx && r.config === cfg);
    if (hero) break outer;
  }
}

const out = {
  generated_at: new Date().toISOString(),
  generated_by: "scripts/gen-dashboard-data.mjs",
  stdev_note: "percentage stdevs are propagated from rep-level stdevs (ratio approximation)",
  sources: sources.map(({ environment, model, ...s }) => s),
  hero,
  rows,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "hero.json"), JSON.stringify(out, null, 1));
writeFileSync(
  join(outDir, "bands.json"),
  JSON.stringify({ generated_at: out.generated_at, generated_by: out.generated_by, sources, cells }, null, 1)
);
console.log(`gen-dashboard-data: ${rows.length} delta row(s), ${cells.length} cell(s) from ${sources.length} file(s); ` +
  (hero ? `hero = ${hero.model} ${hero.config} @ ${hero.context}` : "hero = none"));
