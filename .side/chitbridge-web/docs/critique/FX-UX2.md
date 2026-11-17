# Critique · FX-UX2 (written before any code, 2026-10-14) — F5 register from a small app · F9 a cleared server pref clears the device

## (a) What the brief assumes, checked
- "Registration exists only in app.html (cap-register.js openRegister, `reg-agree`)" — HALF FALSE: cap-register.js is the RAID register (risks), not shop registration. The form is app.html itself: `renderRegister`/`doRegister`/`govPanel`/`regVerticalChooser` (`app.html:3448-3662`), `reg-agree` at `app.html:3482`, `api("register")`→`api("ownerVerify")` (EP `app.html:1790-1793`). True: only app.html has it.
- "page-frame registerHref '/app.html#/welcome'" — TRUE (`public/app/page-frame.js:58`). "index does not pass registerHref" — FALSE: `index.html:114` passes the same `/app.html#/welcome` (index-not-app.cjs ALLOW rows 1-2, round SET3).
- "a small register app, e.g. public/register.html" — CONFLICT: `settings.html:13-14` and docs/design/INDEX-NOT-APP.md row 6 say the register flow is a SECTION of CB Settings (SET3, `settings.html#/new`), "ONE settings app, never one page per screen"; settings.html already carries the form styles (.fl .inp .btn .err .hint) and gov-panel.css. A register.html would need a second copy of those styles (rule 5 "no new style").
- "after registering it lands on Home" — TRUE as asked; note app.html sends a new shop to `#/country` (CS1). From the small app the guess the person agreed to travels with register + verify (FX-AU1, `app.html:3627,3640`); confirming it is CB Settings › Country, one tap from Home.
- "mintEntity moves if the controls move" — the lifted form keeps every testid (reg-name · reg-email · reg-submit · reg-otp · reg-vertical-* · reg-agree) and app.html#/welcome → #/register stays, so `e2e/fixtures.js` mintEntity needs no change.
- F9: `avatar.js:183` returns early when the server object has none of the seven keys; `:186-192` copy only PRESENT values — TRUE. Every kind is pushed since CU3 (`avatar.js:165,228`) — TRUE. The server drops a key sent as ''/null (merge-patch, api `routes/entities.js:670-676`) — TRUE. Before b166 runs /me answers `ui_prefs: {}` (`routes/entities.js:483`) and a push answers `{pending:true}` — so "absent" alone is ambiguous: the pending mark must cover it.

## (b) Conflicts with DECISIONS-level rules / existing constructs
- One form: the form MOVES to `app/cap-registration.js`, host-aware the way cap-country.js is (`CBCountry.mount(host, onDone)`, SET1) — app.html lazy-loads it (ensureCap) and settings.html mounts it. No second form, one `reg-agree`, one register/verify call pair.
- One settings app (SET1/SET3): the register door is `settings.html#/new`, not a new page. Signed-out is fine: the section is public; the sign-in window stays in the head.
- Settings custodian: the pending mark is ONE new device key `cb_prefs_pending` (layer: the person, U; not governed; device-only by nature — it records what has not reached the server). FIELDS entry in api docs/FIELDS.md beside ui_prefs.
## (c) Simpler way
- F9 needs no server change: one loop over KEY in hydrate (all seven kinds, one rule), a pending mark written by set() and cleared by the push that the server answers `ok:true`. CBPrefs.push (core.js) widened with an optional done callback so the app's door reports the same.
## (d) Risks
- Wiping a choice: a device choice made before this ships with no pending mark and not on the server (e.g. set while signed out) is reset once on the next signed-in load — that is F9's own case, accepted. A choice made from now on is marked until a push lands; hydrate re-pushes marked kinds.
- Showing link: editionReload already skips a tab held by `cb_edition_tab` (`avatar.js:234`); CBEdition.key reads the tab first, so the tab keeps its rule.
- app.html is shared with other rounds; the move is mechanical (functions lifted verbatim, host-aware wrapper). No api route, no contract change, no migration (b379-b381 unused), engines untouched.

## (e) VERDICT: BUILD WITH CHANGES
1. The register app is CB Settings' section `settings.html#/new` (SET3), not register.html; the form moves to `app/cap-registration.js`. 2. index's registerHref re-pointed with page-frame's; both ALLOW rows struck. 3. F9's guard: `cb_prefs_pending`, cleared only by a server `ok:true`.
