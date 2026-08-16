/**
 * MCP input schemas are JSON Schema draft 2020-12; the Harness tool registry
 * enforces a narrower subset (see the `JsonSchemaNode` reference). This
 * whitelist-strips every node down to the supported keys so registration
 * never rejects a schema the MCP server only annotated.
 */
const SUPPORTED_KEYS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'description', 'title', 'default', 'examples',
])

export function sanitizeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!SUPPORTED_KEYS.has(key)) continue
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const props: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) props[k] = sanitizeSchema(v)
      out.properties = props
    } else if (key === 'items') {
      out.items = sanitizeSchema(value)
    } else if (key === 'oneOf' && Array.isArray(value)) {
      out.oneOf = value.map(sanitizeSchema)
    } else if (key === 'additionalProperties' && typeof value === 'boolean') {
      // schema-form additionalProperties is not supported; drop it (stays open).
      out[key] = value
    } else if (key !== 'additionalProperties') {
      out[key] = value
    }
  }
  return out
}
