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

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
