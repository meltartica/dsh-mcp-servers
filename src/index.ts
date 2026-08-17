import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { IncomingMessage, ServerResponse } from 'node:http'
// Type-only imports: they load the module augmentations that add
// ctx.tools / ctx.settings, and are erased at build so the bundle only
// imports real runtime deps (schemastery, the MCP SDK). The harness
// provides the framework services at runtime via `inject`.
import type {} from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { publicToolName } from './naming.js'
import { sanitizeSchema } from './sanitize.js'

export const name = 'mcp-servers'
export const inject = ['tools', 'settings']

// 'mcp' as a nominal SettingsNamespace; the brand is type-only so a cast suffices.
const NS = 'mcp' as unknown as SettingsNamespace

/** Structural subset of the host webServer service (market uses the same). */
interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

/** The config route carries env/headers that may hold tokens — loopback only. */
function isLoopback(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)
}

/** Keep error surfaces readable (e.g. a Cloudflare challenge page dumped as the body). */
function shortErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 160 ? msg.slice(0, 160) + '…' : msg
}

function createTransport(server: McpServerConfig) {
  if (server.type === 'stdio') {
    return new StdioClientTransport({
      command: server.command ?? '',
      args: server.args ?? [],
      env: server.env,
      stderr: 'pipe',
    })
  }
  if (server.type === 'sse') {
    return new SSEClientTransport(new URL(server.url ?? ''), {
      requestInit: { headers: server.headers },
    })
  }
  return new StreamableHTTPClientTransport(new URL(server.url ?? ''), {
    requestInit: { headers: server.headers },
  })
}

/** Backup payload size bounds, mirroring dsh-market's WebDAV conventions. */
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024
const MAX_UPLOAD_BYTES = 64 * 1024

/**
 * One WebDAV round trip: https-only, Basic auth via header (credentials are
 * never allowed in the URL), size-capped.
 */
async function webdavRequest(url: string, username: string, password: string, method: 'GET' | 'PUT', body?: string): Promise<string> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('WebDAV requires an https:// URL')
  if (parsed.username !== '' || parsed.password !== '') throw new Error('credentials must be passed separately, not in the URL')
  const headers: Record<string, string> = {}
  if (username !== '') headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  if (method === 'PUT') headers['content-type'] = 'application/json'
  // ponytail: body is capped after the fact rather than mid-stream; fine at these sizes.
  const response = await fetch(parsed, { method, headers, body: method === 'PUT' ? body : undefined })
  if (!response.ok) throw new Error(`WebDAV ${method} failed: HTTP ${response.status}`)
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_DOWNLOAD_BYTES) throw new Error('WebDAV response is too large')
  return text
}

