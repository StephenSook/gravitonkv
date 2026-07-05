import HeroChartLoader from "../components/HeroChartLoader";
import { ParetoBand, ScalingBand, ExplorerBand } from "../components/BandLoaders";
import heroData from "../public/data/hero.json";
import bandsData from "../public/data/bands.json";

const CONTEXT_LABEL = { 2048: "2k", 8192: "8k", 16384: "16k", 32768: "32k", 131072: "128k" };

function fmt(v) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function Band({ id, kicker, title, children }) {
  return (
    <section id={id} style={{ marginTop: 56 }}>
      <p className="hero-kicker">{kicker}</p>
      <h2 style={{ fontSize: 22, fontWeight: 650, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

export default function Page() {
  const hero = heroData.hero;
  const src = bandsData.sources[0];
  const env = src.environment;
  const cells = bandsData.cells;
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
      {/* Band 1: headline */}
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
        The full five-config, four-context, six-model matrix is being collected on
        c8g (Graviton4); every band on this page regenerates from the canonical
        results as cells land. Every number is generated from{" "}
        <a href="https://github.com/StephenSook/gravitonkv">the public repo</a> by
        script; nothing is hand-typed.
      </p>

      {/* Band 2: tradeoff surface */}
      <Band id="tradeoff" kicker="Band 2 · The tradeoff surface" title="Which config should you run?">
        <div className="chart-card">
          <ParetoBand cells={cells} />
        </div>
      </Band>

      {/* Band 3: context scaling */}
      <Band id="scaling" kicker="Band 3 · Context scaling" title="How the trade moves with context length">
        <div className="chart-card">
          <ScalingBand cells={cells} />
        </div>
      </Band>

      {/* Band 4: cell explorer */}
      <Band id="cells" kicker="Band 4 · Cell explorer" title="Every cell, down to the raw reps">
        <div className="chart-card">
          <ExplorerBand cells={cells} />
        </div>
      </Band>

      {/* Band 5: methodology */}
      <Band id="methodology" kicker="Band 5 · Methodology and reproduction" title="How these numbers were made">
        <div className="chart-card" style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {[
                ["Instance", `${env.instance_type} (${env.vcpus} vCPU, ${env.ram_gb} GB), on-demand, us-east-1`],
                ["CPU", env.cpu_model],
                ["OS / kernel", `${env.os} / ${env.kernel}`],
                ["llama.cpp", `${env.llama_cpp_commit} (pinned; never upgraded)`],
                ["Build", env.build_flags],
                ["Acceleration", "KleidiAI = 1 verified in system_info before every cell; reported as the baseline it is"],
                ["Flash attention", "on for every run including f16 baselines"],
                ["Model", `${src.model.name} ${src.model.quant}, sha256 ${src.model.sha256.slice(0, 16)}...`],
                ["Run standard", "N=10 reps where a cell costs under 10 minutes, N=5 minimum, first rep discarded as warmup, median + stdev + CV, seed 42"],
                ["Measurement", "one llama-completion pass per rep: prefill and decode throughput from the perf lines, peak RSS from child rusage, KV buffer from the load log"],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: "5px 18px 5px 0", color: "var(--text-muted)", whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
                  <td style={{ padding: "5px 0" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 16 }}>
            Reproduce a mini-sweep on any Graviton4 instance:
          </p>
          <pre style={{ background: "#161615", border: "1px solid var(--hairline)", borderRadius: 8, padding: "12px 14px", fontSize: 12.5, overflowX: "auto", marginTop: 8 }}>
{`git clone https://github.com/StephenSook/gravitonkv
cd gravitonkv/harness
./run_sweep.sh --config sweeps/mini-validate.yaml`}
          </pre>
          <p style={{ marginTop: 12 }}>
            CI runs this harness end to end on GitHub's arm64 runners (Azure Cobalt
            100, Neoverse N2) and validates the output against the canonical JSON
            schema on every push. CI proves the harness; it never produces findings:
            headline numbers come only from Graviton4.
          </p>
          <p style={{ marginTop: 12 }}>
            Mechanism notes from reading the pinned source:{" "}
            <a href="https://github.com/StephenSook/gravitonkv/blob/main/docs/mechanism-source-notes.md">
              docs/mechanism-source-notes.md
            </a>
            . Related work and citations live in the repository README.
          </p>
        </div>
      </Band>
    </main>
  );
}
