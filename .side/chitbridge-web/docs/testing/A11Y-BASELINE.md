# Accessibility baseline (axe-core 4.12.1, WCAG 2.2 AA tags wcag2a + wcag2aa + wcag21aa + wcag22aa)

Generated 2026-11-08T16:55:31.643Z · 80 screens (addresses from docs/SCREEN-LIST.md) x Cream, Dark, High Contrast x text size m, xl = 480 runs, 829 s · 0 run(s) failed to load.
Set-up: fixture shop (Mayur Bhavan) via e2e/lib/standin.cjs; not a real database. axe finds about 57% of accessibility issues (its README): this is a floor, not a pass.
A *violation* = one rule failing on one screen in one theme+size; *nodes* = the elements it names. 9 register rows are reached by a press inside a page, so they are checked at their page only; sheets are not visited.

**Clean means painted and clean:** of 80 addresses, 45 painted at least 300 characters of text in every run; 24 of those are clean to axe. The other 35 are not counted as clean: 5 placeholder address(es) shown as visited, 1 sign-in window, 29 near-empty in the stand-in shop (under 300 characters). Their zero means nothing was there to check.

## Totals by theme and text size

| Theme | Size | Runs | critical | serious | moderate | minor | incomplete (needs a person) |
|---|---|---|---|---|---|---|---|
| Cream | m | 80 | 27 | 14 | 0 | 0 | 127 |
| Cream | xl | 80 | 27 | 16 | 0 | 0 | 127 |
| Dark | m | 80 | 27 | 19 | 0 | 0 | 127 |
| Dark | xl | 80 | 27 | 21 | 0 | 0 | 127 |
| High Contrast | m | 80 | 27 | 12 | 0 | 0 | 127 |
| High Contrast | xl | 80 | 27 | 14 | 0 | 0 | 127 |
| **All** | | 480 | **162** | **96** | **0** | **0** | 762 |

Elements (nodes) behind those violations: 936 critical, 944 serious, 0 moderate, 0 minor.

## Top 10 rules (by runs that fail it)

| Rule | Impact | WCAG | Screens | Runs | Nodes | What |
|---|---|---|---|---|---|---|
| label | critical | 4.1.2 | 8 | 48 | 282 | Form elements must have labels |
| aria-conditional-attr | serious | 4.1.2 | 7 | 42 | 798 | ARIA attributes must be used as specified for the element's role |
| select-name | critical | 4.1.2 | 7 | 42 | 138 | Select element must have an accessible name |
| aria-allowed-attr | critical | 4.1.2 | 5 | 30 | 450 | Elements must only use supported ARIA attributes |
| target-size | serious | 2.5.8 | 6 | 30 | 54 | All touch targets must be 24px large, or leave sufficient space |
| aria-required-children | critical | 1.3.1 | 5 | 30 | 36 | Certain ARIA roles must contain particular children |
| color-contrast | serious | 1.4.3 | 10 | 24 | 92 | Elements must meet minimum color contrast ratio thresholds |
| button-name | critical | 4.1.2 | 2 | 12 | 30 | Buttons must have discernible text |

All rules seen: label (critical), select-name (critical), aria-allowed-attr (critical), aria-required-children (critical), button-name (critical), color-contrast (serious), aria-conditional-attr (serious), target-size (serious).

## Per screen (distinct rules failing in any theme/size, by impact; worst run in brackets)

