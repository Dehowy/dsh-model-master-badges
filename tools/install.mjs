#!/usr/bin/env node
/**
 * Install this fork into the active DSH profile.
 *
 * Safety rules this script follows:
 *   · It never deletes the installed copy without having a verified backup.
 *   · It copies into a sibling temp directory first, checks the result, and only
 *     then swaps — so an interrupted run cannot leave a half-written plugin.
 *   · Running it twice is a no-op for the backup (the first pristine copy wins),
 *     which matters because a second install must not back up its own output.
 *
 * Usage:
 *   node tools/install.mjs             install
 *   node tools/install.mjs --dry-run   report what would change
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dryRun = process.argv.includes('--dry-run')

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE = process.env.DSH_PROFILE || 'desktop'
const targetDir = path.join(HOME, 'profiles', PROFILE, 'node_modules', 'dsh-model-master')
const backupDir = `${targetDir}.pre-fork`
const stagingDir = `${targetDir}.staging`

const PAYLOAD = ['index.js', 'client.js', 'package.json', 'cordis.patch.yml', 'icon.svg', 'screenshots.json', 'FORK.md']

function log(msg) {
  console.log(dryRun ? `[dry-run] ${msg}` : msg)
}

function fail(msg) {
  console.error(`\ninstall: ${msg}\n`)
  process.exit(1)
}

// ── Preconditions ────────────────────────────────────────────────────────────
for (const rel of ['index.js', 'client.js', 'package.json']) {
  if (!fs.existsSync(path.join(root, rel))) fail(`fork is incomplete: ${rel} missing (run from the fork directory)`)
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (!fs.existsSync(path.join(root, 'FORK.md'))) fail('FORK.md missing — refusing to install something that cannot identify itself')

if (!fs.existsSync(targetDir)) {
  fail(
    `no installed plugin at\n  ${targetDir}\n\n` +
      `This script patches an existing install; it does not create one. Install\n` +
      `dsh-model-master ${pkg.version} from npm first, then re-run this.`
  )
}

// Refuse to overwrite a target that is already our own output with no backup:
// that would destroy the only pristine copy we could ever roll back to.
const alreadyOurs = fs.existsSync(path.join(targetDir, 'FORK.md'))
if (alreadyOurs && !fs.existsSync(backupDir)) {
  fail(
    `target already carries this fork but no backup exists at\n  ${backupDir}\n\n` +
      `Refusing to proceed: there would be nothing to roll back to. Restore the\n` +
      `upstream package (npm install dsh-model-master@${pkg.version}) and re-run.`
  )
}

// ── Backup ───────────────────────────────────────────────────────────────────
if (!fs.existsSync(backupDir)) {
  log(`backing up pristine install -> ${backupDir}`)
  if (!dryRun) {
    fs.cpSync(targetDir, backupDir, { recursive: true, preserveTimestamps: true })
    // A backup we cannot read back is not a backup.
    for (const rel of ['index.js', 'client.js', 'package.json']) {
      if (!fs.existsSync(path.join(backupDir, rel))) fail(`backup verification failed: ${rel} not copied`)
    }
  }
} else {
  log(`backup already present, keeping the original -> ${backupDir}`)
}

// ── Stage ────────────────────────────────────────────────────────────────────
log(`staging new files -> ${stagingDir}`)
if (!dryRun) {
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })
  for (const rel of PAYLOAD) {
    const from = path.join(root, rel)
    if (!fs.existsSync(from)) {
      // optional files are skipped, required ones already validated above
      log(`  (skip ${rel}: not in fork)`)
      continue
    }
    fs.copyFileSync(from, path.join(stagingDir, rel))
    log(`  staged ${rel}`)
  }

  // The new copy must carry the same runtime surface as the file we are about to
  // replace; otherwise the swap would break the plugin in a way that only shows
  // up after a restart.
  const stagedPkg = JSON.parse(fs.readFileSync(path.join(stagingDir, 'package.json'), 'utf8'))
  if (stagedPkg.name !== pkg.name) fail('staged package.json has a mismatched name')
  if (stagedPkg.dsh?.client?.platform !== 'web') fail('staged package.json lost dsh.client.platform = web')
}

// ── Swap ─────────────────────────────────────────────────────────────────────
if (dryRun) {
  log(`would replace index.js, client.js, package.json, cordis.patch.yml in ${targetDir}`)
  log('dry run: nothing written')
  process.exit(0)
}

for (const rel of PAYLOAD) {
  const staged = path.join(stagingDir, rel)
  if (!fs.existsSync(staged)) continue
  fs.copyFileSync(staged, path.join(targetDir, rel))
}
fs.rmSync(stagingDir, { recursive: true, force: true })

// ── Verify ───────────────────────────────────────────────────────────────────
const installed = fs.readFileSync(path.join(targetDir, 'client.js'), 'utf8')
const checks = [
  [installed.includes('renderModelBadge'), 'badge renderer present in installed client.js'],
  [installed.includes('.dmm-badge {'), 'badge CSS present in installed client.js'],
  [!installed.includes('AUTHOR_AVATAR'), 'author avatar removed from installed client.js'],
  [!installed.includes('dmm-header-lb-btn'), 'TOP100 button removed from installed client.js'],
  [
    fs.readFileSync(path.join(targetDir, 'index.js'), 'utf8').includes('badge: m.badge'),
    'getCatalog forwards badge in installed index.js'
  ],
  [fs.existsSync(path.join(targetDir, 'FORK.md')), 'FORK.md marker installed']
]

let bad = 0
for (const [ok, label] of checks) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) bad++
}

if (bad) {
  fail(`${bad} post-install check(s) failed — run tools/rollback.mjs to restore the backup`)
}

console.log(`
install: done
  installed   ${targetDir}
  backup      ${backupDir}
  restart     DSH (or reload the window) to pick up the new client bundle
`)
