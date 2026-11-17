# STD-MEASURE · measured against industry standards (2026-10-15)

Round STD-MEASURE (MAINTAINABILITY-PACK). Read-only measurement + CI config; no product code changed. Critique: `docs/critique/STD-MEASURE.md`.
**No web access this round** — SIG band edges and SSDF task wording are from memory; they are marked "approximate" and a person should
re-check them against the published documents before any number leaves the company. The trend between runs is the useful part.

## 1 · SIG-style maintainability stars

Re-run: `npm run report:stars` (= `node tools/sig-stars.cjs web=. api=../chitbridge-api engines=../chitbridge-engines [--json]`, 2 s, no dependency).
Test: `node tests/sig-stars.test.cjs`. Parser: KG1 `tools/graph/scan.cjs` (reused). Rating symbols ++ + o - -- = 5 4 3 2 1 stars.

Scope (MAINT-1's file was not found in any repo, so rebuilt from the vendoring markers): tracked `.js .cjs .mjs .html` (inline scripts of
html pages included); **out**: files whose header says `ADOPTED from chitbridge-engines` (api `lib/*`), web `public/engine/*`, the vendored
`public/till.html`, fixtures, docs, design folders, images, `.min.js`. Test code = `tests/ e2e/ *.test.* *.spec.*`.

