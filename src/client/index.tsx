/**
 * dsh-mcp-servers client: "MCP Servers" settings section. Each card shows a
 * read-only summary (status dot | id | endpoint | transport icon); Edit
 * switches to fields, and Save persists that card. Tokens match the Harness
 * settings conventions; primitives are host-injected externals.
 */
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, StateDot, IconCodeOutline16, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

export const name = 'dsh-mcp-servers'
export const inject = ['slots']

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}
interface ClientContext { slots: SlotsService }

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
interface ServerStatus { ok: boolean; error?: string }

const EMPTY: McpServerConfig = { id: '', enabled: true, type: 'stdio', args: [], env: {} }

type Css = Record<string, string | number>
const card: Css = {
  background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
}
const fieldStyle: Css = {
  boxSizing: 'border-box', width: '100%', padding: '6px 8px', font: 'inherit',
  borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
}
const labelStyle: Css = { marginBottom: 2, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
const muted: Css = { opacity: 0.7, fontSize: 13 }
const ellipsis: Css = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

function linesToArray(text: string): string[] {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ margin: '2px 0' }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  )
}

function StatusDot({ status }: { status?: ServerStatus }) {
  const ok = status?.ok === true
  return (
    <span title={ok ? 'connected' : status ? status.error ?? 'not connected' : 'not saved yet'} style={{ display: 'inline-flex' }}>
      <StateDot state={ok ? 'done' : 'error'} />
    </span>
  )
}

function TransportIcon({ type }: { type: McpServerConfig['type'] }) {
  const title = type === 'stdio' ? 'stdio (local process)' : type === 'sse' ? 'sse (legacy event stream)' : 'http (streamable)'
  return (
    <span title={title} style={{ display: 'inline-flex' }}>
      {type === 'stdio' ? <IconCodeOutline16 /> : <IconGlobeOutline14 />}
    </span>
  )
}

/** Eye / eye-off for censoring secret values (no such icon in primitives). */
const eyeStyle = { width: 14, height: 14 }
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={eyeStyle}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={eyeStyle}>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  )
}

const iconBtn: Css = {
  background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
  display: 'inline-flex', alignItems: 'center', color: 'var(--dsw-alias-label-secondary)',
}

// Inline SVGs for plus/trash too — host primitives versions older than rc.6
// lack IconPlusOutline16/IconTrashOutline16, and an undefined component
// crashes the whole section on first render (the add path).
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={eyeStyle}>
      <path d="M12 5v14" /><path d="M5 12h14" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={eyeStyle}>
      <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={eyeStyle}>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="enabled"
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 13, padding: 0, cursor: 'pointer', flexShrink: 0,
        boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-l1, #d9dde3)',
        background: checked ? 'var(--dsw-alias-state-success-primary, #16a34a)' : 'var(--dsw-alias-bg-layer-2, #f7f8fa)',
        position: 'relative',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 20 : 2, width: 20, height: 20, borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1, #fff)', transition: 'left 0.15s ease',
      }} />
    </button>
  )
}

function TypeTabs({ type, onChange }: { type: McpServerConfig['type']; onChange: (t: McpServerConfig['type']) => void }) {
  const tab = (value: McpServerConfig['type'], label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      style={{
        border: 'none', background: 'none', font: 'inherit', fontSize: 12, cursor: 'pointer',
        padding: '6px 12px', whiteSpace: 'nowrap',
        color: type === value ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        borderBottom: type === value ? '2px solid var(--dsw-alias-brand-primary)' : '2px solid transparent',
        fontWeight: type === value ? 600 : 400,
      }}
    >{label}</button>
  )
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--dsw-alias-border-l2)' }}>
      {tab('stdio', 'stdio')}
      {tab('http', 'http')}
      {tab('sse', 'sse')}
    </div>
  )
}

type SectionTab = 'all' | 'local' | 'remote' | 'backup'

