// Remote MCP endpoint (Streamable HTTP) over the bundled canonical results.
// Stateless, read-only, no auth: public benchmark data. Judges paste
// https://<host>/mcp into Claude's custom connectors.
import { createMcpHandler } from "mcp-handler";
import { registerTools } from "../../src/server.js";

const handler = createMcpHandler(
  (server) => registerTools(server),
  {},
  { basePath: "" }
);

export { handler as GET, handler as POST, handler as DELETE };
