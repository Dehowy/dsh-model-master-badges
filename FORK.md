# dsh-model-master (fork)

A workspace fork of [`NEETnina/dsh-model-master`](https://github.com/NEETnina/dsh-model-master),
pinned at upstream **1.1.2**. Two deliberate divergences:

1. **Promo badges.** Model rows now show the badge the provider adapter already
   sends (`夜间折扣`, `限时免费`, `订阅优先`, `Pro Only`, …). Upstream never read
   the field, so a discount was invisible in this panel while the native picker
   showed it.
2. **Trimmed header.** The author avatar, the "点个★" GitHub pill and the TOP100
   button are gone. The header now carries only actions that affect the model
   list.

Everything else is upstream, verbatim.

## Why a fork rather than a config toggle

`model.badge` is a data field, not a component. The host builds the catalog with
`buildModelCatalog()` (`@deepseek-ai/dsh-api-session-controller`) and forwards
`badge` untouched; the clock logic that decides *whether* a promo is live runs
inside each provider adapter, before the catalog is built. So the client only has
to render what it is handed — there is nothing to schedule or recompute. There is
no hook for that in upstream's code, hence the patch.

## What changed, exactly

| File | Change |
| --- | --- |
| `index.js` | `getCatalog()` spreads `m.badge` into its model projection. Without this the `/api/model-master/catalog` fallback path would stay badge-less. |
| `client.js` | `badgeText()` resolves `string \| {en, zh, …}` against `uiLang`; `renderModelBadge()` renders a host-`Tag`-shaped capsule; both row renderers call it; `.dmm-badge*` CSS added to the injected sheet. |
| `client.js` | Author avatar, star pill and TOP100 button removed along with their constants, CSS and the three i18n keys, in all 15 language tables. |

Kept on purpose: the leaderboard HTTP endpoints, the leaderboard panel renderer
and its `boardName` / `boardHeader` strings. The UI entry is gone, so
`activeTab === 'leaderboard'` is unreachable — restoring the button is a one-line
revert against `refactor(header)`.

## Badge rendering notes

- Tone follows the host's taxonomy (`neutral` / `info` / `success` / `warning`).
  Geometry is copied from the host `Tag.module.css`, including
  `corner-shape: round` — DSH's theme injects a global superellipse, so without
  it the capsule renders as a squircle.
- Three deliberate departures from the host chip: a `6em` cap with truncation on
  an inner span (`text-overflow` is inert on an inline-flex box), and a `-4px`
  nudge so the name/badge pair keeps the host's 4px rhythm inside this panel's
  10px row gap.
- Upstreams usually ship `{en, zh}` only. This plugin speaks 15 languages, so
  after the host's chain (`uiLang → base → en`) we fall back to any available
  value: an English label beats an empty capsule.
- Badges are read when the catalog is fetched. No polling: a full catalog costs
  one `resolveModelInfo` per model (103 here), and no configured promo boundary
  is crossed within the minutes a panel stays open.

## Working on it

```bash
node --check client.js && node --check index.js     # syntax
node tools/pack.mjs                                  # validate manifest, build tarball
node tools/install.mjs                               # copy into the active profile
node tools/install.mjs --dry-run                     # show what it would touch
node tools/rollback.mjs                              # restore the pre-fork backup
```

The test suite lives in the workspace (`../_explore/test-*.mjs`), not here:
the tests extract functions out of the shipped files and execute them, so they
double as a guard that the fork has not drifted from what it claims to be.

## Following upstream

The repo is a linear history: `upstream: 1.1.2` is a verbatim commit, and every
fork change sits on top of it as its own commit. To take a new upstream release:

```bash
git remote add upstream https://github.com/NEETnina/dsh-model-master.git
git fetch upstream --tags
git rebase --onto upstream/v1.2.0 v1.1.2   # replay only the fork commits
```

Expect conflicts only in `client.js` — the header block and the two row
renderers. Both are small and commented.

## Install location and upgrade risk

`tools/install.mjs` copies into `$DSH_HOME/profiles/desktop/node_modules/dsh-model-master/`
after snapshotting the original to `dsh-model-master.pre-fork/` beside it.
Reinstalling the plugin from npm, or letting a profile-wide install run, will
overwrite the fork — that is what `rollback.mjs` and the snapshot are for.

## Version

`package.json` keeps upstream's `1.1.2` on purpose. The update checker compares
against GitHub releases; bumping to something like `1.1.2-fork.1` would make
`compareVersions()` report an update every time it ran, which is a permanent
false alarm. The fork is identified by this file instead.

## Building and installing

```bash
node tools/pack.mjs        # -> dist/dsh-model-master-1.1.2.tgz
node tools/install.mjs     # backup the installed copy, then swap in the fork
node tools/rollback.mjs    # restore the backup
```

`tools/pack.mjs` writes the tarball in-process instead of shelling out to
`npm pack`. A sandboxed DSH workspace kills child processes whose stdio is piped
(`spawnSync('npm', …)` returns `EPERM`, and npm additionally wants to write its
shared cache under `%LOCALAPPDATA%`), so `tools/tarball.mjs` carries a small ustar
writer and reader. The tarball is verified by parsing it back, not by trusting
the writer.

`tools/install.mjs` copies the pristine install to `dsh-model-master.pre-fork/`
before touching anything, stages the new files in a sibling directory, swaps them
file by file, then asserts the result. It refuses to run if the target already
carries this fork but no backup exists — that would destroy the only rollback
path — and it never overwrites an existing backup, so a second install cannot
back up its own output.

## Tests

```bash
node tests/run.mjs        # this repository
DMM_PLUGIN_DIR=<profile>/node_modules/dsh-model-master node tests/run.mjs   # the installed copy
```

Five files, 208 assertions. They read the real source rather than fixtures: the
renderer functions are extracted by brace-matching out of `client.js` and executed
in a `new Function` sandbox, so a bug in the file is a bug in the test. `test-load`
runs the whole `client.js` inside a stub module loader with a fake React, which is
the only check that catches a removed symbol still referenced at module scope.
`test-endtoend` feeds the badges the adapters actually produce right now —
recomputed from the live `cordis.patch.yml` through workbuddy's own
`selectPromoBadge`, not a reimplementation — into the installed renderer.

`DMM_PLUGIN_DIR` exists because "the tests pass" should be able to mean "the bytes
DSH loads pass", which is a different claim from "the source in my editor passes".