function SectionTabs({ tab, onChange, counts }: {
  tab: SectionTab
  onChange: (t: SectionTab) => void
  counts?: Partial<Record<SectionTab, number>>
}) {
  const tabs: [SectionTab, string][] = [
    ['all', 'All'], ['local', 'Local'], ['remote', 'Remote'], ['backup', 'Backup & Restore'],
  ]
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--dsw-alias-border-l2, #e5e7eb)', alignItems: 'flex-end' }}>
      {tabs.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            border: 'none', background: 'none', font: 'inherit', fontSize: 13, cursor: 'pointer', padding: '7px 12px', whiteSpace: 'nowrap',
            color: tab === value ? 'var(--dsw-alias-brand-primary, #4f6ef7)' : 'var(--dsw-alias-label-secondary, #6b7280)',
            borderBottom: tab === value ? '2px solid var(--dsw-alias-brand-primary, #4f6ef7)' : '2px solid transparent',
            fontWeight: tab === value ? 600 : 400,
          }}
        >
          {label}
          {counts?.[value] !== undefined ? (
            <span style={{
              fontSize: 10, lineHeight: '14px', borderRadius: 8, padding: '0 5px', minWidth: 16, textAlign: 'center',
              background: 'var(--dsw-alias-bg-layer-2, #f7f8fa)', border: '1px solid var(--dsw-alias-border-l3, #d9dde3)',
              color: 'var(--dsw-alias-label-secondary, #6b7280)',
            }}>{counts[value]}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function EnvRow({ row, onChange, onRemove }: {
  row: { key: string; value: string }
  onChange: (next: { key: string; value: string }) => void
  onRemove: () => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }}>
      <input
        value={row.key}
        placeholder="key"
        onChange={(e) => onChange({ ...row, key: e.target.value })}
        style={{ ...fieldStyle, width: 130, padding: '3px 6px' }}
      />
      <input
        value={row.value}
        type={show ? 'text' : 'password'}
        placeholder="value"
        onChange={(e) => onChange({ ...row, value: e.target.value })}
        style={{ ...fieldStyle, flex: 1, padding: '3px 6px' }}
      />
      <button type="button" title={show ? 'hide value' : 'show value'} style={iconBtn} onClick={() => setShow(!show)}>
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
      <button type="button" title="delete variable" style={{ ...iconBtn, color: 'var(--dsw-alias-state-error-primary)' }} onClick={onRemove}>
        <TrashIcon />
      </button>
    </div>
  )
}

function mapToRows(map: Record<string, string> | undefined): { key: string; value: string }[] {
  return Object.entries(map ?? {}).map(([k, v]) => ({ key: k, value: v }))
}
function rowsToMap(rows: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) if (r.key.trim() !== '') out[r.key.trim()] = r.value
  return out
}

/** Shared KEY=VALUE row editor (env vars for stdio, headers for http). */
function KeyValueEditor({ label, addLabel, map, onMapChange }: {
  label: string
  addLabel: string
  map: Record<string, string>
  onMapChange: (next: Record<string, string>) => void
}) {
  const [rows, setRows] = useState<{ key: string; value: string }[]>(() => mapToRows(map))
  const update = (next: { key: string; value: string }[]) => { setRows(next); onMapChange(rowsToMap(next)) }
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const merged = new Map(rows.map((r) => [r.key, r.value]))
      for (const line of text.split(/\r?\n/)) {
        const i = line.indexOf('=')
        if (i <= 0) continue
        merged.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
      }
      update([...merged].map(([key, value]) => ({ key, value })))
    } catch { /* clipboard denied — nothing to do */ }
  }
  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={labelStyle}>{label}</div>
        <span style={{ flex: 1 }} />
        <Button variant="outline" size="sm" icon={<ClipboardIcon />} onClick={() => void paste()}>Paste .env</Button>
      </div>
      {rows.map((row, ri) => (
        <EnvRow
          key={ri}
          row={row}
          onChange={(next) => update(rows.map((r, j) => (j === ri ? next : r)))}
          onRemove={() => update(rows.filter((_, j) => j !== ri))}
        />
      ))}
      <Button variant="outline" size="sm" icon={<PlusIcon />} onClick={() => update([...rows, { key: '', value: '' }])}>
        {addLabel}
      </Button>
    </div>
  )
}

