# TOUR-FINDINGS — the visual tour (round VTOUR, 2026-10-14)

Harness: `e2e/visual-tour.cjs` on the LOCAL stack (`e2e/lib/stack-local.cjs` + api `tools/sim-load.cjs` shop `simstores` + `scripts/seed-local.cjs`). Runs: `a-cream-1366-p-shophtml` · `a-cream-1366-s1` · `a-cream-1366-s2` · `a-cream-1366-s3` · `a-cream-1366-s4` · `a-cream-1366-s5` · `a-cream-1366-s6` · `a-cream-390-p-shophtml` · `a-cream-390` · `a-dark-1366-p-shophtml` · `a-dark-1366` · `a-dark-390-p-shophtml` · `a-dark-390` · `b-cream-1366-p-embed` · `b-cream-1366-p-iot-howitworks-signin-lab` · `b-cream-1366-p-promo` · `b-cream-1366-p-tillhtml` · `b-cream-1366-s1` · `b-cream-1366-s2` · `b-cream-1366-s3` · `b-cream-1366-s4` · `b-cream-1366-s5` · `b-cream-1366-s6` · `b-cream-1366-s7` · `b-cream-1366-s8` · `b-cream-390-p-index-accounts-finance-crm-tasks-till-se` · `b-dark-1366-s1` · `b-dark-1366-s2` · `b-dark-390-p-index-accounts-finance-crm-tasks-till-se`.
States: 403 screen states · 530 boxes (363 clicked) · 618 random operations. Findings: **1 broken · 375 inconsistent · 139 cosmetic** (grouped; n = states it was seen in). Screenshots: the `visual-tour` artifact (`e2e/out/tour/`), never committed.

⚠️ run `b-cream-1366-s5` was cut short (SIGTERM) — its states up to then are kept.

⚠️ run `b-cream-1366-s6` was cut short (SIGTERM) — its states up to then are kept.

⚠️ run `b-cream-1366-s8` was cut short (SIGTERM) — its states up to then are kept.

**Screen codes:** 34 toured page(s) carry no code in the register (public/app/screens.js numbers app.html, the Counter and the Storefront only): accounts.html, authority-forms.html, cart-design.html, combo-lab.html, conversion-lab.html, country-lab.html, crm.html, design-mock.html, embed.html, employees.html, finance.html, index.html, intake.html, iot-howitworks.html, know-your-business.html, lifecycle-test.html, list-lab.html, network-design.html, network-shop.html, network.html, offer-lab-next.html, offer-lab.html, product-lab.html, promo.html, screen-gallery.html, settings.html, shell-lab.html, signin-lab.html, standards.html, store.html, storefront-design.html, supplier-design.html, tasks.html, testing.html. → the SCREEN-ID round.

## Broken (1)

| # | code | finding | seen | screenshot | reproduce |
|---|---|---|---|---|---|
| 1 | OWN002 | request failed on shop.html: `404 GET api:/api/catalogue/CBYQJK44RF` | 2× (cream 1366, dark 1366) | 540001-OWN002-shop-c1366-top.png | open /shop.html?s=CBYQJK44RF signed in · cream · 1366 px |

## Inconsistent (375)

