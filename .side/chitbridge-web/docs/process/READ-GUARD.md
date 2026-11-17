# READ-GUARD — the §6 code-quality guard, the ratchet, the PR checklist, trace.json (2026-10-15)

DISCIPLINES §6 (Athi, 15 Oct): every function a change writes or touches goes through SHRINK · HUMANIFY · STRUCTURE + DOCUMENT, and the PR
shows the before → after numbers. This round makes that a guard in both repos. **Only CHANGED code is judged** — the backlog blocks nobody.

## The tool (one measure, four modes) — `tools/readability.cjs`
| mode | what | where it runs |
|---|---|---|
| `node tools/readability.cjs` | the READ-1 baseline R1–R6 over web · api · engines (`--roots`, `--json`, `--detail`) | by hand |
| `node tools/readability.cjs --changed [--base origin/main] [--repo web\|api --root DIR] --ratchet --md` | judge what the change touched (git diff vs merge-base, plus untracked files); `--md` prints the §6 checklist with numbers | web CI (check job) · api CI (guards job via `tests/readability-guard.test.cjs`) · locally before a push |
| `… --changed --ratchet --write` | tighten only the touched files' ratchet rows (lower only) | by hand, in the PR that lowered a score |
| `node tools/readability.cjs --write [--repo api --root ../chitbridge-api]` | write / tighten the whole ratchet (lower only, never raises) | by hand |

