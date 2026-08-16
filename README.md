# dsh-mcp-servers

Expose [Model Context Protocol](https://modelcontextprotocol.io) servers as tools inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). A dsh **bundle** with both a server half (connects to MCP servers, registers their tools) and a client half (a settings UI in the web app).

## Features

- **stdio, streamable http, and legacy SSE** transports — one shared endpoint field, tabs in the UI
- **Tools registered automatically** under `<serverId>_<toolName>` (e.g. server id `shadcn` → `shadcn_get_component`)
- **Live status dots** — green when connected, red with the reason on failure; auto-reconnects with backoff when a connection drops (idle SSE streams, crashed processes)
- **Test button** per card — probes connect + tool listing against the current draft without registering anything
- **Edit cards** — type tabs, command/args textarea, env variables (or http headers) as key/value rows with show/hide values, paste `.env` from the clipboard, enabled switch
- **Tabs**: All / Local / Remote / Backup & Restore
- **Backup & Restore**: export/import the server list as JSON (with inline preview), and optional **WebDAV sync** (push/pull, https-only, Basic auth) plus an optional **daily automatic backup at 12:00 PM** — password stored server-side as a secret, never sent back to the browser

## Install

Requires DeepSeek Harness with the `dsh` CLI.

```sh
# from a directory containing this repo (or publish it, then use the bare name);
# <name> is the profile you boot, e.g. `web`
dsh plugin --profile <name> add ./dsh-mcp-servers
dsh --profile <name>
```

Then open Settings → **MCP Servers**, add a server, hit **Test**, and **Save**.

Rebuild after changes with `npm run build` — profiles load the built `dist/` and `client/client.js`, not the sources.

## Configuration

### stdio server

| field | example |
| --- | --- |
| type | `stdio` |
| command | `npx` |
| command args | `-y`<br>`@modelcontextprotocol/server-everything` (one per line, first line is the command) |
| env | key/value rows, e.g. `API_KEY` / your token |

### http / sse server

| field | example |
| --- | --- |
| type | `http` (streamable) or `sse` (legacy event-stream) |
| url | `https://example.com/mcp` or `https://example.com/sse` |
| headers | key/value rows (e.g. `Authorization` / `Bearer …`) |

### Backup & Restore

- **Local file**: export the current config (all servers, endpoints, env, headers) as JSON, import it back, or preview what would be exported.
- **WebDAV**: URL, username, password (https only), Push/Pull. Toggle **Back up daily at 12:00 PM** to auto-push every day at noon local time.

## Development

```sh
npm install          # note: .npmrc sets legacy-peer-deps (two framework rc lines)
npm run build        # server dist/ + client bundle
npm run check        # typecheck (server + client) + sanitizer test
npm run pack         # build + produce dsh-mcp-servers-<version>.tgz
npm run publish:npm  # build + publish to npm (run `npm login` first)
```

Versioning is date-based and bumps on every build: `1.0.<YYMMDD>` (e.g. `1.0.260817`).

The client UI follows the Harness design system: primitives are host-injected externals (`@deepseek-ai/dsh-client-ui-primitives`) and native controls use `--dsw-*` theme tokens with hex fallbacks.

## Notes / limitations

- Tool input schemas are whitelist-stripped to the Harness-supported JSON Schema subset (`src/sanitize.ts`); unsupported keywords (`minLength`, `format`, `anyOf`, schema-form `additionalProperties`) are dropped.
- MCP results render as text; image/resource blocks collapse to JSON/text, not rich blocks.
- WebDAV requires an https endpoint; credentials in the URL are rejected (passed separately).
- Config/WebDAV routes are loopback-only.
- Reconnects are a full pass over all servers (parallel), so one server's drop briefly re-registers the others; status dots are not affected.
