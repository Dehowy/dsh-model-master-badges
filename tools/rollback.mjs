#!/usr/bin/env node
/**
 * Restore the pre-fork install created by tools/install.mjs.
 *
 * Restores only the files the installer replaces, so anything else the profile
 * accumulated (assets, data files, an upgrade's new entries) is left alone.
 *
 * Usage:
 *   node tools/rollback.mjs             restore
 *   node tools/rollback.mjs --dry-run   report what would be restored
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE = process.env.DSH_PROFILE || 'desktop'
const targetDir = path.join(HOME, 'profiles', PROFILE, 'node_modules', 'dsh-model-master')
const backupDir = `${targetDir}.pre-fork`

const PAYLOAD = ['index.js', 'client.js', 'package.json', 'cordis.patch.yml', 'icon.svg', 'screenshots.json']

const log = msg => console.log(dryRun ? `[dry-run] ${msg}` : msg)
const fail = msg => {
  console.error(`\nrollback: ${msg}\n`)
  process.exit(1)
}

if (!fs.existsSync(backupDir)) {
  fail(
    `no backup at\n  ${backupDir}\n\n` +
      `Either the fork was never installed via tools/install.mjs, or the backup was\n` +
      `removed. To get upstream back:\n  npm install dsh-model-master@1.1.2`
  )
}

if (!fs.existsSync(targetDir)) {
  fail(`target directory is gone: ${targetDir}\nRestore it with npm install dsh-model-master@1.1.2`)
}

// The backup must be a complete plugin, not a partial copy from an interrupted
// install. Verify before writing anything.
for (const rel of ['index.js', 'client.js', 'package.json']) {
  if (!fs.existsSync(path.join(backupDir, rel))) {
    fail(`backup is incomplete (missing ${rel}) — refusing to restore a broken copy`)
  }
}

const backupClient = fs.readFileSync(path.join(backupDir, 'client.js'), 'utf8')
if (backupClient.includes('renderModelBadge')) {
  fail(
    'backup already contains the fork changes — it is not a pristine upstream copy.\n' +
      'Restore upstream with: npm install dsh-model-master@1.1.2'
  )
}

log(`restoring from ${backupDir}`)
for (const rel of PAYLOAD) {
  const from = path.join(backupDir, rel)
  if (!fs.existsSync(from)) {
    log(`  (skip ${rel}: not in backup)`)
    continue
  }
  log(`  restore ${rel}`)
  if (!dryRun) fs.copyFileSync(from, path.join(targetDir, rel))
}

// FORK.md is the marker the installer uses to detect its own output. It must not
// survive a rollback, or a later install would refuse to back up.
const marker = path.join(targetDir, 'FORK.md')
if (fs.existsSync(marker)) {
  log('  remove FORK.md (fork marker)')
  if (!dryRun) fs.rmSync(marker, { force: true })
}

if (dryRun) {
  log('dry run: nothing written')
  process.exit(0)
}

const restored = fs.readFileSync(path.join(targetDir, 'client.js'), 'utf8')
const problems = []
if (restored.includes('renderModelBadge')) problems.push('client.js still contains the badge renderer')
if (!restored.includes('AUTHOR_AVATAR')) problems.push('client.js does not look like upstream (AUTHOR_AVATAR missing)')
if (fs.existsSync(marker)) problems.push('FORK.md marker still present')

if (problems.length) {
  for (const p of problems) console.error(`  FAIL ${p}`)
  fail('rollback did not fully restore upstream')
}

console.log(`
rollback: done
  restored    ${targetDir}
  from        ${backupDir}
  restart     DSH (or reload the window) to pick up the upstream client bundle
`)