export interface McpServerConfig {
  id: string
  enabled: boolean
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface Config {
  servers: McpServerConfig[]
  webdavUrl?: string
  webdavUser?: string
  webdavPass?: string
  webdavDaily?: boolean
}

// This schema is registered as the `mcp` settings namespace, so the Web UI
// settings page renders it automatically (schema-driven form). Edits land in
// the user settings document and the plugin reconnects live.
export const Config: Schema<Config> = Schema.object({
  webdavUrl: Schema.string().description('WebDAV endpoint for backup sync (https only).'),
  webdavUser: Schema.string().description('WebDAV username (optional).'),
  webdavPass: Schema.string().role('secret').description('WebDAV password (stored locally, never sent to the browser).'),
  webdavDaily: Schema.boolean().default(false).description('Push a backup to WebDAV every day at 12:00 PM.'),
  servers: Schema.array(Schema.object({
    id: Schema.string().required().description('Unique server id; also the tool-name prefix.'),
    enabled: Schema.boolean().default(true),
    type: Schema.union(['stdio', 'http', 'sse']).default('stdio'),
    command: Schema.string().description('Executable to spawn for stdio servers.'),
    args: Schema.array(Schema.string()).default([]),
    env: Schema.dict(Schema.string()).default({}),
    url: Schema.string().description('Endpoint URL for HTTP servers.'),
    headers: Schema.dict(Schema.string()).default({}),
  })).default([]),
}).description('Model Context Protocol servers exposed as Harness tools')

interface Connection {
  client: Client
  disposers: (() => void)[]
  toolCount: number
  closing: boolean
}

export function apply(ctx: Context) {
  ctx.logger?.info('[mcp-servers] loaded')
  const scope = ctx.settings.register(NS, Config)
  const connections = new Map<string, Connection>()
  const status = new Map<string, { ok: boolean; error?: string }>()
  let generation = 0
  let disposed = false
  // Per-server reconnect bookkeeping: only the dropped server is retried, so
  // one flaky server never tears down (and re-registers) the whole fleet.
  const pendingReconnects = new Map<string, NodeJS.Timeout>()
  const reconnectAttempts = new Map<string, number>()

  const clearPending = () => {
    for (const timer of pendingReconnects.values()) clearTimeout(timer)
    pendingReconnects.clear()
  }

  const scheduleReconnect = (id: string) => {
    if (disposed || pendingReconnects.has(id)) return
    // Exponential backoff so a flapping server doesn't hammer the host.
    const attempts = reconnectAttempts.get(id) ?? 0
    const delay = Math.min(30000, 2000 * 2 ** attempts)
    reconnectAttempts.set(id, attempts + 1)
    pendingReconnects.set(id, setTimeout(() => {
      pendingReconnects.delete(id)
      if (!disposed) void reconnectServer(id)
    }, delay))
  }

  const reconnectServer = async (id: string) => {
    const server = scope.get().servers.find((s) => s.id === id)
    if (!server || !server.enabled || connections.has(id)) return
    try {
      const conn = await connectServer(server)
      if (disposed || connections.has(id)) {
        for (const dispose of conn.disposers) dispose()
        await conn.client.close()
        return
      }
      connections.set(id, conn)
      status.set(id, { ok: true })
      reconnectAttempts.delete(id)
      ctx.logger?.info(`[mcp] ${id}: reconnected, ${conn.toolCount} tools`)
    } catch (err) {
      status.set(id, { ok: false, error: shortErr(err) })
      scheduleReconnect(id)
    }
  }

  const connectServer = async (server: McpServerConfig): Promise<Connection> => {
    const client = new Client({ name: 'dsh-mcp', version: '1.0.0' })
    await client.connect(createTransport(server))
    const conn: Connection = { client, disposers: [], toolCount: 0, closing: false }
    conn.disposers = await registerTools(server, client)
    conn.toolCount = conn.disposers.length
    // Real-time status: a dropped transport (child process exit, network loss)
    // unregisters the tools and marks the server down until the next start().
    client.onclose = () => { if (!conn.closing) onDisconnect(server.id, 'connection closed') }
    client.onerror = (err) => { if (!conn.closing) onDisconnect(server.id, shortErr(err)) }
    // Re-sync the tool generation when the server signals a changed tool list.
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => { void resync(server.id) })
    return conn
  }

  // Register one full generation of a server's tools; used by connect and by
  // the list_changed re-sync. The old generation is disposed only AFTER a new
  // one registers, so a failed fetch keeps the previous tools live.
  const registerTools = async (server: McpServerConfig, client: Client): Promise<(() => void)[]> => {
    const { tools } = await client.listTools()
    const disposers: (() => void)[] = []
    for (const tool of tools) {
      const fullName = publicToolName(server.id, tool.name)
      const definition: Parameters<typeof ctx.tools.register>[0] = {
        name: fullName,
        description: tool.description ?? `MCP tool ${tool.name} (server ${server.id})`,
        parameters: sanitizeSchema(tool.inputSchema) as Parameters<typeof ctx.tools.register>[0]['parameters'],
        output: {
          schema: {},
          render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
        },
        async execute(args, exec) {
          return client.callTool(
            { name: tool.name, arguments: args as Record<string, unknown> },
            undefined,
            { signal: exec.signal },
          )
        },
      }
      try {
        disposers.push(ctx.tools.register(definition))
      } catch (err) {
        // one bad schema must not drop the whole server; register the rest
        ctx.logger?.warn(`[mcp] ${server.id}: skipped tool ${tool.name}: ${err instanceof Error ? err.message : err}`)
      }
    }
    return disposers
  }

  const resync = async (id: string) => {
    const conn = connections.get(id)
    const server = serverConfig(id)
    if (!conn || !server || conn.closing) return
    try {
      const disposers = await registerTools(server, conn.client)
      for (const dispose of conn.disposers) { try { dispose() } catch { /* already gone */ } }
      conn.disposers = disposers
      conn.toolCount = disposers.length
      ctx.logger?.info(`[mcp] ${id}: re-synced ${disposers.length} tools`)
    } catch (err) {
      ctx.logger?.warn(`[mcp] ${id}: re-sync failed, keeping previous tools: ${shortErr(err)}`)
    }
  }
  const serverConfig = (id: string) => scope.get().servers.find((s) => s.id === id)

