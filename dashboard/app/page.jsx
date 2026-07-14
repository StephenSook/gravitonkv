import HeroChartLoader from "../components/HeroChartLoader";
import Reveal from "../components/Reveal";
import Nav from "../components/Nav";
import CountUp from "../components/CountUp";
import ModelBands from "../components/ModelBands";
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
  const models = bandsData.models ?? [hero.model];
  const flagship = bandsData.flagship ?? hero.model;
  const flagshipCells = cells.filter((c) => c.model === flagship).length;
  const statusText =
    models.length > 1
      ? `${models.length} models · ${cells.length} cells`
      : flagshipCells >= MATRIX_TARGET
        ? `matrix complete · ${flagshipCells} cells`
        : `matrix collecting · ${flagshipCells}/${MATRIX_TARGET} cells`;

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
            {bandsData.commit && (
              <a className="chip chip-link" href={`${bandsData.repo}/commit/${bandsData.commit}`} target="_blank" rel="noreferrer">
                data @ {bandsData.commit.slice(0, 7)} ↗
              </a>
            )}
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
            The five-config, four-context, six-model matrix is complete on c8g
            (Graviton4); every band is generated from the canonical results by script,
            nothing is hand-typed. Every number traces to its exact committed source:{" "}
            {bandsData.commit && (
              <>
                <a href={`${bandsData.repo}/commit/${bandsData.commit}`} target="_blank" rel="noreferrer">commit {bandsData.commit.slice(0, 7)}</a>,{" "}
                <a href={bandsData.ci_url} target="_blank" rel="noreferrer">the CI runs</a>,{" "}
                and the per-model source files in the methodology section.
              </>
            )}
          </p>
        </div>

        <ModelBands cells={cells} models={models} flagship={flagship} />

        <Band id="methodology" no="06" kicker="methodology and reproduction" title="How these numbers were made">
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
            <p style={{ marginTop: 16 }}>
              Reproduce clean-room on any arm64 instance (Graviton4 for real numbers). One
              command builds the pinned llama.cpp with KleidiAI, downloads a small model, runs
              the harness, and validates the output against the schema. It mirrors CI:
            </p>
            <pre style={{ background: "#0a0d1c", border: "1px solid var(--hairline)", borderRadius: 3, padding: "12px 14px", fontSize: 12.5, overflowX: "auto", marginTop: 8, fontFamily: "var(--font-mono)" }}>
{`git clone https://github.com/StephenSook/gravitonkv
cd gravitonkv
./scripts/reproduce.sh`}
            </pre>
            {bandsData.commit && (
              <>
                <p style={{ marginTop: 16 }}>
                  Every number traces to its exact committed source. The data on this page was
                  generated from{" "}
                  <a href={`${bandsData.repo}/commit/${bandsData.commit}`} target="_blank" rel="noreferrer">
                    commit {bandsData.commit.slice(0, 7)}
                  </a>
                  ; each per-model result file:
                </p>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7 }}>
                  {bandsData.sources.map((s) => (
                    <li key={s.file}>
                      <a href={s.results_url} target="_blank" rel="noreferrer">{s.file}</a>
                      {" — "}
                      {s.model.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p style={{ marginTop: 12 }}>
              Ask the data directly: a read-only MCP server serves these results. Remote
              endpoint <code style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>https://gravitonkv-mcp.vercel.app/mcp</code>{" "}
              (paste into Claude's custom connectors) or <code style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>npx @gravitonkv/mcp</code>.
            </p>
            <p style={{ marginTop: 12 }}>
              <a href={bandsData.ci_url ?? "https://github.com/StephenSook/gravitonkv/actions"} target="_blank" rel="noreferrer">CI</a>{" "}
              runs this harness end to end on GitHub's arm64 runners (Azure Cobalt 100,
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
          {bandsData.commit && (
            <a href={`${bandsData.repo}/commit/${bandsData.commit}`} target="_blank" rel="noreferrer">data @ {bandsData.commit.slice(0, 7)}</a>
          )}
          <a href="https://gravitonkv-mcp.vercel.app">mcp server</a>
          <span>llama.cpp pin {src.commit.slice(0, 9)}</span>
          <span>generated {bandsData.generated_at.slice(0, 10)}</span>
        </footer>
      </main>
    </>
  );
}
