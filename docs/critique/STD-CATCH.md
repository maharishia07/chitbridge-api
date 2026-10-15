# STD-CATCH critique — the counter master's empty catches → ONE quiet-but-logged helper (written before any code, 14 Oct)

**(a) What the brief assumes, checked**
- "479 empty catches in the till master" — ROUGHLY TRUE: `tools/tally-connector/till.html` has 477 literally-empty block catches (471 `catch (_) {}` · 3 `catch(_){ }` · 2 `catch (e) {}` · 1 `catch(_){}`) + 16 `.catch(function(){})` = 493. The api's own MAINT-1 counter `scripts/empty-catches.cjs` (silent = empty OR literal-only) says 607 for the master.
- "the baseline's prims.cjs" — NOT ON THIS RUNNER: `../chitbridge-docs` is an empty checkout (no commits), so no C:/dev area README, DISCIPLINES.md or prims.cjs. X1 is re-counted with the committed `scripts/empty-catches.cjs` (the T2-HONEST round's counter) plus the literal grep above.
- "an existing quiet/soft-catch helper" — NONE: `quiet(` at till.html:21772 is an HTML line painter (the day-check panel), not a catch helper. `cbQuiet` / `softCatch` do not exist in api or web.
- "the till's own log/diagnostics buffer" — PARTLY: the only failure record is `MEM.fail` (till.html:4401, ONE last lost write) read by `stuckReport()` (:23761, the 🩺 text dump) and `openStuck()`. There is no ring. The ring is NEW and sits beside MEM, in memory (bounded, never a storage write — a full disk is one of the failures it records).
- ONE master, copies by `scripts/vendor-till.cjs` — TRUE; web `public/till.html` is byte-equal to the master today (cmp).
- The page is one classic `<script>` block from :3955 to the end — TRUE, so a hoisted `function cbQuiet` is visible to every catch; the till-vendor sandbox loads the slice `/* ═══ 0 · state` → `applyLook();` (tests/till-vendor.test.js:50), so the helper must live inside that slice (it goes next to MEM, :4401).

**(b) Conflicts with standing rules**
- NO EMPTY CATCH (14 Oct review) — this round IS that rule applied to the counter. The one catch that stays empty is inside `cbQuiet` itself (the recorder has nothing to record itself with) — commented.
- lib/logger is server-only; the counter is offline-first, so "log it" = the local ring, never a network call per error (brief agrees).
- Behaviour must not change: every converted catch keeps its control flow (the call is the whole body); `catch (_) {} /* comment outside */` keeps the comment; a catch whose body is a comment or a literal fallback is NOT empty and is left alone.

**(c) Simpler way** — the brief's shape is already the simplest: one hoisted function, a mechanical codemod (string/comment/regex-aware scan of the one script block, enclosing function found by brace depth), `vendor-till.cjs` for the copy. The ring is read by the existing 🩺 text dump (`stuckReport`) so it is not write-only — one additive section, no new screen.

**(d) Risks** — a scanner that misreads a regex literal or template string could edit inside one → the diff is checked to touch ONLY the catch sites (+ helper + dump section), and pages-parse / till-vendor / till-country-bill / honest-failures run before push. Other rounds push to `integrate/1014d` tonight → pull before every push; the edits are one-line, conflicts stay small. No migration (b628–b630 unused). No engines change. Web PR #285 / api PR #238 already open on the branch — this is a push, not a new PR.

**(e) VERDICT: BUILD WITH CHANGES** — (1) the ring is new (no buffer existed), in memory beside MEM, 200 deep; (2) the 🩺 text dump lists the last entries (else the buffer is write-only); (3) X1 is reported with `scripts/empty-catches.cjs` + the literal grep, not prims.cjs (absent here); (4) the unit test joins `tests/till-vendor.test.js` (it already lifts the page's functions) — no new test file.
