# Critique · DESIGN-DETAIL-AVATAR (design track pass 2: the one detail view, the avatar menu)
(a) Assumptions vs code
- "Accounts, Finance, CRM, Tasks already call chit-sheet.js" — TRUE: openChitSheet in accounts.html:457, finance.html:381, crm.html:406; tasks.html:144 loads it (public/app/chit-sheet.js:437 open()).
- "Avatar Support loops to Home, Profile opens Know your business, no page shows Settings" — TRUE: avatar.js:54 (PROFILE_HREF, SUPPORT_HREF), :411 draws Settings only with onSettings/settingsHref (no small app passes one).
- "Header chip reads the shown view (UX-93)" — TRUE, landed in web #337 (tests/sheets-links.test.cjs); kept, untouched.
- "Skeleton wide breakpoint" — the skeleton has 760 (phone) and 1100 (sidebar collapses) in page-skeleton.css / page-frame.js; no named "wide" token. Pane starts at 1101.
(b) Conflicts: none with DECISIONS. One painter stays (chit-sheet.js paint); no second sheet. Money stays read-only (moneyFor). The pane docks inside `.cbsk .app` (a flex sibling), so nothing floats over content; a page with no skeleton (the workshop) keeps the popup.
(c) Simpler way: CSS + one placement function over the existing dialog, instead of a new module. That is what is built.
(d) Risks: e2e specs that press `cs-close` (kept: the back arrow carries that test id); a modal dialog is gone in pane mode, so Escape and page scrolling need their own handling (done in the sheet); other area files touched: avatar.js (ux-locale, own). Home files (index.html, manifest.json, home shell JS) NOT touched. No SQL, no api, no engines.
(e) VERDICT: BUILD AS BRIEFED
