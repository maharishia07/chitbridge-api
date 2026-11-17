# T2-LABS — critique before building (rule 00, 2026-10-14)

**(a) What the brief assumes, checked**
- The clash check lives only in `public/offer-lab-next.html` ~3105-3146 — PARTLY TRUE: `scopeCoversItem`/`scopesOverlap`/`clashDetail`/`offerCoveringItem` at 3097-3157; `public/combo-lab.html:3021` carries an older private `clash()` too. The engine (`chitbridge-engines/src/offers.js`) has no overlap test; its scope test is inline in `eligibleFor` (:559).
- No clash check on save — TRUE: api `routes/definitions.js` POST (:203) and PUT (:258) store any offer.
- Lab maths at `combo()` 1706, fallbacks 1719-1748 — TRUE (`combo` = percent-on-percent, the engine's own stacking rule; four `if(!window.CBOffers) return R2(...)` copies). "Five previews": outPair/outCheap/outSame already call `evaluate`; outBundle (pay) and outSpend (give back) do the offer sum by hand. outShip/outGift sum the SHOP's delivery/gift cost — not offer maths, left as is.
- combo-lab shares 129 functions — ~TRUE: 126 shared names, 78 byte-identical; combo-lab is an OLDER copy of the whole Offer Lab kept inert under its modal (its own comment, :3112). Only the ~700-line modal block (:1091-1790) + `catDisplayName`/`loadCatNames` are its own.
- signin-lab fakes the server — TRUE: `window.fetch` is replaced in the page (:139-224).
- Pins: api + web pin offers at 1.3.0; `src/offers.js` is byte-identical from 1.3.0 to 1.45.0 (diffed), so 1.46.0 only adds.
- The docs repo beside us is EMPTY (no IP-EXPOSURE / RECONCILIATION / MAINT-1 / area README) — measured with my own stated command instead.

**(b) Conflicts** — one place per thing: the clash rule moves to CBOffers and the server's save answers may/why (`code: OFFER_CLASH` + sentence); the lab only paints it. KG1 name-match guard: lab `esc`/`go`/`row` collide with production names (helpers.js · app.html · rail-bell.js).

**(c) Simpler way** — combo-lab as a MODE of offer-lab-next (`?mode=combo`, the modal it once was) instead of a third shared module: the modal block moves to `public/lab/combo-mode.js`, combo-lab.html becomes a redirect. Removes the whole inert copy.

**(d) Risks** — money: refusing a save changes production behaviour (briefed fix); only a save that leaves the offer LIVE is checked, against other LIVE item-level discounts (percent/amount/tier) of the same shop, so drafts and the planner's non-overlapping rows are untouched. Engines serial: v1.46.0 tagged this round (fetch tags first). Twin landing: engines tag → api → web. Other rounds editing the labs would conflict (unknown). signin-lab: the real verify sends no access_level/can_see_costs, so the "What you can do" panel against a real server shows the server's level only when it sends one.

**(e) VERDICT: BUILD WITH CHANGES** — (1) combo-lab becomes a mode of offer-lab-next, not a new shared module; (2) outShip/outGift stay (shop cost, not offer maths); (3) the sign-in stand-in moves out of the page into `e2e/lib/signin-standin.cjs`; the lab talks to `?api=` (local stack / harness) or the deploy's api.
