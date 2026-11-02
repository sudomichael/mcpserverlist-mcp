import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export const DEFAULT_URL = "https://mcpserverlist.io/mcp";

export interface ProxyOptions {
  url?: string;
  apiKey?: string;
}

export interface Proxy {
  /** Stdio-facing server; call `server.connect(transport)` to serve it. */
  server: Server;
  close(): Promise<void>;
}

/** Errors that mean the remote answered (keep as-is) vs. the link broke (reconnect). */
function isLinkError(err: unknown): boolean {
  if (err instanceof McpError) return err.code === ErrorCode.ConnectionClosed;
  return true;
}

export async function createProxy(opts: ProxyOptions = {}): Promise<Proxy> {
  const url = new URL(opts.url ?? DEFAULT_URL);
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

  const connectRemote = async (): Promise<Client> => {
    const client = new Client({ name: "mcpserverlist-mcp", version: "0.1.0" }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
    return client;
  };

  let remote = await connectRemote();
  const caps = remote.getServerCapabilities() ?? {};
  const info = remote.getServerVersion();

  /** Run `fn` against the remote; on a broken link, reconnect once and retry. */
  const call = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    try {
      return await fn(remote);
    } catch (err) {
      if (!isLinkError(err)) throw err;
      await remote.close().catch(() => {});
      remote = await connectRemote();
      return await fn(remote);
    }
  };

  const server = new Server(
    { name: info?.name ?? "mcpserverlist-mcp", version: info?.version ?? "0.1.0" },
    {
      capabilities: {
        tools: {},
        ...(caps.resources ? { resources: {} } : {}),
        ...(caps.prompts ? { prompts: {} } : {}),
      },
      instructions: remote.getInstructions(),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, (req) => call((c) => c.listTools(req.params)));
  server.setRequestHandler(CallToolRequestSchema, (req) => call((c) => c.callTool(req.params)));

  if (caps.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, (req) => call((c) => c.listResources(req.params)));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, (req) =>
      call((c) => c.listResourceTemplates(req.params)),
    );
    server.setRequestHandler(ReadResourceRequestSchema, (req) => call((c) => c.readResource(req.params)));
  }
  if (caps.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, (req) => call((c) => c.listPrompts(req.params)));
    server.setRequestHandler(GetPromptRequestSchema, (req) => call((c) => c.getPrompt(req.params)));
  }

  return {
    server,
    close: async () => {
      await server.close().catch(() => {});
      await remote.close().catch(() => {});
    },
  };
}