| Screen | Address | Painted (chars) | crit | serious | mod | minor | Top rules (nodes, worst run) |
|---|---|---|---|---|---|---|---|
| HOM001 | / (page) | 2431 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS001 | /accounts.html#todo | 385 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS002 | /accounts.html#daybook | 726 | 1 | 1 | 0 | 0 | aria-required-children (2), aria-conditional-attr (1) [cream/m] |
| BKS003 | /accounts.html#ledgers | 241 thin | 1 | 1 | 0 | 0 | button-name (4), target-size (3) [cream/m] |
| BKS004 | /accounts.html#tb | 434 | 1 | 0 | 0 | 0 | label (1) [cream/m] |
| BKS005 | /accounts.html#pl | 428 | 1 | 0 | 0 | 0 | label (2) [cream/m] |
| BKS006 | /accounts.html#bs | 465 | 1 | 0 | 0 | 0 | label (1) [cream/m] |
| BKS007 | /accounts.html#compare | 441 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS008 | /accounts.html#receivables | 425 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS009 | /accounts.html#payables | 415 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS010 | /accounts.html (page) | 385 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS011 | /accounts.html#bills | 393 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS012 | /accounts.html#cheques | 415 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS014 | /accounts.html#bank | 422 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS015 | /accounts.html#lock | 724 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS016 | /accounts.html#closingstock | 505 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS017 | /accounts.html#assets | 484 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS018 | /accounts.html#accruals | 478 | 1 | 0 | 0 | 0 | aria-allowed-attr (2) [cream/m] |
| BKS019 | /accounts.html#gstclose | 469 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS020 | /accounts.html#yearclose | 495 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS021 | /accounts.html#packs | 451 | 1 | 0 | 0 | 0 | select-name (2) [cream/m] |
| BKS022 | /accounts.html#opening | 456 | 0 | 0 | 0 | 0 | none [cream/m] |
| BKS023 | /accounts.html#accounts | 466 | 1 | 0 | 0 | 0 | select-name (1) [cream/m] |
| BKS024 | /accounts.html#movein | 784 | 2 | 1 | 0 | 0 | select-name (3), label (1), color-contrast (1) [dark/m] |
| BKS025 | /accounts.html#rates | 449 | 0 | 0 | 0 | 0 | none [cream/m] |
| FIN001 | /finance.html#/collections | 201 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| FIN002 | /finance.html#/payables | 187 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| FIN003 | /finance.html#/cash | 203 thin | 1 | 0 | 0 | 0 | aria-allowed-attr (2) [cream/m] |
| FIN004 | /finance.html#/terms | 460 | 1 | 0 | 0 | 0 | label (6) [cream/m] |
| FIN005 | /finance.html#/repeat | 265 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| FIN006 | /finance.html#/cheques | 203 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| FIN007 | /finance.html#/returns | 220 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| FIN008 | /finance.html#/reports | 460 | 1 | 1 | 0 | 0 | aria-allowed-attr (5), aria-conditional-attr (8) [cream/m] |
| CRM001 | /crm.html#/parties | 910 | 0 | 2 | 0 | 0 | aria-conditional-attr (7), target-size (2) [cream/m] |
| CRM002 | /crm.html#/chits | 271 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| CRM003 | /crm.html#/followups | 232 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| CRM004 CRM005 CRM006 +1 | /crm.html (page) | 910 | 0 | 2 | 0 | 0 | aria-conditional-attr (7), target-size (2) [cream/m] |
| CRM008 | /crm.html#/groups | 281 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| CRM009 | /crm.html#/showcase | 399 | 0 | 0 | 0 | 0 | none [cream/m] |
| CRM010 | /crm.html#/privacy | 262 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| MKT001 | /crm.html?app=marketing#/leads | 445 | 0 | 1 | 0 | 0 | target-size (1) [cream/xl] |
| MKT002 | /crm.html?app=marketing#/groups | 278 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| MKT003 | /crm.html?app=marketing#/sent | 195 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| MKT004 | /crm.html?app=marketing#/results | 268 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| MKT005 | /crm.html?app=marketing#/showcase | 402 | 0 | 0 | 0 | 0 | none [cream/m] |
| MKT006 | /crm.html?app=marketing (page) | 268 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| TSK001 TSK002 TSK003 +3 | /tasks.html | 176 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| SET001 | /settings.html#/shop | 247 thin | 1 | 0 | 0 | 0 | label (6) [cream/m] |
| SET002 | /settings.html#/country | 752 | 1 | 0 | 0 | 0 | select-name (6) [cream/m] |
| SET003 SET009 | /settings.html (page) | 752 | 1 | 0 | 0 | 0 | select-name (6) [cream/m] |
| SET004 | /settings.html#/counters | 272 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| SET005 | /settings.html#/connectors | 289 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| SET006 | /settings.html#/policy | 230 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| SET007 | /settings.html#/plan | 294 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| SET008 | /settings.html#/account | 382 | 0 | 0 | 0 | 0 | none [cream/m] |
| OPS001 | /operations.html#/stock | 204 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| OPS002 | /operations.html#/suppliers | 241 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| EMP001 | /employees.html | 134 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| CTG001 | /catalogue.html#/items | 191 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| CTG002 | /catalogue.html#/categories | 192 thin | 0 | 0 | 0 | 0 | none [cream/m] |
| CTG003 | /catalogue.html#/import | 311 | 0 | 0 | 0 | 0 | none [cream/m] |
| NET001 NET002 NET003 | /network.html | 162 thin | 0 | 1 | 0 | 0 | color-contrast (2) [dark/m] |
| CLB001 CLB002 CLB003 +1 | /country-lab.html | 3533 | 0 | 0 | 0 | 0 | none [cream/m] |
| KYB001 | /know-your-business.html | 575 | 0 | 0 | 0 | 0 | none [cream/m] |
| DOC001 | /authority-forms.html | 482 | 1 | 1 | 0 | 0 | select-name (1), color-contrast (2) [dark/m] |
| STD001 | /standards.html | 8305 | 2 | 1 | 0 | 0 | aria-allowed-attr (33), aria-required-children (1), aria-conditional-attr (50) [cream/m] |
| STD002 | /standards.html#works-with | 3428 | 2 | 2 | 0 | 0 | aria-allowed-attr (33), aria-required-children (1), aria-conditional-attr (14) [cream/xl] |
| SHP001 | /shop.html?s=<shop> | 279 placeholder | 0 | 1 | 0 | 0 | color-contrast (1) [cream/m] |
| NSH001 | /network-shop.html?bridge=<network> | 69 placeholder | 0 | 1 | 0 | 0 | color-contrast (1) [cream/m] |
| STR001 | /store.html?net=<network> | 229 placeholder | 0 | 1 | 0 | 0 | color-contrast (3) [dark/m] |
| EMB001 | /embed.html?bridge=<shop> | 108 placeholder | 0 | 0 | 0 | 0 | none [cream/m] |
| PRM001 | /promo.html#key=… | 622 placeholder | 0 | 1 | 0 | 0 | color-contrast (2) [cream/m] |
| PLB001 | /product-lab.html | 121 thin | 0 | 1 | 0 | 0 | color-contrast (1) [dark/m] |
| OLB001 | /offer-lab-next.html | 989 | 2 | 0 | 0 | 0 | label (2), button-name (1) [cream/m] |
| OLB002 | /offer-lab-next.html?mode=combo | 546 | 0 | 0 | 0 | 0 | none [cream/m] |
| CVL001 | /conversion-lab.html | 2016 | 2 | 1 | 0 | 0 | label (28), select-name (4), color-contrast (34) [dark/m] |
| NLB001 | /network-design.html | 594 | 0 | 0 | 0 | 0 | none [cream/m] |
| LLB001 | /list-lab.html | 4527 | 1 | 3 | 0 | 0 | aria-required-children (1), aria-conditional-attr (46), target-size (1) [dark/m] |
| SLB001 | /signin-lab.html | 415 sign-in | 1 | 0 | 0 | 0 | aria-required-children (1) [cream/m] |
| SHL001 | /shell-lab.html | 151 thin | 0 | 0 | 0 | 0 | none [cream/m] |

