# STDREG1 · critique before build (2026-10-14)

(a) What the brief assumes, checked
- "The audit's section (e) has 28 rows ready to paste": FALSE on this runner. ../chitbridge-docs is an empty repo (no commits); STANDARDS-GAP-2026-10-14.md
  and PRODUCT-AREA-MAP-2026-10-14.md are absent. The rows are written from the brief's list, each status from code + test found here (named on the row).
- "THE register, 81 rows": TRUE (public/app/cap-standards.js:32-711). compat.json 8 rows: TRUE. e2e/standards-page.cjs hard-codes 81: TRUE (:110, :46, :113).
- "catalogue-model.js has its own 19-standard list": TRUE (catalogue-model.js:517-543); it says Rec 20 is "roadmap" while the register says In force (:176) — the drift.
  Nothing on screen reads CBCatalogue.STANDARDS (grep: comments only), so pointing it at the register by id breaks no reader.
- Rows have no `id` today: the register is matched by `n` (stdRowFor :856). An `id` field is needed for "reads by id" — a new key, entered in the file's dictionary.
- WCAG 1.4.4 says 132%: TRUE (:106-107); the law is 200%. 1.4.6 rides on the 1.4.3 row as In force, but the contrast test is AA only (4.5:1): TRUE.
- NIST "about AAL2": a single one-time code is AAL1 — the row overclaims. HS: HSN is carried and filed (api lib/tax-lines.js:105). OAuth: the Zoho adapter uses OAuth 2 (api tools/tally-connector/adapters/zoho.js:8).
- data.js (docs/design/standards-page) is a 61-row frozen copy that the e2e compares field for field: TRUE (standards-page.cjs:56, :128).
(b) Conflicts: one place per thing — the product-area vocabulary must not be a 3rd list of anything; I REUSE the product areas of
  docs/design/standards/COUNTRY-COVERAGE.md §1 (the ones data/country-ready.json reports) and widen them with the platform areas the area packs name.
  The 29-area map is missing, so the vocabulary is the closest existing one, said so in the file; when the map lands it widens one array.
(c) Simpler: no new screen — the page's CBList gets one more filter + group (Product area); catalogue-model keeps only {id, where} and resolves the rest.
(d) Risks: no money, no SQL (b409–b411 unused), no api change. Other rounds append rows to cap-standards.js (merge conflicts at the end of the array);
  the e2e now counts from source, so a parallel append no longer breaks it. Statuses: nothing upgraded without a test named; several DOWNgraded (1.4.4, 1.4.6, NIST).
(e) VERDICT: BUILD WITH CHANGES — rows written from code evidence, not pasted (the audit is absent); product areas = COUNTRY-COVERAGE §1 + platform areas
  (the 29-area map is absent); data.js becomes derived from the register; Playwright walk run only if time allows (static checks first).
