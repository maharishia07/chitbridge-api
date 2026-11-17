# Critique · SHELL-ONE (written before any code, 2026-10-15)

## (a) What the brief assumes, checked
- "the index's shared shell" — TRUE: `shell.js:276` draws `.cbsh-hdr`; nine pages mount it through CBFrame (`skeleton-guard.cjs:94` FRAMED + kyb · documents).
- "accounts (.top), crm/finance (.bar)" — TRUE: `accounts.html:281`, `crm.html:326`, `finance.html:309`, each with its own `whoPaint` (`accounts.html:442` · `crm.html:433` · `finance.html:410`) drawing shop · bell · ⌂ Home · avatar · chip — three copies of the frame.
- "promo/store (header), shop/network-shop/embed (no header)" — TRUE: `promo.html:122`, `store.html:44`; shop (`shop.html:730`), network-shop (`:67`), embed draw a `.hd` brand row in JS — no Home, no avatar, no chip.
- "4 body fonts" — TRUE: shop `Inter` (a Google Fonts link), network-shop · embed · kyb · documents `-apple-system`, store `system-ui`; accounts/crm/finance headings in `'Source Serif 4'` (`accounts.html:33,90`) and `page-skeleton.css:11`. SYSTEM.md §2 names Bricolage Grotesque · IBM Plex Sans · IBM Plex Mono; the only serif is the kural's Noto Serif Tamil (§3b).
- "no Home on settings" — TRUE in effect: in app mode the shell draws a switcher (`shell.js:280`), never a `⌂ Home` control; the chip is skipped in bar mode (`shell.js:282,310`).
- "the tour harness e2e/visual-tour.cjs" — FALSE: no such file; `e2e/tour.cjs` is a 2026-09 workshop screenshot script against the LIVE api; TOUR-FINDINGS.md is in neither this repo nor `../chitbridge-docs` (EMPTY on this runner: no area README, no DISCIPLINES.md — the brief's inline copy is used).
- "avatar.js the one door" — TRUE (`avatar.js:417-421`: onSignIn in place, else a link to signInHref). "till.html" — VENDORED (CLAUDE.md): not framed here; the counter's bar is the api's round.

## (b) Conflicts with rules and constructs
- The frozen head (SYSTEM §3a; `crm.html:90` overbar; `accounts.html:220` ledgers-page hand-over `BK.slotWho`): shop · Home · avatar ride IN the list's title row so the head stays ≤ 20%. A frame bar above a CBList is already the accepted shape on tasks · settings · catalogue. So: the frame stays on, the hand-over goes (`whoHome` · `BK.slotWho` become no-ops); CRM/Finance keep only their page ACTION over the title row.
- One avatar / one bell: pages stop calling `CBAvatar.mount` and `CBBell.mount` themselves — the shell does, once per mount.
- Storefront: the shell's person is the ChitBridge session (cb_sess), not the shopper's order session; signed out the door is "Sign in" → `/`. "Home" there = the shop's own front (`homeHref`). embed.html keeps the bar even with `brand=off`.

## (c) Simpler way
Widen the two units, not the pages: CBShell gains `⌂ Home` (app + bar), a `title` for pages with no manifest entry, the chip in bar mode and `fit:'pane'`; CBFrame gains `host · bar · homeHref · title`. Then every page is a 3–8 line change, and the three own headers are DELETED, not restyled. Reference pages are rows in `screen-id.js` DECLARED.references → `docs/SCREEN-LIST.md`.

## (d) Risks
- Walks asserting the old headers (`cb-accounts.cjs` 18 refs · `crm.cjs` 14 · `frame-every-width.cjs` 9 · `walk-screen-id.cjs`) are re-pointed at `shell-*` testids in the same PR.
- The three apps now GET `/api/entities/header` (an existing route, one trip) and `/app/manifest.json` (static) per load.
- Token guard: storefront literal counts only fall. No migration (b679–b681 unused), no engines change, no twin PR.

## (e) VERDICT: BUILD WITH CHANGES
1. Home · title · chip · pane are widenings of CBShell/CBFrame, never a per-page copy. 2. accounts/crm/finance headers deleted; the list-title hand-over retired. 3. Storefront + promo + labs wear the BAR (header only) with the shop/lab name as the title. 4. design-mock · cart-design · storefront-design · supplier-design · list-lab · shell-lab · signin-lab · screen-gallery · lifecycle-test · testing · intake · iot-howitworks · bill-print · offer-lab (old) are REFERENCES (register row, not customer navigation); till.html vendored, app.html the workshop. 5. The tour harness is NEW (`e2e/visual-tour.cjs`): the frame rows are hard; body contrast is a ratchet that only falls.
