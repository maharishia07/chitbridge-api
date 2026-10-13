# INT3 critique — `integrate/1013c` (api + web): INT2 · ENG-R1 · HX0 · HX1 · AX1 onto today's main, written before any merge

**(a) What the brief assumes, checked**
- STEP 0: api origin/main lacks CX0 (#129) — TRUE (`round/CX0-38327916667` 12 ahead, 0 behind) → merged first, clean. Web main already has #198 (30c27141) — TRUE, nothing to do.
- Branches exist on origin — TRUE for all; web has no HX0/AX1 branch (merged as #177/#176) — TRUE.
- They conflict with main — TRUE (`git merge-tree`): api INT2 in FIELDS · contract · engines.lock · books-store · books · party-fields · reg-au · tax-engine.browser; ENG-R1 in tax-engine.browser (adopted file: regenerated, never hand-merged); HX1 + AX1 in FIELDS; HX0 clean. Web INT2 in the contract fixture + MODULES.md (both regenerated); HX1 in public/till.html (re-vendored, never hand-merged); ENG-R1 clean.
- HX0 ⊂ HX1? FALSE — HX1 carries HX0's commits but not its last main-merge; HX0 merges first as briefed, HX1 then adds only its own.
- Migrations b302 · b303 (INT2) · b304 (HX1), main tops at b301 — TRUE, no clash, nothing renumbered. No migration written here (b349–b351 unused).
- Engines: main pins most at 1.42.0, INT2 reg-au 1.40.0, ENG-R1 tax 1.43.0; v1.42.0 ⊂ v1.43.0 (`merge-base --is-ancestor`) → lock = main + tax 1.43.0 (highest adopted per engine; INT2's reg-au 1.40.0 < main's 1.42.0 loses), written by engines `tools/adopt.cjs`, `--check` after.
- awaiting_client marks: none on main or any branch's budget (INT2 already dropped its 17) — nothing to remove unless the merged test asks.

**(b) Rule conflicts** — none added: no new code; generated files regenerated (contract `--write`, MODULES.md, process pages, adopted engines, till vendor), budget unioned by hand, FIELDS union of rows. If two helpers for one thing appear, main's is kept and callers repointed.

**(c) Simpler way** — none; the briefed order re-resolves least (INT2 carries the contract + lock churn; ENG-R1 only moves `tax`).

**(d) Risks** — tax 1.43.0 changes inclusive-line rounding: `tests/tax-truth` + `tax-vendor` decide, plus the till vendor check. HX1 rewrites db/index.js connect config (HX0's pooler-fallback off) — HX1's version wins where both edited, by meaning. Web HX1 adds guard 17 (no platform host in the site): pages merged from INT2 must pass it. Twin landing api → web (contract master first). Never merged, never force-pushed.

**(e) VERDICT: BUILD AS BRIEFED** — plus STEP 0 (CX0 into the api branch first).
