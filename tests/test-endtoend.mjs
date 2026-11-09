// End-to-end data test: real promo config -> real renderer.
//
// The unit tests prove badgeText/renderModelBadge behave; the structural tests
// prove they are wired into the rows. This closes the remaining gap by taking
// the badges the provider adapters ACTUALLY produce right now (computed from the
// live cordis.patch.yml through workbuddy's own selectPromoBadge) and pushing
// them through the renderer from the INSTALLED client.js.
//
// What this still does not cover: the browser. Everything up to the DOM node is
// verified; whether the capsule is visually centred is a screenshot question.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { readPlugin, PLUGIN_DIR } from './plugin-source.mjs'

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

// 1. Pull the real badge values. verify-badges.mjs already knows how to walk the
//    YAML and call the adapter's own selector, so reuse it rather than
//    reimplementing the promo windowing (a reimplementation would test itself).
//
// js-yaml is resolved from the profile, not from here: this workspace has no
// node_modules, and the profile is the tree that actually owns the dependency.
const profileDir = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh-beta'), 'profiles', 'desktop')
const yamlPath = path.join(profileDir, 'cordis.patch.yml')
const wbChunk = path.join(profileDir, 'node_modules', 'dsh-connect-workbuddy', 'lib')

const live = []
if (fs.existsSync(yamlPath) && fs.existsSync(wbChunk)) {
  const require = createRequire(path.join(profileDir, 'noop.js'))
  const yaml = require('js-yaml')
  const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
  const chunkFile = fs.readdirSync(wbChunk).find(f => f.startsWith('host-heartbeat-'))
  const mod = await import(new URL(`file://${path.join(wbChunk, chunkFile).replace(/\\/g, '/')}`).href)
  const selectPromoBadge = mod.selectPromoBadge ?? mod.Tt
  const promoBadgeTone = mod.promoBadgeTone ?? mod.wt

  const walk = (node, sink) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(n => walk(n, sink))
    if (Array.isArray(node.promos)) sink.push(node)
    for (const v of Object.values(node)) walk(v, sink)
  }
  const holders = []
  walk(doc, holders)

  for (const holder of holders) {
    const model = holder.model?.[0]?.id ?? holder.name ?? '?'
    const promo = selectPromoBadge(holder.promos, Date.now())
    if (!promo) continue
    // selectPromoBadge returns the promo RECORD, not a badge: the label lives in
    // promo.badge.{shortLabel,label}, and the tone is derived from its colour.
    // Getting this wrong silently yields empty text and red herrings.
    const label = promo.badge?.shortLabel ?? promo.badge?.label
    live.push({ model, badge: { text: label, tone: promoBadgeTone(promo) } })
  }
}

ok(live.length > 0, `found live badges to render (${live.length})`, 'no promo is active at this moment')

// 2. Extract the renderer from the installed client.js, same technique the other
//    tests use: brace matching over the real source, no copy-paste.
const src = readPlugin('client.js')
function extract(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`${name} not found in ${PLUGIN_DIR}/client.js`)
  let i = src.indexOf('{', start)
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error(`unbalanced braces after ${name}`)
}

// The source declares these with `var`, not `const` — matching on `const` here
// silently matched nothing and made every badge assertion fail for the wrong
// reason. Accept both so the test does not depend on a style choice upstream.
const tonesSrc = src.match(/(?:var|const|let) BADGE_TONES = (\[[^\]]*\])/)?.[1]
ok(!!tonesSrc, 'BADGE_TONES literal found')

// A tiny createElement stand-in: enough to inspect the produced tree.
const h = (type, props, ...children) => ({ type, props: props || {}, children })
const factory = new Function(
  'h',
  'uiLang',
  'BADGE_TONES',
  `
  ${extract('badgeText')}
  ${extract('renderModelBadge')}
  return { badgeText, renderModelBadge }
  `
)
const { badgeText, renderModelBadge } = factory(h, 'zh', new Function(`return ${tonesSrc}`)())

console.log('\n== every live badge renders ==')
const expectedTone = { '夜间折扣': 'success', '限时免费': 'success', '订阅优先': 'neutral', 'Pro Only': 'success' }
for (const { model, badge } of live) {
  const text = badgeText(badge)
  ok(!!text && text.length > 0, `${model}: badgeText -> ${JSON.stringify(text)}`)
  const node = renderModelBadge(badge)
  const cls = node?.props?.className || ''
  ok(cls.includes(`dmm-badge-${badge.tone}`), `${model}: tone class ${cls}`)
  // The inner span carries the ellipsis rule; text must live there, not on the pill.
  ok(node?.children?.[0]?.props?.className === 'dmm-badge-text', `${model}: text sits in the truncation span`)
  ok(node?.children?.[0]?.children?.[0] === text, `${model}: rendered text matches badgeText`)
  if (expectedTone[text]) {
    ok(badge.tone === expectedTone[text], `${model}: "${text}" uses the colour the host reserved for it (${badge.tone})`)
  }
}

console.log('\n== Chinese labels survive an English UI ==')
// The panel's language does not decide the label; the badge's own table does,
// with en as the host-required fallback. A zh user must not see "Night discount"
// and an en user must not see 夜间折扣 unless the table only has zh.
const tableBadge = { text: { en: 'Night discount', zh: '夜间折扣' }, tone: 'success' }
const zhFactory = new Function('h', 'uiLang', 'BADGE_TONES', `${extract('badgeText')}\n${extract('renderModelBadge')}\nreturn { badgeText }`)
ok(zhFactory(h, 'zh', []).badgeText(tableBadge) === '夜间折扣', 'uiLang=zh picks the Chinese string')
ok(zhFactory(h, 'en', []).badgeText(tableBadge) === 'Night discount', 'uiLang=en picks the English string')
ok(zhFactory(h, 'ja', []).badgeText(tableBadge) === 'Night discount', 'a language missing from the table falls back to en')

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