## What this baseline is, and is not

- It is a floor. axe-core finds about 57% of accessibility issues (its own README). Only 24 of 80 addresses are both painted (300+ characters in every run) and clean to axe; that does not make them accessible. Of the other 56, 21 painted screens have at least one violation and 35 are unknown rather than clean (placeholders, a sign-in window, near-empty stand-in screens; see Clean means painted and clean above). The keyboard walk, a screen reader and the manual WCAG 2.2 items (focus order, consistent help, accessible authentication) stay with a person.
- WCAG 2.2 AA is the standard checked (axe tags wcag2a, wcag2aa, wcag21aa, wcag22aa). axe's best-practice rules are NOT in these tags, which is why moderate and minor read 0: the impacts that matter here are critical and serious.
- The shop behind the screens is the walks' stand-in (a small fixture shop), not the demo month. A screen that is mostly rows in real life is checked here in its ordinary, near-empty state; a second pass on the full local stack (the demo shop) is the next widening. Colour contrast, target size and label problems that depend on real rows will be under-counted.
- Five addresses carry a placeholder in the register (counted as not painted, never as clean) (`/shop.html?s=<shop>`, `/network-shop.html?bridge=<network>`, `/store.html?net=<network>`, `/embed.html?bridge=<shop>`, `/promo.html#key=…`): they were visited with the placeholder as written, so they show their "not found" state. `/signin-lab.html` shows the sign-in window.
- 9 register rows are reached by a press inside a page, not by an address; they are checked at their page. Sheets (popups opened by a press) are not visited here: that is a gap, listed for step 2 (a sheet-opening pass through the UX-137 ids).
- Theme and text size were set as a person sets them (localStorage cb_theme, cb_fs) and confirmed on `<html data-theme>` in all 480 runs.
- Every node in this file carries a screen code: 904 of 904 listed nodes have one (the element's own UX-137 code, else the page chip's).