Bands used (cells show `% of code at ≥moderate / ≥high / very-high risk`):
| property | measure | risk bands / rating edges |
|---|---|---|
| Volume | production KLOC | ++ <66 · + <246 · o <665 · - <1310 (SIG Java-equivalent man-year edges) |
| Duplication | % lines in a repeated 6-line block (≥120 chars) | ++ ≤3 · + ≤5 · o ≤10 · - ≤20 |
| Unit size | lines per unit, share of LOC | low ≤15 · moderate ≤30 · high ≤60 · very high >60; ++ needs ≤19.5/10.9/3.9 % (approx) |
| Unit complexity | McCabe per unit, share of LOC | low ≤5 · moderate ≤10 · high ≤25 · very high >25; ++ ≤17.9/9.9/3.3 % (approx) |
| Unit interfacing | parameters per unit, share of units | low ≤2 · moderate ≤4 · high ≤6 · very high >6 (the brief's ">4" = high); ++ ≤12.1/5.4/1.2 % (approx) |
| Module coupling | fan-in = distinct other files requiring/calling the module, share of LOC | low ≤10 · moderate ≤21 · high ≤49 · very high ≥50 |
| Component balance | component count (folders) + Gini of their size | count 6–12 best; Gini ≤.25 = 5 stars … >.6 = 1 |
| Test code ratio | test LOC ÷ production LOC | ++ ≥1.0 · + ≥0.5 · o ≥0.25 · - ≥0.1 |
Overall = mean of the five ISO 25010 sub-characteristics (analysability, modifiability, testability, modularity, reusability) as SIG maps them.

### Result (run 2026-10-15, this commit)

| property | web | api | engines |
|---|---|---|---|
| Volume | ★★★★☆ 4 (+) · 84.4 | ★★★★☆ 4 (+) · 75.9 | ★★★★★ 5 (++) · 11.9 |
| Duplication | ★★★★★ 5 (++) · 1.3 | ★★★★★ 5 (++) · 2.6 | ★★★★☆ 4 (+) · 4.8 |
| Unit size | ★☆☆☆☆ 1 (--) · 51.4/27.7/12.9% | ★☆☆☆☆ 1 (--) · 54.7/31.4/12.6% | ★☆☆☆☆ 1 (--) · 53.4/33.3/15.7% |
| Unit complexity | ★☆☆☆☆ 1 (--) · 66.3/44.2/17.8% | ★☆☆☆☆ 1 (--) · 69/49.9/20.7% | ★☆☆☆☆ 1 (--) · 74.1/52.4/21.5% |
| Unit interfacing | ★★★★★ 5 (++) · 4.8/0.5/0% | ★★★★☆ 4 (+) · 14.1/1.8/0.2% | ★★★★☆ 4 (+) · 14.1/1.2/0.3% |
| Module coupling | ★★★★☆ 4 (+) · 15/12/0% | ★★★★★ 5 (++) · 5.6/1.3/0.2% | ★★★★★ 5 (++) · 0/0/0% |
| Component balance | ★★★☆☆ 3 (o) · 10 components, Gini 0.83 | ★★★☆☆ 3 (o) · 11 components, Gini 0.66 | ★★★☆☆ 3 (o) · 3 components, Gini 0.59 |
| Test code ratio | ★★★★☆ 4 (+) · 0.72 | ★★★★☆ 4 (+) · 0.55 | ★★★★☆ 4 (+) · 0.81 |
| **Overall** | **3.1** | **3.1** | **3.1** |

- web: 165 prod files · 84362 prod LOC · 561 test files · 60343 test LOC · 10200 units · vendored/generated left out: 34/66
- api: 448 prod files · 75921 prod LOC · 360 test files · 42066 test LOC · 7209 units · vendored/generated left out: 57/88
- engines: 53 prod files · 11911 prod LOC · 62 test files · 9650 test LOC · 1301 units · vendored/generated left out: 1/0

Per-repo roll-up (ISO 25010): 

    web: analysability 3.5 · modifiability 3.3 · testability 2 · modularity 3.5 · reusability 3 · overall 3.1
      - `tools/graph/graph.cjs:66` build — 404 lines, complexity 321
      - `public/app.html:12668` prodOutcomeHTML — 81 lines, complexity 142
      - `public/app.html:4764` _renderApp — 120 lines, complexity 111
      - `public/app/cart.js:2077` rowHTML — 117 lines, complexity 110
      - `public/app/cap-admin.js:1983` iamGovernedRows — 140 lines, complexity 94

    api: analysability 3.5 · modifiability 3.7 · testability 2 · modularity 4 · reusability 2.5 · overall 3.1
      - `lib/books-hooks.js:373` classify — 152 lines, complexity 183
      - `routes/catalogue.js:181` repriceAgainstCatalogue — 128 lines, complexity 117
      - `lib/books-hooks.js:654` postChit — 109 lines, complexity 104
      - `tools/tally-connector/till.html:13787` paintQuick — 151 lines, complexity 97
      - `lib/catalogue-view.js:206` buildPublicView — 207 lines, complexity 94

    engines: analysability 3.5 · modifiability 3.3 · testability 2 · modularity 4 · reusability 2.5 · overall 3.1
      - `src/einvoice.js:353` ewbPayload — 83 lines, complexity 137
      - `src/einvoice.js:227` irnPayload — 101 lines, complexity 124
      - `src/tax.js:238` determine — 143 lines, complexity 111
      - `src/posting.js:627` post — 69 lines, complexity 85
      - `src/bank-recon.js:618` explain — 60 lines, complexity 71

Reading it: duplication, volume, interfacing, coupling and test ratio are good; **unit size and unit complexity are 1 star in all three repos**
and they alone hold testability at 2.0 — they are the whole gap. Component balance 3 is dominated by `public/app` (73 % of web code) and `lib`
(32 % of api). Complexity counts decision tokens on blanked code (no AST), so absolute numbers are ±10 %; ranking is reliable. The five worst
units per repo are listed above (`--json` gives ten): each is a SHRINK candidate under DISCIPLINES §6.

## 2 · NIST SSDF SP 800-218 v1.1 (+ SP 800-218A for AI-assisted work)

met = a control exists AND evidence is in a repo · partly = exists but not enforced/complete · not = absent. Evidence is a file you can open.
Task wording is from memory (no web access); IDs are the stable part.

| practice | status | evidence / gap |
|---|---|---|
| PO.1 security requirements defined | partly | api `docs/THREAT-MODEL.md`; web `docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md`; no single requirements list per release |
| PO.2 roles & responsibilities | partly | api `docs/compliance/RECORD-KEEPING.md`, web `docs/compliance/OWNER-ACTIONS.md` (owner acts listed); no named security owner/DPO yet (listed there as open) |
| PO.3 supporting toolchains | met | CI both repos (`.github/workflows/ci.yml`), guards (api `scripts/guards.cjs`, web `e2e/guard-static.cjs`), `tools/graph` |
| PO.4 security checks defined in the lifecycle | met | api `ci.yml` guards + scan jobs; web `ci.yml`; DISCIPLINES.md §6/§7 gates (in the docs repo) |
| PO.5 secure environments | partly | secrets only in repo secrets; backup in the private engines repo; prod `NODE_ENV` risk noted in the platform pack; no env separation proof |
| PS.1 protect code from tampering | partly | branch protection of `main` is READ by api `governance.yml` nightly but web's cannot be read with the default token (see its header) → unknown; no CODEOWNERS in either repo |
| PS.2 verify release integrity | partly | byte-equal pins for adopted engines and the vendored till (api `tests/till-vendor.test.js`, `engines.lock.json`); no signed releases / checksums |
| PS.3 archive & protect releases (+ SBOM) | not | no SBOM (grep: none); Vercel/Railway keep builds; backup rehearsal api `.github/workflows/backup-restore.yml` covers data, not releases |
| PW.1 secure design | met | api `docs/THREAT-MODEL.md`, `docs/B1-RLS-DESIGN.md`, server-decides-access rule (`lib/access.js`) |
| PW.2 design review | partly | `docs/critique/<ROUND>.md` before every build round (rule 00) — a review by the builder, not an independent one |
| PW.4 reuse secure components | met | engines adopted with pins (`engines.lock.json`), `docs/SEAMS.md`, CLAUDE.md "reuse before you build" |
| PW.5 secure coding | partly | api `lib/logger.js`, no-empty-catch rule (STD-CATCH), `.gitleaks.toml`; CodeQL now added (report-only) |
| PW.6 build/compile settings | partly | `scripts/check-syntax.js`, `node --check` job in api `ci.yml`; no strict-mode/lint gate across the board |
| PW.7 code review / analysis | partly | PR per round, never self-merged (`build-round.yml` rules); static analysis was absent → `codeql.yml` (this round) |
| PW.8 test executable code | met | api guards (2.6 k checks), web walks (`.github/workflows/walks.yml`, `e2e.yml`), test ratio 0.55 / 0.72 (§1) |
| PW.9 secure default settings | partly | default-deny scoping + may/why; CSP is Report-Only in `vercel.json` (enforced policy only `object-src 'none'`) |
| RV.1 identify vulnerabilities | partly | api `ci.yml` `npm audit` (high+) and gitleaks; Dependabot ALERTS are on (GitHub said so on push) but NO `.github/dependabot.yml` updates in either repo; web CI runs no `npm audit`/gitleaks job (only a `.gitleaks.toml` exists) |
| RV.2 assess, prioritise, remediate | partly | api `governance.yml` nightly report counts open alerts and fails red; no triage SLA written |
| RV.3 root-cause analysis | partly | `docs/compliance/INCIDENT-RUNBOOK.md` + `INCIDENT-REGISTER.md` (web); dated "found/why" notes in CLAUDE.md; no recurrence-prevention step recorded per incident |

### SP 800-218A (generative-AI community profile) — the AI-assisted-work rows

| 218A concern | status | evidence / gap |
|---|---|---|
| Provenance of AI-written changes | met | PR body ends "Generated with Claude Code"; commits carry `Co-Authored-By` (`.github/workflows/build-round.yml` rules) |
| Human review before merge | met | "Never merge" rule for build agents; batch merge by the owner (`batch-merge.yml`) |
| Secrets/data kept out of the model | partly | rule "no secret in a diff", gitleaks in api CI; no policy on what customer data may enter a prompt |
| AI feature testing | partly | api `docs/AI-ASSISTANT.md`, `tests/ai-one-pipe.test.cjs`, ai-eval on the key (DISCIPLINES §7); cost log per call not verified here |
| Model/dependency inventory (AI-BOM) | not | no SBOM/AI-BOM; model IDs live in config only |
| Training-data & poisoning controls | n/a | we do not train models; recorded so it is not re-asked |
| Licence | met | `LICENSE` in web and api |
| Backups (supports recovery) | met | api `backup-restore.yml` proof + private engines `backup-nightly.yml` (BKP1), `deploy/backup.sh` |

## 3 · The five cheapest moves per standard

**SIG maintainability** (target: lift testability from 2.0 — the unit size/complexity pair)
1. Shrink only the ten worst units per repo (list above) — each is one function; 10 functions move complexity share the most for the least work.
2. Add `readability --changed --ratchet` to CI (DISCIPLINES §6 already promises it) so no touched unit gets worse — stops the bleed at zero cost per unit.
3. Split `tools/graph/graph.cjs` `build` (404 lines) — our own tool is the single biggest unit in web.
4. Split `lib/books-hooks.js` `classify`/`postChit` (api) and `src/tax.js` `determine`, `src/einvoice.js` payload builders (engines) into lookup tables — branch ladders are the cause.
5. Break `public/app` (73 % of web code) into named sub-folders by area to lift component balance from 3 to 4 stars.

**NIST SSDF 800-218**
1. Add `.github/dependabot.yml` (npm + github-actions, weekly) to web and api — turns RV.1 from alerts-only into fixes.
2. Add the gitleaks + `npm audit` job from api `ci.yml` to web `ci.yml` (config already there) — RV.1/PW.5.
3. Add `.github/CODEOWNERS` and give the governance token (Administration: read) so PS.1 reads green, not "unknown".
4. Generate a CycloneDX SBOM in CI per release (`npx @cyclonedx/cyclonedx-npm`, an action-time tool, not a dependency) — PS.3.
5. Move CSP from Report-Only to enforcing after one clean week of reports — PW.9.

**NIST SP 800-218A (AI-assisted)**
1. Put a one-page "what may enter a prompt" rule (no customer rows, no secrets) in `docs/compliance/` — closes the data row.
2. Make `Co-Authored-By` + the PR footer a CI check (`pr-checklist`) rather than a build-round instruction.
3. Record the model ID used per round in the PR body (provenance is "AI" today, not "which model").
4. Log token cost per AI-assistant call and show it in the governance report.
5. Add the SBOM above and name the AI models in it (AI-BOM row).

**CodeQL / static analysis (new this round)**
1. Let `codeql.yml` run once on main; triage the first Security > Code scanning list.
2. If noise is low, make `analyze` a required check (it is deliberately not one yet).
3. Add `.github/codeql/` custom query-suite excludes only for confirmed false positives, with a dated reason.
4. Review `app.html` inline-script findings first (largest unreviewed surface).
5. Alert the governance report when code-scanning alerts > 0 (same call pattern as its Dependabot count).

## 4 · What was added (the PR's tools + CI + docs only)
Web: `tools/sig-stars.cjs`, `tests/sig-stars.test.cjs`, `npm run report:stars`, `.github/workflows/codeql.yml`, `.github/codeql/codeql-config.yml`, `docs/critique/STD-MEASURE.md`, this file. Api: `.github/workflows/codeql.yml` + `.github/codeql/codeql-config.yml`. Engines: untouched (not reachable as a CodeQL target this round; stars measured read-only). No migration used (b664–b666 free).
CodeQL could not be run here (no web access) — the first real run is on merge to main; the config path and `languages: javascript-typescript` should be confirmed then.