  const onDisconnect = (id: string, reason: string) => {
    const conn = connections.get(id)
    if (!conn) return
    connections.delete(id)
    conn.closing = true
    for (const dispose of conn.disposers) {
      try { dispose() } catch { /* already gone */ }
    }
    void conn.client.close().catch(() => {})
    status.set(id, { ok: false, error: reason })
    // The server may still be up (idle drop / transient blip) — bring it back.
    scheduleReconnect(id)
  }

  const stopAll = async () => {
    for (const conn of connections.values()) {
      conn.closing = true
      for (const dispose of conn.disposers) {
        try { dispose() } catch { /* already gone */ }
      }
      try { await conn.client.close() } catch { /* already closed */ }
    }
    connections.clear()
  }

  const start = async () => {
    clearPending()
    const gen = ++generation
    await stopAll()
    if (gen !== generation) return
    // Statuses are preserved across reconnects — stopAll flags intentional
    // closes, so a single server's transient drop must not flash everyone red.
    // Connect all servers concurrently; each awaits independently so one slow
    // server (spawning npx, cold SSE handshake) doesn't delay the others.
    await Promise.all(scope.get().servers.map(async (server) => {
      if (gen !== generation) return
      if (!server.enabled) {
        status.set(server.id, { ok: false, error: 'disabled' })
        return
      }
      try {
        const conn = await connectServer(server)
        if (gen !== generation) {
          for (const dispose of conn.disposers) dispose()
          await conn.client.close()
          return
        }
        connections.set(server.id, conn)
        status.set(server.id, { ok: true })
        reconnectAttempts.delete(server.id)
        ctx.logger?.info(`[mcp] ${server.id}: registered ${conn.toolCount} tools`)
      } catch (err) {
        status.set(server.id, { ok: false, error: shortErr(err) })
        ctx.logger?.warn(`[mcp] ${server.id}: connect failed: ${shortErr(err)}`)
        scheduleReconnect(server.id)
      }
    }))
  }

  // Daily WebDAV backup at 12:00 PM local time; reschedules itself on each run.
  let dailyTimer: NodeJS.Timeout | null = null
  const runDailyBackup = async () => {
    const cfg = scope.get()
    if (!cfg.webdavUrl) return
    const payload = JSON.stringify({ version: 1, servers: cfg.servers })
    if (Buffer.byteLength(payload) > MAX_UPLOAD_BYTES) { ctx.logger?.warn('[mcp] daily backup too large, skipping'); return }
    try {
      await webdavRequest(cfg.webdavUrl, cfg.webdavUser ?? '', cfg.webdavPass ?? '', 'PUT', payload)
      ctx.logger?.info('[mcp] daily backup pushed to WebDAV')
    } catch (err) {
      ctx.logger?.warn(`[mcp] daily backup failed: ${shortErr(err)}`)
    }
  }
  const scheduleDaily = () => {
    if (dailyTimer) clearTimeout(dailyTimer)
    dailyTimer = null
    const cfg = scope.get()
    if (!cfg.webdavDaily || !cfg.webdavUrl) return
    const next = new Date()
    next.setHours(12, 0, 0, 0)
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
    dailyTimer = setTimeout(() => { void runDailyBackup(); scheduleDaily() }, next.getTime() - Date.now())
  }

  const startWithSchedule = async () => { await start(); scheduleDaily() }
  ctx.effect(() => {
    void startWithSchedule()
    const unwatch = scope.watch(() => { void startWithSchedule() })
    return () => {
      disposed = true
      unwatch()
      void stopAll()
      if (dailyTimer) clearTimeout(dailyTimer)
      clearPending()
    }
  })

