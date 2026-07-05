export const metadata = { title: "GravitonKV MCP" };

export default function Page() {
  return (
    <main style={{ fontFamily: "system-ui", background: "#1a1a19", color: "#c3c2b7", minHeight: "100vh", padding: "48px 24px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ color: "#fff", fontSize: 24 }}>GravitonKV results MCP</h1>
        <p style={{ marginTop: 12 }}>
          Read-only MCP server over the GravitonKV canonical benchmark results
          (KV-cache quantization on AWS Graviton4 CPU).
        </p>
        <p style={{ marginTop: 12 }}>
          Endpoint: <code style={{ color: "#fff" }}>/mcp</code> (Streamable HTTP). Add it in
          Claude: Settings, Connectors, Add custom connector. Or run locally:{" "}
          <code style={{ color: "#fff" }}>npx @gravitonkv/mcp</code>.
        </p>
        <p style={{ marginTop: 12 }}>
          Tools: get_headline_finding, query_results, compare_configs,
          recommend_config, get_methodology. Read-only forever.
        </p>
        <p style={{ marginTop: 12 }}>
          <a href="https://gravitonkv-web.vercel.app" style={{ color: "#56B4E9" }}>Dashboard</a> ·{" "}
          <a href="https://github.com/StephenSook/gravitonkv" style={{ color: "#56B4E9" }}>Repository</a>
        </p>
      </div>
    </main>
  );
}