Modules: `tools/readability/measure.cjs` (the acorn walk — functions · names · catches · literals · comments · header),
`baseline.cjs` (R1–R6), `changed.cjs` (git), `guard.cjs` (the rules + numbers + markdown), `ratchet.cjs` (score + file).
acorn 8.15.0 is **vendored** at `tools/vendor/acorn.cjs` (MIT, https://www.npmjs.com/package/acorn) — no npm dependency, so the guard runs
offline in both gates and on the owner's PC; an installed `acorn` package is used first when one exists.

## What fails (`--changed --ratchet`)
| rule | fails when | passes when |
|---|---|---|
| `hard-limit` | a touched function is over a hard limit (> 80 lines · complexity > 15 · nesting > 4) and is NEW, CROSSED the limit, or GOT WORSE (lines, complexity or depth rose) | a legacy function still over but not worse → a warning naming it |
| `cryptic-name` | a cryptic name's declaration count in the file ROSE (≤ 3 chars; not `i j k` in a for header, `e`/`err` in a catch, `x y _ $`, nor the conventional list `req res db id key url …` + `fs os`) | `ct` → `counter` · moved code · a rename |
| `empty-catch` | the file's count of `catch (e) {}` / `.catch(fn)` whose body only returns or assigns a literal ROSE | the catch logs (`cbQuiet`, `lib/logger`) or answers |
| `module-header` | the touched module's header lacks **owns** · **called by** · a **FLOW / INIT** line | all three words present (first comment of the file; for a page also its first `<!-- -->`) |
| `card-line` | no `CARD <area>/<card-id>` in the header | e.g. `// CARD qa/readability-guard` |
| `trace-row` | the module has no test in `trace.json` (KG1 `tested-by`: a test that requires it, names it by path string, names its screen / function, or calls its route) | at least one test or walk reaches it |
| `test-minimums` | §7 minimums of the module's layer not evidenced by its tests — **a warning until 2026-10-22, a failure after** (`MINIMUMS_FAIL_FROM` in guard.cjs; `--today` for tests) | the keywords are in the tests, or a `MIN <name>` line |
| `ratchet` | the file's score is above its row in `readability.ratchet.json` (a file with no row = new code, must score 0) | the score is the same or lower (lower → "tighten it: --write") |
| `parse` | the file does not parse | |

**Score** (per file, the ratchet row) = `long40 + long80 + complex10 + complex15 + deep3 + deep4 + cryptic + noWhatLine + emptyCatch + noHeader`
— a count of breaches, so a one-line fix inside a legacy function does not move it; crossing a soft limit (40 lines, complexity 10,
nesting 3) does. Complexity = 1 + if · ?: · loops · case · catch · `&&` `||` `??`, per function (nested functions count on their own).

## The PR checklist (`tools/pr-checklist.cjs`, CI job `pr-checklist` in both repos)
The template `.github/pull_request_template.md` carries the five lines; `--md` prints them filled. The job fails a PR whose body lacks a line,
leaves a `<placeholder>`, or has no numbers (`lines N → N · complexity N → N`, `cryptic names N → N · empty catches N → N`). It skips a
dependency bot's PR (dependabot / renovate / github-actions) and a docs-only PR (every file under docs/ or *.md). The api runs the web's
file from a web checkout — one reader.

## trace.json — the TRACE rows, generated (never typed)
`node tools/graph/trace.cjs` builds KG1 and writes `<repo>/trace.json` (gitignored in both repos — a committed copy would churn on every PR;
the guard builds it fresh in CI when none is at the root, and uses the file at the root when there is one — refresh a stale local copy with
the same command). One row per own-code module:

| key | from | meaning |
|---|---|---|
| `card` | the module's `CARD <area>/<card-id>` header line | which doc card holds its TRACE table |
| `layer` | path pattern (`routes/` route · `lib/ middleware/ src/` lib · `tools/tally-connector/` counter · `public/` ui · `src/` engine · else tool) | which §7 minimums apply |
| `tests[]` · `walks[]` | KG1 `tested-by` edges (a walk = `e2e/walk-*`); each with `via` (requires · reads · names · opens · evaluates · http …) and `steps[]` (the labels on its `ok( / t( / check(` lines) | unit test file + its steps · walks it takes part in |
| `calls[]` · `calledBy[]` | KG1 `calls` edges folded to files | |
| `routesServed[]` · `routesCalled[]` | route nodes in the file · `calls via http` | api routes it serves / calls |
| `tablesOwned[]` · `tablesRead[]` | KG1 `writes` / `reads` | tables it writes (owns) / reads |
| `flowSteps[]` | `implements` edges from flows.json steps (PM1) | flow steps |
| `minimums` | `{ layer, have[], missing[], how }` — keyword evidence over the module's tests; a `MIN <name>` line in a test is explicit | the §7 row |

## The owner's PC — the exact changes (the files are not in any repo here)
**`C:/dev/tools/area-docs.cjs`** — generate each card's TRACE table instead of typing it:
1. read `C:/dev/chitbridge-web/trace.json` and `C:/dev/chitbridge-api/trace.json` (run `node tools/graph/trace.cjs` in the web first);
2. for a card `<area>/<card-id>`, take every module row in both files whose `card` equals it;
3. render one TRACE table per card: **module** · requirement/spec/design (the card's own links, as today) · **flow steps** (`flowSteps`) ·
   **unit test file + steps** (`tests[].file`, `tests[].steps`) · **walks / e2e (+ step)** (`walks[].file`, `walks[].steps`) ·
   **routes served / called** · **tables owned** · **§7 minimums** (`minimums.have` ✓ / `minimums.missing` ✗) · status;
4. a card with no module row, or a module with no card, is listed at the end as a gap (the guard already fails a touched module with no CARD line).

**`C:/dev/toolset/briefs/_cloud-build-rules.md`** — add under rule 10 (PR body):
```
10a. §6 CHECKLIST IN EVERY PR BODY (READ-GUARD, 15 Oct). Before `gh pr create`, run in the web
     `node tools/readability.cjs --changed --base origin/main --ratchet --md` (api: `node ../chitbridge-web/tools/readability.cjs --changed
     --repo api --root ../chitbridge-api --base origin/main --ratchet --md`) and paste the printed checklist into the PR body, filling
     Pass 0 (the seams word → what you reused/widened, or "nothing exists") and the spec/design docs (or n/a). The CI job `pr-checklist`
     fails a PR whose body lacks the five lines with numbers. The guard must be green before you push: a touched function over a hard
     limit, a new cryptic name, a new empty catch, a touched module with no header / CARD line / test row, or a worse ratchet score fails CI.
```

## Where the guard runs
- web `.github/workflows/ci.yml` check job (checkout `fetch-depth: 0`): `node e2e/readability-guard.cjs` (every rule on a fixture) then
  `node tools/readability.cjs --changed --base origin/main --ratchet --md`; job `pr-checklist` on pull_request.
- api `.github/workflows/ci.yml` guards job (api checkout `fetch-depth: 0`): `scripts/guards.cjs` → `tests/readability-guard.test.cjs`
  (spawns the web tool from the twin checkout; skips with a warning when the web has no tool yet); job `pr-checklist` (web main's reader).
- Landing order: web first (the tool), api second (its gate calls the tool by path).
