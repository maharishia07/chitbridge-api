# Critique · T3-P1-MONEY (written before any code, 2026-10-14)

## (a) What the brief assumes, checked
- "finance.html's page-frame tabs" — FALSE: finance.html wears crm/accounts' own frame, not CBFrame (`finance.html:290-311`); its tabs are hash routes painted by `ftNav` (`cap-finance-terms.js:21-30`) and dispatched in `finLoad`/`finMount` (`cap-finance.js:21-25, 97-101`). Cash, Payables, Terms, Repeat each landed as one `cap-finance-*.js` module this way — Cheques and Returns follow it; reframing the page is another round.
- "the workshop's cheque/PDC list and its reminder (FIN-R2)" — HALF: the list exists in a module finance.html ALREADY loads (`cap-books.js:2167-2192` bkChequeCols · bkChequesLoad · bkChequeStepsHTML · bkChequeStep, on CBList); "FIN-R2" appears nowhere in web or api. The server already says the reminders — GET /api/books/cheques `pdc_reminders` (`routes/books.js:837-873`, engines `receivables.pdcReminders`) with `on: true` hard-wired — and NO screen reads them (grep: only a stand-in). The owner's switch has no home yet.
- "the ONE return builder" — TRUE: GET /api/tax/gstr?month&form (`routes/tax.js:48`) → tax-lines gstr1/gstr3b; the workshop downloads it in `cap-admin.js:250 misTaxExport`. AU BAS / AE VAT201 are GET /api/books/returns (`books-period.js:553 taxReturn`), painted in CB Accounts › GST (`cap-period.js:549`). Note: /api/tax/gstr has no country gate (an AU shop gets a GSTR) — the tab is country-first on the client from the pack, the route is not widened.
- "the collections reader (stored terms since FIN-R1)" — TRUE: `finance-terms.js shopTerms` = books_setting.terms (jsonb, b298). It is the one home for a shop-level finance setting, so the reminder switch lives there (`pdc_remind: { on, lead_days }`), widened additively in `clean()`.
- "the existing reminder/notify path" — TRUE, two: the per-party CRM follow-up (POST /api/crm/followups, source `dues`, `cap-crm-record.js:520 rremind`; the bell sweeps what is due, `crm-followups.js:13`) and the list's own `head.notices` strip (Books' "cheques to deposit / clear", `cap-books.js:1072`). Both reused; no new notify path.
- the shop's country on this page — finance.html never sets SESSION.country; `/api/books/health` answers it (`routes/books.js:~200`, as accounts.html:690 reads it) → `shopReg(cc)` (`helpers.js:34`). One existing read.

## (b) Conflicts with DECISIONS-level rules
- One place per thing: the cheque list, its steps and the download are the EXISTING functions; `misTaxExport`'s blob/download part is lifted into helpers.js `gstrDownload` and cap-admin.js points at it (one copy).
- Follow-up `source` is a DB CHECK (b276: manual · dues · interaction): a cheque reminder is filed as `dues` with the cheque named in `what` — no migration (b583-585 unused).
- Money: minor units painted by bkMoney; nothing computed on the page. Better than Tally/Zoho PDC registers: the reminder is a follow-up on the party both sides' chit already names, due on the cheque's date, with the server's state words — not a fourth list.

## (c) Simpler
- No new route for the reminder: the switch is a term (existing GET/POST /api/books/terms, may_set from the server); the per-cheque "Remind me" is the CRM follow-up. Home card: ONE new facts builder (`/api/facts/finance`, cheques to deposit) — the smallest widening the brief allows.

## (d) Risks
- GET /cheques gains `remind` (the switch as read) → contract example re-written (`--write`, byte-copied to web); budget line by hand (+1 statement in the same transaction, trips stay 1).
- Twin landing: web first paints "Not set" until the api lands (the key is simply absent); api first changes nothing visible. Other rounds: cap-finance.js/terms.js dispatch lines are touched by every finance tab round (merge by hand). Engines untouched (rule 12). `--real` is wired but cannot run here (no Postgres on this runner).

## (e) VERDICT: BUILD WITH CHANGES
1. Tabs join finance.html's own hash tabs (no page-frame reframe). 2. Reminder = terms switch + CRM follow-up, no new route or table. 3. AU/AE on Returns say where their return is prepared (CB Accounts › GST) — "not built" only for a pack with no return.