## Reading the numbers

- All 162 critical violations are structural and identical in every theme (27 per theme and size): a control with no accessible name or label (`label`, `select-name`, `button-name`) or misused ARIA (`aria-allowed-attr`, `aria-required-children`). These are fixes in markup, once, not per theme.
- The serious ones move with the look: colour contrast fails in 3 screens in Cream, 8 in Dark and 1 in High Contrast; target size (WCAG 2.2 criterion 2.5.8) fails on 6 screens and gets slightly worse at the xl text size. Dark is the weakest theme.
- Three screens carry most of the element count: /standards.html (aria-conditional-attr 50 and aria-allowed-attr 33 nodes), /list-lab.html (aria-conditional-attr 46) and /conversion-lab.html (color-contrast 34, label 28). Two of those are workshop/lab pages; /standards.html is customer-visible.

## Proposed gate (for Athi to decide; nothing is blocking today)

**Today:** this is a report only. `npm run a11y:axe` writes the same two files; `.github/workflows/a11y-report.yml` runs it on demand with `continue-on-error`. Nothing on a pull request waits for it.

**Proposal, in two steps:**

1. **No new critical or serious on a changed screen.** A pull request that touches a screen's files runs the check for those screens (6 runs a screen, about 10 seconds) in Cream, Dark and High Contrast at text size m, and compares with `docs/testing/A11Y-BASELINE.json`. It fails when a screen and rule pair of impact critical or serious is present that the baseline does not hold. Moderate and minor never fail. This is a ratchet like the readability one: the baseline only moves down, in the PR that fixes the pair; a pair that must stay is listed with a reason and a round, like the KNOWN list in run-shard.
2. **New screens start at zero.** A screen added after the gate starts has no baseline entry, so it must be clean of critical and serious in all three themes before it lands; this is the "accessibility is part of how we build" rule in code. A new screen's walk (cloud-build-rules 13) already checks contrast; this adds labels, names and ARIA.

**Why this threshold:** it is the smallest rule that stops the count growing without asking anyone to fix 96 serious and 162 critical in one go, it blocks only what a PR itself introduced, and it needs no judgement from a reviewer. The cost is one box run of about 14 minutes for the full set or a few minutes for changed screens; run it on the SIT box, not a laptop.

**Before the gate can start:** (a) the stand-in shop widened or the run moved to the demo shop so the baseline is not flattered; (b) the sheet pass added; (c) one owner for the fixes, starting with the five critical rule families (a handful of controls in accounts, finance, settings and the labs).

Reuse: `e2e/a11y-contrast.cjs` (themes' declared contrast claims) stays; this adds what it cannot see. `e2e/tests/axe.spec.js` (3 specs on the old workshop) now runs through this module (`A.check`, same wcag2a/wcag2aa tags) on the vendored copy; `@axe-core/playwright` is removed, so there is one axe engine.
