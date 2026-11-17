# Critique · Offer Lab walk fixes (W21-W48) · written with the build, spec = the walk table (docs repo WALK-2026-10-21.md, 22 Oct section)

**Assumes** (checked against the code, origin/main 2f1b8f25):
- A category is pre-set: TRUE, `FRESH.scope:'cat'` and `BIZ.*.d.catId` (offer-lab-next.html ~1086, 1167, 1225, buildBiz).
- Loyalty starts on: TRUE, `S.loyOn = S.custOn` in `applyBiz`.
- No commit control confirms: TRUE, `cartLive`, `cartApplyGroup`, `SHELF_STEP` buttons and `dropSaved` call the api at once.
- The four settings boxes are 46px: TRUE and the cause is a class collision, not styling. The settings fields used `.fld`, which the "Work it out" sheet already defines as `height:48px; overflow:hidden` (number field). Rename to `.sfld`.
- The sheet is 460px at 390: TRUE, `.sheet{min-width:460px}` was not reset in the phone media block.

**Conflicts / constructs:** the confirm is the lab kit's one popup (`CBLabKit.popup`), widened with `CBLabKit.confirm`; `CBConfirm` (accounts-shell.js) is the page-level twin for the Accounts app and drags a 1,000-line file in, so it is not loaded here. Server may/why is unchanged: the page still only asks, the api still decides.

**Simpler way:** the walk's own recommendation (reach card as the first required step, a confirm popup for shelf buttons) is the simplest; no wizard step is added, the existing "Work it out" reason line is widened to every kind.

**Risks:** many e2e files relied on the pre-set category and item (`S.itemId='masala'` with the default `itemIds`); they now set the reach themselves. No money maths, api, route or contract is touched; web only. Other rounds touching offer-lab-next.html: none known open.

**Left for others:** W38 (switcher lists app areas, verify against CBLabKit.LABS) and W44 (Import in a real browser) go to cb-qa; W46 (the OLB chip is the frame's screen-id) is shell.js, ux-locale's but a shared file.

**VERDICT: BUILD AS BRIEFED.**

## cb-critic round (22 Oct, CHANGE) - fixed on the same branch
1. BLOCKER Resume on a paused "Only for a group" offer went through `attachOffer`, which clears the group while the popup said "every customer": Resume is now `resumeOffer` (status only, rules untouched) and the popup names the group with its member count (automatic groups ask `GET /api/relationships/customers?segment=`; a named group has no count route, so it says "member count not shown here" rather than invent one: api gap for cb-crm). Walk C4 pauses and resumes a group offer and asserts `customer_group` kept and the group named.
2. `fallbackReach` and `scopeWords` always state a number ("1 item: A, 1 no longer in your catalogue", "0 items, 2 no longer in your catalogue"). Walk C5.
3. Editing a live or paused offer still saves it as a draft (the items changed, so the review no longer holds), but the sheet and the line after the save now say "Editing takes it off for customers until you make it live again." Walk C6.
4. Esc with a confirm open closes only the confirm. Walk C7.
