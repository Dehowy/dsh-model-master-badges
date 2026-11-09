#!/usr/bin/env node
/**
 * Install this fork into the active DSH profile.
 *
 * Safety rules this script follows:
 *   · It never overwrites the installed copy without a verified backup first.
 *   · It copies into a sibling staging directory, checks the result, and only
 *     then swaps — so an interrupted run cannot leave a half-written plugin.
 *   · Running it twice is a no-op for the backup (the first pristine copy wins),
 *     which matters because a second install must not back up its own output.
 *
 * Usage:
 *   node tools/install.mjs             install
 *   node tools/install.mjs --dry-run   report what would change
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { profilePaths, INSTALL_PAYLOAD } from './profile-paths.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dryRun = process.argv.includes('--dry-run')

const { home, profile, profileDir, workDir, targetDir, backupDir, stagingDir, legacyBackupDir } = profilePaths()

const log = msg => console.log(dryRun ? `[dry-run] ${msg}` : msg)
const fail = msg => {
  console.error(`\ninstall: ${msg}\n`)
  process.exit(1)
}

console.log(`profile: ${profileDir}\n`)

// ── Preconditions ────────────────────────────────────────────────────────────
for (const rel of ['index.js', 'client.js', 'package.json', 'FORK.md']) {
  if (!fs.existsSync(path.join(root, rel))) fail(`fork is incomplete: ${rel} missing (run from the fork directory)`)
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

if (!fs.existsSync(targetDir)) {
  fail(
    `no installed plugin at\n  ${targetDir}\n\n` +
      `This script patches an existing install; it does not create one. Install\n` +
      `dsh-model-master ${pkg.version} from npm first, then re-run this.\n\n` +
      `If DSH uses a different home directory, set DSH_HOME (looked in: ${home}).`
  )
}

// An earlier build of this script parked the backup inside node_modules as
// `dsh-model-master.pre-fork`. Move it out FIRST: while it sits there the loader
// sees a package whose manifest claims the same name, and the guard below would
// otherwise reject a perfectly recoverable upgrade.
if (fs.existsSync(legacyBackupDir) && !fs.existsSync(backupDir)) {
  log(`relocating legacy backup out of node_modules -> ${backupDir}`)
  if (!dryRun) {
    fs.mkdirSync(workDir, { recursive: true })
    fs.renameSync(legacyBackupDir, backupDir)
  }
}

// Refuse to overwrite a target that is already our own output with no backup:
// that would destroy the only pristine copy we could ever roll back to.
// A legacy backup counts as recoverable because the block above relocates it —
// during a dry run that move has not happened yet, so testing backupDir alone
// would make --dry-run report "safe" for a run that would actually abort.
const backupAvailable = fs.existsSync(backupDir) || fs.existsSync(legacyBackupDir)
const alreadyOurs = fs.existsSync(path.join(targetDir, 'FORK.md'))
if (alreadyOurs && !backupAvailable) {
  fail(
    `target already carries this fork but no backup exists at\n  ${backupDir}\n\n` +
      `Refusing to proceed: there would be nothing to roll back to. Restore the\n` +
      `upstream package (npm install dsh-model-master@${pkg.version}) and re-run.`
  )
}

// ── Backup ───────────────────────────────────────────────────────────────────
if (fs.existsSync(backupDir)) {
  log(`backup already present, keeping the original -> ${backupDir}`)
} else if (fs.existsSync(legacyBackupDir)) {
  log(`backup comes from the relocated legacy copy -> ${backupDir}`)
} else if (dryRun) {
  log(`backing up pristine install -> ${backupDir}`)
} else {
  log(`backing up pristine install -> ${backupDir}`)
  fs.mkdirSync(workDir, { recursive: true })
  fs.cpSync(targetDir, backupDir, { recursive: true, preserveTimestamps: true })
  // A backup we cannot read back is not a backup.
  for (const rel of ['index.js', 'client.js', 'package.json']) {
    if (!fs.existsSync(path.join(backupDir, rel))) fail(`backup verification failed: ${rel} not copied`)
  }
}

// ── Stage ────────────────────────────────────────────────────────────────────
log(`staging new files -> ${stagingDir}`)
if (!dryRun) {
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })
  for (const rel of INSTALL_PAYLOAD) {
    const from = path.join(root, rel)
    if (!fs.existsSync(from)) {
      log(`  (skip ${rel}: not in fork)`)
      continue
    }
    fs.copyFileSync(from, path.join(stagingDir, rel))
    log(`  staged ${rel}`)
  }

  // The new copy must carry the same runtime surface as the file it replaces;
  // otherwise the swap breaks the plugin in a way that only shows up after a
  // restart, when the old files are already gone.
  const stagedPkg = JSON.parse(fs.readFileSync(path.join(stagingDir, 'package.json'), 'utf8'))
  if (stagedPkg.name !== pkg.name) fail('staged package.json has a mismatched name')
  if (stagedPkg.dsh?.client?.platform !== 'web') fail('staged package.json lost dsh.client.platform = web')
}

// ── Swap ─────────────────────────────────────────────────────────────────────
if (dryRun) {
  log(`would replace ${INSTALL_PAYLOAD.join(', ')} in ${targetDir}`)
  log('dry run: nothing written')
  process.exit(0)
}

for (const rel of INSTALL_PAYLOAD) {
  const staged = path.join(stagingDir, rel)
  if (!fs.existsSync(staged)) continue
  fs.copyFileSync(staged, path.join(targetDir, rel))
}
fs.rmSync(stagingDir, { recursive: true, force: true })

// ── Verify ───────────────────────────────────────────────────────────────────
const installed = fs.readFileSync(path.join(targetDir, 'client.js'), 'utf8')
const installedHost = fs.readFileSync(path.join(targetDir, 'index.js'), 'utf8')
const checks = [
  [installed.includes('renderModelBadge'), 'badge renderer present in installed client.js'],
  [installed.includes('.dmm-badge {'), 'badge CSS present in installed client.js'],
  [!installed.includes('AUTHOR_AVATAR'), 'author avatar removed from installed client.js'],
  [!installed.includes('dmm-header-lb-btn'), 'TOP100 button removed from installed client.js'],
  [installedHost.includes('badge: m.badge'), 'getCatalog forwards badge in installed index.js'],
  [fs.existsSync(path.join(targetDir, 'FORK.md')), 'FORK.md marker installed'],
  [!fs.existsSync(path.join(profileDir, 'node_modules', 'dsh-model-master.pre-fork')), 'no stray package copy under node_modules']
]

let bad = 0
for (const [ok, label] of checks) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) bad++
}

if (bad) fail(`${bad} post-install check(s) failed — run tools/rollback.mjs to restore the backup`)

console.log(`
install: done
  profile     ${profileDir}
  backup      ${backupDir}
  restart     DSH (or reload the window) to pick up the new client bundle
`)
