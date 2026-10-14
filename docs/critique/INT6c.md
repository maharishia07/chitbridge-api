# INT6c critique — `integrate/1014c` (api + web): TOUR-FIX1 · T3 wave 2, stacked on INT6b, written before any merge

**(a) What the brief assumes, checked**
- Base = origin/integrate/1014b (INT6b not on main: web #265 · api #220 still OPEN) — TRUE. `origin/main` has 12 commits not in web 1014b (SEC1b #258 · SCREEN-ID #251) → the main merge is real on web; api main has only the #210 merge commit.
- Every PR branch exists — TRUE for all 11. api #215 PEOPLE-SRV1 is CLOSED (15:17 UTC today: its base integrate/1014a was deleted when #210 merged), its branch `round/PEOPLE-SRV1-38581951994` (7e7586c6) is intact → merged by branch, and this PR supersedes it.
- NET-SRV1 web twin — NONE (`gh pr list --search NET-SRV1`: nothing; no branch). T3-CATALOGUE — NO PR in either repo (web has a branch `round/T3-CATALOGUE-38581858804`, api none) → left out, as briefed.
- Engines: none of the 11 branches touches chitbridge-engines, lib/units.js or an adopted copy → no adopt, no tag (highest = v1.47.0). ENG-REW1 (#264/#219) is not in this brief → not merged.
- Migrations: only TRADE-SRV1's `migrations/b538_trade_lanes_au_ae.sql` (its own reserved number, kept). b574–b576 unused.
- Conflicts (merge-tree vs 1014b, each alone): web TOUR-FIX1 → walk-tasks · shop.html · tasks.html; T3-SETTINGS → flows.json · app.html · cap-admin.js · manifest.json · settings.html; MKT → contract fixture; PEOPLE → walk-home · manifest.json; TRADE → flows.json. api TOUR-FIX1 clean; T3-SETTINGS → FIELDS · home-facts · owner.js · counters · entities · facts; NET-SRV1 → network-membership · network-offers (lib + route); MKT → crm.js · home-facts · budget · facts; PEOPLE → home-facts · budget · facts; TRADE → FIELDS · country-setup · kyb · profile · readiness · guards.cjs.
- Round-to-round overlaps: api lib/home-facts.js ×4 (rail · counters · marketing · people cards) · routes/facts.js ×3 · round-trips.budget.json ×4 · guards.cjs ×4 · FIELDS.md ×5 · contract ×2 (TOUR `#rail` row, MKT consent/paging); web flows.json ×3 (SET · H2P · TRADE) · manifest.json ×2 · contract fixture ×2.
- TOUR-FIX1 changes the till MASTER (till.html · promo.html · signin-ui.js) and web's copy by hand-identical edits → after the api merge, `scripts/vendor-till.cjs` with CB_WEB_DIR; the web copy must equal the vendored bytes.
- C:/dev area homes (../chitbridge-docs) — EMPTY checkout on this runner again; DISCIPLINES.md taken from the brief inline.

**(b) Rule conflicts** — home-facts `BUILD` is ONE registry: each round adds a card → union, never a second registry. One owner gate: T3-SETTINGS' `lib/owner.gate/may` and PEOPLE's `ownerOnly` live in the same module → both kept, no second copy. Contract: api master `--write` once after every api merge, web fixture a BYTE COPY (MKT's web #260 fixture is a copy of an older master → never hand-merged). flows.json: union of the SET · H2P · TRADE rows, then `tools/gen-process-docs.cjs` (INDEX.md / TRADE.md are generated). MODULES.md by `tools/gen-modules-doc.cjs`. Budget: hand-union. SCREEN-ID (main) × T3-SETTINGS: the new Settings sections get their codes from the register, not a new chip.

**(c) Simpler way** — none; order as briefed, web half first.

**(d) Risks** — the hand-patched web till (TOUR-FIX1) vs the vendored output: a byte diff means a master edit was missed → re-vendor wins. MKT's `whatsapp-out` gate × 1014b's HONEST catches: keep the gate AND the logged catch. SEC1b (main) × TOUR-FIX1's e2e sign-in. Other rounds on the same files (ENG-REW1, T3-CATALOGUE) rebase on this. Landing: AFTER integrate/1014b; web → api.

**(e) VERDICT: BUILD WITH CHANGES** — (1) PEOPLE-SRV1 api merged by branch (its PR #215 was auto-closed); (2) T3-CATALOGUE left out (no PR open); (3) NET-SRV1 has no web twin; (4) the web till re-vendored from the api master after TOUR-FIX1 rather than trusting the hand copy.
