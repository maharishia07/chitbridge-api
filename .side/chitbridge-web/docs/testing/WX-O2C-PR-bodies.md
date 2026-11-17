# WX-O2C · the two PR bodies (the round's token was refused createPullRequest — HTTP 403; open them from the branches below)

## chitbridge-api · round/WX-O2C-38343007038 → main (land FIRST)

VERDICT: BUILD WITH CHANGES (critique: web docs/critique/WX-O2C.md — AU leg a NOTE, quote step not built). Twin of web round/WX-O2C-38343007038; land THIS first.
Walked O2C on the real stack (loader shop); fixes, each with its test: View-only employees were created as editors (POST /api/actors drops access_level → a viewer billed) · On-credit bills to a local customer closed on issue (Unpaid bills › Issued 0; bill-steps `owed`) · counter bills named the shop as customer (lib/select.js) · /my-orders adds `shop_status` (FIELDS.md row) · books 'today' = the shop's day · till online orders leave own bills out · sim-load `--start` + enabled_at off the same clock · AU refused until a pack exists.
Reuse: access.FROM_HAT/LEVELS, chit_participants (b50), trySavepoint, bill-steps facts, planDays. New: tests/actors-create-level · select-counter-customer (each: no existing check covered it).
Trips: /my-orders +2 statements (SAVEPOINT·RELEASE), one read; POST /api/actors one cached hasColumn (the budget test refuses a line — not in the web call set). No migration. Who may call: unchanged.
Open (not built, in web docs/testing/WX-O2C-2026-10-13.md): folder-views reads the newest 2000 before open/closed (🔴 O-5); production staff already mis-levelled (🔴 O-12, SQL to review there); engines: inclusive split loses a paisa (O-3), AU pack (O-13).
Better than Xero: the buyer's own chit carries the shop's step — no separate portal. O2C steps 3–7.
🤖 Generated with [Claude Code](https://claude.com/claude-code)

## chitbridge-web · round/WX-O2C-38343007038 → main

VERDICT: BUILD WITH CHANGES (docs/critique/WX-O2C.md — AU leg a NOTE, quote step not built). Twin: api round/WX-O2C-38343007038 — land the api FIRST (the api PR could not be opened by this token: open it from that branch).
Walk: e2e/walk-x-o2c.cjs (--real on the loader's shop · fixture mode NOTEs) + e2e/lib/real-stack.cjs. Findings: docs/testing/WX-O2C-2026-10-13.md — 24 screens · 15 operations · 29 found · 16 fixed · 13 open (🔴 5: credit-bill return pays cash · credit note never posts 128.99≠129 · till prints a viewer's refused bill · Unpaid bills' 2000 cap · mis-levelled staff).
Last run on `sim-load --start 2023-04-01`: S3+S4 16/16 · S5–S8 19/25 · S9+S10 4/5 + AU NOTE; every red path is an open row.
Fixed here, each with its test: My orders said Delivered for an unseen order (CBWorkflow.stageOf) and now shows the shop's step · the Ledger's door kept the bill open + its real status · Unpaid bills shows Bill no/Date (CBList defaultCols) · Receive names the party · cart splits inclusive GST (splitLineTax) · storefront money in the shop's currency.
Reuse: CBWorkflow.stageOf, CBTax.splitLineTax, CBList defaultCols, payOpen, CBLocale.money. New: real-stack.billByNo/lastWalkBill (the walk finds its own bill locally). O2C steps 3–7.
Engines (not changed, rule 12): tax splitLineTax/lineHeads — last head takes the remainder (O-3); an AU pack (O-13). Till fixes go to the api master then vendor (O-1, O-2, O-4).
Better than Xero: the buyer reads the shop's step on the chit both hold — no separate portal. Checks: guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses green.
🤖 Generated with [Claude Code](https://claude.com/claude-code)
