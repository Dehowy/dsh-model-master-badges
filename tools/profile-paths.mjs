// Shared path resolution for the install/rollback tools.
//
// Both scripts must agree on exactly where the plugin lives, or rollback will
// restore into a directory install never touched. Keeping the logic here means
// there is one answer to "where is the profile?".
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// DSH_HOME wins when set. Otherwise probe the layouts DSH is known to use —
// notably, this machine's install is `~/.dsh-beta`, not `~/.dsh`.
//
// Probing for "the directory exists" is not enough: on this machine BOTH
// `~/.dsh` and `~/.dsh-beta` exist and both contain `profiles/`, so first-match
// picked the wrong one and the tools reported "no installed plugin" against a
// healthy profile. Rank by whether the plugin is actually installed there.
export function candidateHomes(profile) {
  const homes = []
  if (process.env.DSH_HOME) homes.push(process.env.DSH_HOME)
  for (const name of ['.dsh', '.dsh-beta', '.deepseek', path.join('.config', 'dsh')]) {
    homes.push(path.join(os.homedir(), name))
  }
  return [...new Set(homes)]
}

export function resolveHome(profile = process.env.DSH_PROFILE || 'desktop') {
  const homes = candidateHomes(profile).filter(h => fs.existsSync(path.join(h, 'profiles')))

  // Prefer a home that actually has this plugin installed, most recent first.
  const installed = homes.filter(h =>
    fs.existsSync(path.join(h, 'profiles', profile, 'node_modules', 'dsh-model-master', 'package.json'))
  )
  if (installed.length) {
    installed.sort((a, b) => {
      const mtime = h => fs.statSync(path.join(h, 'profiles', profile, 'node_modules', 'dsh-model-master')).mtimeMs
      return mtime(b) - mtime(a)
    })
    return installed[0]
  }

  if (homes.length) {
    // No plugin anywhere: say so against a real profile rather than a guess.
    return homes[0]
  }
  return path.join(os.homedir(), '.dsh')
}

export function profilePaths() {
  const profile = process.env.DSH_PROFILE || 'desktop'
  const home = resolveHome(profile)
  const profileDir = path.join(home, 'profiles', profile)

  // The working area sits NEXT TO node_modules, never inside it. Anything with a
  // package.json under node_modules looks like a plugin package to DSH's loader,
  // and the pristine copy's manifest still claims `"name": "dsh-model-master"` —
  // park it inside and the loader has two candidates for the same plugin id.
  const workDir = path.join(profileDir, '.model-master-fork')

  return {
    home,
    profile,
    profileDir,
    workDir,
    targetDir: path.join(profileDir, 'node_modules', 'dsh-model-master'),
    backupDir: path.join(workDir, 'pristine'),
    stagingDir: path.join(workDir, 'staging'),
    // Where an earlier build of install.mjs put the backup. Detected so the tool
    // can move it out instead of leaving a duplicate package behind.
    legacyBackupDir: path.join(profileDir, 'node_modules', 'dsh-model-master.pre-fork')
  }
}

// Files the installer swaps. FORK.md is the marker that identifies our output;
// rollback removes it rather than restoring it.
export const INSTALL_PAYLOAD = ['index.js', 'client.js', 'package.json', 'cordis.patch.yml', 'icon.svg', 'screenshots.json', 'FORK.md']
export const ROLLBACK_PAYLOAD = INSTALL_PAYLOAD.filter(f => f !== 'FORK.md')
