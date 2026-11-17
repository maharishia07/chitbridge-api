# tools/graph — the call graph, the joined knowledge graph, and `impact` (KG1, 2026-10-12)

Athi, 2026-10-12: *"knowledge graph, call graph, reasoning engine, digital twin — do we have all this?"* — in steps. This is steps 1 + 2:
one static, deterministic read of the three repos side by side, joined with what already names the system, and three questions over it.

```
node tools/graph/graph.cjs build                     → tools/graph/out/calls.json + graph.json   (gitignored; ~4 s)
node tools/graph/graph.cjs impact <file|function>    flow steps · screens · routes · TESTS a change there touches
node tools/graph/graph.cjs changed <git-range>       git diff → the tests a PR should run      [--repo api|engines]
node tools/graph/graph.cjs gaps                      steps with no test · functions on no flow · routes no screen calls · tables no route touches
node tools/graph/trace.cjs [--repo web|api|engines]          READ-GUARD: every module's TRACE row (tests + steps · walks · calls · routes · tables · flow
                                                     steps · §7 minimums) → <repo>/trace.json (gitignored); docs/process/READ-GUARD.md
```
READ-GUARD (15 Oct) widened the scan: web `tools/` + `scripts/` and api `tools/` + `scripts/` are modules too (kind `web-tool` / `api-lib`),
and a test that names a module by path string (`tools/x.cjs`, `scripts/x.cjs`, `lib/x.js` …) gets a `tested-by` edge in every repo.
Flags: `--roots web=DIR,api=DIR,engines=DIR` · `--out DIR` · `--json` · `--depth N` (4 by default; 0 = unlimited) · `--top N` · `--endpoint-usage PATH`.
A seed can be a function name (`sendChit`), `repo:path`, a path suffix (`public/app/cap-books.js`), `path#fn`, a route (`/api/chits/send`),
a table (`chit_header`), a step (`O2C/3`) or a nav key (`task`).

## What it reads (reuse, not a second copy)

| joined from | gives |
|---|---|
| `docs/process/flows.json` (PM1) | `step` nodes · `implements` (step → screen fn · engine fn · route) · `tested-by` (step → the tests it names) |
| `public/app/screens.js` (CBSCREENS.byNav) + app.html's `UI.nav==="x"` dispatch | `screen` nodes with their codes · screen → the function that paints it |
| api `tools/endpoint-usage.cjs --json` — **spawned**, as `tests/round-trips-all.test.cjs` does | the client's `api('key')` registry and the server's mounts: how a web function reaches a route |
| api `migrations/*.sql` + `db/*.sql` | the `table` nodes that exist; SQL text in a route or lib function gives `reads` / `writes` |
| engines `src/reg-*.js` | `pack` nodes; `uses` from any file that names the pack |
| the `ADOPTED from chitbridge-engines vX · name` header | `vendors`: an adopted copy (web `public/engine/*.js`, api `lib/*.js`) → its engines source |
| a decisions file | **none exists** in any of the three repos (searched by name and heading) — `decision` / `decided-by` are skipped, and `meta.notes` says so |

Scanner: `scan.cjs`, hand-written (acorn/espree are in no lockfile here; no new dependency). A one-pass lexer blanks comments and string
bodies (template `${…}` kept as code) so brace matching and `name(` detection cannot be fooled by HTML in a string; the strings are read
separately for `api('key')`, `/api/...` literals, `onclick="…"` handlers and SQL. Declaration forms are the ones `e2e/missing-functions.cjs`
and `dead-surface.cjs` already know. A `/` is a regex when the token before it says so (`return /x/`), else division.

## What it cannot see (said plainly)

Static names only. `window[name]()`, a holder chain longer than one (`a.b.c()`), SQL built from variables, and a route reached only by a
script it does not scan are invisible. It over-links where unsure — a callback passed by name counts as a call — because `impact` must err
towards MORE tests. `--depth` exists because app.html is one window: an unlimited walk from a shared helper reaches every screen, which is
true and useless.

## The test

`e2e/knowledge-graph.cjs` (web CI, `npm run check:graph`) builds `fixture/` — a three-repo miniature where every join is known — and pins
each one; then runs `impact`, `gaps` and `changed` (on a throw-away git copy); then builds the real repos. Without `../chitbridge-api`
beside the checkout (web CI) the api half is checked by shape only, and the test says so.

## FEEDGRAPH — the api's own registers as graph facts (2026-10-23, `apifeed.cjs`)

Athi, 2026-10-23: *"create feedgraph and the other one and will see which one should be useful"* (the other one: the Backstage software catalog, `toolset/catalog-api.cjs`; comparison in `C:/dev/PM/KG-VS-CATALOG-2026-10-23.md`). Candidate A widens this graph, no second graph. `build` also reads, from the api checkout and `--home DIR` (default: the folder beside the repos, holding `docs/29-…/tests/TEST-LIBRARY.json` and `PM/API-LESSONS-AUDIT-*.md`):

| joined from | gives |
|---|---|
| api `docs/api-register.json` | route nodes gain `reg` (status · columns · sign-off · owner_area · declared statuses) |
| api `docs/contracts/api-error-tests.json` · `api-contract-results.json` · `api-hardening-evidence.json` (+ `-areas.json` once api #337 lands; absence is said in `meta.notes`) | `tested-by` route → test, `via` error-tests / contract / evidence |
| api `docs/error-codes.json` | `errcode` nodes; `returns` route → errcode where the route's own text names the code |
| `TEST-LIBRARY.json` | test nodes gain level · type · runner · owner |
| `API-LESSONS-AUDIT-*.md` (hand-written by cb-api) | `lesson` nodes; `enforced-by` only when the named file runs in CI (tests/ · tools/ · e2e/ · .github/), else `mentions` (via audit = "named by the audit"); RULE ONLY / NOT ADDRESSED carry `gap`, ADDRESSED (partly) carries `partly` |

`gaps` adds **6 · routes no test proves** (no `tested-by` edge of any kind) and **7 · lessons nothing enforces**. Register rows the scan cannot place (and the reverse) are counted in `meta.apiFeed`, never dropped; a router file mounted twice is joined by file + method + tail.
