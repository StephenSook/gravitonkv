"use client";

import bandsData from "../public/data/bands.json";
import pricing from "../public/data/pricing.json";

const RATE = pricing.instances[pricing.measured_instance].usd_per_hour;
const perM = (tps) => ((RATE * 1e6) / (tps * 3600)).toFixed(4);

const HEADERS = [
  "model", "config", "context", "n",
  "prefill_tok_s", "prefill_stdev", "decode_tok_s", "decode_stdev",
  "peak_memory_mb", "kv_buffer_mb", "niah", "kld", "ruler_vt",
  "prefill_usd_per_1m", "decode_usd_per_1m",
];

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(cells) {
  const rows = [HEADERS];
  for (const c of cells) {
    const q = c.quality || {};
    rows.push([
      c.model, c.config, c.context, c.n,
      c.prefill.median, c.prefill.stdev, c.decode.median, c.decode.stdev,
      c.memory.median, c.kv_buffer_mb ?? "", q.niah ?? "", q.kld ?? "", q.ruler_vt ?? "",
      perM(c.prefill.median), perM(c.decode.median),
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function DataExport({ model }) {
  const all = bandsData.cells;
  const mine = model ? all.filter((c) => c.model === model) : all;
  const short = model ? model.replace(/[^A-Za-z0-9.-]/g, "-") : "all";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      {model && (
        <button className="ctx-btn" onClick={() => download(`gravitonkv-${short}.csv`, toCsv(mine))}>
          download {short} data (CSV)
        </button>
      )}
      <button className="ctx-btn" onClick={() => download("gravitonkv-all-models.csv", toCsv(all))}>
        download all 6 models (CSV)
      </button>
    </div>
  );
}
