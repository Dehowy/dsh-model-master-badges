#!/usr/bin/env node
/**
 * Run the whole suite, one process per file, and fail if any file fails.
 *
 * Each test is deliberately its own process: they mutate nothing shared, but a
 * hung or crashed file should not take the others down, and the exit code has to
 * reflect the worst file rather than the last one run.
 *
 * Set DMM_PLUGIN_DIR to test an installed copy instead of this repository:
 *   DMM_PLUGIN_DIR=~/.dsh-beta/profiles/desktop/node_modules/dsh-model-master \
 *     node tests/run.mjs
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const files = fs
  .readdirSync(here)
  .filter(f => f.startsWith('test-') && f.endsWith('.mjs'))
  .sort()

let failed = 0
const results = []

for (const file of files) {
  const started = Date.now()
  // stdio inherited: the assertion lines are the useful output, and buffering
  // them would hide the failing label until the very end.
  const result = spawnSync(process.execPath, [path.join(here, file)], { stdio: 'inherit' })
  const ms = Date.now() - started
  const ok = result.status === 0
  if (!ok) failed++
  results.push({ file, ok, ms, status: result.status, signal: result.signal })
}

console.log('\n' + '─'.repeat(60))
for (const r of results) {
  console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.file.padEnd(22)} ${String(r.ms).padStart(6)} ms`)
}
console.log(`${results.length - failed}/${results.length} files passed`)

if (failed) {
  console.error(`\n${failed} test file(s) failed`)
  process.exit(1)
}
