# SEC-FIX3 critique (written before any code)

**(a) Assumptions, checked on main (api bd5c304)**
- S1 `/changes` stores `cites.entity_id` from the body (testing.js:3043) and `/releases` resolves it via `withEntity(<that>)` (:3189) — TRUE.
- S2 `adopt.js:199` passes `req.body.schema_id` to `mintProduct`; `commitFields` inserts on the bare query — TRUE. `products.js` uses `defaultSchemaId` — the owner function exists.
- S3 `req.till` is set on every request (holderOf always returns an object) so `allowed` is always true — TRUE (chits.js:754).
- S4 disputes `selParties` come from the body, no holder check (chits.js:4334); `chit_participants()` definer exists to check — TRUE.
- S5–S11: read from the review; each gets a failing test first. Anything that does not reproduce is reported, not "fixed".
- Live checks (TEST_BOARD_ENTITY, orphan catalogue_source rows, WHATSAPP_TOKEN numbers) are UNKNOWN from here: no DB, no web.

**(b) Rules** Cross-shop = server scope (withEntity / owner gate / may-why), never the page. Reuse `defaultSchemaId`, `isOwner`, `boardRefused`, `platformroot.isRoot`, `chit_participants`. No new tables, no new route.

**(c) Simpler?** Each fix is a 1–6 line gate at the owner file; no new module.

**(d) Risks** S7 (WhatsApp) and S8/S9 (keys) touch behaviour shops rely on (kits, enrol): gate to owner and say so. Definer change for S4 goes in migration b742 (not run; route filter works without it). Other rounds may touch chits.js/testing.js: edits are small and local. Web repo: no change needed.

**(e) VERDICT: BUILD WITH CHANGES** — fix S1–S6 and S8–S11 at the server; S7 as far as the listed fixes reach safely; Medium/Low items beyond the brief's S1–S11 headline are listed as "left" unless trivial.
