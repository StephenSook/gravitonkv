#!/usr/bin/env node
// Generate the dashboard's pre-aggregated data slice from canonical results.
// Every number the dashboard shows originates here; nothing is hand-typed.
//
// Reads results/*.json (canonical schema), computes per-config deltas vs the
// f16 baseline at the same (model, context), and writes
// dashboard/public/data/hero.json. Percentage stdevs are propagated from the
// raw rep stdevs via the ratio approximation and labeled as propagated.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultsDir = join(root, "results");
const outDir = join(root, "dashboard", "public", "data");
// Provenance for reproducibility-linking: every number on the dashboard can
// point back to the exact committed source file at this commit, plus CI.
const REPO = "https://github.com/StephenSook/gravitonkv";
let COMMIT = null;
try {
  COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim();
} catch {
  COMMIT = null;
}
const blobRef = COMMIT || "main";
const CI_URL = `${REPO}/actions`;

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

// The same (model, config, context) cell can exist in more than one results
// file (a validation sweep and the full matrix). Keep exactly one winner per
// key: the cell with more kept reps, tiebreak on the newer capture time. The
// full matrix therefore supersedes mini-validate as its cells land.
const winners = new Map();
const docs = [];
for (const f of files) {
  const doc = JSON.parse(readFileSync(join(resultsDir, f), "utf8"));
  if (doc.fixture_note) continue;
  docs.push({ file: f, doc });
  for (const c of doc.cells) {
    const key = `${doc.model.name}|${c.config}|${c.context}`;
    const n = c.metrics.prefill_tok_s.raw.length;
    const at = doc.environment.captured_at ?? "";
    const prev = winners.get(key);
    if (!prev || n > prev.n || (n === prev.n && at > prev.at)) {
      winners.set(key, { cell: c, doc, file: f, n, at });
    }
  }
}

const rows = [];
const cells = [];
const sources = [];
for (const { file: f, doc } of docs) {
  const winning = doc.cells.filter(
    (c) => winners.get(`${doc.model.name}|${c.config}|${c.context}`).cell === c
  );
  if (winning.length === 0) continue;
  sources.push({
    file: `results/${f}`,
    results_url: `${REPO}/blob/${blobRef}/results/${f}`,
    sweep_instance: doc.environment.instance_type,
    cpu: doc.environment.cpu_model,
    commit: doc.environment.llama_cpp_commit,
    environment: doc.environment,
    model: doc.model,
  });
  for (const c of winning) {
    const m = c.metrics;
    cells.push({
      model: doc.model.name,
      config: c.config,
      context: c.context,
      results_url: `${REPO}/blob/${blobRef}/results/${f}`,
      n: m.prefill_tok_s.raw.length,
      prefill: { median: m.prefill_tok_s.median, stdev: m.prefill_tok_s.stdev, cv: m.prefill_tok_s.cv, raw: m.prefill_tok_s.raw },
      decode: { median: m.decode_tok_s.median, stdev: m.decode_tok_s.stdev, cv: m.decode_tok_s.cv, raw: m.decode_tok_s.raw },
      memory: { median: m.peak_memory_mb.median, stdev: m.peak_memory_mb.stdev, cv: m.peak_memory_mb.cv, raw: m.peak_memory_mb.raw },
      kv_buffer_mb: m.kv_buffer_mb ? m.kv_buffer_mb.median : null,
      quality: c.quality ?? null,
      anomalies: c.anomalies ?? [],
    });
  }
  // Deltas pair a quantized cell with the f16 baseline from the SAME run when
  // that run has one (apples-to-apples); the cross-file winning baseline is
  // the fallback for partial-collection states only.
  const byKey = new Map();
  for (const c of doc.cells) byKey.set(`${c.config}|${c.context}`, c);
  for (const c of winning) {
    if (c.config === "f16") continue;
    const base =
      byKey.get(`f16|${c.context}`) ??
      winners.get(`${doc.model.name}|f16|${c.context}`)?.cell;
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

// The headline stays on the flagship model regardless of how many other model
// sweeps land later; only that model's rows are eligible for the hero cell.
const FLAGSHIP = "Qwen3-4B-Instruct-2507";
// Models present, flagship first, the rest by descending cell count then name.
const models = [...new Set(cells.map((c) => c.model))].sort((a, b) => {
  if (a === FLAGSHIP) return -1;
  if (b === FLAGSHIP) return 1;
  const ca = cells.filter((c) => c.model === a).length;
  const cb = cells.filter((c) => c.model === b).length;
  return cb - ca || a.localeCompare(b);
});

// Deterministic headline-cell selection: prefer the flagship config and the
// 8k tier when present, fall back down the lists. No numbers are typed here.
const CONFIG_PREF = ["q8_0", "q8_0/q4_0", "q4_0", "q4_0/q8_0"];
const CONTEXT_PREF = [8192, 16384, 32768, 2048];
const heroModel = models.includes(FLAGSHIP) ? FLAGSHIP : models[0];
let hero = null;
outer: for (const ctx of CONTEXT_PREF) {
  for (const cfg of CONFIG_PREF) {
    hero = rows.find((r) => r.model === heroModel && r.context === ctx && r.config === cfg);
    if (hero) break outer;
  }
}

// Sources ordered so the flagship's source is first; the hero provenance and
// methodology table read sources[0].
sources.sort((a, b) => (a.model.name === heroModel ? -1 : b.model.name === heroModel ? 1 : 0));

const out = {
  generated_at: new Date().toISOString(),
  generated_by: "scripts/gen-dashboard-data.mjs",
  repo: REPO,
  commit: COMMIT,
  ci_url: CI_URL,
  stdev_note: "percentage stdevs are propagated from rep-level stdevs (ratio approximation)",
  sources: sources.map(({ environment, model, ...s }) => s),
  hero,
  rows,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "hero.json"), JSON.stringify(out, null, 1));
writeFileSync(
  join(outDir, "bands.json"),
  JSON.stringify(
    { generated_at: out.generated_at, generated_by: out.generated_by, repo: REPO, commit: COMMIT, ci_url: CI_URL, models, flagship: heroModel, sources, cells },
    null,
    1
  )
);

// Copy the sourced pricing into the dashboard bundle so the cost band can
// compute $/1M tokens client-side from the committed hourly rate.
const pricingSrc = join(root, "docs", "pricing.json");
if (existsSync(pricingSrc)) {
  writeFileSync(join(outDir, "pricing.json"), readFileSync(pricingSrc, "utf8"));
}
console.log(
  `gen-dashboard-data: ${rows.length} delta row(s), ${cells.length} cell(s), ${models.length} model(s) from ${sources.length} file(s); ` +
    (hero ? `hero = ${hero.model} ${hero.config} @ ${hero.context}` : "hero = none")
);
