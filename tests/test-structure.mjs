// Structural assertions on the shipped fork. These complement test-badge.mjs
// (which exercises behaviour); this file guards the *wiring* — the failure mode
// that actually bites in this plugin is code that looks right but never reaches
// the page, e.g. CSS appended to the wrong template literal, or a render call
// inserted into only one of the two row renderers.
import { readPlugin } from './plugin-source.mjs'

const client = readPlugin('client.js')
const index = readPlugin('index.js')

let pass = 0
let fail = 0
function ok(cond, label, detail) {
  if (cond) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`)
  }
}
function count(hay, needle) {
  return hay.split(needle).length - 1
}

// ── Locate the two independent CSS payloads in client.js ────────────────────
// STYLES: the main sheet, injected as <style id="dsh-model-master-styles">.
// CSS:    a separate array feeding installStyles() for the .ces-* slider.
function templateLiteral(startMarker) {
  const at = client.indexOf(startMarker)
  if (at < 0) throw new Error(`marker not found: ${startMarker}`)
  const open = client.indexOf('`', at)
  let i = open + 1
  while (i < client.length) {
    const c = client[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') return { body: client.slice(open + 1, i), start: open, end: i }
    i++
  }
  throw new Error(`unterminated template literal after ${startMarker}`)
}

const mainStyles = templateLiteral('const STYLES =')
const sliderCss = templateLiteral('var CSS =')

console.log('\n== the badge CSS lives in the sheet that actually gets injected ==')
ok(mainStyles.body.includes('.dmm-badge {'), '.dmm-badge block is inside STYLES')
ok(mainStyles.body.includes('.dmm-badge-text {'), '.dmm-badge-text is inside STYLES')
ok(!sliderCss.body.includes('.dmm-badge'), '.dmm-badge did NOT leak into the .ces-* sheet')

console.log('\n== injected sheet is the one attached to <style id="dsh-model-master-styles"> ==')
{
  const idAt = client.indexOf("'dsh-model-master-styles'")
  const styleAt = client.indexOf('style.textContent = STYLES')
  ok(idAt > -1, 'the style element id literal is present')
  ok(styleAt > -1, 'STYLES is assigned to style.textContent')
  ok(styleAt > mainStyles.start && styleAt < mainStyles.end + 4000, 'the assignment follows the STYLES literal')
}

console.log('\n== host Tag parity ==')
const badgeBlock = mainStyles.body.slice(
  mainStyles.body.indexOf('.dmm-badge {'),
  mainStyles.body.indexOf('.dmm-badge-neutral {')
)
ok(/padding:\s*1px 8px;/.test(badgeBlock), 'padding 1px 8px matches host Tag')
ok(/font-size:\s*11px;/.test(badgeBlock), 'font-size 11px matches host Tag')
ok(/line-height:\s*17px;/.test(badgeBlock), 'line-height 17px matches host Tag')
ok(/font-weight:\s*500;/.test(badgeBlock), 'font-weight 500 matches host Tag')
ok(/border-radius:\s*999px;/.test(badgeBlock), 'border-radius 999px matches host Tag')
ok(/corner-shape:\s*round;/.test(badgeBlock), 'corner-shape:round keeps the capsule a capsule')

console.log('\n== four tones, host token names, 10%/12% tints ==')
for (const tone of ['neutral', 'info', 'success', 'warning']) {
  ok(mainStyles.body.includes(`.dmm-badge-${tone} {`), `.dmm-badge-${tone} rule exists`)
}
ok(
  /\.dmm-badge-neutral \{[^}]*var\(--dsw-alias-bg-module-platform\)/.test(mainStyles.body),
  'neutral background uses --dsw-alias-bg-module-platform'
)
ok(
  /\.dmm-badge-neutral \{[^}]*var\(--dsw-alias-label-secondary\)/.test(mainStyles.body),
  'neutral colour uses --dsw-alias-label-secondary'
)
ok(
  /\.dmm-badge-success \{[^}]*state-success-primary\) 10%/.test(mainStyles.body),
  'success tint is 10%'
)
ok(/\.dmm-badge-info \{[^}]*state-business-primary\) 10%/.test(mainStyles.body), 'info tint is 10%')
ok(/\.dmm-badge-warning \{[^}]*state-warn-primary\) 12%/.test(mainStyles.body), 'warning tint is 12%, as on the host')

