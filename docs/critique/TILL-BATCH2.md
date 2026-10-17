# Critique — till batch 2 (the counter per country), written before code · 2026-10-17

**(a) What the brief assumes, checked**
- `shopPack().slip`, `tax.prices_include_tax`, `collect_without_tax_id`, `cashRounding`, SG/JP `taxInvoice` exist in engines v1.65.0 — TRUE (lib/reg-ae.js:723, reg-au.js:571-572, reg-us.js:176-177, reg-sg.js:302, reg-jp.js:292; bundled in lib/tax-engine.browser.js).
- India's pack titles uppercase to today's words — TRUE (reg-in.js:630: "Tax invoice" / "Bill of supply" / "Cash memo").
- The snapshot can tell an unset `price_includes_tax` from 'yes' — FALSE: routes/till.js:891 sends `flags.price_includes_tax || 'yes'` after policy defaults are merged.
- A round-off path exists to feed — TRUE: lib/books-hooks.js:545 `round_off = charged − invoice total`, where `charged` is the sum of `business_json.payment.parts`; posting.js:196 posts it to the pack's `round_off` ledger; daySummary sums it (posting.js:730). `seams round-off` / `seams cash` found nothing named for it — the primitive is `round_off`.
- `money()` prints S$, RM — FALSE: CBLocale.money gives "SGD 1,234.50", "MYR 1,234.50" (MONEY_LOCALE has INR only; lib/locale.browser.js:802). JPY ¥, AUD A$, USD $, AED "AED" are right.

**(b) Conflicts with rules / constructs**
- Shelf-price default in the till alone would split the counter from every server invoice (tax-copy.js:141, services.js:92, chits.js:1107, catalogue-view.js:565 all read `policy.flagOf`). One place = the server's default: `flagOf(flags, key, country)` takes the pack's convention when the shop never set the flag. The till keeps reading `S.policy.price_includes_tax`. (Settings area file — lib/policy.js — touched only at the default.)
- A US bill with no EIN is `kind:'cash'` but taxed: every `kind === 'tax'` reader that gates the TAX block (slipHTML) must also print it when tax was charged; India never has a taxed cash memo, so nothing there moves.
- Money symbols are an ENGINES change (rule 12 — this round does not own engines): queued, not hand-fixed.

**(c) Simpler way**: cash rounding needs NO books change — store the cash part at the rounded amount and books-hooks already posts the gap as round-off. `cash_round` is recorded on the bill for the slip and the day sheet only.

**(d) Risks**: India slip must be byte-identical (proved by a test that renders the old and new slipHTML side by side); the till-vendor check needs a twin web PR (not opened — no vendoring this round); dayReportHTML is over the size limit — the round-off row goes in through an extracted helper; a day of many cash bills can carry > 1 unit of rounding in a summary chit — per-bill posting is unaffected (each bill is ≤ 2c).

**(e) VERDICT: BUILD WITH CHANGES** — shelf default in lib/policy.flagOf (pack-aware), not a till-only rule; money symbols queued for engines; no books api change needed.
