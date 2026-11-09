// Imports the host half of the fork as a real ES module and checks its public
// surface. This catches a broken export, a syntax error node --check accepts in
// CJS mode, and — most importantly — that getCatalog's badge passthrough is live
// code, by calling the mapping shape the way the plugin does.
import assert from 'node:assert'
import path from 'node:path'
import { PLUGIN_DIR, readPlugin } from './plugin-source.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, detail) => {
  if (cond) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`)
  }
}

console.log('\n== index.js imports as an ES module ==')
let mod = null
let err = null
try {
  mod = await import(new URL(`file://${path.join(PLUGIN_DIR, 'index.js').replace(/\\/g, '/')}`).href)
} catch (e) {
  err = e
}
ok(err === null, 'index.js imports cleanly', err && `${err.name}: ${err.message}`)

if (mod) {
  console.log('\n== public surface ==')
  ok(typeof mod.default === 'function' || typeof mod.apply === 'function', 'a plugin entry point exists')
  ok(Array.isArray(mod.inject) && mod.inject.includes('llm'), `inject declares llm (got ${JSON.stringify(mod.inject)})`)
  ok(mod.name === 'model-master', `name is model-master (got ${JSON.stringify(mod.name)})`)
}

console.log('\n== getCatalog keeps the badge ==')
{
  // Drive the real getCatalog through a fake llm service. This is the exact
  // failure the fork fixes: before the change the projection rebuilt each model
  // object field by field and silently dropped `badge`.
  const src = readPlugin('index.js')

  const start = src.indexOf('async function getCatalog(')
  assert.ok(start > -1, 'getCatalog exists')
  let i = src.indexOf('{', start)
  let depth = 0
  let end = -1
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  const body = src.slice(start, end)

  const logger = { info() {}, warn() {}, error() {}, debug() {} }
  const fakes = {
    'model with a translated badge': {
      id: 'p1',
      displayName: 'WorkBuddy',
      models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', badge: { text: { en: 'Night discount', zh: '夜间折扣' }, tone: 'success' } }]
    },
    'model with a string badge': {
      id: 'p2',
      displayName: 'Trae',
      models: [{ id: 'm2', name: 'M2', badge: { text: '限时免费', tone: 'info' } }]
    },
    'model without a badge': {
      id: 'p3',
      displayName: 'Plain',
      models: [{ id: 'm3', name: 'M3' }]
    }
  }

  const fn = new Function(
    'logger',
    `
    ${body}
    return getCatalog
    `
  )(logger)

  for (const [label, provider] of Object.entries(fakes)) {
    const llm = {
      // listProviders() is synchronous and returning a bare array.
      listProviders: () => [provider],
      listModels: async () => provider.models,
      resolveModelInfo: async (_p, id) => ({ reasoning: false, id })
    }
    let catalog = null
    let callErr = null
    try {
      catalog = await fn(llm, logger)
    } catch (e) {
      callErr = e
    }
    ok(callErr === null, `${label}: getCatalog runs`, callErr && `${callErr.name}: ${callErr.message}`)
    // getCatalog returns the groups array itself, not an envelope.
    const model = catalog?.[0]?.models?.[0]
    if (provider.models[0].badge) {
      ok(
        model && JSON.stringify(model.badge) === JSON.stringify(provider.models[0].badge),
        `${label}: badge survives the projection`,
        model ? `got ${JSON.stringify(model.badge)}` : 'no model in catalog'
      )
    } else {
      ok(model && !('badge' in model), `${label}: no badge key is fabricated`, model ? `got ${JSON.stringify(model.badge)}` : 'no model')
    }
  }
}

console.log('\n== the published manifest cannot run scripts a consumer lacks files for ==')
{
  // Regression guard for a real defect: `scripts.install` is the npm lifecycle
  // hook, so every consumer of the tarball executed `node tools/install.mjs` — but
  // tools/ is intentionally absent from files[], so that path never existed in the
  // package. Installing the fork failed outright until the key was renamed.
  const pkg = JSON.parse(readPlugin('package.json'))
  const LIFECYCLE = [
    'preinstall',
    'install',
    'postinstall',
    'prepare',
    'prepublish',
    'prepublishOnly',
    'prepack',
    'postpack',
    'dependencies',
    'preversion',
    'version',
    'postversion',
  ]
  const collisions = Object.keys(pkg.scripts || {}).filter(k => LIFECYCLE.includes(k))
  ok(collisions.length === 0, 'no script is named after an npm lifecycle event', `collisions: ${collisions.join(', ')}`)

  // Those entry points must still exist, just under names npm will not auto-run.
  ok(typeof pkg.scripts?.['fork:install'] === 'string', 'the fork installer is reachable as fork:install')
  ok(typeof pkg.scripts?.['fork:rollback'] === 'string', 'the fork rollback is reachable as fork:rollback')

  // The manifest must not claim runtime files it does not ship: `main` and the
  // declared bundle patch have to be real paths inside the repository root.
  const fs = await import('node:fs')
  ok(fs.existsSync(path.join(PLUGIN_DIR, pkg.main)), `main resolves (${pkg.main})`)
  ok(
    fs.existsSync(path.join(PLUGIN_DIR, pkg.dsh?.bundle?.patch ?? '')),
    `dsh.bundle.patch resolves (${pkg.dsh?.bundle?.patch})`
  )

  // The version has to stay a plain semver the comparator understands, and it
  // has to keep moving past whatever the fork's own last release shipped — the
  // update checker compares it against releases on this repository now, not
  // upstream's, so a version at or below the published tag reads as "up to date"
  // forever.
  ok(
    /^\d+\.\d+\.\d+$/.test(pkg.version),
    `version is a plain release semver, no prerelease tag (${pkg.version})`
  )
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
