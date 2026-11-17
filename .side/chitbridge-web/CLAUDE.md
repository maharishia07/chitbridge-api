# Reuse before you build — read before writing ANY function, field, shape or calculation

Athi, 2026-10-02: *"the software asset you hold is not good enough for you to reuse, you keep generating new path and
each one drifts."* Found that day: a counter bill's tax was printed by the counter, recomputed differently by the
server, blank on the buyer's screen and GST ₹0.00 on the reprint — while `summary_json.money` and the frozen
`business_json.invoice` already had the slots, and `invoiceFor` / `splitLineTax` / `lineHeads` already did the sums.

1. **Look first, and say what you found.** Before adding anything, search for what already does it:
   functions → `node C:/dev/seams.cjs <word>` locally, or `docs/SEAMS.md` in the repo (cloud sessions);
   modules → `docs/SOFTWARE-ASSETS.md` (api); data fields → `docs/FIELDS.md` (being built — until then, grep the
   writers and readers of the key). The PR description names the reuse points used.
2. **One calculation.** Money, tax, totals, rounding and place of supply come from the existing engines —
   `tax-lines.invoiceFor`, `tax-engine` `splitLineTax · lineHeads · supplyType`, `money.round` / `CBMoney.round`.
   A screen paints what was computed; it never computes a second answer. If an engine does not fit, WIDEN it
   (additively, with a test) — never copy it.
3. **One shape per slot.** Fill the slot that exists — `business_json.invoice` (the frozen invoice both ledgers post
   from), `summary_json.money` (gross · savings · net · tax · total), `line_items[]`, `detail.total_value`. Never put a
   different shape under an existing key. A NEW key is allowed only with its dictionary entry in the same change:
   number · source or derived · who writes it · who reads it.
4. **A new path must justify itself.** Every new function, module or field in a PR is listed with one line on why
   nothing existing served. "I didn't find one" is not a reason unless the search in rule 1 is shown.
5. **No new style — the first question is "how do I reuse?"** (Athi, 2026-10-02: *"do not create new style anywhere, the first question is how do i reuse"*). A list IS the Task table (`listHeader · rowGrid · colTemplate`, app.html) with `list-ctl.js` for search · filters · sort · paging · count; a row's details open the existing popup (`openChitSheet`) or Task's own `openChit`; a row's next level opens the way Task's Group sum does (`gsToggle`, cap-folders.js); a preview is `rowPeek`. A screen that draws its own rows, cards or expanders is wrong even if it looks right. A new look needs Athi's yes BEFORE it is built.

# This repo
The web app (Vercel, deploys from `main`). `public/till.html` is VENDORED from chitbridge-api `tools/tally-connector/till.html` — change the master there, then copy. Design rules and the testing policy live in chitbridge-api/CLAUDE.md and apply here too.