function ServerCard({ server, status, index, onSave, onRemove }: {
  server: McpServerConfig
  status?: ServerStatus
  index?: number
  onSave: (next: McpServerConfig) => void
  onRemove: () => void
}) {
  // New (unsaved) cards open in edit mode; saved cards show the summary.
  const isNew = !server.id
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState<McpServerConfig>(server)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; tools?: number } | null>(null)
  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const res = await fetch('/mcp-servers/test', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ server: draft }),
      })
      // Read as text and parse defensively — a timed-out/hung test can yield
      // an empty or truncated body, which res.json() would throw on.
      const text = await res.text()
      if (!res.ok) throw new Error('HTTP ' + res.status)
      let d: { ok?: boolean; error?: string; tools?: number } = {}
      try { d = JSON.parse(text) } catch { throw new Error('empty or invalid response from server') }
      setTestResult({ ok: d.ok === true, error: d.error, tools: d.tools })
    } catch (e) { setTestResult({ ok: false, error: String(e instanceof Error ? e.message : e) }) } finally { setTesting(false) }
  }
  const set = (patch: Partial<McpServerConfig>) => setDraft({ ...draft, ...patch })
  const startEdit = () => { setDraft(server); setEditing(true) }
  const cancel = () => { setDraft(server); setEditing(false) }

  if (!editing) {
    return (
      <div className="dshmcp-card" style={{ ...card, animationDelay: `${Math.min(index ?? 0, 6) * 40}ms` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusDot status={status} />
          <span style={{ flex: '0 1 auto', fontWeight: 500, fontSize: 13, color: 'var(--dsw-alias-label-primary)', ...ellipsis }}>
            {server.id || '(new server)'}
          </span>
          <TransportIcon type={server.type} />
          <span style={{ flex: 1 }} />
          <Button variant="outline" size="sm" onClick={startEdit}>Edit</Button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', ...ellipsis }}>
          {server.type === 'stdio'
            ? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
            : server.url || '—'}
        </div>
      </div>
    )
  }

  return (
    <div className="dshmcp-card" style={{ ...card, animationDelay: `${Math.min(index ?? 0, 6) * 40}ms` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot status={status} />
        <input
          value={draft.id}
          placeholder="server id"
          onChange={(e) => set({ id: e.target.value })}
          style={{ ...fieldStyle, width: 200 }}
        />
        <TransportIcon type={draft.type} />
        <span style={{ flex: 1 }} />
        <Switch checked={draft.enabled} onChange={(v) => set({ enabled: v })} />
      </div>
      <TypeTabs
        type={draft.type}
        onChange={(t) => set(t !== 'stdio'
          ? { type: t, command: '', args: [], env: {} }
          : { type: t, url: '', headers: {} })}
      />
      <div className="dshmcp-edit" style={{ display: 'flex', flexDirection: 'column' }}>
        <Field label={draft.type === 'stdio' ? 'command' : 'url'}>
          {draft.type === 'stdio' ? (
            <textarea
              value={[draft.command ?? '', ...(draft.args ?? [])].join('\n')}
              rows={4}
              placeholder={'npx\n-y\n@some/mcp-server'}
              onChange={(e) => {
                const lines = e.target.value.split(/\r?\n/)
                set({ command: lines[0] ?? '', args: lines.slice(1).map((s) => s.trim()).filter(Boolean) })
              }}
              style={fieldStyle}
            />
          ) : (
            <input
              value={draft.url ?? ''}
              placeholder="https://example.com/mcp"
              onChange={(e) => set({ url: e.target.value })}
              style={fieldStyle}
            />
          )}
        </Field>
        {draft.type === 'stdio' ? (
          <KeyValueEditor
            key="env"
            label="Environment Variables"
            addLabel="Add environment variable"
            map={draft.env ?? {}}
            onMapChange={(m) => set({ env: m })}
          />
        ) : (
          <KeyValueEditor
            key="headers"
            label="Headers"
            addLabel="Add header"
            map={draft.headers ?? {}}
            onMapChange={(m) => set({ headers: m })}
          />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4, alignItems: 'center' }}>
        <Button variant="outline" size="sm" disabled={testing} onClick={() => void test()}>{testing ? 'Testing…' : 'Test'}</Button>
        {testResult !== null ? (
          <span style={{ fontSize: 12, color: testResult.ok ? 'var(--dsw-alias-state-success-primary, #16a34a)' : 'var(--dsw-alias-state-error-primary, #dc2626)' }}>
            {testResult.ok ? `OK · ${testResult.tools} tools` : testResult.error ?? 'failed'}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <Button variant="outline" size="sm" onClick={onRemove} style={{ color: 'var(--dsw-alias-state-error-primary)' }}>Delete</Button>
        <Button variant="outline" size="sm" onClick={() => { if (isNew) onRemove(); else cancel() }}>Cancel</Button>
        <Button
          variant="primary" size="sm"
          onClick={() => { onSave(draft); setEditing(false) }}
          style={{ height: 28, minHeight: 28, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center' }}
        >Save</Button>
      </div>
    </div>
  )
}

function McpServersSection() {
  const [servers, setServers] = useState<McpServerConfig[] | null>(null)
  const [cardKeys, setCardKeys] = useState<string[]>([])
  const [status, setStatus] = useState<Record<string, ServerStatus>>({})
  const [webdavUrl, setWebdavUrl] = useState('')
  const [webdavUser, setWebdavUser] = useState('')
  const [webdavPass, setWebdavPass] = useState('')
  const [webdavDaily, setWebdavDaily] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<SectionTab>('all')
  const [preview, setPreview] = useState(false)
  const restoreRef = useRef<HTMLInputElement>(null)
  // Stable per-card identity so adding/removing other cards never remounts
  // (and thus never resets the drafts of) cards that are still in edit mode.
  const keyRef = useRef(0)
  const newKey = () => `new-${++keyRef.current}`

  const load = (alive = true) => {
    return fetch('/mcp-servers/config', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (!alive) return
        const list: McpServerConfig[] = Array.isArray(d?.servers) ? d.servers as McpServerConfig[] : []
        setServers(list)
        setCardKeys(list.map((s) => s.id || newKey()))
        setStatus(d?.status ?? {})
        if (typeof d?.webdavUrl === 'string') setWebdavUrl(d.webdavUrl)
        if (typeof d?.webdavUser === 'string') setWebdavUser(d.webdavUser)
        if (typeof d?.webdavDaily === 'boolean') setWebdavDaily(d.webdavDaily)
      })
  }

  useEffect(() => {
    let alive = true
    load(alive).catch((e) => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [])

  // Poll status so connection dots track disconnects without a manual refresh.
  useEffect(() => {
    const id = setInterval(() => { void refreshStatus().catch(() => {}) }, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After a save, refresh only status — the local servers list stays the
  // source of truth so unsaved edits in other cards are never clobbered.
  const refreshStatus = async () => {
    const res = await fetch('/mcp-servers/config', { cache: 'no-store' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const d = await res.json() as { status?: Record<string, ServerStatus> }
    setStatus(d?.status ?? {})
  }

  const persist = async (list: McpServerConfig[]) => {
    setBusy(true); setNotice(''); setError('')
    try {
      // webdavPass is sent only when the user typed one this session; an
      // empty value would otherwise wipe the stored secret on unrelated saves.
      const body: Record<string, unknown> = { servers: list, webdavUrl, webdavUser, webdavDaily }
      if (webdavPass !== '') body.webdavPass = webdavPass
      const res = await fetch('/mcp-servers/config', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()))
      setNotice('Saved')
      await refreshStatus()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  if (servers === null) return <div style={{ padding: 8, ...muted }}>Loading…</div>
  const saveOne = (i: number, next: McpServerConfig) => {
    const copy = servers.slice()
    copy[i] = next
    setServers(copy)
    void persist(copy)
  }
  const addServer = () => {
    setServers([{ ...EMPTY }, ...servers])
    setCardKeys([newKey(), ...cardKeys])
  }
  const removeOne = (i: number) => {
    const copy = servers.filter((_, j) => j !== i)
    setServers(copy)
    setCardKeys(cardKeys.filter((_, j) => j !== i))
    void persist(copy)
  }

  const backup = () => {
    const blob = new Blob([JSON.stringify({ version: 1, servers }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mcp-servers-backup.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setNotice(''); setError('')
    try {
      const parsed = JSON.parse(await file.text()) as { servers?: unknown }
      if (!Array.isArray(parsed.servers)) throw new Error('backup has no servers list')
      setServers(parsed.servers)
      setCardKeys(parsed.servers.map((s: McpServerConfig) => s.id || newKey()))
      await persist(parsed.servers)
      setNotice('Backup restored.')
    } catch (err) { setError(String(err instanceof Error ? err.message : err)) } finally { setBusy(false) }
  }

  const webdav = async (direction: 'push' | 'pull') => {
    setBusy(true); setNotice(''); setError('')
    try {
      const body: Record<string, unknown> = { url: webdavUrl, username: webdavUser, password: webdavPass, direction: direction === 'push' ? 'upload' : 'download' }
      if (direction === 'push') body.body = JSON.stringify({ version: 1, servers })
      const res = await fetch('/mcp-servers/webdav', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()))
      const d = await res.json() as { body?: string }
      if (direction === 'pull') {
        const parsed = JSON.parse(d.body ?? '') as { servers?: unknown }
        if (!Array.isArray(parsed.servers)) throw new Error('backup has no servers list')
        setServers(parsed.servers)
        setCardKeys(parsed.servers.map((s: McpServerConfig) => s.id || newKey()))
        await persist(parsed.servers)
      }
      setNotice(direction === 'push' ? 'Backup pushed to WebDAV.' : 'Backup pulled from WebDAV.')
    } catch (err) { setError(String(err instanceof Error ? err.message : err)) } finally { setBusy(false) }
  }
  return (
    <div className="dshmcp-section" style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <style>{`
        @keyframes dshmcp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .dshmcp-section { animation: dshmcp-in 0.3s ease both; }
        .dshmcp-card {
          animation: dshmcp-in 0.28s cubic-bezier(0.2, 0.7, 0.3, 1) both;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
        }
        .dshmcp-card:hover {
          border-color: var(--dsw-alias-border-l1);
          transform: translateY(-1px);
          box-shadow: 0 2px 10px rgb(0 0 0 / 0.06);
        }
        .dshmcp-edit { animation: dshmcp-in 0.22s ease both; }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px 8px' }}>
        <h3 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>MCP Servers</h3>
        <span style={{ flex: 1 }} />
        {notice ? <span style={{ fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' }}>{notice}</span> : null}
        {error ? <span style={{ fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }}>{error}</span> : null}
        {tab !== 'backup' ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={addServer}>Add server</Button>
        ) : null}
      </div>
      <SectionTabs
        tab={tab}
        onChange={setTab}
        counts={{
          all: servers.length,
          local: servers.filter((s) => s.type === 'stdio').length,
          remote: servers.filter((s) => s.type !== 'stdio').length,
        }}
      />
      {tab === 'backup' ? (
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 4px 24px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
          <div className="dshmcp-card" style={card}>
            <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>Local file</div>
            <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8b93a1)' }}>
              Export the current MCP server configuration — every server, its endpoint, environment variables and headers — to a JSON file, or import one back. Use it to back up your setup, share it with a teammate, or move it to another machine.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Button variant="outline" size="sm" disabled={busy} onClick={backup}>Export backup</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => restoreRef.current?.click()}>Import</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Preview'}</Button>
              <input
                ref={restoreRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={onRestoreFile}
              />
            </div>
            {preview ? (
              <pre style={{
                margin: 0, fontSize: 11, lineHeight: '16px', padding: 8, borderRadius: 6, overflow: 'auto', maxHeight: 240,
                background: 'var(--dsw-alias-bg-layer-2, #f7f8fa)', border: '1px solid var(--dsw-alias-border-l1, #d9dde3)',
                color: 'var(--dsw-alias-label-primary, #1f2328)',
              }}>
                {JSON.stringify({ version: 1, servers }, null, 2)}
              </pre>
            ) : null}
          </div>
          <div className="dshmcp-card" style={card}>
            <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>WebDAV</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                value={webdavUrl}
                placeholder="https://webdav…/mcp-backup.json"
                onChange={(e) => setWebdavUrl(e.target.value)}
                style={fieldStyle}
              />
              <input
                value={webdavUser}
                placeholder="user"
                onChange={(e) => setWebdavUser(e.target.value)}
                style={fieldStyle}
              />
              <input
                value={webdavPass}
                type="password"
                placeholder="password"
                onChange={(e) => setWebdavPass(e.target.value)}
                style={fieldStyle}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void webdav('push')}>Push</Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void webdav('pull')}>Pull</Button>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary, #6b7280)' }}>Back up daily at 12:00 PM</span>
                <Switch
                  checked={webdavDaily}
                  onChange={(v) => { setWebdavDaily(v); void persist(servers) }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 4px 24px',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 12, alignContent: 'start',
        }}>
          {servers.length === 0 ? (
            <div style={{ ...card, ...muted }}>No MCP servers configured. Add one to expose its tools.</div>
          ) : (
            servers
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => tab === 'local' ? s.type === 'stdio' : tab === 'remote' ? s.type !== 'stdio' : true)
              .map(({ s, i }) => (
                <ServerCard
                  key={cardKeys[i] ?? s.id}
                  server={s}
                  status={status[s.id]}
                  index={i}
                  onSave={(next) => saveOne(i, next)}
                  onRemove={() => removeOne(i)}
                />
              ))
          )}
        </div>
      )}
    </div>
  )
}

/** Shows a render crash instead of letting it blank the whole settings panel. */
class SectionBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error !== null) {
      return (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap' }}>
          MCP Servers crashed: {String(this.state.error.stack ?? this.state.error)}
        </div>
      )
    }
    return this.props.children
  }
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'mcp-servers', order: 50,
    label: () => 'MCP Servers',
  }, () => <SectionBoundary><McpServersSection /></SectionBoundary>))
}