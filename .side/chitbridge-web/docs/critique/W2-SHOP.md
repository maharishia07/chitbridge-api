# Critique · W2-SHOP (COMPLETE-100 wave 2 · S1 at 65% → 100%) — written before any code, 2026-10-15

(a) What the brief assumes — checked against main (13b8b65c)
- SH-MY1 "a returning shopper signs in and reaches My orders" — TRUE, already landed by T1-ORD (f344147d): the door `shopMyOrdersOpen`
  (shop.html:1288) opens the one gate `renderLoginGate` with `_lg.after='orders'` (:767), `sfLoginVerify` keeps the token in `_MYTOK`
  and opens `shopMyOrders` (:798), the list pages on the server's total · page · limit (:1292-1320). api my-orders answers the pager
  contract (routes/catalogue.js:1385-1404; tests/tier2-record.test.js:201). The walk exists: e2e/walk-shop-my-orders.cjs (R1–R6).
- SH-OTP1 "one shopper code path, tester door = lib/dev-otp testerCodeOk" — TRUE: lib/otp.js issueShopperOtp · spendShopperOtp ·
  verifyOtp (testerCodeOk asked at :81, the one verify every door uses); catalogue.js order/start:845, support:965, confirm:1019,
  login/verify:1356 all go through it; tests/one-writer.test.cjs "SH-OTP1" (2 checks) and tests/tester-code.test.cjs (44) are GREEN here.
  Web has ONE shopper OTP UI (shop.html; app.html's hits are the owner's flows) — no second page carries its own.
- CART-REG1 "the cart's money is the shop's, never INR" — TRUE in code (shop.html:610, :684; app/cart.js) but its PROOF is RED:
  tests/cart-currency.test.cjs loads `app/locale.js`, which T2-ENGONCE moved to `engine/locale.js` → ENOENT on main.
- "e2e/one-cart.cjs green (:57-69)" — FALSE, but not at the registry: the guard fails on app/cap-mis.js:110 (`tx('as of')`, the Reports tab's
  read stamp, T3-P4-ACCOUNT 14 Oct) — the stock-stamp rule reads it as a second stamp. The registry (:57-69) already names cap-network-member.js.
- cap-network-member.js:479 — TRUE: the one CBCart.create() of the Network outlet, registered.
- Area home C:/dev/docs/10-…/README.md and DISCIPLINES.md — UNKNOWN: ../chitbridge-docs holds only .git on this runner (said in the report).

(b) Conflicts with rules / constructs
- The MIS read stamp is now painted twice (cap-admin.js:127 `live · <time>`, cap-mis.js:110 `as of <time>`): one fact, two formats — the 14 Oct
  rule "second call site → lift ONE helper" applies; cap-mis.js already owns `misWindow` that cap-admin.js reads, so the helper lives there.
- flows.json O2C step 3 names `orderStart` / `_orderPost` only; the returning shopper's door and its walk are not on the map (rule 7, PM1).

(c) Simpler way: no new route, screen, field or migration (b685–b687 unused). Three small web changes: one helper, one path, one map row.

(d) Risks: none to data or money; web-only PR (api untouched; contract fixture already byte-equal). `tools/readability.cjs --changed` does not
exist in this repo (only --roots); §6 numbers counted by hand. No engines change. The walk runs here on Chromium (rule 6).

(e) VERDICT: BUILD WITH CHANGES — SH-MY1 and SH-OTP1 are done (prove with the walk + api tests, no rebuild); fix the two red proofs
(one-cart via the one MIS stamp helper; cart-currency's locale path) and add the O2C map row. S1 → 100% when the walk and both guards are green.
