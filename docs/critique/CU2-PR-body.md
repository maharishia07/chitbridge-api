VERDICT: BUILD WITH CHANGES (docs/critique/CU2.md) — product_rows → policy flag deferred to CU8, which builds the one policy_flags writer.
Fix: `savePrefSet` (/me/prefs/ui · /me/prefs/locale · legacy /me/locale) wrote the whole column, so a theme save erased `product_rows`. Now an RFC 7386 merge-patch: `(col - $drop) || $set` … RETURNING. PATCH /profile `ui_prefs` uses the same expression (null removes). Trips: still 1 per save (RETURNING is part of the same statement). The route has no budget line because the scanner does not see it, and the trips test refuses a hand-added line.
New: `MERGE_PATCH_SQL` + `prefPatch` (routes/entities.js). Nothing else did a merge with removal: schedule.js uses `||`, which cannot remove a key. No keys added. FIELDS now has an entry for every ui_prefs and locale_prefs key (person layer U, no GOV class; product_rows is E). Flow: SET1 · person prefs.
Proof: tests/prefs-merge.test.cjs (14 checks, in guards, board case added) · guards.cjs 5023 checks, all passed. No migration; b322–b324 not used.
Land first; the twin is web round/CU2-38352483400, which is safe in either order.
🤖 Generated with [Claude Code](https://claude.com/claude-code)
