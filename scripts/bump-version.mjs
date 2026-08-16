#!/usr/bin/env node
/**
 * Set package.json version to 1.<YYMMDD>.<build>: the date is the minor and a
 * per-build counter the patch. Each build increments the counter; a new day
 * resets it to 1 (e.g. 1.260817.1 -> 1.260817.2 -> 1.260818.1).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const path = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(path, 'utf8'))
const now = new Date()
const minor = [
  String(now.getFullYear()).slice(2),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('')
const [, curMinor = '', curPatch = '0'] = String(pkg.version).split('.')
const patch = curMinor === minor ? parseInt(curPatch, 10) + 1 : 1
const next = `1.${minor}.${patch}`
if (pkg.version !== next) {
  pkg.version = next
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n')
}
console.log(`version -> ${next}`)
