# mcpserverlist-mcp

Stdio MCP server for [MCP Server List](https://mcpserverlist.io). It connects to the hosted service at `https://mcpserverlist.io/mcp` and passes tools through unchanged, so any stdio-only client or directory can use it.

## What MCP Server List does

It helps MCP server authors get their server listed in MCP directories. It checks whether your server is ready to submit, and offers a $99 managed submission service that handles the submissions for you.

## Install

Run with `npx -y mcpserverlist-mcp` (Node 20 or newer).

**Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "mcpserverlist": {
      "command": "npx",
      "args": ["-y", "mcpserverlist-mcp"]
    }
  }
}
```

**Claude Code:**

```sh
claude mcp add mcpserverlist -- npx -y mcpserverlist-mcp
```

To use an API key, add `"env": { "MCP_SERVER_LIST_API_KEY": "..." }` to the config above, or pass `-e MCP_SERVER_LIST_API_KEY=...` to `claude mcp add`.

### Direct remote (no install)

Clients that support Streamable HTTP can connect straight to the hosted server:

```sh
claude mcp add --transport http mcpserverlist https://mcpserverlist.io/mcp
```

Or in a JSON config, `{ "mcpServers": { "mcpserverlist": { "url": "https://mcpserverlist.io/mcp" } } }`.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `MCP_SERVER_LIST_API_KEY` | No | Sent as `Authorization: Bearer <key>`. Only sent when set. |
| `MCP_SERVER_LIST_URL` | No | Remote endpoint. Default `https://mcpserverlist.io/mcp`. |

## Anonymous vs. API key

Discovery and check tools work without a key. Tools that act on your account (your servers, submissions) need an API key, which you get by calling the `create_account` tool. Use `tools/list` for the current set.

## Behavior

- Connects to the remote at startup. If that fails, it prints an error to stderr and exits non-zero. Stdout carries only MCP protocol traffic.
- Forwards `tools/list` and `tools/call` unchanged. Resources and prompts are forwarded only if the remote advertises them. The remote's server instructions are mirrored.
- If the connection to the remote drops, a request reconnects and retries once.

## Development

```sh
npm install
npm test   # builds, then runs tests against an in-process fake remote
```

## License

MIT
