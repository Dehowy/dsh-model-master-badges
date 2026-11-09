// Resolves which copy of the plugin the tests should read.
//
// Default: this repository's own files. Set DMM_PLUGIN_DIR to point the suite at
// another copy — notably the INSTALLED plugin under
// <DSH_HOME>/profiles/<profile>/node_modules/dsh-model-master — so "the tests
// pass" can mean "the bytes DSH actually loads pass", not just "the source in my
// editor passes". That distinction matters here: the whole point of these tools
// is swapping files into a profile.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLUGIN_DIR = path.resolve(
  process.env.DMM_PLUGIN_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
)

export function readPlugin(rel) {
  const abs = path.join(PLUGIN_DIR, rel)
  if (!fs.existsSync(abs)) throw new Error(`plugin file not found: ${abs}`)
  return fs.readFileSync(abs, 'utf8')
}

console.log(`source: ${PLUGIN_DIR}\n`)
