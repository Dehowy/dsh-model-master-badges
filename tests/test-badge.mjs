// Extracts badgeText / renderModelBadge OUT OF THE REAL client.js SOURCE and
// exercises them. No copy-paste: a bug in the file is a bug in this test.
import { readPlugin } from './plugin-source.mjs'

const src = readPlugin('client.js')

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`function ${name} not found`)
  let i = src.indexOf('{', start)
  let depth = 0
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const badgeTextSrc = extractFn('badgeText')
const renderSrc = extractFn('renderModelBadge')

// BADGE_TONES is a top-level const, not a function — pull its literal from the
// source too so the test cannot drift from the shipped whitelist.
const tonesMatch = src.match(/var BADGE_TONES = (\[[^\]]*\])/)
if (!tonesMatch) throw new Error('BADGE_TONES declaration not found')
const BADGE_TONES = JSON.parse(tonesMatch[1].replace(/'/g, '"'))

let uiLang = 'zh'
const h = (type, props, ...children) => ({ type, props, children })
const t = k => k

// eslint-disable-next-line no-new-func
const factory = new Function(
  'h',
  't',
  'getUiLang',
  'BADGE_TONES',
  `
  let uiLang = getUiLang()
  ${badgeTextSrc}
  ${renderSrc}
  return { badgeText, renderModelBadge }
  `
)
const api = () => factory(h, t, () => uiLang, BADGE_TONES)

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}\n         got      ${a}\n         expected ${e}`)
  }
}

console.log('\n== badgeText: string passthrough ==')
uiLang = 'zh'
eq(api().badgeText({ text: '夜间折扣' }), '夜间折扣', 'plain string is returned as-is')
eq(api().badgeText('夜间折扣'), '', 'non-object badge yields empty string')
eq(api().badgeText(null), '', 'null badge yields empty string')
eq(api().badgeText(undefined), '', 'undefined badge yields empty string')

console.log('\n== badgeText: translation table, exact locale wins ==')
uiLang = 'zh'
eq(api().badgeText({ text: { en: 'Night discount', zh: '夜间折扣' } }), '夜间折扣', 'zh user gets zh')
uiLang = 'en'
eq(api().badgeText({ text: { en: 'Night discount', zh: '夜间折扣' } }), 'Night discount', 'en user gets en')

console.log('\n== badgeText: base-language fallback (en-US -> en) ==')
uiLang = 'en-US'
eq(api().badgeText({ text: { en: 'Night discount', zh: '夜间折扣' } }), 'Night discount', 'en-US falls back to base en')

console.log('\n== badgeText: missing locale falls back to en ==')
uiLang = 'ja'
eq(api().badgeText({ text: { en: 'Night discount', zh: '夜间折扣' } }), 'Night discount', 'ja missing -> en')

console.log('\n== badgeText: en absent (upstream shipped only zh) -> any value ==')
uiLang = 'ko'
eq(api().badgeText({ text: { zh: '夜间折扣' } }), '夜间折扣', 'ko missing, en missing -> any available (zh)')
uiLang = 'zh'
eq(api().badgeText({ text: { zh: '夜间折扣' } }), '夜间折扣', 'zh present without en still resolves')

console.log('\n== badgeText: pathological tables ==')
uiLang = 'zh'
eq(api().badgeText({ text: {} }), '', 'empty table -> empty string')
eq(api().badgeText({ text: { en: '', zh: '夜间折扣' } }), '夜间折扣', 'empty en string is skipped, not returned')
eq(api().badgeText({ text: { en: 42, zh: '夜间折扣' } }), '夜间折扣', 'non-string value is skipped')
eq(api().badgeText({ text: null }), '', 'null text -> empty string')

console.log('\n== renderModelBadge: null / empty guards ==')
uiLang = 'zh'
eq(api().renderModelBadge(null), null, 'null badge -> null (no empty capsule)')
eq(api().renderModelBadge({ text: '' }), null, 'empty text -> null')
eq(api().renderModelBadge({ text: {} }), null, 'empty table -> null')
eq(api().renderModelBadge({}), null, 'badge without text -> null')

console.log('\n== renderModelBadge: shape and tone ==')
uiLang = 'zh'
{
  const el = api().renderModelBadge({ text: '夜间折扣', tone: 'success' })
  eq(el.type, 'span', 'root is a span')
  eq(el.props.className, 'dmm-badge dmm-badge-success', 'success tone class')
  eq(el.props.title, '夜间折扣', 'title mirrors the text')
  eq(el.children.length, 1, 'exactly one child')
  eq(el.children[0].type, 'span', 'child is the inner text span')
  eq(el.children[0].props.className, 'dmm-badge-text', 'inner span carries the truncation class')
  eq(el.children[0].children, ['夜间折扣'], 'inner span holds the label')
}
{
  const el = api().renderModelBadge({ text: 'Pro Only', tone: 'neutral' })
  eq(el.props.className, 'dmm-badge dmm-badge-neutral', 'neutral tone class')
}
{
  const el = api().renderModelBadge({ text: 'Pro Only', tone: 'info' })
  eq(el.props.className, 'dmm-badge dmm-badge-info', 'info tone class')
}
{
  const el = api().renderModelBadge({ text: 'Pro Only', tone: 'warning' })
  eq(el.props.className, 'dmm-badge dmm-badge-warning', 'warning tone class')
}

console.log('\n== renderModelBadge: tone whitelist ==')
{
  const el = api().renderModelBadge({ text: 'X', tone: 'danger' })
  eq(el.props.className, 'dmm-badge dmm-badge-neutral', 'out-of-schema tone falls back to neutral')
}
{
  const el = api().renderModelBadge({ text: 'X' })
  eq(el.props.className, 'dmm-badge dmm-badge-neutral', 'missing tone falls back to neutral')
}
{
  const el = api().renderModelBadge({ text: 'X', tone: 'constructor' })
  eq(el.props.className, 'dmm-badge dmm-badge-neutral', 'prototype key cannot smuggle a tone')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
