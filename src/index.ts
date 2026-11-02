#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_URL, createProxy } from "./proxy.js";

const url = process.env.MCP_SERVER_LIST_URL || DEFAULT_URL;
const apiKey = process.env.MCP_SERVER_LIST_API_KEY || undefined;

try {
  const proxy = await createProxy({ url, apiKey });
  await proxy.server.connect(new StdioServerTransport());
  const shutdown = () => void proxy.close().finally(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
} catch (err) {
  // stdout is reserved for the MCP protocol; log to stderr only.
  console.error(`mcpserverlist-mcp: could not connect to ${url}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