| # | code | finding | seen | screenshot | reproduce |
|---|---|---|---|---|---|
| 1 | UNNUMBERED | request failed on accounts.html: `422 GET api:/api/books/returns` | 42× (cream 1366) | 570005-UNNUMBERED-accounts-Day-book-op1-c1366.png | open /accounts.html#daybook signed in · cream · 1366 px · section "Day book" · switch a tab/filter "Month db-group-month" |
| 2 | UNNUMBERED | tasks.html links to the workshop (app.html): `<a class="act quiet" id="tk_new" data-testid="tk-new" href="/app.html#/app/compo` | 17× (cream 1366, cream 390, dark 1366, dark 390) | 550001-UNNUMBERED-tasks-c1366-top.png | open /tasks.html signed in · cream · 1366 px |
| 3 | UNNUMBERED | contrast below AA on design-mock.html (cream), `div.sub`: 2.77:1 (need 4.5) "South Asia · 3 set here" · 3.07:1 (need 4.5) "the top — its settings flow " · 3.07:1 (need 4.5) "North America · 3 set here" +2 | 15× (cream 1366) | 160057-UNNUMBERED-design-mock-c1366-top.png | open /design-mock.html signed out · cream · 1366 px |
| 4 | UNNUMBERED | settings.html has no Home button — Home is only inside the app switcher menu (the index has ⌂ Home in its rail) | 14× (cream 1366, cream 390, dark 1366, dark 390) | 140040-UNNUMBERED-settings-c1366-top.png | open /settings.html signed out · cream · 1366 px |
| 5 | UNNUMBERED | sideways scroll on standards.html: DIV.cbl-list 1010>1006 | 14× (cream 1366, dark 1366) | 160012-UNNUMBERED-standards-c1366-top.png | open /standards.html signed out · cream · 1366 px |
| 6 | UNNUMBERED | controls covered by `cbsh-tools` on index.html (they cannot be brought out from under it): shell-card-documents | 12× (cream 1366, dark 1366) | 110005-UNNUMBERED-index-signin-5-done-c1366-top.png | open / signed out · cream · 1366 px |
| 7 | OWN002 | shop.html does not draw the shared shell header (.cbsh-hdr) the index draws | 10× (cream 1366, cream 390, dark 1366, dark 390) | 110001-OWN002-shop-c1366-top.png | open /shop.html?s=CBFB5A4VH2 signed out · cream · 1366 px |
| 8 | OWN002 | shop.html has no avatar / Sign in door | 10× (cream 1366, cream 390, dark 1366, dark 390) | 110001-OWN002-shop-c1366-top.png | open /shop.html?s=CBFB5A4VH2 signed out · cream · 1366 px |
| 9 | OWN002 | shop.html has no Home button / link back to the index | 10× (cream 1366, cream 390, dark 1366, dark 390) | 110001-OWN002-shop-c1366-top.png | open /shop.html?s=CBFB5A4VH2 signed out · cream · 1366 px |
| 10 | OWN002 | shop.html body font "Inter" ≠ the index's "IBM Plex Sans" | 10× (cream 1366, cream 390, dark 1366, dark 390) | 110001-OWN002-shop-c1366-top.png | open /shop.html?s=CBFB5A4VH2 signed out · cream · 1366 px |
| 11 | OWN001 | till.html ignores the chosen theme (Dark saved; the page paints cream) | 10× (dark 1366, dark 390) | 210003-OWN001-till-d1366-top.png | open /till.html signed out · dark · 1366 px |
| 12 | UNNUMBERED | controls covered by `cbsh-tools` on shell-lab.html (they cannot be brought out from under it): shell-card-documents | 10× (cream 1366, dark 1366) | 570106-UNNUMBERED-shell-lab-c1366-top.png | open /shell-lab.html signed in · cream · 1366 px |
| 13 | UNNUMBERED | dead click on design-mock.html: "🗂️ Catalogue" — nothing happened | 9× (cream 1366) | 160065-UNNUMBERED-design-mock-click07-c1366.png | open /design-mock.html signed out · cream · 1366 px · click "🗂️ Catalogue" |
| 14 | UNNUMBERED | controls covered by `pairwrap` on promo.html (they cannot be brought out from under it): camp, play, prevb, nextb, share +5 | 8× (cream 1366, cream 390, dark 1366, dark 390) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 15 | OWN001 | controls covered by `usigndlg` on till.html (they cannot be brought out from under it): till-mode, till-side-open, till-side-bills, till-side-check, till-side-expense +7 | 8× (cream 1366, cream 390, dark 1366, dark 390) | 510001-OWN001-till-c1366-top.png | open /till.html signed in · cream · 1366 px |
| 16 | UNNUMBERED | accounts.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has .top | 7× (cream 1366, dark 1366, cream 390, dark 390) | 120009-UNNUMBERED-accounts-c1366-top.png | open /accounts.html#compare signed out · cream · 1366 px |
| 17 | UNNUMBERED | crm.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has .bar | 7× (cream 1366, dark 1366, cream 390, dark 390) | 160001-UNNUMBERED-crm-c1366-top.png | open /crm.html#/chits?tab=orders signed out · cream · 1366 px |
| 18 | UNNUMBERED | contrast below AA on tasks.html (dark), `b`: 1.12:1 (need 3) "0" | 7× (dark 1366, dark 390) | 610010-UNNUMBERED-tasks-d1366-top.png | open /tasks.html signed in · dark · 1366 px |
| 19 | UNNUMBERED | contrast below AA on tasks.html (dark), `span.tk-count`: 1.12:1 (need 4.5) "rows" | 7× (dark 1366, dark 390) | 610010-UNNUMBERED-tasks-d1366-top.png | open /tasks.html signed in · dark · 1366 px |
| 20 | UNNUMBERED | contrast below AA on tasks.html (dark), `a.act`: 1.12:1 (need 4.5) "＋ New" | 7× (dark 1366, dark 390) | 610010-UNNUMBERED-tasks-d1366-top.png | open /tasks.html signed in · dark · 1366 px |
| 21 | UNNUMBERED | network-shop.html does not draw the shared shell header (.cbsh-hdr) the index draws | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110024-UNNUMBERED-network-shop-c1366-top.png | open /network-shop.html signed out · cream · 1366 px |
| 22 | UNNUMBERED | network-shop.html has no avatar / Sign in door | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110024-UNNUMBERED-network-shop-c1366-top.png | open /network-shop.html signed out · cream · 1366 px |
| 23 | UNNUMBERED | network-shop.html has no Home button / link back to the index | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110024-UNNUMBERED-network-shop-c1366-top.png | open /network-shop.html signed out · cream · 1366 px |
| 24 | UNNUMBERED | network-shop.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110024-UNNUMBERED-network-shop-c1366-top.png | open /network-shop.html signed out · cream · 1366 px |
| 25 | UNNUMBERED | controls covered by `cbsh-bar` on index.html (they cannot be brought out from under it): shell-card-tasks, shell-card-employees, shell-card-kyb | 6× (cream 1366, dark 1366) | 110001-UNNUMBERED-index-signin-1-open-c1366-top.png | open / signed out · cream · 1366 px |
| 26 | UNNUMBERED | embed.html does not draw the shared shell header (.cbsh-hdr) the index draws | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110065-UNNUMBERED-embed-c1366-top.png | open /embed.html signed out · cream · 1366 px |
| 27 | UNNUMBERED | embed.html has no avatar / Sign in door | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110065-UNNUMBERED-embed-c1366-top.png | open /embed.html signed out · cream · 1366 px |
| 28 | UNNUMBERED | embed.html has no Home button / link back to the index | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110065-UNNUMBERED-embed-c1366-top.png | open /embed.html signed out · cream · 1366 px |
| 29 | UNNUMBERED | embed.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110065-UNNUMBERED-embed-c1366-top.png | open /embed.html signed out · cream · 1366 px |
| 30 | UNNUMBERED | finance.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has .bar | 6× (cream 1366, dark 1366, cream 390, dark 390) | 120001-UNNUMBERED-finance-c1366-top.png | open /finance.html signed out · cream · 1366 px |
| 31 | UNNUMBERED | controls covered by `pairbox` on promo.html (they cannot be brought out from under it): copycap | 6× (cream 1366, dark 1366) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 32 | UNNUMBERED | controls covered by `paircode` on promo.html (they cannot be brought out from under it): cap | 6× (cream 1366, dark 1366) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 33 | UNNUMBERED | promo.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has header | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 34 | UNNUMBERED | promo.html has no avatar / Sign in door | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 35 | UNNUMBERED | promo.html has no Home button / link back to the index | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 36 | UNNUMBERED | promo.html body font "Segoe UI" ≠ the index's "IBM Plex Sans" | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 37 | UNNUMBERED | store.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has header | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120037-UNNUMBERED-store-c1366-top.png | open /store.html signed out · cream · 1366 px |
| 38 | UNNUMBERED | store.html has no avatar / Sign in door | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120037-UNNUMBERED-store-c1366-top.png | open /store.html signed out · cream · 1366 px |
| 39 | UNNUMBERED | store.html has no Home button / link back to the index | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120037-UNNUMBERED-store-c1366-top.png | open /store.html signed out · cream · 1366 px |
| 40 | UNNUMBERED | store.html body font "system-ui" ≠ the index's "IBM Plex Sans" | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120037-UNNUMBERED-store-c1366-top.png | open /store.html signed out · cream · 1366 px |
| 41 | OWN001 | till.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has header | 6× (cream 1366, dark 1366, cream 390, dark 390) | 130001-OWN001-till-c1366-top.png | open /till.html signed out · cream · 1366 px |
| 42 | OWN001 | till.html body font "system-ui" ≠ the index's "IBM Plex Sans" | 6× (cream 1366, dark 1366, cream 390, dark 390) | 130001-OWN001-till-c1366-top.png | open /till.html signed out · cream · 1366 px |
| 43 | UNNUMBERED | contrast below AA on screen-gallery.html (cream), `small`: 2.28:1 (need 4.5) "06:00–11:30" · 3.72:1 (need 4.5) "/ plate" | 6× (cream 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 44 | UNNUMBERED | contrast below AA on screen-gallery.html (cream), `b`: 2.28:1 (need 4.5) "Morning" | 6× (cream 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 45 | UNNUMBERED | storefront-design.html does not draw the shared shell header (.cbsh-hdr) the index draws | 6× (cream 1366, cream 390, dark 1366, dark 390) | 130118-UNNUMBERED-storefront-design-c1366-top.png | open /storefront-design.html signed out · cream · 1366 px |
| 46 | UNNUMBERED | storefront-design.html has no avatar / Sign in door | 6× (cream 1366, cream 390, dark 1366, dark 390) | 130118-UNNUMBERED-storefront-design-c1366-top.png | open /storefront-design.html signed out · cream · 1366 px |
| 47 | UNNUMBERED | storefront-design.html has no Home button / link back to the index | 6× (cream 1366, cream 390, dark 1366, dark 390) | 130118-UNNUMBERED-storefront-design-c1366-top.png | open /storefront-design.html signed out · cream · 1366 px |
| 48 | UNNUMBERED | storefront-design.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 6× (cream 1366, cream 390, dark 1366, dark 390) | 130118-UNNUMBERED-storefront-design-c1366-top.png | open /storefront-design.html signed out · cream · 1366 px |
| 49 | UNNUMBERED | know-your-business.html has no Home button — Home is only inside the app switcher menu (the index has ⌂ Home in its rail) | 6× (cream 1366, cream 390, dark 1366, dark 390) | 140003-UNNUMBERED-know-your-business-c1366-top.png | open /know-your-business.html signed out · cream · 1366 px |
| 50 | UNNUMBERED | know-your-business.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 6× (cream 1366, cream 390, dark 1366, dark 390) | 140003-UNNUMBERED-know-your-business-c1366-top.png | open /know-your-business.html signed out · cream · 1366 px |
| 51 | UNNUMBERED | tasks.html has no Home button — Home is only inside the app switcher menu (the index has ⌂ Home in its rail) | 6× (cream 1366, dark 1366, cream 390, dark 390) | 150001-UNNUMBERED-tasks-c1366-top.png | open /tasks.html signed out · cream · 1366 px |
| 52 | UNNUMBERED | sideways scroll on index.html: DIV. 375>338 | 6× (cream 390, dark 390) | 310001-UNNUMBERED-index-c390-top.png | open / signed out · cream · 390 px |
| 53 | UNNUMBERED | contrast below AA on settings.html (dark), `label`: 2.32:1 (need 4.5) "Mobile, e-mail or user ID" | 6× (dark 1366, dark 390) | 210019-UNNUMBERED-settings-d1366-top.png | open /settings.html#/shop signed out · dark · 1366 px |
| 54 | UNNUMBERED | contrast below AA on settings.html (dark), `a.cbsi-ln`: 1.82:1 (need 4.5) "New shop? Register" | 6× (dark 1366, dark 390) | 210019-UNNUMBERED-settings-d1366-top.png | open /settings.html#/shop signed out · dark · 1366 px |
| 55 | UNNUMBERED | sideways scroll on finance.html: DIV.cbl-list 1231>1134 | 6× (cream 1366, dark 1366) | 520001-UNNUMBERED-finance-c1366-top.png | open /finance.html signed in · cream · 1366 px |
| 56 | UNNUMBERED | offer-lab-next.html does not draw the shared shell header (.cbsh-hdr) the index draws | 5× (cream 1366, dark 1366) | 130031-UNNUMBERED-offer-lab-next-c1366-top.png | open /offer-lab-next.html signed out · cream · 1366 px |
| 57 | UNNUMBERED | dead click on list-lab.html: "ENTRY ⇅" — nothing happened | 5× (cream 1366) | 150090-UNNUMBERED-list-lab-click24-c1366.png | open /list-lab.html signed out · cream · 1366 px · click "ENTRY ⇅" |
| 58 | OWN002 | shop.html ignores the chosen theme (Dark saved; the page paints its own colours, no CBAvatar) | 5× (dark 1366, dark 390) | 210001-OWN002-shop-d1366-top.png | open /shop.html?s=CBFB5A4VH2 signed out · dark · 1366 px |
| 59 | UNNUMBERED | contrast below AA on design-mock.html (dark), `div.sub`: 2.77:1 (need 4.5) "South Asia · 3 set here" · 3.07:1 (need 4.5) "the top — its settings flow " · 3.07:1 (need 4.5) "North America · 3 set here" +2 | 5× (dark 1366) | 210024-UNNUMBERED-design-mock-d1366-top.png | open /design-mock.html signed out · dark · 1366 px |
| 60 | UNNUMBERED | design-mock.html ignores the chosen theme (Dark saved; the page paints its own colours, no CBAvatar) | 5× (dark 1366) | 210024-UNNUMBERED-design-mock-d1366-top.png | open /design-mock.html signed out · dark · 1366 px |
| 61 | UNNUMBERED | contrast below AA on screen-gallery.html (dark), `small`: 2.28:1 (need 4.5) "06:00–11:30" · 3.72:1 (need 4.5) "/ plate" | 5× (dark 1366) | 210033-UNNUMBERED-screen-gallery-d1366-top.png | open /screen-gallery.html signed out · dark · 1366 px |
| 62 | UNNUMBERED | contrast below AA on screen-gallery.html (dark), `b`: 2.28:1 (need 4.5) "Morning" | 5× (dark 1366) | 210033-UNNUMBERED-screen-gallery-d1366-top.png | open /screen-gallery.html signed out · dark · 1366 px |
| 63 | UNNUMBERED | screen-gallery.html ignores the chosen theme (Dark saved; the page paints its own colours, no CBAvatar) | 5× (dark 1366) | 210033-UNNUMBERED-screen-gallery-d1366-top.png | open /screen-gallery.html signed out · dark · 1366 px |
| 64 | UNNUMBERED | network.html has no Home button — Home is only inside the app switcher menu (the index has ⌂ Home in its rail) | 4× (cream 1366, dark 1366) | 110046-UNNUMBERED-network-c1366-top.png | open /network.html signed out · cream · 1366 px |
| 65 | UNNUMBERED | signin-lab.html does not draw the shared shell header (.cbsh-hdr) the index draws | 4× (cream 1366, dark 1366) | 110081-UNNUMBERED-signin-lab-c1366-top.png | open /signin-lab.html signed out · cream · 1366 px |
| 66 | UNNUMBERED | signin-lab.html has no avatar / Sign in door | 4× (cream 1366, dark 1366) | 110081-UNNUMBERED-signin-lab-c1366-top.png | open /signin-lab.html signed out · cream · 1366 px |
| 67 | UNNUMBERED | signin-lab.html has no Home button / link back to the index | 4× (cream 1366, dark 1366) | 110081-UNNUMBERED-signin-lab-c1366-top.png | open /signin-lab.html signed out · cream · 1366 px |
| 68 | UNNUMBERED | product-lab.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has header | 4× (cream 1366, dark 1366) | 120012-UNNUMBERED-product-lab-c1366-top.png | open /product-lab.html signed out · cream · 1366 px |
| 69 | UNNUMBERED | product-lab.html body font "system-ui" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 120012-UNNUMBERED-product-lab-c1366-top.png | open /product-lab.html signed out · cream · 1366 px |
| 70 | UNNUMBERED | intake.html does not draw the shared shell header (.cbsh-hdr) the index draws | 4× (cream 1366, dark 1366) | 120023-UNNUMBERED-intake-c1366-top.png | open /intake.html signed out · cream · 1366 px |
| 71 | UNNUMBERED | intake.html has no avatar / Sign in door | 4× (cream 1366, dark 1366) | 120023-UNNUMBERED-intake-c1366-top.png | open /intake.html signed out · cream · 1366 px |
| 72 | UNNUMBERED | intake.html has no Home button / link back to the index | 4× (cream 1366, dark 1366) | 120023-UNNUMBERED-intake-c1366-top.png | open /intake.html signed out · cream · 1366 px |
| 73 | UNNUMBERED | intake.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 120023-UNNUMBERED-intake-c1366-top.png | open /intake.html signed out · cream · 1366 px |
| 74 | UNNUMBERED | cart-design.html does not draw the shared shell header (.cbsh-hdr) the index draws | 4× (cream 1366, dark 1366) | 130046-UNNUMBERED-cart-design-c1366-top.png | open /cart-design.html signed out · cream · 1366 px |
| 75 | UNNUMBERED | cart-design.html has no avatar / Sign in door | 4× (cream 1366, dark 1366) | 130046-UNNUMBERED-cart-design-c1366-top.png | open /cart-design.html signed out · cream · 1366 px |
| 76 | UNNUMBERED | cart-design.html has no Home button / link back to the index | 4× (cream 1366, dark 1366) | 130046-UNNUMBERED-cart-design-c1366-top.png | open /cart-design.html signed out · cream · 1366 px |
| 77 | UNNUMBERED | cart-design.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 130046-UNNUMBERED-cart-design-c1366-top.png | open /cart-design.html signed out · cream · 1366 px |
| 78 | UNNUMBERED | iot-howitworks.html does not draw the shared shell header (.cbsh-hdr) the index draws | 4× (cream 1366, dark 1366) | 130063-UNNUMBERED-iot-howitworks-c1366-top.png | open /iot-howitworks.html signed out · cream · 1366 px |
| 79 | UNNUMBERED | iot-howitworks.html has no avatar / Sign in door | 4× (cream 1366, dark 1366) | 130063-UNNUMBERED-iot-howitworks-c1366-top.png | open /iot-howitworks.html signed out · cream · 1366 px |
| 80 | UNNUMBERED | iot-howitworks.html has no Home button / link back to the index | 4× (cream 1366, dark 1366) | 130063-UNNUMBERED-iot-howitworks-c1366-top.png | open /iot-howitworks.html signed out · cream · 1366 px |
| 81 | UNNUMBERED | iot-howitworks.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 130063-UNNUMBERED-iot-howitworks-c1366-top.png | open /iot-howitworks.html signed out · cream · 1366 px |
| 82 | UNNUMBERED | screen-gallery.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has .top | 4× (cream 1366, dark 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 83 | UNNUMBERED | screen-gallery.html has no avatar / Sign in door | 4× (cream 1366, dark 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 84 | UNNUMBERED | screen-gallery.html has no Home button / link back to the index | 4× (cream 1366, dark 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 85 | UNNUMBERED | screen-gallery.html body font "system-ui" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 86 | UNNUMBERED | combo-lab.html does not draw the shared shell header (.cbsh-hdr) the index draws | 4× (cream 1366, dark 1366) | 140008-UNNUMBERED-combo-lab-c1366-top.png | open /combo-lab.html signed out · cream · 1366 px |
| 87 | UNNUMBERED | sideways scroll on conversion-lab.html: DIV.scroll 695>650 | 4× (cream 1366, dark 1366) | 140021-UNNUMBERED-conversion-lab-c1366-top.png | open /conversion-lab.html signed out · cream · 1366 px |
| 88 | UNNUMBERED | conversion-lab.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has header | 4× (cream 1366, dark 1366) | 140021-UNNUMBERED-conversion-lab-c1366-top.png | open /conversion-lab.html signed out · cream · 1366 px |
| 89 | UNNUMBERED | conversion-lab.html body font "Inter" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 140021-UNNUMBERED-conversion-lab-c1366-top.png | open /conversion-lab.html signed out · cream · 1366 px |
| 90 | UNNUMBERED | lifecycle-test.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has .bar | 4× (cream 1366, dark 1366) | 140038-UNNUMBERED-lifecycle-test-c1366-top.png | open /lifecycle-test.html signed out · cream · 1366 px |
| 91 | UNNUMBERED | lifecycle-test.html has no avatar / Sign in door | 4× (cream 1366, dark 1366) | 140038-UNNUMBERED-lifecycle-test-c1366-top.png | open /lifecycle-test.html signed out · cream · 1366 px |
| 92 | UNNUMBERED | lifecycle-test.html has no Home button / link back to the index | 4× (cream 1366, dark 1366) | 140038-UNNUMBERED-lifecycle-test-c1366-top.png | open /lifecycle-test.html signed out · cream · 1366 px |
| 93 | UNNUMBERED | lifecycle-test.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 140038-UNNUMBERED-lifecycle-test-c1366-top.png | open /lifecycle-test.html signed out · cream · 1366 px |
| 94 | UNNUMBERED | supplier-design.html does not draw the shared shell header (.cbsh-hdr) the index draws | 4× (cream 1366, dark 1366) | 140049-UNNUMBERED-supplier-design-c1366-top.png | open /supplier-design.html signed out · cream · 1366 px |
| 95 | UNNUMBERED | supplier-design.html has no avatar / Sign in door | 4× (cream 1366, dark 1366) | 140049-UNNUMBERED-supplier-design-c1366-top.png | open /supplier-design.html signed out · cream · 1366 px |
| 96 | UNNUMBERED | supplier-design.html has no Home button / link back to the index | 4× (cream 1366, dark 1366) | 140049-UNNUMBERED-supplier-design-c1366-top.png | open /supplier-design.html signed out · cream · 1366 px |
| 97 | UNNUMBERED | supplier-design.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 140049-UNNUMBERED-supplier-design-c1366-top.png | open /supplier-design.html signed out · cream · 1366 px |
| 98 | UNNUMBERED | authority-forms.html has no Home button — Home is only inside the app switcher menu (the index has ⌂ Home in its rail) | 4× (cream 1366, dark 1366) | 150012-UNNUMBERED-authority-forms-c1366-top.png | open /authority-forms.html signed out · cream · 1366 px |
| 99 | UNNUMBERED | authority-forms.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 150012-UNNUMBERED-authority-forms-c1366-top.png | open /authority-forms.html signed out · cream · 1366 px |
| 100 | UNNUMBERED | network-design.html does not draw the shared shell header (.cbsh-hdr) the index draws | 4× (cream 1366, dark 1366) | 150017-UNNUMBERED-network-design-c1366-top.png | open /network-design.html signed out · cream · 1366 px |
| 101 | UNNUMBERED | network-design.html has no avatar / Sign in door | 4× (cream 1366, dark 1366) | 150017-UNNUMBERED-network-design-c1366-top.png | open /network-design.html signed out · cream · 1366 px |
| 102 | UNNUMBERED | network-design.html has no Home button / link back to the index | 4× (cream 1366, dark 1366) | 150017-UNNUMBERED-network-design-c1366-top.png | open /network-design.html signed out · cream · 1366 px |
| 103 | UNNUMBERED | network-design.html body font "-apple-system" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 150017-UNNUMBERED-network-design-c1366-top.png | open /network-design.html signed out · cream · 1366 px |
| 104 | UNNUMBERED | list-lab.html does not draw the shared shell header (.cbsh-hdr) the index draws | 4× (cream 1366, dark 1366) | 150065-UNNUMBERED-list-lab-c1366-top.png | open /list-lab.html signed out · cream · 1366 px |
| 105 | UNNUMBERED | shell-lab.html body font "Times New Roman" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 150144-UNNUMBERED-shell-lab-c1366-top.png | open /shell-lab.html signed out · cream · 1366 px |
| 106 | UNNUMBERED | testing.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has header | 4× (cream 1366, dark 1366) | 150171-UNNUMBERED-testing-c1366-top.png | open /testing.html signed out · cream · 1366 px |
| 107 | UNNUMBERED | testing.html body font "Inter" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 150171-UNNUMBERED-testing-c1366-top.png | open /testing.html signed out · cream · 1366 px |
| 108 | UNNUMBERED | employees.html has no Home button — Home is only inside the app switcher menu (the index has ⌂ Home in its rail) | 4× (cream 1366, dark 1366) | 160004-UNNUMBERED-employees-c1366-top.png | open /employees.html signed out · cream · 1366 px |
| 109 | UNNUMBERED | standards.html does not draw the shared shell header (.cbsh-hdr) the index draws | 4× (cream 1366, dark 1366) | 160012-UNNUMBERED-standards-c1366-top.png | open /standards.html signed out · cream · 1366 px |
| 110 | UNNUMBERED | design-mock.html does not draw the shared shell header (.cbsh-hdr) the index draws — it has .bar | 4× (cream 1366, dark 1366) | 160057-UNNUMBERED-design-mock-c1366-top.png | open /design-mock.html signed out · cream · 1366 px |
| 111 | UNNUMBERED | design-mock.html has no avatar / Sign in door | 4× (cream 1366, dark 1366) | 160057-UNNUMBERED-design-mock-c1366-top.png | open /design-mock.html signed out · cream · 1366 px |
| 112 | UNNUMBERED | design-mock.html has no Home button / link back to the index | 4× (cream 1366, dark 1366) | 160057-UNNUMBERED-design-mock-c1366-top.png | open /design-mock.html signed out · cream · 1366 px |
| 113 | UNNUMBERED | design-mock.html body font "system-ui" ≠ the index's "IBM Plex Sans" | 4× (cream 1366, dark 1366) | 160057-UNNUMBERED-design-mock-c1366-top.png | open /design-mock.html signed out · cream · 1366 px |
| 114 | UNNUMBERED | contrast below AA on network.html (dark), `div.t`: 1.12:1 (need 3) "Sign in above" | 4× (dark 1366) | 210013-UNNUMBERED-network-d1366-top.png | open /network.html signed out · dark · 1366 px |
| 115 | UNNUMBERED | promo.html ignores the chosen theme (Dark saved; the page paints its own colours, no CBAvatar) | 4× (dark 1366, dark 390) | 210032-UNNUMBERED-promo-d1366-top.png | open /promo.html signed out · dark · 1366 px |
| 116 | UNNUMBERED | signin-lab.html ignores the chosen theme (Dark saved; the page paints its own colours, no CBAvatar) | 4× (dark 1366) | 210037-UNNUMBERED-signin-lab-d1366-top.png | open /signin-lab.html signed out · dark · 1366 px |
| 117 | OWN001 | till.html — a window covers the screen on arrival: Counter PIN (every visit, before anything else can be done) | 4× (cream 1366, cream 390, dark 1366, dark 390) | 510001-OWN001-till-c1366-top.png | open /till.html signed in · cream · 1366 px |
| 118 | OWN001 | till.html has no Home button / link back to the index | 4× (cream 1366, cream 390, dark 1366, dark 390) | 510001-OWN001-till-c1366-top.png | open /till.html signed in · cream · 1366 px |
| 119 | OWN001 | controls covered by `hubhead` on till.html (they cannot be brought out from under it): till-modepill, till-who, till-lock, till-day, till-tray-btn +5 | 4× (cream 1366, dark 1366) | 510010-OWN001-till-1-c1366-top.png | open /till.html signed in · cream · 1366 px · section "☰ 1" |
| 120 | OWN001 | controls covered by `tillscrim` on till.html (they cannot be brought out from under it): till-mic, till-chip-all | 4× (cream 1366, dark 1366) | 510010-OWN001-till-1-c1366-top.png | open /till.html signed in · cream · 1366 px · section "☰ 1" |
| 121 | UNNUMBERED | dead click on finance.html: "INTEREST DUE ⇅" — nothing happened | 4× (cream 1366) | 520004-UNNUMBERED-finance-main-op2-c1366.png | open /finance.html signed in · cream · 1366 px · section "main" · sort "INTEREST DUE ⇅" |
| 122 | UNNUMBERED | dead click on finance.html: "LIMIT ⇅" — nothing happened | 4× (cream 1366) | 520005-UNNUMBERED-finance-main-op3-c1366.png | open /finance.html signed in · cream · 1366 px · section "main" · sort "LIMIT ⇅" |
| 123 | UNNUMBERED | dead click on finance.html: "LAST REMINDED" — nothing happened | 4× (cream 1366) | 520006-UNNUMBERED-finance-main-op4-c1366.png | open /finance.html signed in · cream · 1366 px · section "main" · sort "LAST REMINDED" |
| 124 | UNNUMBERED | sideways scroll on accounts.html: NAV.nav scroll 69>67 | 4× (cream 1366, cream 390, dark 1366, dark 390) | 570011-UNNUMBERED-accounts-Ledgers-c1366-top.png | open /accounts.html#ledgers signed in · cream · 1366 px · section "Ledgers" |
| 125 | UNNUMBERED | contrast below AA on know-your-business.html (dark), `div.tab`: 1.25:1 (need 4.5) "Position" · 1.25:1 (need 4.5) "Risk" · 1.25:1 (need 4.5) "Field" +1 | 4× (dark 1366) | 620010-UNNUMBERED-know-your-business-d1366-top.png | open /know-your-business.html signed in · dark · 1366 px |
| 126 | UNNUMBERED | contrast below AA on network-shop.html (cream), `div.msg`: 2.91:1 (need 4.5) "Add" | 3× (cream 1366, cream 390) | 110024-UNNUMBERED-network-shop-c1366-top.png | open /network-shop.html signed out · cream · 1366 px |
| 127 | UNNUMBERED | contrast below AA on network-shop.html (cream), `code`: 2.91:1 (need 4.5) "?bridge=…" | 3× (cream 1366, cream 390) | 110024-UNNUMBERED-network-shop-c1366-top.png | open /network-shop.html signed out · cream · 1366 px |
| 128 | OWN002 | contrast below AA on shop.html (cream), `div.msg`: 2.91:1 (need 4.5) "No shop specified." | 3× (cream 1366, cream 390) | 110025-OWN002-shop-c1366-top.png | open /shop.html signed out · cream · 1366 px |
| 129 | UNNUMBERED | accounts.html has no avatar / Sign in door | 3× (cream 1366, dark 1366) | 120009-UNNUMBERED-accounts-c1366-top.png | open /accounts.html#compare signed out · cream · 1366 px |
| 130 | UNNUMBERED | accounts.html has no Home button / link back to the index | 3× (cream 1366, dark 1366) | 120009-UNNUMBERED-accounts-c1366-top.png | open /accounts.html#compare signed out · cream · 1366 px |
| 131 | UNNUMBERED | a box on promo.html cannot be clicked: "›" — something covers it, or it is never on screen | 3× (cream 1366) | 120028-UNNUMBERED-promo-click02-c1366.png | open /promo.html signed out · cream · 1366 px · click "›" |
| 132 | UNNUMBERED | dead click on list-lab.html: "DATE ⇅" — nothing happened | 3× (cream 1366) | 150088-UNNUMBERED-list-lab-click22-c1366.png | open /list-lab.html signed out · cream · 1366 px · click "DATE ⇅" |
| 133 | UNNUMBERED | dead click on list-lab.html: "AMOUNT ⇅" — nothing happened | 3× (cream 1366) | 150094-UNNUMBERED-list-lab-click28-c1366.png | open /list-lab.html signed out · cream · 1366 px · click "AMOUNT ⇅" |
| 134 | UNNUMBERED | crm.html has no avatar / Sign in door | 3× (cream 1366, dark 1366) | 160001-UNNUMBERED-crm-c1366-top.png | open /crm.html#/chits?tab=orders signed out · cream · 1366 px |
| 135 | UNNUMBERED | crm.html has no Home button / link back to the index | 3× (cream 1366, dark 1366) | 160001-UNNUMBERED-crm-c1366-top.png | open /crm.html#/chits?tab=orders signed out · cream · 1366 px |
| 136 | UNNUMBERED | contrast below AA on network-shop.html (dark), `div.msg`: 2.91:1 (need 4.5) "Add" | 3× (dark 1366, dark 390) | 210002-UNNUMBERED-network-shop-d1366-top.png | open /network-shop.html signed out · dark · 1366 px |
| 137 | UNNUMBERED | contrast below AA on network-shop.html (dark), `code`: 2.91:1 (need 4.5) "?bridge=…" | 3× (dark 1366, dark 390) | 210002-UNNUMBERED-network-shop-d1366-top.png | open /network-shop.html signed out · dark · 1366 px |
| 138 | UNNUMBERED | network-shop.html ignores the chosen theme (Dark saved; the page paints its own colours, no CBAvatar) | 3× (dark 1366, dark 390) | 210002-UNNUMBERED-network-shop-d1366-top.png | open /network-shop.html signed out · dark · 1366 px |
| 139 | OWN002 | contrast below AA on shop.html (dark), `div.msg`: 2.91:1 (need 4.5) "No shop specified." | 3× (dark 1366, dark 390) | 210003-OWN002-shop-d1366-top.png | open /shop.html signed out · dark · 1366 px |
| 140 | UNNUMBERED | embed.html ignores the chosen theme (Dark saved; the page paints its own colours, no CBAvatar) | 3× (dark 1366, dark 390) | 210025-UNNUMBERED-embed-d1366-top.png | open /embed.html signed out · dark · 1366 px |
| 141 | UNNUMBERED | store.html ignores the chosen theme (Dark saved; the page paints its own colours, no CBAvatar) | 3× (dark 1366, dark 390) | 210038-UNNUMBERED-store-d1366-top.png | open /store.html signed out · dark · 1366 px |
| 142 | UNNUMBERED | storefront-design.html ignores the chosen theme (Dark saved; the page paints its own colours, no CBAvatar) | 3× (dark 1366, dark 390) | 210039-UNNUMBERED-storefront-design-d1366-top.png | open /storefront-design.html signed out · dark · 1366 px |
| 143 | OWN001 | controls covered by `setdlg` on till.html (they cannot be brought out from under it): till-mode, till-side-open, till-side-bills, till-side-check, till-side-expense +5 | 3× (cream 1366, cream 390, dark 390) | 510032-OWN001-till-index-c1366-top.png | open /till.html signed in · cream · 1366 px · section "⚙" |
| 144 | UNNUMBERED | dead click on crm.html: "▤ view-grid-rail-chits" — nothing happened | 3× (cream 1366) | 560002-UNNUMBERED-crm-main-op0-c1366.png | open /crm.html#/chits?tab=orders signed in · cream · 1366 px · section "main" · switch a tab/filter "▤ view-grid-rail-chits" |
| 145 | UNNUMBERED | dead click on crm.html: "Whose: Only chits with another party ×" — nothing happened | 3× (cream 1366) | 560004-UNNUMBERED-crm-main-op2-c1366.png | open /crm.html#/chits?tab=orders signed in · cream · 1366 px · section "main" · switch a tab/filter "Whose: Only chits with another party ×" |
| 146 | UNNUMBERED | controls covered by `cbl-rz colrz` on crm.html (they cannot be brought out from under it): cbl-hf-rail | 3× (cream 1366, dark 1366) | 560007-UNNUMBERED-crm-Parties-c1366-top.png | open /crm.html#/parties signed in · cream · 1366 px · section "Parties" |
| 147 | UNNUMBERED | controls covered by `top` on accounts.html (they cannot be brought out from under it): lg-acc-6090 "Bank charges—" | 3× (cream 1366, dark 1366) | 570011-UNNUMBERED-accounts-Ledgers-c1366-top.png | open /accounts.html#ledgers signed in · cream · 1366 px · section "Ledgers" |
| 148 | UNNUMBERED | dead click on accounts.html: "Show" — nothing happened | 3× (cream 1366) | 570017-UNNUMBERED-accounts-Trial-balance-op3-c1366.png | open /accounts.html#tb signed in · cream · 1366 px · section "Trial balance" · open a popup / form "Show" |
| 149 | UNNUMBERED | dead click on know-your-business.html: "Yourself" — nothing happened | 3× (cream 1366) | 580003-UNNUMBERED-know-your-business-main-op1-c1366.png | open /know-your-business.html signed in · cream · 1366 px · section "main" · switch a tab/filter "Yourself" |
| 150 | UNNUMBERED | contrast below AA on network.html (dark), `div`: 1.32:1 (need 4.5) "When a brand adds this shop " | 3× (dark 1366) | 610019-UNNUMBERED-network-d1366-top.png | open /network.html signed in · dark · 1366 px |

… 225 more in tour.json.

## Cosmetic (139)

| # | code | finding | seen | screenshot | reproduce |
|---|---|---|---|---|---|
| 1 | UNNUMBERED | copy over the text budget on index.html: 106 chars / 3 sentences: "Partly = some of it works today. Planned = not bui…" | 28× (cream 1366, cream 390, dark 1366, dark 390) | 110001-UNNUMBERED-index-signin-1-open-c1366-top.png | open / signed out · cream · 1366 px |
| 2 | UNNUMBERED | clipped text on standards.html: "Australia · Global" | 20× (cream 1366, dark 1366) | 160012-UNNUMBERED-standards-c1366-top.png | open /standards.html signed out · cream · 1366 px |
| 3 | UNNUMBERED | clipped text on standards.html: "India · Australia · UAE" | 16× (cream 1366, dark 1366) | 160012-UNNUMBERED-standards-c1366-top.png | open /standards.html signed out · cream · 1366 px |
| 4 | UNNUMBERED | settings.html body text 15px ≠ the index's 16px | 14× (cream 1366, cream 390, dark 1366, dark 390) | 140040-UNNUMBERED-settings-c1366-top.png | open /settings.html signed out · cream · 1366 px |
| 5 | UNNUMBERED | copy over the text budget on know-your-business.html: 170 chars / 2 sentences: "What CB can tell you from data you’ve already give…" | 13× (cream 1366, cream 390, dark 1366, dark 390) | 140003-UNNUMBERED-know-your-business-c1366-top.png | open /know-your-business.html signed out · cream · 1366 px |
| 6 | UNNUMBERED | clipped text on screen-gallery.html: "Masala Dosa" | 11× (cream 1366, dark 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 7 | UNNUMBERED | clipped text on screen-gallery.html: "Ven Pongal" | 11× (cream 1366, dark 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 8 | UNNUMBERED | clipped text on standards.html: "India · Global" | 11× (cream 1366, dark 1366) | 160012-UNNUMBERED-standards-c1366-top.png | open /standards.html signed out · cream · 1366 px |
| 9 | OWN002 | shop.html tab title "Shop — Chit & Bridge" does not name ChitBridge | 10× (cream 1366, cream 390, dark 1366, dark 390) | 110001-OWN002-shop-c1366-top.png | open /shop.html?s=CBFB5A4VH2 signed out · cream · 1366 px |
| 10 | UNNUMBERED | contrast below AA on testing.html (cream), `span.sub`: 3.81:1 (need 4.5) "· cases, results and the com" | 9× (cream 1366) | 150171-UNNUMBERED-testing-c1366-top.png | open /testing.html signed out · cream · 1366 px |
| 11 | UNNUMBERED | copy over the text budget on combo-lab.html: 162 chars / 2 sentences: "A set of choices before something goes on the bill…" | 8× (cream 1366, dark 1366) | 140008-UNNUMBERED-combo-lab-c1366-top.png | open /combo-lab.html signed out · cream · 1366 px |
| 12 | UNNUMBERED | copy over the text budget on country-lab.html: 170 chars / 1 sentences: "why these countriesThe registered packs first (the…" | 8× (cream 1366, dark 1366) | 150027-UNNUMBERED-country-lab-c1366-top.png | open /country-lab.html signed out · cream · 1366 px |
| 13 | UNNUMBERED | copy over the text budget on country-lab.html: 403 chars / 3 sentences: "whyConverting money is the Conversion lab's job, w…" | 8× (cream 1366, dark 1366) | 150027-UNNUMBERED-country-lab-c1366-top.png | open /country-lab.html signed out · cream · 1366 px |
| 14 | UNNUMBERED | copy over the text budget on country-lab.html: 190 chars / 1 sentences: "GST-free: no GST is charged on this line, and the …" | 8× (cream 1366, dark 1366) | 150027-UNNUMBERED-country-lab-c1366-top.png | open /country-lab.html signed out · cream · 1366 px |
| 15 | UNNUMBERED | copy over the text budget on country-lab.html: 175 chars / 1 sentences: "Input-taxed: no GST is charged on this line, and n…" | 8× (cream 1366, dark 1366) | 150027-UNNUMBERED-country-lab-c1366-top.png | open /country-lab.html signed out · cream · 1366 px |
| 16 | UNNUMBERED | copy over the text budget on country-lab.html: 174 chars / 2 sentences: "why a row says "none in the pack"That is the pack'…" | 8× (cream 1366, dark 1366) | 150027-UNNUMBERED-country-lab-c1366-top.png | open /country-lab.html signed out · cream · 1366 px |
| 17 | UNNUMBERED | accounts.html body text 15px ≠ the index's 16px | 7× (cream 1366, dark 1366, cream 390, dark 390) | 120009-UNNUMBERED-accounts-c1366-top.png | open /accounts.html#compare signed out · cream · 1366 px |
| 18 | UNNUMBERED | contrast below AA on know-your-business.html (cream), `div.sub`: 4.43:1 (need 4.5) "What CB can tell you from da" | 7× (cream 1366, cream 390) | 140003-UNNUMBERED-know-your-business-c1366-top.png | open /know-your-business.html signed out · cream · 1366 px |
| 19 | UNNUMBERED | crm.html body text 15px ≠ the index's 16px | 7× (cream 1366, dark 1366, cream 390, dark 390) | 160001-UNNUMBERED-crm-c1366-top.png | open /crm.html#/chits?tab=orders signed out · cream · 1366 px |
| 20 | UNNUMBERED | network-shop.html tab title "Network shop — Chit & Bridge" does not name ChitBridge | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110024-UNNUMBERED-network-shop-c1366-top.png | open /network-shop.html signed out · cream · 1366 px |
| 21 | UNNUMBERED | embed.html tab title "Catalogue" does not name ChitBridge | 6× (cream 1366, cream 390, dark 1366, dark 390) | 110065-UNNUMBERED-embed-c1366-top.png | open /embed.html signed out · cream · 1366 px |
| 22 | UNNUMBERED | finance.html body text 15px ≠ the index's 16px | 6× (cream 1366, dark 1366, cream 390, dark 390) | 120001-UNNUMBERED-finance-c1366-top.png | open /finance.html signed out · cream · 1366 px |
| 23 | UNNUMBERED | promo.html body text 15px ≠ the index's 16px | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 24 | UNNUMBERED | promo.html tab title "Shop screen" does not name ChitBridge | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 25 | UNNUMBERED | store.html tab title "Store" does not name ChitBridge | 6× (cream 1366, cream 390, dark 1366, dark 390) | 120037-UNNUMBERED-store-c1366-top.png | open /store.html signed out · cream · 1366 px |
| 26 | OWN001 | till.html tab title "Counter" does not name ChitBridge | 6× (cream 1366, dark 1366, cream 390, dark 390) | 130001-OWN001-till-c1366-top.png | open /till.html signed out · cream · 1366 px |
| 27 | UNNUMBERED | contrast below AA on screen-gallery.html (cream), `span.sk-price`: 3.72:1 (need 4.5) "₹140.00" | 6× (cream 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 28 | UNNUMBERED | contrast below AA on screen-gallery.html (cream), `span.sk-badge`: 3.41:1 (need 4.5) "VP" | 6× (cream 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 29 | UNNUMBERED | storefront-design.html body text 15px ≠ the index's 16px | 6× (cream 1366, cream 390, dark 1366, dark 390) | 130118-UNNUMBERED-storefront-design-c1366-top.png | open /storefront-design.html signed out · cream · 1366 px |
| 30 | UNNUMBERED | storefront-design.html tab title "Storefront — design mock" does not name ChitBridge | 6× (cream 1366, cream 390, dark 1366, dark 390) | 130118-UNNUMBERED-storefront-design-c1366-top.png | open /storefront-design.html signed out · cream · 1366 px |
| 31 | UNNUMBERED | know-your-business.html tab title "Chit & Bridge — Know your business" does not name ChitBridge | 6× (cream 1366, cream 390, dark 1366, dark 390) | 140003-UNNUMBERED-know-your-business-c1366-top.png | open /know-your-business.html signed out · cream · 1366 px |
| 32 | UNNUMBERED | tasks.html body text 15px ≠ the index's 16px | 6× (cream 1366, dark 1366, cream 390, dark 390) | 150001-UNNUMBERED-tasks-c1366-top.png | open /tasks.html signed out · cream · 1366 px |
| 33 | UNNUMBERED | tasks.html tab title "Tasks & Orders" does not name ChitBridge | 6× (cream 1366, dark 1366, cream 390, dark 390) | 150001-UNNUMBERED-tasks-c1366-top.png | open /tasks.html signed out · cream · 1366 px |
| 34 | UNNUMBERED | clipped text on crm.html: "Not connected" | 6× (cream 1366, dark 1366) | 560007-UNNUMBERED-crm-Parties-c1366-top.png | open /crm.html#/parties signed in · cream · 1366 px · section "Parties" |
| 35 | UNNUMBERED | copy over the text budget on combo-lab.html: 198 chars / 2 sentences: "Cost and margin are yours alone by default. To let…" | 6× (cream 1366, dark 1366) | 560074-UNNUMBERED-combo-lab-c1366-top.png | open /combo-lab.html signed in · cream · 1366 px |
| 36 | UNNUMBERED | clipped text on tasks.html: "Simulated Stores" | 6× (cream 390, dark 390) | 710013-UNNUMBERED-tasks-c390-top.png | open /tasks.html signed in · cream · 390 px |
| 37 | UNNUMBERED | offer-lab-next.html body text 15px ≠ the index's 16px | 5× (cream 1366, dark 1366) | 130031-UNNUMBERED-offer-lab-next-c1366-top.png | open /offer-lab-next.html signed out · cream · 1366 px |
| 38 | UNNUMBERED | offer-lab-next.html tab title "Offer Lab" does not name ChitBridge | 5× (cream 1366, dark 1366) | 130031-UNNUMBERED-offer-lab-next-c1366-top.png | open /offer-lab-next.html signed out · cream · 1366 px |
| 39 | UNNUMBERED | contrast below AA on screen-gallery.html (dark), `span.sk-price`: 3.72:1 (need 4.5) "₹140.00" | 5× (dark 1366) | 210033-UNNUMBERED-screen-gallery-d1366-top.png | open /screen-gallery.html signed out · dark · 1366 px |
| 40 | UNNUMBERED | contrast below AA on screen-gallery.html (dark), `span.sk-badge`: 3.41:1 (need 4.5) "VP" | 5× (dark 1366) | 210033-UNNUMBERED-screen-gallery-d1366-top.png | open /screen-gallery.html signed out · dark · 1366 px |
| 41 | UNNUMBERED | contrast below AA on testing.html (dark), `button.on`: 3.12:1 (need 4.5) "Cases" | 5× (dark 1366) | 210041-UNNUMBERED-testing-d1366-top.png | open /testing.html signed out · dark · 1366 px |
| 42 | UNNUMBERED | contrast below AA on testing.html (dark), `button.btn`: 3.12:1 (need 4.5) "Load cases" · 3.12:1 (need 4.5) "Post a run" | 5× (dark 1366) | 210041-UNNUMBERED-testing-d1366-top.png | open /testing.html signed out · dark · 1366 px |
| 43 | UNNUMBERED | contrast below AA on design-mock.html (cream), `span`: 4.26:1 (need 4.5) "N/E" | 5× (cream 1366) | 550095-UNNUMBERED-design-mock-Territory-N-E-c1366-top.png | open /design-mock.html signed in · cream · 1366 px · section "🗺️ Territory N/E" |
| 44 | UNNUMBERED | contrast below AA on know-your-business.html (cream), `div.tab`: 4.08:1 (need 4.5) "Position" · 4.08:1 (need 4.5) "Risk" · 4.08:1 (need 4.5) "Field" | 5× (cream 1366) | 580001-UNNUMBERED-know-your-business-c1366-top.png | open /know-your-business.html signed in · cream · 1366 px |
| 45 | UNNUMBERED | network.html body text 15px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 110046-UNNUMBERED-network-c1366-top.png | open /network.html signed out · cream · 1366 px |
| 46 | UNNUMBERED | network.html tab title "Network" does not name ChitBridge | 4× (cream 1366, dark 1366) | 110046-UNNUMBERED-network-c1366-top.png | open /network.html signed out · cream · 1366 px |
| 47 | UNNUMBERED | signin-lab.html body text 15px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 110081-UNNUMBERED-signin-lab-c1366-top.png | open /signin-lab.html signed out · cream · 1366 px |
| 48 | UNNUMBERED | signin-lab.html tab title "Sign-in Lab" does not name ChitBridge | 4× (cream 1366, dark 1366) | 110081-UNNUMBERED-signin-lab-c1366-top.png | open /signin-lab.html signed out · cream · 1366 px |
| 49 | UNNUMBERED | product-lab.html body text 15px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 120012-UNNUMBERED-product-lab-c1366-top.png | open /product-lab.html signed out · cream · 1366 px |
| 50 | UNNUMBERED | product-lab.html tab title "Product Lab" does not name ChitBridge | 4× (cream 1366, dark 1366) | 120012-UNNUMBERED-product-lab-c1366-top.png | open /product-lab.html signed out · cream · 1366 px |
| 51 | UNNUMBERED | copy over the text budget on intake.html: 176 chars / 2 sentences: "Bring an inbound message (WhatsApp · email · web) …" | 4× (cream 1366, dark 1366) | 120023-UNNUMBERED-intake-c1366-top.png | open /intake.html signed out · cream · 1366 px |
| 52 | UNNUMBERED | intake.html tab title "Chit & Bridge — Intake inbox" does not name ChitBridge | 4× (cream 1366, dark 1366) | 120023-UNNUMBERED-intake-c1366-top.png | open /intake.html signed out · cream · 1366 px |
| 53 | UNNUMBERED | contrast below AA on promo.html (cream), `button.on`: 4.32:1 (need 4.5) "⏸ Pause" | 4× (cream 1366, cream 390) | 120025-UNNUMBERED-promo-c1366-top.png | open /promo.html signed out · cream · 1366 px |
| 54 | UNNUMBERED | cart-design.html body text 15px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 130046-UNNUMBERED-cart-design-c1366-top.png | open /cart-design.html signed out · cream · 1366 px |
| 55 | UNNUMBERED | cart-design.html tab title "Compose — design mock" does not name ChitBridge | 4× (cream 1366, dark 1366) | 130046-UNNUMBERED-cart-design-c1366-top.png | open /cart-design.html signed out · cream · 1366 px |
| 56 | UNNUMBERED | iot-howitworks.html tab title "IoT on Chit & Bridge — how it works" does not name ChitBridge | 4× (cream 1366, dark 1366) | 130063-UNNUMBERED-iot-howitworks-c1366-top.png | open /iot-howitworks.html signed out · cream · 1366 px |
| 57 | UNNUMBERED | screen-gallery.html body text 15px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 58 | UNNUMBERED | screen-gallery.html tab title "Screen Library" does not name ChitBridge | 4× (cream 1366, dark 1366) | 130064-UNNUMBERED-screen-gallery-c1366-top.png | open /screen-gallery.html signed out · cream · 1366 px |
| 59 | UNNUMBERED | contrast below AA on combo-lab.html (cream), `button`: 3.76:1 (need 4.5) "Combos" | 4× (cream 1366) | 140008-UNNUMBERED-combo-lab-c1366-top.png | open /combo-lab.html signed out · cream · 1366 px |
| 60 | UNNUMBERED | contrast below AA on combo-lab.html (cream), `span.say`: 3.76:1 (need 4.5) "A choice before it goes on t" | 4× (cream 1366) | 140008-UNNUMBERED-combo-lab-c1366-top.png | open /combo-lab.html signed out · cream · 1366 px |
| 61 | UNNUMBERED | combo-lab.html body text 15px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 140008-UNNUMBERED-combo-lab-c1366-top.png | open /combo-lab.html signed out · cream · 1366 px |
| 62 | UNNUMBERED | combo-lab.html tab title "Combo Lab" does not name ChitBridge | 4× (cream 1366, dark 1366) | 140008-UNNUMBERED-combo-lab-c1366-top.png | open /combo-lab.html signed out · cream · 1366 px |
| 63 | UNNUMBERED | copy over the text budget on conversion-lab.html: 176 chars / 2 sentences: "A quantity and a market price per unit. ⚠️ The eng…" | 4× (cream 1366, dark 1366) | 140021-UNNUMBERED-conversion-lab-c1366-top.png | open /conversion-lab.html signed out · cream · 1366 px |
| 64 | UNNUMBERED | copy over the text budget on conversion-lab.html: 228 chars / 2 sentences: "⚠️ There is no price feed behind this page, on pur…" | 4× (cream 1366, dark 1366) | 140021-UNNUMBERED-conversion-lab-c1366-top.png | open /conversion-lab.html signed out · cream · 1366 px |
| 65 | UNNUMBERED | copy over the text budget on conversion-lab.html: 202 chars / 2 sentences: "Every line of this comes back from the engine, not…" | 4× (cream 1366, dark 1366) | 140021-UNNUMBERED-conversion-lab-c1366-top.png | open /conversion-lab.html signed out · cream · 1366 px |
| 66 | UNNUMBERED | conversion-lab.html body text 14px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 140021-UNNUMBERED-conversion-lab-c1366-top.png | open /conversion-lab.html signed out · cream · 1366 px |
| 67 | UNNUMBERED | conversion-lab.html tab title "Conversion lab · Chit & Bridge" does not name ChitBridge | 4× (cream 1366, dark 1366) | 140021-UNNUMBERED-conversion-lab-c1366-top.png | open /conversion-lab.html signed out · cream · 1366 px |
| 68 | UNNUMBERED | copy over the text budget on lifecycle-test.html: 177 chars / 2 sentences: "Runs the full connector→device→exception→folder li…" | 4× (cream 1366, dark 1366) | 140038-UNNUMBERED-lifecycle-test-c1366-top.png | open /lifecycle-test.html signed out · cream · 1366 px |
| 69 | UNNUMBERED | lifecycle-test.html tab title "IoT Lifecycle — live verification" does not name ChitBridge | 4× (cream 1366, dark 1366) | 140038-UNNUMBERED-lifecycle-test-c1366-top.png | open /lifecycle-test.html signed out · cream · 1366 px |
| 70 | UNNUMBERED | clipped text on supplier-design.html: "Model Yard (all 6 order models)" | 4× (cream 1366, dark 1366) | 140049-UNNUMBERED-supplier-design-c1366-top.png | open /supplier-design.html signed out · cream · 1366 px |
| 71 | UNNUMBERED | supplier-design.html body text 15px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 140049-UNNUMBERED-supplier-design-c1366-top.png | open /supplier-design.html signed out · cream · 1366 px |
| 72 | UNNUMBERED | supplier-design.html tab title "Suppliers — design mock" does not name ChitBridge | 4× (cream 1366, dark 1366) | 140049-UNNUMBERED-supplier-design-c1366-top.png | open /supplier-design.html signed out · cream · 1366 px |
| 73 | UNNUMBERED | copy over the text budget on authority-forms.html: 210 chars / 3 sentences: "Fill a submission-ready form from data CB already …" | 4× (cream 1366, dark 1366) | 150012-UNNUMBERED-authority-forms-c1366-top.png | open /authority-forms.html signed out · cream · 1366 px |
| 74 | UNNUMBERED | authority-forms.html tab title "Chit & Bridge — Authority forms" does not name ChitBridge | 4× (cream 1366, dark 1366) | 150012-UNNUMBERED-authority-forms-c1366-top.png | open /authority-forms.html signed out · cream · 1366 px |
| 75 | UNNUMBERED | network-design.html body text 15px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 150017-UNNUMBERED-network-design-c1366-top.png | open /network-design.html signed out · cream · 1366 px |
| 76 | UNNUMBERED | network-design.html tab title "Network Lab" does not name ChitBridge | 4× (cream 1366, dark 1366) | 150017-UNNUMBERED-network-design-c1366-top.png | open /network-design.html signed out · cream · 1366 px |
| 77 | UNNUMBERED | country-lab.html body text 14px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 150027-UNNUMBERED-country-lab-c1366-top.png | open /country-lab.html signed out · cream · 1366 px |
| 78 | UNNUMBERED | country-lab.html tab title "Country lab · Chit & Bridge" does not name ChitBridge | 4× (cream 1366, dark 1366) | 150027-UNNUMBERED-country-lab-c1366-top.png | open /country-lab.html signed out · cream · 1366 px |
| 79 | UNNUMBERED | list-lab.html body text 15px ≠ the index's 16px | 4× (cream 1366, dark 1366) | 150065-UNNUMBERED-list-lab-c1366-top.png | open /list-lab.html signed out · cream · 1366 px |
| 80 | UNNUMBERED | list-lab.html tab title "List Lab" does not name ChitBridge | 4× (cream 1366, dark 1366) | 150065-UNNUMBERED-list-lab-c1366-top.png | open /list-lab.html signed out · cream · 1366 px |

… 59 more in tour.json.

## Known local-stack effects (not ranked)

- the counter asks the shop-PC program's /api/state when it is served over http (public/till.html:6490 skips it on https) — a local-stack effect — 25×

## Where the tour could not reach (not ranked — a tab it could not press, a page that would not load)

- UNNUMBERED · promo.html (b-cream-1366-p-promo): tab "copy": locator.click: Timeout 3000ms exceeded.
- UNNUMBERED · standards.html (b-cream-1366-s8): tab "4": locator.click: Timeout 3000ms exceeded.
- UNNUMBERED · standards.html (b-cream-1366-s8): tab "Buying": locator.click: Timeout 3000ms exceeded.
- UNNUMBERED · standards.html (b-cream-1366-s8): tab "2": locator.click: Timeout 3000ms exceeded.
- UNNUMBERED · standards.html (b-cream-1366-s8): tab "Money & GST": locator.click: Timeout 3000ms exceeded.
- UNNUMBERED · promo.html (b-dark-1366-s1): tab "copy" could not be pressed: locator.click: Timeout 3000ms exceeded.

## Empty-state wording across pages

- "No shop specified" — shop.html
- "No drafts waiting" — index.html, shell-lab.html
- "No counter open" — index.html, shell-lab.html
- "No open orders" — index.html, shell-lab.html
- "Nothing waiting" — index.html, shell-lab.html
- "No saved sets yet" — index.html, shell-lab.html
- "No catalogue specified. Add ?bridge=YOUR_BRIDGE_ID" — embed.html
- "no prices yet" — till.html
- "Nothing on this bill yet" — till.html
- "no price" — cart-design.html
- "Not yet: written at register" — country-lab.html
- "Nothing else moves: nothing is recorded yet" — country-lab.html
- "not yet verified by an accountant" — country-lab.html
- "No accounts software? A spreadsheet works the same way" — standards.html
- "No tracking or targeted offers aimed at children" — standards.html
- "nothing" — till.html
- "Nothing counted yet. Choose the order above, or just scan what arrived" — till.html
- "nothing taken yet" — till.html
- "Nothing to send" — till.html
- "No bills yet today" — till.html
- "no group chosen" — till.html
- "No recent orders yet. The form is filled from your own data" — authority-forms.html
- "Nothing here yet. Add it, then fill in the legal name, address, city, state and PIN" — settings.html
- "No changes yet" — finance.html
- "Nothing due todayRun what is due" — finance.html
- "No repeat supply yetOpen a sent bill and press Repeat this…" — finance.html
- "No repeat supply yet" — finance.html
- "No one added yet" — employees.html
- "No offers from your network yet" — network.html
- "No design yetDraw a network in the builder, then check it here" — network.html

## Inventory (mark the screen inventory)

| code | name | page | visited | issues |
|---|---|---|---|---|
| OWN001 | Counter | till.html | ✓ | 34 |
| OWN002 | Storefront | shop.html | ✓ | 9 |
| UNNUMBERED | CB Accounts | accounts.html | ✓ | 34 |
| UNNUMBERED | 🗎 Authority forms | authority-forms.html | ✓ | 12 |
| UNNUMBERED | Compose — design mock | cart-design.html | ✓ | 14 |
| UNNUMBERED | Combo Lab | combo-lab.html | ✓ | 8 |
| UNNUMBERED | Conversion lab | conversion-lab.html | ✓ | 11 |
| UNNUMBERED | Country lab | country-lab.html | ✓ | 17 |
| UNNUMBERED | CB CRM | crm.html | ✓ | 20 |
| UNNUMBERED | India OWNED | design-mock.html | ✓ | 19 |
| UNNUMBERED | Catalogue | embed.html | ✓ | 6 |
| UNNUMBERED | Employees | employees.html | ✓ | 8 |
| UNNUMBERED | CB Finance | finance.html | ✓ | 26 |
| UNNUMBERED | ChitBridge | index.html | ✓ | 7 |
| UNNUMBERED | 📥 Intake inbox | intake.html | ✓ | 9 |
| UNNUMBERED | Put a device on the rail in one drop | iot-howitworks.html | ✓ | 14 |
| UNNUMBERED | 📊 Know your business | know-your-business.html | ✓ | 21 |
| UNNUMBERED | 🛰️ IoT Lifecycle — live verification | lifecycle-test.html | ✓ | 10 |
| UNNUMBERED | Day book | list-lab.html | ✓ | 21 |
| UNNUMBERED | Network Lab | network-design.html | ✓ | 9 |
| UNNUMBERED | Network shop — Chit & Bridge | network-shop.html | ✓ | 10 |
| UNNUMBERED | Network | network.html | ✓ | 12 |
| UNNUMBERED | Offer Lab | offer-lab-next.html | ✓ | 8 |
| UNNUMBERED | Product Lab | product-lab.html | ✓ | 10 |
| UNNUMBERED | Shop screen | promo.html | ✓ | 21 |
| UNNUMBERED | Screen library | screen-gallery.html | ✓ | 27 |
| UNNUMBERED | CB Settings | settings.html | ✓ | 13 |
| UNNUMBERED | Shell Lab · ChitBridge | shell-lab.html | ✓ | 4 |
| UNNUMBERED | Sign-in Lab | signin-lab.html | ✓ | 14 |
| UNNUMBERED | Standards | standards.html | ✓ | 22 |
| UNNUMBERED | Store | store.html | ✓ | 6 |
| UNNUMBERED | Storefront — design mock | storefront-design.html | ✓ | 12 |
| UNNUMBERED | Suppliers — design mock | supplier-design.html | ✓ | 8 |
| UNNUMBERED | Tasks & Orders | tasks.html | ✓ | 19 |
| UNNUMBERED | Test Report | testing.html | ✓ | 18 |
| ACC001 | Account › Profile | — | ✗ the workshop (app.html) — not on the tour | 0 |
| ACC002 | Account › Settings | — | ✗ the workshop (app.html) — not on the tour | 0 |
| ACC003 | Account › Language | — | ✗ the workshop (app.html) — not on the tour | 0 |
| ACC004 | Account › Appearance | — | ✗ the workshop (app.html) — not on the tour | 0 |
| ACC005 | Account › Sign out | — | ✗ the workshop (app.html) — not on the tour | 0 |
| APP001 | The app itself › app.html | — | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS001 | Business › Customers | app.html#customers | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS002 | Business › Suppliers | app.html#suppliers | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS003 | Business › Match | app.html#match | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS004 | Business › Network | app.html#network | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS005 | Business › Co-assists | app.html#coassists | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS006 | Business › Connector cockpit (ERP) | app.html#connector-erp | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS007 | Business › Connector cockpit (IoT) | app.html#connector-iot | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS008 | Business › Co-assist cockpit | app.html#coassist-actor | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS009 | Business › Supplier detail | app.html#supplier-detail | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS010 | Business › Customer detail | app.html#customer-detail | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS011 | Business › Find a product | app.html#supplier-find | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS012 | Business › Required certificates | app.html#supplier-certs | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS013 | Business › Platform | app.html#platform | ✗ the workshop (app.html) — not on the tour | 0 |
| BUS014 | Business › Ledger | app.html#ledger | ✗ the workshop (app.html) — not on the tour | 0 |
| CAT001 | Catalogue › Catalogue | app.html#catalogue | ✗ the workshop (app.html) — not on the tour | 0 |
| CAT002 | Catalogue › Record a sale | app.html#selfbill | ✗ the workshop (app.html) — not on the tour | 0 |
| CAT003 | Catalogue › Categories | app.html#categories | ✗ the workshop (app.html) — not on the tour | 0 |
| CAT004 | Catalogue › Catalogue setup | app.html#catsetup | ✗ the workshop (app.html) — not on the tour | 0 |
| CAT005 | Catalogue › Product detail | app.html#catalogue-product | ✗ the workshop (app.html) — not on the tour | 0 |
| CTR001 | Counter › Counter | app.html#counter | ✗ the workshop (app.html) — not on the tour | 0 |
| DTL001 | Detail › Chit detail | app.html#chit-detail | ✗ the workshop (app.html) — not on the tour | 0 |
| DTL006 | Detail › Chit detail (design 2) | app.html#chit2-detail | ✗ the workshop (app.html) — not on the tour | 0 |
| DTL007 | Detail › Chit input | app.html#chit-input | ✗ the workshop (app.html) — not on the tour | 0 |
| INS001 | Insight › MIS | app.html#mis | ✗ the workshop (app.html) — not on the tour | 0 |
| INS003 | Insight › Traceability | app.html#traceability | ✗ the workshop (app.html) — not on the tour | 0 |
| INS004 | Insight › Trade ready | app.html#readiness | ✗ the workshop (app.html) — not on the tour | 0 |
| MSG001 | Message › Chit messages | app.html#chit-messages | ✗ the workshop (app.html) — not on the tour | 0 |
| PNL001 | Panel › Assistant | — | ✗ the workshop (app.html) — not on the tour | 0 |
| PNL002 | Panel › Floating cart | — | ✗ the workshop (app.html) — not on the tour | 0 |
| PNL003 | Panel › The register (CMDB) | — | ✗ the workshop (app.html) — not on the tour | 0 |
| PNL004 | Panel › Test lab | — | ✗ the workshop (app.html) — not on the tour | 0 |
| PNL005 | Panel › Line card | — | ✗ the workshop (app.html) — not on the tour | 0 |
| PNL007 | Panel › Test cases for this screen | — | ✗ the workshop (app.html) — not on the tour | 0 |
| RAL001 | Rail › Compose | app.html#compose | ✗ the workshop (app.html) — not on the tour | 0 |
| RAL002 | Rail › Task | app.html#task | ✗ the workshop (app.html) — not on the tour | 0 |
| RAL003 | Rail › Order | app.html#order | ✗ the workshop (app.html) — not on the tour | 0 |
| RAL004 | Rail › Drafts | app.html#drafts | ✗ the workshop (app.html) — not on the tour | 0 |
| RAL005 | Rail › Archive | app.html#archive | ✗ the workshop (app.html) — not on the tour | 0 |
| RAL006 | Rail › Trash | app.html#trash | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR001 | Inside a screen › Adopt | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR002 | Inside a screen › Connector | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR003 | Inside a screen › Definitions | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR004 | Inside a screen › Folders | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR005 | Inside a screen › Iddocs | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR006 | Inside a screen › Legend | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR007 | Inside a screen › Register | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR008 | Inside a screen › Service | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR009 | Inside a screen › Supplies | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR010 | Inside a screen › Testing | — | ✗ the workshop (app.html) — not on the tour | 0 |
| SCR011 | Inside a screen › Cmdb | — | ✗ the workshop (app.html) — not on the tour | 0 |
| UNNUMBERED | offer-lab.html | offer-lab.html | ✗ | 2 |
| WRK001 | Work › Messages | app.html#messages | ✗ the workshop (app.html) — not on the tour | 0 |
| WRK002 | Work › Everyone's work | app.html#worklist | ✗ the workshop (app.html) — not on the tour | 0 |
| WRK003 | Work › Intake | app.html#intake | ✗ the workshop (app.html) — not on the tour | 0 |
| WRK004 | Work › Disputes | app.html#disputes | ✗ the workshop (app.html) — not on the tour | 0 |

## Boxes per page (Part A) — label → result

- **shop.html** — 3 changed · 19 skipped
- **index.html** — 9 changed · 1 nothing happened · 3 skipped · 18 navigated · dead: "⌂ Home"
- **network.html** — 4 nothing happened · 3 changed · 2 skipped · dead: "My network", "Offers", "Design", "Sign in"
- **offer-lab.html** — 2 navigated · 8 changed · 1 opened a new tab · 2 skipped · 1 nothing happened · dead: "1 Settings"
- **signin-lab.html** — 8 nothing happened · 14 changed · 2 skipped · dead: "Owner", "Mobile", "First time", "Hidden (as in apps)", "Not named (web)", "Light"
- **finance.html** — 5 navigated · 1 changed · 1 skipped
- **accounts.html** — 1 changed · 1 skipped
- **product-lab.html** — 2 navigated
- **intake.html** — 1 skipped
- **promo.html** — 7 cannot be clicked · 3 skipped · 1 changed
- **till.html** — 19 changed · 6 skipped · 1 navigated
- **offer-lab-next.html** — 2 navigated · 8 changed · 1 opened a new tab · 2 skipped · 1 nothing happened · dead: "1 Settings"
- **cart-design.html** — 3 nothing happened · 2 changed · 11 skipped · dead: "×", "+", "✨"
- **screen-gallery.html** — 9 nothing happened · 29 changed · 15 skipped · dead: "Light cream light", "Masala Dosa ₹70.00 / pla", "Filter Coffee ₹25.00 / c", "Veg Biryani ₹140.00 / pl", "Curd Rice ₹70.00 / plate", "Ven Pongal ₹55.00 / plat"
- **storefront-design.html** — 1 nothing happened · dead: "Back to the shop"
- **know-your-business.html** — 1 changed · 1 nothing happened · 2 skipped · dead: "Sign in"
- **combo-lab.html** — 3 navigated · 6 changed · 3 skipped
- **conversion-lab.html** — 2 opened a new tab · 2 navigated · 5 changed · 1 nothing happened · 6 skipped · dead: "examples"
- **lifecycle-test.html** — 1 changed
- **settings.html** — 2 navigated · 3 changed · 1 nothing happened · 2 skipped · dead: "Sign in"
- **supplier-design.html** — 4 changed
- **tasks.html** — 5 nothing happened · 3 changed · 2 skipped · dead: "Orders in", "Orders out", "Tasks", "Done", "Sign in"
- **authority-forms.html** — 1 changed · 1 nothing happened · 2 skipped · dead: "Sign in"
- **network-design.html** — 8 changed · 1 skipped
- **country-lab.html** — 1 nothing happened · 13 changed · 1 navigated · 3 opened a new tab · 19 skipped · dead: "Side by side"
- **list-lab.html** — 14 nothing happened · 15 changed · 48 skipped · 1 navigated · dead: "Day book", "Rows", "Light", "Dark", "Day", "▤"
- **shell-lab.html** — 19 navigated · 1 nothing happened · 5 changed · 1 skipped · dead: "⌂ Home"
- **testing.html** — 1 navigated · 7 changed · 2 nothing happened · 4 skipped · dead: "A−", "A+"
- **crm.html** — 1 changed · 1 skipped
- **employees.html** — 2 nothing happened · 3 changed · 2 skipped · dead: "People", "Sign in"
- **standards.html** — 32 changed · 4 skipped · 5 nothing happened · 3 navigated · dead: "All", "Area", "KIND ⇅", "Resize Kind column (arro", "APPLIES IN ⇅"
- **design-mock.html** — 16 changed · 2 skipped · 3 nothing happened · dead: "└ IndiaPublic South Asia", "🗂️ Catalogue", "● Convert from the netwo"

## Seen by eye on the shots (VTOUR reviewer, 14 Oct) — what the probes cannot judge

| # | rank | code · page | what | shot |
|---|---|---|---|---|
| E1 | broken | OWN002 · shop.html (signed in, Home › "Your online shop") | The owner's own storefront card opens a bare **"Shop not found"** when the catalogue is private: no shop name, no shell, no line saying *why* or *what to do* (Profile › Public). | `540001-OWN002-shop-c1366-top.png` (and the 404 on `/api/catalogue/<bridge>` in Broken #1) |
| E2 | inconsistent | every small app vs index | **Five different headers.** Home: mark · shop ▾ · 🔔 · avatar. Accounts: page title · shop name as text · 🔔 · **"⌂Home"** (no space) · avatar. Finance: shop name · 🔔 · "⌂ Home" · avatar. Employees / Tasks: mark · shop ▾ · app switcher ▾ · 🔔 · avatar, **no Home button**. Settings (signed out): switcher says **"Home"** while on Settings. | `510001-UNNUMBERED-index-c1366-top` · `570001-UNNUMBERED-accounts-c1366-top` · `520001-UNNUMBERED-finance-c1366-top` · `520072-UNNUMBERED-employees-c1366-top` · `410004-UNNUMBERED-settings-d390-top` |
| E3 | inconsistent | accounts · finance · employees · tasks | The app name in the sidebar is drawn in a **serif** (Times fallback) — "CB Accounts", "Employees", "Tasks & Orders" — the index and the rest of each page are sans. Card names on Home say "CB Employees" / "CB Tasks & Orders"; the sidebar says "Employees" / "Tasks & Orders". | same shots |
| E4 | inconsistent | index (signed in) vs tasks.html | Home's rail says **187 in** for the shop; Tasks › Orders in says **0 rows · No orders here**. Two counts of "in" that a shopkeeper will compare. | `510001-UNNUMBERED-index-c1366-top` · `550001-UNNUMBERED-tasks-c1366-top` |
| E5 | inconsistent | OWN001 · till.html (owner) | A **Counter PIN** window covers the whole counter on every visit, before a bill can be started ("Not now" each time). | `510001-OWN001-till-c1366-top.png` |
| E6 | inconsistent | settings.html · know-your-business (Dark, signed out) | In Dark the **kural band stays cream** while its Tamil and English lines are pale — unreadable; "Mobile, e-mail or user ID" and "New shop? Register" fall to ~2:1 and ~1.8:1. | `410004-UNNUMBERED-settings-d390-top.png` |
| E7 | inconsistent | store.html · shop.html | **Own look, no shell:** no avatar / Sign in, no Home, own font (Inter), white in Dark. store.html with no `?net=` shows a developer line: *"No store specified. Open with ?net=<network id>."* | `210038-UNNUMBERED-store-d1366-top.png` |
| E8 | cosmetic | finance.html › Collections (1366) | The row's **Receive** button is cut at the right edge — the grid is wider than the pane at 1366. | `520010-UNNUMBERED-finance-Collections-op2-c1366.png` |
| E9 | cosmetic | employees.html | Count line reads **"0 on"**; the empty list says "No one added yet", Tasks "No orders here", the till "Nothing on this bill yet" — three wordings for the same empty state. | `520072-UNNUMBERED-employees-c1366-top` |
| E10 | cosmetic | know-your-business · settings (signed out) | Pressing the header's **Sign in** while the sign-in window is already on the page does nothing visible (no focus, no scroll). | `140005-UNNUMBERED-know-your-business-click01-c1366.png` |
| E11 | inconsistent | sign-in window | After the e-mail step, the empty code says *"Type your PIN, or the code if this is a first sign-in"* — for an e-mail code sign-in, the PIN is not what was asked. | `110004-UNNUMBERED-index-signin-4-empty-code-c1366-top.png` |
| E12 | cosmetic | OWN002 · shop.html (Mayur, public) | Four products were seeded **with a photo** (Masala Dosa, Veg Meals, Filter Coffee, Gulab Jamun); the storefront list shows none of them — check whether the list is meant to be picture-less. | `110001-OWN002-shop-c1366-top.png` |

**How these were found:** the automated rows above come from `e2e/visual-tour.cjs` (probes in the page). E1–E12 were read off the screenshots by the round's reviewer — they are what a shopkeeper sees and a probe cannot score (wording, two counts that disagree, a window in the way).
