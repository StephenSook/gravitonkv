// Pure query functions over the canonical GravitonKV results. Every answer
// carries a source line; nothing here mutates anything, ever.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const CONFIGS = ["f16", "q8_0", "q4_0", "q8_0/q4_0", "q4_0/q8_0"];
export const CONTEXTS = [2048, 8192, 16384, 32768, 131072];
export const PRIORITIES = ["speed", "memory", "quality", "balanced"];

export function loadDocs(dataDir) {
  const dir =
    dataDir ||
    process.env.GRAVITONKV_DATA_DIR ||
    [resolve(here, "../data"), resolve(here, "../../results")].find((d) => existsSync(d));
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .filter((d) => !d.fixture_note);
}

function sourceLine(doc, cell) {
  const e = doc.environment;
  const n = cell ? cell.metrics.prefill_tok_s.raw.length : null;
  return (
    `source: ${doc.model.name} on ${e.instance_type} (${e.cpu_model}), ` +
    `llama.cpp ${e.llama_cpp_commit.slice(0, 9)}, KleidiAI on, flash attention on` +
    (n ? `, N=${n} (first rep discarded)` : "")
  );
}

function findCell(docs, model, config, context) {
  for (const doc of docs) {
    if (model && doc.model.name !== model) continue;
    const cell = doc.cells.find((c) => c.config === config && c.context === context);
    if (cell) return { doc, cell };
  }
  return null;
}

function cellSummary(cell) {
  const m = cell.metrics;
  const out = {
    config: cell.config,
    context: cell.context,
    prefill_tok_s: { median: m.prefill_tok_s.median, stdev: m.prefill_tok_s.stdev },
    decode_tok_s: { median: m.decode_tok_s.median, stdev: m.decode_tok_s.stdev },
    peak_memory_mb: { median: m.peak_memory_mb.median, stdev: m.peak_memory_mb.stdev },
    n: m.prefill_tok_s.raw.length,
  };
  if (m.kv_buffer_mb) out.kv_buffer_mb = m.kv_buffer_mb.median;
  if (cell.quality) out.quality = cell.quality;
  if (cell.anomalies?.length) out.anomalies = cell.anomalies;
  return out;
}

function pct(q, f) {
  return ((q / f - 1) * 100);
}

export function getHeadlineFinding(docs) {
  // Deterministic flagship-cell preference, same as the dashboard.
  const CONFIG_PREF = ["q8_0", "q8_0/q4_0", "q4_0", "q4_0/q8_0"];
  const CONTEXT_PREF = [8192, 16384, 32768, 2048];
  for (const ctx of CONTEXT_PREF) {
    for (const cfg of CONFIG_PREF) {
      for (const doc of docs) {
        const cell = doc.cells.find((c) => c.config === cfg && c.context === ctx);
        const base = doc.cells.find((c) => c.config === "f16" && c.context === ctx);
        if (!cell || !base) continue;
        const p = pct(cell.metrics.prefill_tok_s.median, base.metrics.prefill_tok_s.median);
        const d = pct(cell.metrics.decode_tok_s.median, base.metrics.decode_tok_s.median);
        const mem = pct(cell.metrics.peak_memory_mb.median, base.metrics.peak_memory_mb.median);
        return {
          finding:
            `On Graviton4 CPU (llama.cpp, KleidiAI, flash attention), quantizing the KV cache to ` +
            `${cell.config} at ${ctx} context is a three-way asymmetric trade versus f16: prefill ` +
            `${p >= 0 ? "+" : ""}${p.toFixed(1)}%, decode ${d >= 0 ? "+" : ""}${d.toFixed(1)}%, ` +
            `peak memory ${mem >= 0 ? "+" : ""}${mem.toFixed(1)}%. The decode cost is reported as ` +
            `prominently as the prefill gain; both directions are the finding.`,
          numbers: { baseline: cellSummary(base), quantized: cellSummary(cell) },
          source: sourceLine(doc, cell),
          coverage_note:
            docs.reduce((a, x) => a + x.cells.length, 0) < 20
              ? "Partial data: the full five-config, four-context, six-model matrix is still being collected."
              : undefined,
        };
      }
    }
  }
  return { finding: "No canonical results available yet.", source: "results/ is empty" };
}

export function queryResults(docs, model, config, context) {
  const hit = findCell(docs, model, config, context);
  if (!hit) {
    const have = docs.flatMap((d) => d.cells.map((c) => `${d.model.name} ${c.config}@${c.context}`));
    return { error: `no cell for ${model} ${config}@${context}`, available_cells: have };
  }
  return { cell: cellSummary(hit.cell), source: sourceLine(hit.doc, hit.cell) };
}