console.log('\n== truncation is on the inner span, not the flex container ==')
ok(
  /\.dmm-badge-text \{[^}]*text-overflow:\s*ellipsis/.test(mainStyles.body),
  'text-overflow:ellipsis is on .dmm-badge-text'
)
ok(
  !/\.dmm-badge \{[^}]*text-overflow/.test(badgeBlock),
  '.dmm-badge itself does not declare text-overflow (it would be ignored)'
)
ok(/\.dmm-badge \{[^}]*max-width:\s*6em/.test(badgeBlock), 'outer capsule caps the width at 6em')

console.log('\n== the row gap correction targets only the name/badge pair ==')
ok(
  /\.dmm-card-name \+ \.dmm-badge \{[^}]*margin-left:\s*-4px/.test(mainStyles.body),
  'adjacent-sibling rule tightens name -> badge to the host 4px rhythm'
)
ok(
  !/\.dmm-card-left \{[^}]*gap:\s*4px/.test(mainStyles.body),
  '.dmm-card-left gap is untouched (changing it would move provider/Reasoning too)'
)

console.log('\n== both row renderers carry the chip ==')
const callSites = count(client, 'renderModelBadge(entry.modelBadge)')
ok(callSites === 2, `renderModelBadge(entry.modelBadge) appears exactly twice (found ${callSites})`)
{
  // Each call must sit inside a dmm-card-left block, immediately after the name.
  const re =
    /className: 'dmm-card-left' \},([\s\S]{0,400}?)h\('span', \{ className: 'dmm-card-name' \}, entry\.modelName\),\s*renderModelBadge\(entry\.modelBadge\),\s*h\('span', \{ className: 'dmm-card-provider' \}/g
  const hits = client.match(re) || []
  ok(hits.length === 2, `both call sites follow the card name inside dmm-card-left (matched ${hits.length})`)
}
ok(count(client, "className: 'dmm-card-left'") === 2, 'there are exactly two card-left renderers to patch')
// entry.modelName also appears in switch toasts and clear-button aria-labels,
// so count the render sites specifically.
ok(
  count(client, "h('span', { className: 'dmm-card-name' }, entry.modelName)") === 2,
  'exactly two card-name spans exist, and both got a badge neighbour'
)

console.log('\n== the entry field is populated from the catalog ==')
ok(/modelBadge:\s*m\.badge \|\| null/.test(client), 'allModelEntries maps m.badge -> modelBadge')
ok(count(client, 'modelBadge:') === 1, 'modelBadge is assigned in exactly one place')

console.log('\n== the fallback catalog path forwards badge too ==')
ok(
  /\.\.\.\(m\.badge === undefined \? \{\} : \{ badge: m\.badge \}\)/.test(index),
  'getCatalog() spreads badge instead of dropping it'
)
ok(
  /models\.map\(m => \(\{[\s\S]*?badge: m\.badge/.test(index),
  'the spread sits inside the model projection'
)

console.log('\n== removed surfaces are gone for good ==')
for (const gone of [
  'AUTHOR_AVATAR',
  'AUTHOR_BILI_URL',
  'AUTHOR_REPO_URL',
  'dmm-author',
  'dmm-avatar',
  'dmm-star-btn',
  'dmm-header-lb-btn',
  'IcoPodium',
  'boardBtnTitle',
  'authorLabel',
  'authorStarTip'
]) {
  ok(count(client, gone) === 0, `${gone} is fully removed from client.js`)
}

console.log('\n== leaderboard backend intentionally kept ==')
ok(count(index, '/leaderboard') >= 1, 'host still serves /leaderboard')
ok(client.includes("fetch('/api/model-master/leaderboard')"), 'client still prefetches the snapshot')

console.log('\n== i18n tables stay balanced across 15 languages ==')
{
  const keys = ['title', 'searchPlaceholder', 'boardName', 'boardHeader', 'catalogLoadingSub']
  for (const k of keys) {
    const n = count(client, `\n      ${k}:`)
    ok(n === 15, `${k} still declared in all 15 tables (found ${n})`)
  }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
