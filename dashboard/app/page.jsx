import HeroChartLoader from "../components/HeroChartLoader";
import data from "../public/data/hero.json";

const CONTEXT_LABEL = { 2048: "2k", 8192: "8k", 16384: "16k", 32768: "32k", 131072: "128k" };

function fmt(v) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default function Page() {
  const hero = data.hero;
  const src = data.sources[0];
  if (!hero) {
    return (
      <main>
        <h1>GravitonKV</h1>
        <p className="provenance">No delta rows generated yet. Run npm run build:data.</p>
      </main>
    );
  }
  const ctx = CONTEXT_LABEL[hero.context] ?? hero.context;
  return (
    <main>
      <p className="hero-kicker">GravitonKV · KV-cache quantization on AWS Graviton4 CPU</p>
      <h1>
        Quantizing the KV cache ({hero.config}) at {ctx} context:{" "}
        <span className="better">{fmt(hero.prefill_pct)} prefill</span>,{" "}
        <span className="worse">{fmt(hero.decode_pct)} decode</span>,{" "}
        <span className="better">{fmt(hero.memory_pct)} memory</span> vs f16.
      </h1>
      <p className="provenance">
        {hero.model} · {src.sweep_instance} ({src.cpu}) · N={hero.n}, first rep discarded ·
        llama.cpp {src.commit.slice(0, 9)} · KleidiAI on · flash attention on · seed 42
      </p>

      <div className="chart-card">
        <p className="chart-title">
          Delta vs the f16/f16 baseline at the same context (median of N={hero.n})
        </p>
        <HeroChartLoader hero={hero} />
        <p className="chart-note">
          Error bars: propagated stdev from rep-level spreads. Positive prefill and
          negative memory are improvements; negative decode is the cost. Blue = better,
          orange = worse.
        </p>
      </div>

      <p className="status-line">
        Shown: the harness-validation cell. The full five-config, four-context,
        six-model matrix is being collected on c8g (Graviton4) and this page
        regenerates from the canonical results when it lands. Every number here is
        generated from{" "}
        <a href="https://github.com/StephenSook/gravitonkv">the public repo</a>{" "}
        by script; nothing is hand-typed.
      </p>
    </main>
  );
}
