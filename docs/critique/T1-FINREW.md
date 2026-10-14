# Critique · T1-FINREW (written before any code)
Note: ../chitbridge-docs is an empty checkout on this runner — the two RECONCILIATION-2026-10-14.md files and DISCIPLINES.md were not readable; the brief's inline text is the spec.

(a) Assumptions, checked
- FIN-R1 "Collections uses a fixed 1.5%/month" — TRUE: lib/books-engines.js:194 `INTEREST_GUIDE = { on:true, rate_pm:1.5 }`, used by routes/books.js:445 for every debtor.
- "ignores the shop's default credit limit" — TRUE: books-engines.js:205 `limitView` reads only the party row (S.parties → credit_limit_minor).
- "the stored Terms and its reader" exist — TRUE: lib/finance-terms.js `resolve(shop, party)` (party → shop → not set) + `shopTerms`; b298 columns. Party interest lives in customer_list.terms, which S.parties does not select.
- ⚠️ Units: the Terms tab stores `rate_pct` as **% a year** (web cap-finance-terms.js:48 "Rate % a year"); receivables.interestDue takes `rate_pm`. Convert rate_pm = rate_pct / 12 at the seam — never a second interest formula.
- REW-L1 "balance counts only the newest 500" — TRUE: lib/reward-store.js entriesOf `LIMIT $4` default 500, folded by balance(), till GET/POST /reward, /reward/claim, crm walk-ins/add.
- "each claim entry in its own transaction" — TRUE: store.append opens its own withEntity per row (till.js claim loop, crm.js:351).
- Found beside it (FALSE-SAFE today): rewards.expired() re-emits an expiry for an earning that already has a written 'expired' row (nothing marks it), so after the first write the fold counts it twice. Fixed by the same SUM read: only earnings with no 'expired' row for their ref are candidates.
- Found beside it: a claim row may meet ON CONFLICT DO NOTHING (crm ref 'claim:'+digits reused for a later claim) — the minus half is skipped, the plus half lands → points created. All-or-nothing must refuse that.

(b) Conflicts: none with "Finance is the ONE place terms are set" — we only READ through finance-terms.resolve. lib/rewards.js is a vendored engine — NOT edited; the fold stays rewards.balanceOf / rewards.expired. Interest stays show-only.
(c) Simpler: SUM in SQL (index idx_reward_ledger_holder already covers it) instead of a stored running balance → no migration, no second answer. b427–b429 unused.
(d) Risks: before b298 runs, terms columns are absent → read the party row only (as today) and say "not set"; /dues gains 1 read (shop terms) + party terms via one grouped read — no per-row query. Concurrent claims on one phone: a per-holder advisory xact lock serialises them. Twin: the web Collections cells say "Not set" from a server code (interest_from / credit_limit_from) — land api first; the web reads absent codes as before.
(e) VERDICT: BUILD WITH CHANGES — rate_pct/12 conversion; fix the double expiry; a claim with a skipped half rolls back; no migration.
