VERDICT: BUILD WITH CHANGES — no route/table removal and no flag enforcement this round (each could change behaviour); listed with a plan instead (docs/critique/CU1.md).
Audit: docs/design/CUSTODIAN-AUDIT-2026-10-13.md — 6 settings duplicates · 6 declared-not-enforced flags (+5 values that never reach the server) · 29 same-body function groups + 17 policy_flags write sites + 12 endpoint aliases · 169 routes / 34 tables classified (an upper bound: the graph misses till.html's path helper; 3 "tables" are words in SQL comments).
Fixed: 20 web functions with zero references in web + api removed; app.html `attGlyph`/`fmtSize` → `cbAttachIcon`/`cbAttachSize` (byte-identical, attach-ui.js already loaded). Graph: web functions on no flow 1631 → 1613. No new function, key, route or SQL; b312–b314 unused; api untouched.
Biggest finding (CU2): `PATCH /me/prefs/ui` REPLACES identities.ui_prefs, so changing the theme erases the shop's `ui_prefs.product_rows`.
Engines (queued, not edited): `roundMoney_` ×4 in adopted copies → CBMoney.round; `taxPacks_` ×2; gst-returns `rupees_` is dead.
Plan, first 3 rounds: CU2 settings S ui_prefs merge + FIELDS · CU3 settings S tz/workdays/font/weight reach the server · CU4 capabilities S one date-time stamp (CBLocale.datetime; fixes fmtDateTime's `dateTime` typo).
Checks: guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses · missing-functions · ep-aliases · dead-surface · docs-guard + 6 unit tests, all exit 0.
🤖 Generated with [Claude Code](https://claude.com/claude-code)
