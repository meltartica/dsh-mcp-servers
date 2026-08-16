import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeSchema } from '../src/sanitize.js'

test('strips unsupported keywords, keeps supported nested ones', () => {
  const input = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: { type: 'boolean' }, // schema-form: dropped
    properties: {
      name: { type: 'string', minLength: 1, description: 'the name' },
      tags: { type: 'array', items: { type: 'string', format: 'uri' } },
      kind: { oneOf: [{ const: 'a' }, { const: 'b' }], anyOf: [{ type: 'string' }] },
    },
    required: ['name'],
  }
  assert.deepEqual(sanitizeSchema(input), {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'the name' },
      tags: { type: 'array', items: { type: 'string' } },
      kind: { oneOf: [{ const: 'a' }, { const: 'b' }] },
    },
    required: ['name'],
  })
})

test('keeps plain values and empty schema', () => {
  assert.equal(sanitizeSchema('x'), 'x')
  assert.deepEqual(sanitizeSchema(null), null)
  assert.deepEqual(sanitizeSchema({}), {})
})
