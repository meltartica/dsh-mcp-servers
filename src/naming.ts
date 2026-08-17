import { createHash } from 'node:crypto'

/**
 * Public model-facing tool name, matching the official dsh-mcp-client
 * contract: `mcp__<serverId>__<rawName>`, normalized to [A-Za-z0-9_-] and
 * capped at 64 chars. When replacement or truncation changes the name, a
 * deterministic 12-hex hash of (serverId, rawName) is appended so distinct
 * tools never collapse into one name.
 */
const TOOL_NAME_RE = /[^A-Za-z0-9_-]/g
export function publicToolName(serverId: string, rawName: string): string {
  const base = `mcp__${serverId}__${rawName}`
  const normalized = base.replace(TOOL_NAME_RE, '_')
  if (normalized === base && base.length <= 64) return base
  const hash = createHash('sha256').update(`${serverId}\u0000${rawName}`).digest('hex').slice(0, 12)
  return `${normalized.slice(0, 64 - 13)}_${hash}`
}
