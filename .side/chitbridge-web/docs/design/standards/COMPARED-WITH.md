# Compared with — the country comparison on the Standards page (STD-COMPARE, 15 Oct 2026)

Athi, 15 Oct: *the country-level comparison of accounting packages must be part of the Standards page, not a separate document.*
This is the doc card (DISCIPLINES §6 pass 3) for the tab; the area card lives in C:/dev/docs/14-accounting/functions/ once the docs repo is beside the web again (it was empty on the build runner).

## What it is
A third saved view of the ONE Standards list (`public/standards.html`, a CBList mount): **All · Works with · Compared with**. Its rows are
`public/data/compare.json` (the rows of C:/dev/docs/14-accounting/compare.json, byte for byte): country · package · capability · theirs · ours ·
better · status `ahead | level | behind | n/a` · source · verified `source | memory` · id · `checked` (per row, the date it was last held against its source; R120, 24 Oct 2026) · `source_url` (the first official page in `source`). They are not standards: they never join the register
(STANDARDS), the matrix or the All view — the view carries them itself.

## Owns · called by · flow
| | |
|---|---|
| **owns** | the mapping `stdCompareRows` + `STD_COMPARE_STATUS` · `STD_COMPARE_VERIFIED` · `STD_COMPARE_DOCS` (app/cap-standards.js); the view `COMPARED`, its columns `compareCols`, the status cell `cmpStatusCell`, the opened row `compareNext` / `sourceHTML`, the copy `compareStatement`, the Package filter, `openCompared` + the `cb:me` listener, `tabHash` (standards.html) |
| **called by** | Home's Compatibility card and the Auditor view (manifest.json → `/standards.html#compared-with`); the Works with tab beside it |
| **widened, additively** | CBList `views[].rows` (a view with its own rows stays lit while its filters are in force; `defaultCols` may be a function) — list-ctl.js; CBAvatar `pull()` announces the shop's country as `cb:me` and `shopCountry()` — avatar.js |
| **FLOW** | `compare.json → stdCompareRows → CMP_ROWS → COMPARED.rows() → CBList paints compareCols → a row opens compareNext (sources) → Open the source (new tab) · See it → accounts.html#compare (PRN step 2) · Copy` |
| **INIT** | `Promise.all(compat.json · compare.json · country-matrix.json) → start(): FILTERS += packageFilter() → mountList() → #compared-with → openCompared() (shop's country from CBAvatar.shopCountry(), else IN; a later cb:me moves it unless the person chose)` |

## Rules it keeps
- Status is a symbol AND a word (▲ Ahead · = Level · ▼ Behind · — Not compared); `verified: memory` rows say **to confirm** beside it.
- A source opens: a web source as a link in a new tab; a document on this checkout says where its copy is; a document only in the docs library is said in words and **Open the source** is greyed WITH that sentence — never a dead link.
- Could-not-read → words + Try again, never "nothing matches". Cells wrap; a word breaks only when longer than the line.
- Better, not copied: the vendor rows are a baseline (data), no vendor screen, verb or flow is copied.

## TRACE row
| requirement | spec | design | flow step | unit test | walks | api routes | tables | status |
|---|---|---|---|---|---|---|---|---|
| STD-COMPARE brief (15 Oct) | docs/design/standards/REQUIREMENT.md | this card · docs/critique/STD-COMPARE.md | PRN step 4 (docs/process/flows.json) | e2e/standards-page.cjs (the five audit fixes; the head budget) | e2e/walk-standards-compare.cjs S1–S8 · e2e/walk-compat.cjs C1 | none (the page reads no API; the avatar's /me is reused) | none | built |

## Five register fixes proved in the same round (STANDARDS AUDIT, 15 Oct)
wcag-1.4.6 Planned → Partly (engines screen.js `hc` claims AAA, e2e/a11y-contrast.cjs holds it to 7:1) · css-logical In force → Partly (~200 physical
properties across 15 small-app files) · gherkin · oauth2-oidc · medusa-model Partly → In force (proof named in each row's note; the decision not to adopt
more is a stated Limit). standards-page.cjs asserts all five.
