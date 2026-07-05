import HeroChartLoader from "../components/HeroChartLoader";
import Reveal from "../components/Reveal";
import Nav from "../components/Nav";
import CountUp from "../components/CountUp";
import { ParetoBand, ScalingBand, ExplorerBand } from "../components/BandLoaders";
import heroData from "../public/data/hero.json";
import bandsData from "../public/data/bands.json";

const CONTEXT_LABEL = { 2048: "2k", 8192: "8k", 16384: "16k", 32768: "32k", 131072: "128k" };
const MATRIX_TARGET = 20; // 5 configs x 4 contexts for the current model sweep

function Band({ id, no, kicker, title, children }) {
  return (
    <section id={id}>
      <Reveal>
        <div className="band-head">
          <span className="band-no">{no}</span>
          <span className="band-kicker">{kicker}</span>
        </div>
        <h2>{title}</h2>
        {children}
      </Reveal>
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
        <p className="chart-note">No delta rows generated yet. Run npm run build:data.</p>
      </main>
    );
  }
  const ctx = CONTEXT_LABEL[hero.context] ?? hero.context;
  const statusText =
    cells.length >= MATRIX_TARGET
      ? `matrix complete · ${cells.length} cells`
      : `matrix collecting · ${cells.length}/${MATRIX_TARGET} cells`;

  return (
    <>
      <Nav statusText={statusText} />

      <main>
        {/* Band 1: headline */}
        <div className="hero-stagger">
          <p className="hero-kicker">KV-cache quantization on AWS Graviton4 CPU</p>
          <h1>
            Quantizing the KV cache ({hero.config}) at {ctx} context:{" "}
            <span className="better"><CountUp value={hero.prefill_pct} /> prefill</span>,{" "}
            <span className="worse"><CountUp value={hero.decode_pct} /> decode</span>,{" "}
            <span className="better"><CountUp value={hero.memory_pct} /> memory</span> vs f16.
          </h1>
          <div className="provenance">
            <span className="chip"><strong>{hero.model}</strong></span>
            <span className="chip">{src.sweep_instance} · Graviton4</span>
            <span className="chip">N={hero.n} · warmup discarded</span>
            <span className="chip">llama.cpp {src.commit.slice(0, 9)}</span>
            <span className="chip">KleidiAI on · fa on · seed 42</span>
          </div>
          <div className="chart-card">
            <p className="chart-title">
              delta vs f16/f16 baseline · same context · median of N={hero.n}
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
            c8g (Graviton4); every band regenerates from the canonical results as cells
            land. Every number on this page is generated from{" "}
            <a href="https://github.com/StephenSook/gravitonkv">the public repo</a> by
            script; nothing is hand-typed.
          </p>
        </div>

        <Band id="tradeoff" no="01" kicker="the tradeoff surface" title="Which config should you run?">
          <div className="chart-card">
            <ParetoBand cells={cells} />
          </div>
        </Band>

        <Band id="scaling" no="02" kicker="context scaling" title="How the trade moves with context length">
          <div className="chart-card">
            <ScalingBand cells={cells} />
          </div>
        </Band>

        <Band id="cells" no="03" kicker="cell explorer" title="Every cell, down to the raw reps">
          <div className="chart-card">
            <ExplorerBand cells={cells} />
          </div>
        </Band>

        <Band id="methodology" no="04" kicker="methodology and reproduction" title="How these numbers were made">
          <div className="chart-card" style={{ fontSize: 14, color: "var(--ink-2)" }}>
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
                    <td style={{ padding: "5px 18px 6px 0", color: "var(--ink-3)", whiteSpace: "nowrap", verticalAlign: "top", fontFamily: "var(--font-mono)", fontSize: 12 }}>{k}</td>
                    <td style={{ padding: "5px 0 6px" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: 16 }}>Reproduce a mini-sweep on any Graviton4 instance:</p>
            <pre style={{ background: "#0a0d1c", border: "1px solid var(--hairline)", borderRadius: 3, padding: "12px 14px", fontSize: 12.5, overflowX: "auto", marginTop: 8, fontFamily: "var(--font-mono)" }}>
{`git clone https://github.com/StephenSook/gravitonkv
cd gravitonkv/harness
./run_sweep.sh --config sweeps/mini-validate.yaml`}
            </pre>
            <p style={{ marginTop: 12 }}>
              Ask the data directly: a read-only MCP server serves these results. Remote
              endpoint <code style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>https://gravitonkv-mcp.vercel.app/mcp</code>{" "}
              (paste into Claude's custom connectors) or <code style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>npx @gravitonkv/mcp</code>.
            </p>
            <p style={{ marginTop: 12 }}>
              CI runs this harness end to end on GitHub's arm64 runners (Azure Cobalt 100,
              Neoverse N2) and validates the output against the canonical JSON schema on
              every push. CI proves the harness; it never produces findings: headline
              numbers come only from Graviton4.
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

        <footer className="footer">
          <span>GravitonKV · MIT</span>
          <a href="https://github.com/StephenSook/gravitonkv">repository</a>
          <a href="https://gravitonkv-mcp.vercel.app">mcp server</a>
          <span>llama.cpp pin {src.commit.slice(0, 9)}</span>
          <span>generated {bandsData.generated_at.slice(0, 10)}</span>
        </footer>
      </main>
    </>
  );
}
