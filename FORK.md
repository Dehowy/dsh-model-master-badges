# dsh-model-master-badges

A personal fork of [`NEETnina/dsh-model-master`](https://github.com/NEETnina/dsh-model-master),
based on upstream **v1.1.2**. It is for my own use — there is no intent to merge
anything upstream (see [Why a fork rather than a config toggle](#why-a-fork-rather-than-a-config-toggle)).

Two deliberate divergences from upstream `v1.1.2`:

1. **Promo badges.** Model rows now show the badge the provider adapter already
   sends (`夜间折扣`, `限时免费`, `订阅优先`, `Pro Only`, …). Upstream never read
   that field, so a live discount was invisible in this panel while the native
   picker showed it.
2. **Trimmed header.** The author avatar, the "点个★" GitHub pill and the TOP100
   button are gone. The header now carries only actions that affect the model list.

Everything else is upstream, verbatim.

## What changed, exactly

Three files carry the behavioural changes. Everything else is additive tooling
and documentation.

| File | Change | Lines |
| --- | --- | --- |
| `index.js` | `getCatalog()` spreads `m.badge` into its model projection. | +5 |
| `client.js` | `badgeText()` / `renderModelBadge()` added; both row renderers call it; `.dmm-badge*` CSS added to the injected sheet. | +~60 |
| `client.js` | Author avatar, star pill and TOP100 button removed with their constants, CSS and the three i18n keys in all 15 language tables. | −233 |
| `package.json` | Four npm scripts (`test` / `pack` / `install` / `rollback`); `FORK.md` added to `files`. | +8 |
| `.gitignore` | Build output and the local npm cache. | +10 |

New files: `FORK.md`, `tools/` (5), `tests/` (6 of mine, plus upstream's 8
`*.test.js` which are tracked here but excluded from the npm package).

### `index.js` — one hunk

```js
reasoning: m.reasoning,
// Carry the promo badge (e.g. "夜间折扣" / "限时免费") through to the
// client. It is produced by provider adapters' listModels() and is
// the only channel the host forwards; dropping it here would leave
// the fallback catalog path permanently badge-less.
...(m.badge === undefined ? {} : { badge: m.badge })
```

Without this the `/api/model-master/catalog` fallback path stays badge-less even
though the main path (host `state.groups`) has the data. The spread is conditional
so a model with no badge gains no `badge: undefined` key.

### `client.js` — two independent concerns

**Added.** `badgeText(badge)` resolves `string | {en, zh, …}` against the plugin's
own `uiLang`; `renderModelBadge(badge)` renders a capsule shaped like the host's
`Tag`. Both `dmm-card-left` row renderers (search view and main list) call it
between the model name and the provider name. `allModelEntries` carries
`modelBadge: m.badge || null` — deliberately *not* named `badge`, because both
renderers already have a local `const badge = formatSpeedBadge(entry.bench)` for
the speed-test pill.

**Removed.** `AUTHOR_AVATAR` / `AUTHOR_BILI_URL` / `AUTHOR_REPO_URL`, the
`dmm-header` author block, `IcoPodium` + the TOP100 button, the `.dmm-author` /
`.dmm-avatar-*` / `.dmm-star-btn` / `.dmm-header-lb-btn` CSS, and the i18n keys
`authorLabel` / `authorStarTip` / `boardBtnTitle` from all 15 language tables.

**Kept on purpose.** The leaderboard HTTP endpoints (`/leaderboard`,
`/leaderboard/refresh`), the leaderboard panel renderer, and its `boardName` /
`boardHeader` strings. With the button gone `activeTab === 'leaderboard'` is
unreachable, so those branches are dead for now — restoring the entry point is a
one-line revert against `ca8d92b`.

## Why a fork rather than a config toggle

`model.badge` is a data field, not a component. The host builds the catalog with
`buildModelCatalog()` (`@deepseek-ai/dsh-api-session-controller`) and forwards
`badge` untouched; the clock logic that decides *whether* a promo is live runs
inside each provider adapter, before the catalog is built. So a consumer only has
to render what it is handed — there is nothing to schedule or recompute. Upstream
has no hook for that, hence the patch.

This also means the fork does not drift with promo schedules: new promos, changed
windows and expired discounts all show up correctly without touching this code.

## Badge rendering notes

- Tone follows the host's taxonomy (`neutral` / `info` / `success` / `warning`).
  The whitelist is checked by array membership, not object lookup: a tone of
  `'constructor'` would otherwise resolve through `Object.prototype` and emit a
  class that does not exist.
- Geometry is copied from the host `Tag.module.css`, including
  `corner-shape: round`. DSH's theme injects a global superellipse, so without that
  line the capsule renders as a squircle instead of a pill.
- Three deliberate departures from the host chip: a `6em` cap, truncation applied
  on an inner span (`text-overflow` is inert on an `inline-flex` box because the
  text is wrapped in an anonymous flex item), and a `-4px` nudge so the
  name/badge pair keeps the host's 4px rhythm inside this panel's 10px row gap.
  The row `gap` itself is untouched, so provider and Reasoning tags keep their
  spacing.
- Upstream adapters usually ship `{en, zh}` only. This plugin speaks 15 languages,
  so after the host's chain (`uiLang → base → en`) we fall back to any available
  value: an English label beats an empty capsule.
- Badges are read when the catalog is fetched. No polling: a full catalog costs
  one `resolveModelInfo` per model (103 here), and no configured promo boundary is
  crossed within the minutes a panel stays open.

## Working on it

```bash
node --check client.js && node --check index.js   # syntax
node tests/run.mjs                                # full suite (see below)
node tools/pack.mjs                               # validate manifest, build tarball
node tools/install.mjs [--dry-run]                # copy into the active profile
node tools/rollback.mjs [--dry-run]               # restore the pre-fork backup
```

`npm test` runs the same suite.

### Tests

```bash
node tests/run.mjs
DMM_PLUGIN_DIR=<profile>/node_modules/dsh-model-master node tests/run.mjs
```

13 files, 273 assertions, run one process per file so a crash cannot mask a
failure in another file.

Two kinds of file, both run:

- **Upstream's** eight `*.test.js` (65 assertions) run through `node --test`. They
  are the ones that prove removing the header widgets did not break the plugin's
  contract. Setting `scripts.test` to the custom runner would otherwise have
  quietly dropped them from the default run.
- **Mine** — `test-badge` (31), `test-structure` (52), `test-load` (7),
  `test-host` (10), `test-endtoend` (108). They read the real source rather than
  fixtures: functions are extracted by brace-matching out of `client.js` and
  executed in a `new Function` sandbox, so a bug in the file is a bug in the test.
  `test-load` executes the whole `client.js` inside a stub module loader with a
  fake React — the only check that catches a removed symbol still referenced at
  module scope. `test-endtoend` feeds the badges the adapters actually produce
  right now (recomputed from the live `cordis.patch.yml` through workbuddy's own
  `selectPromoBadge`, not a reimplementation) into the installed renderer.

`DMM_PLUGIN_DIR` exists because "the tests pass" should be able to mean "the bytes
DSH loads pass", which is a different claim from "the source in my editor passes".

### Why `tools/tarball.mjs` exists

`tools/pack.mjs` writes the tarball in-process instead of shelling out to
`npm pack`. A sandboxed DSH workspace kills child processes whose stdio is piped
(`spawnSync('npm', …)` returns `EPERM`), and npm additionally wants to write its
shared cache under `%LOCALAPPDATA%`. So the repo carries a small ustar writer and
reader, and verifies the archive by parsing it back rather than trusting the
writer.

`tools/install.mjs` snapshots the pristine install before touching anything,
stages the new files in a sibling directory, swaps them file by file, then asserts
the result. Its backup and staging directories live in
`<profile>/.model-master-fork/`, deliberately **outside** `node_modules`: a
directory in there whose `package.json` still says `"name": "dsh-model-master"` is,
as far as the loader is concerned, a second candidate package for the same plugin
id. It refuses to run if the target already carries this fork but no backup
exists, and never overwrites an existing backup, so a second install cannot back
up its own output.

## Following upstream

The history is linear on top of the upstream release commit
(`d1c2098`, tag `v1.1.2`), with each change as its own commit. To take a new
upstream release:

```bash
git fetch upstream --tags
git rebase --onto upstream/v1.3.0 v1.1.2     # replay only the fork commits
```

Swap `v1.3.0` for whatever the new tag is. Expect conflicts only in `client.js`:
the header block and the two row renderers, both small and commented.

Note that upstream's tags do include a `tests/` directory that the npm package
excludes, which is why this fork was rebased onto the tag rather than onto the
published tarball.

## Install location and upgrade risk

`tools/install.mjs` copies into
`$DSH_HOME/profiles/desktop/node_modules/dsh-model-master/` and snapshots the
original to `<profile>/.model-master-fork/pristine/`. Reinstalling the plugin from
npm, or a profile-wide install, will overwrite the fork — that is what
`rollback.mjs` and the snapshot are for.

`$DSH_HOME` resolves in this order: the environment variable, then whichever of
`~/.dsh`, `~/.dsh-beta`, `~/.deepseek`, `~/.config/dsh` actually contains the
plugin. Two of those directories can exist at once with valid `profiles/` trees,
so the plugin's presence decides, not the directory's presence.

## Version

The fork versions independently from upstream, starting at `1.2.0`. `1.2.0` is
the first fork release: it is `1.1.2` plus the promo badges, the trimmed header
and the packaging fixes.

Why the number had to move off upstream's `1.1.2`: `index.js` compares the
installed version against releases on **this** repository
(`UPDATE_REPO_SLUG = 'Dehowy/dsh-model-master-badges'`). If the fork had kept
`1.1.2` while this repository published `v1.2.0`, every install would report a
permanent "update available" pointing at a release it already ran. Conversely, a
prerelease suffix such as `1.1.2-fork.1` would do the same thing in the other
direction — `compareVersions()` ranks a prerelease *below* the plain version, so
`1.2.0` vs `1.2.0-fork.1` always reads as an update. Fork versions therefore stay
plain `MAJOR.MINOR.PATCH`, and `tests/test-host.mjs` asserts it.

Consequence for following upstream: there are now two version lines. Upstream
tags stay `v1.x.y` and the fork tags its own releases on top. The rebase recipe
below still starts from upstream's `v1.1.2` because that is where the fork's
commits were originally replayed; it does not need to track the fork's number.

## Attribution

Upstream is MIT-licensed; see `LICENSE` and `THIRD-PARTY-NOTICES.md`. This is a
personal fork with no upstream affiliation.
