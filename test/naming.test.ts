import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicToolName } from '../src/naming.js'

test('keeps clean short names as-is', () => {
  assert.equal(publicToolName('shadcn', 'get_component'), 'mcp__shadcn__get_component')
})

test('normalizes disallowed characters', () => {
  const name = publicToolName('my-server', 'read.file')
  assert.match(name, /^mcp__my-server__read_file_/)
  // changed by normalization -> deterministic hash suffix appended
  assert.equal(name, publicToolName('my-server', 'read.file'))
})

test('truncates long names to 64 chars and stays distinct', () => {
  const long = 'x'.repeat(80)
  const a = publicToolName('s', long)
  const b = publicToolName('s', 'y'.repeat(80))
  assert.ok(a.length <= 64)
  assert.notEqual(a, b)
  // deterministic
  assert.equal(a, publicToolName('s', long))
})

test('distinct raw names never collapse even after normalization', () => {
  const a = publicToolName('s', 'read.file')
  const b = publicToolName('s', 'read_file')
  assert.notEqual(a, b)
})
