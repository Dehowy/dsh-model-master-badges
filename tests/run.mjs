#!/usr/bin/env node
/**
 * Run the whole suite: this fork's checks plus upstream's own tests.
 *
 * Two kinds of file live here:
 *
 *   test-*.mjs      plain scripts; they print their own assertion lines and set
 *                   the exit code themselves.
 *   *.test.js       upstream's node:test files.
 *
 * Both are executed as plain `node <file>`. Upstream's files work that way because
 * node:test runs them in-process and still reports the usual `ℹ tests / pass / fail`
 * summary and exits non-zero on failure. We deliberately avoid `node --test <file>`:
 * that form spawns a child per file, and a sandboxed DSH workspace denies piped-stdio
 * child processes (spawn EPERM), which turned all eight upstream files into one
 * uniform `Error: spawn EPERM` unrelated to their assertions.
 *
 * Both kinds are covered on purpose. Ours prove the badge wiring works; upstream's
 * prove the fork did not break the plugin's contract while removing the header
 * widgets. Running only one of the two would make "tests pass" a much weaker claim
 * than it sounds — that is exactly how a removed symbol reaches production.
 *
 * Each file gets its own process: a hang or a crash in one must not mask a real
 * failure in another, and the exit code has to reflect the worst file, not the
 * last one run.
 *
 * Set DMM_PLUGIN_DIR to point this fork's checks at an installed copy instead of
 * this repository:
 *   DMM_PLUGIN_DIR=~/.dsh-beta/profiles/desktop/node_modules/dsh-model-master \
 *     node tests/run.mjs
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const all = fs.readdirSync(here)

const ours = all.filter(f => f.startsWith('test-') && f.endsWith('.mjs')).sort()
const upstream = all.filter(f => f.endsWith('.test.js')).sort()

const results = []
let failed = 0

function run(label, args) {
  const started = Date.now()
  // stdio inherited: the assertion lines are the useful output, and buffering
  // them would hide the failing label until the very end.
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' })
  const ok = result.status === 0
  if (!ok) failed++
  results.push({ label, ok, ms: Date.now() - started })
}

console.log(`\n== upstream contract tests (${upstream.length} files) ==`)
for (const file of upstream) run(file, [path.join(here, file)])

console.log(`\n== fork checks (${ours.length} files) ==`)
for (const file of ours) run(file, [path.join(here, file)])

console.log('\n' + '─'.repeat(62))
for (const r of results) {
  console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.label.padEnd(26)} ${String(r.ms).padStart(6)} ms`)
}
console.log(`${results.length - failed}/${results.length} files passed`)

if (failed) {
  console.error(`\n${failed} test file(s) failed`)
  process.exit(1)
}
