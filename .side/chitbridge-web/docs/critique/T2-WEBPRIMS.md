# Critique · T2-WEBPRIMS — one esc(), one money formatter, one month list (written before any code)

(a) What the brief assumes, checked
- "helpers.js esc escapes & < > \" '" — **FALSE**: `public/app/helpers.js:9` escapes `<>"&` only; 30 of the 43 private copies are the ones that escape `'`. Widen the home (additive: `'` → `&#39;`), then delete the copies.
- "esc copied 21+ times" — TRUE and worse: 43 definitions outside the home in public/ (app/*.js 22 · pages/labs 18 · engine/ 3 vendored).
- helpers.js is on every page — **FALSE**: only app, accounts, crm, finance, settings, tasks load it (`grep app/helpers.js public/*.html`). Shared modules (shell, avatar, kural, list-ctl, rail-bell, signin-ui …) carry their own esc *because* they run on pages without it. So each page that loses a copy loads `/app/helpers.js` first (it is pure leaves, no load-time reads — helpers.js:1-5).
- CBLocale has a month list — **FALSE**: `public/app/locale.js` has `date()` only, and it is adopted (DO NOT EDIT). Month words are read through `CBLocale.date(…, {month})` by one helper in helpers.js.
- "the one formatter with the shop's currency" — TRUE: `fmtMoney(amount, code)` helpers.js:144 → `CBLocale.money`; the shop's currency is `myCur()` in the app, the page's own shop/sample currency elsewhere.
- Docs: `C:/dev` (../chitbridge-docs) is EMPTY on this runner — RECONCILIATION-2026-10-14, MAINT-1 baseline and SPEC-money-one-reader could not be read. The metric is counted by the new guard itself (same regex before/after).

(b) Conflicts with standing rules
- Vendored engine copies (public/engine/*, app/tax.js, app/variant.js, app/offers.js) hold esc/month copies — rule 2/12: NOT edited; listed for an engines round.
- The till (public/till.html) and promo.html are kit-vendored and run offline where /app/helpers.js is not served: their ONE helper stays (the till's `esc`, widened to `'` in the api master + re-vendor). signin-ui.js is byte-copied into the kit → api twin re-vendors it.
- cart.js `money(lines, o)` is the cart's TOTALS calculator (CBCart.money), not a formatter — allowed by name in the guard.

(c) Simpler way: none that ends with one copy; an alias module would be a second home.

(d) Risks: a page loading helpers.js gets its globals (cap, nm, opt, loader…) — a `let/const` of the same name in a page would throw → checked per page. Labs' `₹1,234` becomes `₹1,234.00` (the formatter's two decimals) — the named fix. `'` now renders as `&#39;` in HTML: identical on screen; no esc output feeds a selector or a non-HTML sink (grep). Other rounds touching app/*.js: merge risk only.

(e) VERDICT: BUILD WITH CHANGES — widen helpers.js esc first; add helpers.js to the pages that lose a copy; months via one helpers.js reader over CBLocale.date; vendored engines + kit pages excepted by name in the guard; api twin (till esc + kit signin-ui copy), web lands first.
