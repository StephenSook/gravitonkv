#!/usr/bin/env node
// npx entry: stdio MCP server over the bundled canonical results.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./src/server.js";

const server = new McpServer({ name: "gravitonkv", version: "0.1.0" });
registerTools(server);
const transport = new StdioServerTransport();
await server.connect(transport);