  // HTTP routes for the settings-page form. webServer is optional (web
  // profiles only), so acquire it lazily instead of failing CLI profiles.
  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = (hostCtx as unknown as { webServer: WebServerService }).webServer
    hostCtx.effect(() => {
      const disposers = [
        webServer.register({
          kind: 'exact',
          path: '/mcp-servers/config',
          handler: (req, res) => {
            if (!isLoopback(req)) { sendJson(res, 403, { error: 'loopback only' }); return }
            if (req.method === 'GET') {
              const cfg = scope.get()
              // webdavPass is a secret — never sent to the browser.
              sendJson(res, 200, {
                servers: cfg.servers,
                status: Object.fromEntries(status),
                webdavUrl: cfg.webdavUrl ?? '',
                webdavUser: cfg.webdavUser ?? '',
                webdavDaily: cfg.webdavDaily === true,
              })
              return
            }
            if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
            readJson(req)
              .then((body) => {
                const patch: Record<string, unknown> = {}
                if ('servers' in body) {
                  if (!Array.isArray(body.servers)) { sendJson(res, 400, { error: 'expected { servers: [...] }' }); return }
                  patch.servers = body.servers
                }
                if ('webdavUrl' in body) {
                  if (typeof body.webdavUrl !== 'string') { sendJson(res, 400, { error: 'webdavUrl must be a string' }); return }
                  patch.webdavUrl = body.webdavUrl
                }
                if ('webdavUser' in body) {
                  if (typeof body.webdavUser !== 'string') { sendJson(res, 400, { error: 'webdavUser must be a string' }); return }
                  patch.webdavUser = body.webdavUser
                }
                if ('webdavPass' in body) {
                  if (typeof body.webdavPass !== 'string') { sendJson(res, 400, { error: 'webdavPass must be a string' }); return }
                  patch.webdavPass = body.webdavPass
                }
                if ('webdavDaily' in body) {
                  if (typeof body.webdavDaily !== 'boolean') { sendJson(res, 400, { error: 'webdavDaily must be a boolean' }); return }
                  patch.webdavDaily = body.webdavDaily
                }
                if (Object.keys(patch).length === 0) { sendJson(res, 400, { error: 'empty update' }); return }
                return scope.update(patch)
              })
              .then(() => sendJson(res, 200, { ok: true }))
              .catch((err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }))
          },
        }),
        webServer.register({
          kind: 'exact',
          path: '/mcp-servers/test',
          handler: (req, res) => {
            if (!isLoopback(req)) { sendJson(res, 403, { error: 'loopback only' }); return }
            if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
            readJson(req)
              .then(async (body) => {
                const server = body.server as McpServerConfig | undefined
                if (!server || typeof server !== 'object') {
                  sendJson(res, 400, { error: 'expected { server: {...} }' })
                  return
                }
                // ponytail: test reconnects and lists tools; no registration.
                const client = new Client({ name: 'dsh-mcp', version: '1.0.0' })
                // Bound the test so a hanging spawn can't stall the HTTP
                // response (npx cold-start downloads can be slow).
                const timer = setTimeout(() => { void client.close().catch(() => {}) }, 30000)
                try {
                  await client.connect(createTransport(server))
                  const { tools } = await client.listTools()
                  clearTimeout(timer)
                  sendJson(res, 200, { ok: true, tools: tools.length })
                } catch (err) {
                  clearTimeout(timer)
                  try { await client.close() } catch { /* already gone */ }
                  sendJson(res, 200, { ok: false, error: shortErr(err) })
                }
              })
              .catch((err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }))
          },
        }),
        webServer.register({
          kind: 'exact',
          path: '/mcp-servers/webdav',
          handler: (req, res) => {
            if (!isLoopback(req)) { sendJson(res, 403, { error: 'loopback only' }); return }
            if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
            readJson(req)
              .then(async (body) => {
                const { url, username, password, direction, body: payload } = body as {
                  url?: unknown; username?: unknown; password?: unknown
                  direction?: unknown; body?: unknown
                }
                if (typeof url !== 'string' || (direction !== 'upload' && direction !== 'download')) {
                  sendJson(res, 400, { error: 'expected { url, direction: upload|download }' })
                  return
                }
                const uploadBody = direction === 'upload' ? String(payload ?? '') : undefined
                if (uploadBody !== undefined && Buffer.byteLength(uploadBody) > MAX_UPLOAD_BYTES) {
                  sendJson(res, 400, { error: 'backup is too large' })
                  return
                }
                const text = await webdavRequest(url, String(username ?? ''), String(password ?? ''), direction === 'upload' ? 'PUT' : 'GET', uploadBody)
                sendJson(res, 200, { ok: true, body: direction === 'download' ? text : undefined })
              })
              .catch((err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }))
          },
        }),
      ]
      return () => { for (const dispose of disposers) dispose() }
    }, 'mcp-servers: http routes')
  })
}

// ponytail: image/resource blocks collapse to text. If a UI wants rich blocks, render them per block type here.
function renderResult(value: unknown): string {
  const r = value as { content?: { type: string; text?: string }[]; structuredContent?: unknown } | undefined
  if (!r || !Array.isArray(r.content)) return JSON.stringify(value)
  const texts = r.content.filter((b) => b.type === 'text' && b.text).map((b) => b.text!)
  if (texts.length) return texts.join('\n')
  if (r.structuredContent !== undefined) return JSON.stringify(r.structuredContent)
  return JSON.stringify(value)
}
