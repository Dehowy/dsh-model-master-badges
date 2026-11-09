#!/usr/bin/env node
/**
 * Package the fork into a distributable tarball under dist/.
 *
 * No bundler, no build step: client.js and index.js are shipped as authored, the
 * same way upstream publishes them. This script only validates the two things a
 * tarball can silently get wrong — the manifest's `files` list actually covering
 * what the plugin needs at runtime, and every file named there existing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTarGz, listTarGz } from './tarball.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const REQUIRED_ALWAYS = ['index.js', 'client.js', 'package.json', 'cordis.patch.yml']
const problems = []

// 1. Files the runtime cannot work without.
for (const rel of REQUIRED_ALWAYS) {
  if (!fs.existsSync(path.join(root, rel))) problems.push(`missing required file: ${rel}`)
}

// 2. Every path in `files` must resolve (a typo publishes a broken tarball).
for (const entry of pkg.files || []) {
  const abs = path.join(root, entry)
  if (!fs.existsSync(abs)) problems.push(`package.json files[] names a missing path: ${entry}`)
}

// 3. `files` must actually include the runtime files. package.json is exempt:
//    npm always packs it regardless of the list, so demanding an entry would be
//    a false alarm.
const IMPLICIT = new Set(['package.json'])
for (const rel of REQUIRED_ALWAYS) {
  if (IMPLICIT.has(rel)) continue
  const covered =
    (pkg.files || []).includes(rel) ||
    (pkg.files || []).some(f => f.endsWith('/') && rel.startsWith(f))
  if (!covered) problems.push(`package.json files[] does not include ${rel}`)
}

// 3b. The fork marker must ship, or an installed copy cannot say what it is.
if (!(pkg.files || []).includes('FORK.md')) problems.push('package.json files[] does not include FORK.md')

// 4. A fork must be identifiable as one, or "is my build installed?" has no answer.
if (!fs.existsSync(path.join(root, 'FORK.md'))) {
  problems.push('FORK.md missing — the installed copy cannot identify itself as a fork')
}

// 5. The host declares `dsh.client.platform: web`; losing it silently disables
//    the whole UI half of the plugin.
if (pkg.dsh?.client?.platform !== 'web') problems.push('package.json dsh.client.platform must be "web"')
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') problems.push('package.json dsh.bundle.patch must point at ./cordis.patch.yml')

if (problems.length) {
  console.error('pack: refusing to build\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('')
  process.exit(1)
}

// ── Build ────────────────────────────────────────────────────────────────────
const dist = path.join(root, 'dist')
fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })
const name = pkg.name.replace(/^@/, '').replace(/\//g, '-')
const tarball = path.join(dist, `${name}-${pkg.version}.tgz`)

// Expand `files[]` into concrete paths. npm always includes package.json, and a
// directory entry means "everything under it", which is the only glob we need.
function expand(entries) {
  const out = []
  for (const entry of entries) {
    const abs = path.join(root, entry)
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(abs).sort()) {
        out.push(...expand([`${entry.replace(/\/$/, '')}/${child}`]))
      }
    } else {
      out.push(entry)
    }
  }
  return out
}

const archivePaths = expand([...new Set(['package.json', ...(pkg.files || [])])]).sort()
const entries = archivePaths.map(rel => ({ path: rel, data: fs.readFileSync(path.join(root, rel)) }))

// Written in-process rather than via `npm pack`: a sandboxed DSH workspace kills
// any child process whose stdio is piped (EPERM), and npm additionally wants to
// write its shared cache under %LOCALAPPDATA%. Neither is a packaging concern.
fs.writeFileSync(tarball, createTarGz(entries))

const size = fs.statSync(tarball).size
console.log(`pack: ${path.relative(root, tarball)}  (${(size / 1024).toFixed(1)} KiB, ${entries.length} files)`)

// Verify by reading the archive back, not by trusting the writer. This is the
// check that catches a tarball which is structurally valid but missing a file.
const listing = listTarGz(fs.readFileSync(tarball))
const missing = [...REQUIRED_ALWAYS, 'icon.svg', 'FORK.md']
  .map(rel => `package/${rel}`)
  .filter(needle => !listing.includes(needle))
if (missing.length) {
  console.error(`pack: tarball is missing ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`pack: tarball contains ${REQUIRED_ALWAYS.join(', ')}, icon.svg and FORK.md`)
