# Cloud task — Manual entries, API side: the preview and the everyday events (Sonnet)

**Outcome (one):** the API that the "＋ Entry" screen needs, per `docs/design/manual-entry/REQUIREMENT.md` (copied here from
chitbridge-web, merged there as #28/#29): (1) a PREVIEW that composes an event's journal lines through the engine and returns
them with each line's account TYPE and the golden RULE that placed it, posting nothing; (2) the everyday owner events not yet
routed. Branch `cloud/manual-entry-api`, PR against `main`, never push to `main`. No secrets, no live sites, never run SQL.

## Already on main (reuse; don't rebuild)
`routes/books.js`: POST /entries (free journal, owner, Dr=Cr), /entries/:id/reverse, /write-off, /payments (+ propose/confirm),
/opening, /periods lock, /packs; and (api #17) /assets (+ dispose), /depreciation/run, /closing-stock, /gst/close, /gst/pay,
/loans (+ /emi), /accruals (+ reverse), /contra. lib/books.js writeLines (voucher series by type; owner-made → MJ with its
voucher_type kept: b279 has run, api #19 writes it). Engines v1.16.0 adopted (`voucherTypeOf`, the golden-rules header in
posting.js, accounts-packs types personal / real / nominal, EXPENSE_CLASSES / INCOME_CLASSES, nextCode).

## Build
1. `POST /api/books/preview { event }` (owner or an allowed co-assist): run the SAME composition the posting route would
   (one code path: the route and the preview call one function; never a copy) and return `{ ok, voucher: { series, type },
   lines: [{ code, ledger, party?, dr_minor, cr_minor, type: 'personal'|'real'|'nominal', rule: 'Dr the receiver' … }],
   balanced, refusals: [plain sentences] }`, including the locked-month refusal (PERIOD_LOCKED) and the GST input-credit flag
   (s.17(5) blocked credit) when the event carries a bill. Nothing is written; no counter is taken.
2. The everyday events the requirement's grid names that have no route yet, each owner-only, idempotent by client_ref,
   locked-month-safe, built by the engine, numbered MJ with its voucher type:
   - expense paid (class from EXPENSE_CLASSES; with GST from a supplier bill's tax lines read by the tax engine, never
     hand-computed; without GST) · other income received (INCOME_CLASSES)
   - capital introduced · drawings (cash or goods)
   - staff salary advance · advance recovered
   If an engine event is missing for one of these, add it in the API ONLY as a composition of existing engine events. If
   that's impossible, list it in the PR as "needs an engine event" and skip it; don't invent posting rules here.
3. A shop's own ledger: `POST /accounts` exists; make sure it assigns the next free code in the chosen group (engines
   nextCode), role null (Books v2), and refuses a code typed by the person.
4. `GET /api/books/events`: the list the screen draws its grid from (kind, words, icon key, which fields it needs, which
   ledger group it picks from), so the screen holds no rules.

## Proof
`tests/books-preview.test.cjs` + `tests/books-manual-events.test.cjs` (offline, the repo's pattern): for each event, the
preview's lines EQUAL the posted lines (same function), Dr = Cr, each line's type and rule named; a locked month refused in
both; a double tap posts once; MJ number with the right voucher_type; a blocked credit flagged. Then the offline books tests one at a
time and `node scripts/guards.cjs` once (all pass; CI is red only for three books tests that need the sibling engines repo).
**Commit and push after EACH logical step.**

## Do not touch
The adopted engine files, `tools/tally-connector/`, other migrations, `.env`, CRM files. Commit messages end with
`Co-Authored-By: Claude <noreply@anthropic.com>`.