export function compareConfigs(docs, model, context, configs) {
  const base = findCell(docs, model, "f16", context);
  if (!base) return { error: `no f16 baseline for ${model} at ${context}` };
  const rows = [];
  for (const cfg of configs) {
    const hit = findCell(docs, model, cfg, context);
    if (!hit) {
      rows.push({ config: cfg, error: "cell not measured yet" });
      continue;
    }
    const m = hit.cell.metrics;
    const b = base.cell.metrics;
    rows.push({
      config: cfg,
      prefill_tok_s: m.prefill_tok_s.median,
      decode_tok_s: m.decode_tok_s.median,
      peak_memory_mb: m.peak_memory_mb.median,
      vs_f16:
        cfg === "f16"
          ? "baseline"
          : {
              prefill_pct: +pct(m.prefill_tok_s.median, b.prefill_tok_s.median).toFixed(1),
              decode_pct: +pct(m.decode_tok_s.median, b.decode_tok_s.median).toFixed(1),
              memory_pct: +pct(m.peak_memory_mb.median, b.peak_memory_mb.median).toFixed(1),
            },
      quality: hit.cell.quality ?? "quality battery pending",
      n: m.prefill_tok_s.raw.length,
    });
  }
  return { context, model, rows, source: sourceLine(base.doc, base.cell) };
}

export function recommendConfig(docs, context, priority) {
  // Transparent scoring over measured cells at the requested context (largest
  // measured context at or below the request if the exact tier is absent).
  const measured = docs.flatMap((d) =>
    d.cells.map((c) => ({ doc: d, cell: c }))
  );
  if (!measured.length) return { error: "no canonical results available yet" };
  const ctxs = [...new Set(measured.map((x) => x.cell.context))].sort((a, b) => a - b);
  const ctx = ctxs.filter((c) => c <= context).pop() ?? ctxs[0];
  const at = measured.filter((x) => x.cell.context === ctx);
  const base = at.find((x) => x.cell.config === "f16");
  if (!base) return { error: `no f16 baseline at ${ctx}` };
  const b = base.cell.metrics;
  const scored = at
    .filter((x) => x.cell.config !== "f16")
    .map((x) => {
      const m = x.cell.metrics;
      const prefill = pct(m.prefill_tok_s.median, b.prefill_tok_s.median);
      const decode = pct(m.decode_tok_s.median, b.decode_tok_s.median);
      const memory = pct(m.peak_memory_mb.median, b.peak_memory_mb.median);
      const kld = x.cell.quality?.kld ?? null;
      let score;
      if (priority === "speed") score = prefill + decode;
      else if (priority === "memory") score = -memory;
      else if (priority === "quality") score = kld != null ? -kld * 1000 : (x.cell.type_k === "q8_0" ? 1 : 0);
      else score = -memory + decode / 2 + prefill / 4; // balanced
      return { x, prefill, decode, memory, kld, score };
    })
    .sort((a, b2) => b2.score - a.score);
  const w = scored[0];
  return {
    recommendation: w.x.cell.config,
    at_context: ctx,
    requested_context: context,
    priority,
    tradeoff:
      `${w.x.cell.config} vs f16 at ${ctx}: prefill ${w.prefill >= 0 ? "+" : ""}${w.prefill.toFixed(1)}%, ` +
      `decode ${w.decode >= 0 ? "+" : ""}${w.decode.toFixed(1)}%, memory ${w.memory >= 0 ? "+" : ""}${w.memory.toFixed(1)}%` +
      (w.kld != null ? `, mean KLD vs f16 ${w.kld}` : ", quality battery pending"),
    alternatives: scored.slice(1).map((s) => ({
      config: s.x.cell.config,
      prefill_pct: +s.prefill.toFixed(1),
      decode_pct: +s.decode.toFixed(1),
      memory_pct: +s.memory.toFixed(1),
    })),
    scoring_note:
      "Transparent formula over measured medians; speed = prefill+decode deltas, memory = memory saving, " +
      "quality = lowest KLD (or q8_0-K preference while the battery is pending), balanced = memory saving + decode/2 + prefill/4.",
    caveat: ctx !== context ? `Requested ${context}; nearest measured tier is ${ctx}. The full matrix adds more tiers.` : undefined,
    source: sourceLine(w.x.doc, w.x.cell),
  };
}

export function getMethodology(docs) {
  if (!docs.length) return { error: "no canonical results available yet" };
  return {
    environments: docs.map((d) => ({ model: d.model, environment: d.environment })),
    run_standard:
      "N=10 reps where a cell costs under 10 minutes, N=5 minimum, first rep discarded as warmup, " +
      "median + stdev + CV reported, seed 42, threads pinned to physical cores, on-demand Graviton4 only " +
      "(no burstable, no spot). One llama-completion pass per rep yields prefill, decode, peak RSS " +
      "(child rusage), and KV buffer size. CI (Cobalt 100 arm64 runners) validates the harness and " +
      "schema on every push but never produces findings.",
    repo: "https://github.com/StephenSook/gravitonkv",
    dashboard: "https://gravitonkv-web.vercel.app",
  };
}
