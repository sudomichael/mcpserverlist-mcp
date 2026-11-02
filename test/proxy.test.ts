import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createProxy } from "../src/proxy.js";

const seenAuth: Array<string | undefined> = [];
let http: HttpServer;
let url: string;

function buildFake(): McpServer {
  const s = new McpServer(
    { name: "fake-remote", version: "9.9.9" },
    { instructions: "fake instructions" },
  );
  s.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Echo a message",
      inputSchema: { msg: z.string() },
      outputSchema: { echoed: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ msg }) => ({
      content: [{ type: "text", text: msg }],
      structuredContent: { echoed: msg },
    }),
  );
  s.registerTool("boom", { description: "Always fails" }, async () => ({
    isError: true,
    content: [{ type: "text", text: "kaboom" }],
  }));
  return s;
}

before(async () => {
  http = createServer(async (req, res) => {
    seenAuth.push(req.headers.authorization);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await buildFake().connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});

after(() => {
  http.closeAllConnections();
  http.close();
});

async function connectThroughProxy(apiKey?: string) {
  const proxy = await createProxy({ url, apiKey });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await proxy.server.connect(a);
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(b);
  return { proxy, client };
}

describe("proxy", () => {
  it("passes tools/list through verbatim and mirrors instructions", async () => {
    const { proxy, client } = await connectThroughProxy();
    const direct = new Client({ name: "direct", version: "0" }, { capabilities: {} });
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    await direct.connect(new StreamableHTTPClientTransport(new URL(url)));

    const viaProxy = await client.listTools();
    const expected = await direct.listTools();
    assert.deepEqual(viaProxy.tools, expected.tools);
    const echo = viaProxy.tools.find((t) => t.name === "echo")!;
    assert.equal(echo.title, "Echo");
    assert.equal(echo.annotations?.readOnlyHint, true);
    assert.ok(echo.inputSchema.properties?.msg);
    assert.ok(echo.outputSchema);
    assert.equal(client.getInstructions(), "fake instructions");
    assert.equal(client.getServerVersion()?.name, "fake-remote");
    assert.equal(client.getServerCapabilities()?.resources, undefined);

    await direct.close();
    await client.close();
    await proxy.close();
  });

  it("passes structuredContent and isError through", async () => {
    const { proxy, client } = await connectThroughProxy();
    const ok = await client.callTool({ name: "echo", arguments: { msg: "hi" } });
    assert.deepEqual(ok.structuredContent, { echoed: "hi" });
    assert.deepEqual(ok.content, [{ type: "text", text: "hi" }]);
    assert.ok(!ok.isError);

    const bad = await client.callTool({ name: "boom", arguments: {} });
    assert.equal(bad.isError, true);
    assert.deepEqual(bad.content, [{ type: "text", text: "kaboom" }]);
    await client.close();
    await proxy.close();
  });

  it("forwards the Authorization header only when an API key is set", async () => {
    seenAuth.length = 0;
    const anon = await connectThroughProxy();
    await anon.client.listTools();
    assert.ok(seenAuth.length > 0);
    assert.ok(seenAuth.every((h) => h === undefined));
    await anon.client.close();
    await anon.proxy.close();

    seenAuth.length = 0;
    const authed = await connectThroughProxy("sk_test_123");
    await authed.client.callTool({ name: "echo", arguments: { msg: "x" } });
    assert.ok(seenAuth.length > 0);
    assert.ok(seenAuth.every((h) => h === "Bearer sk_test_123"));
    await authed.client.close();
    await authed.proxy.close();
  });

  it("works end to end as a stdio process", async () => {
    const bin = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin],
      env: { ...(process.env as Record<string, string>), MCP_SERVER_LIST_URL: url, MCP_SERVER_LIST_API_KEY: "k" },
    });
    const client = new Client({ name: "stdio-test", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["boom", "echo"]);
    await client.close();
  });
});
