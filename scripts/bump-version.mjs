#!/usr/bin/env node
/**
 * Set package.json version to a date-based build number: 1.0.<YYMMDD>.
 * Runs on every build, so the version advances as the date does
 * (e.g. 2026-08-17 -> 1.0.260817).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const path = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(path, 'utf8'))
const now = new Date()
const yymmdd = [
  String(now.getFullYear()).slice(2),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('')
const next = `1.0.${yymmdd}`
if (pkg.version !== next) {
  pkg.version = next
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n')
}
console.log(`version -> ${next}`)
