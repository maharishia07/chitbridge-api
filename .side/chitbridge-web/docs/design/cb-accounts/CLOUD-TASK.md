# Cloud task — CB Accounts: its own page, the designer's shell, and the index tile

**Outcome (one):** a standalone page `public/accounts.html` named **CB Accounts**, built on the designer's handoff in
`docs/design/ledgers-page/` (sidebar + pinned header + Ledgers view), hosting the existing Ledger screens under its own
menu; the index page's third tile renamed **CB Accounts** with a Switch on / **Active** state. Athi (2026-10-01):
*"split the accounting system separate from the rail menu and provide its own identity as CB Accounts and its own menu,
profile page etc. — reuse the profile and avatar"*; *"under Ledger … call it CB Accounts and bring the subscribe button
there itself; if already subscribed say Active and give some illumination."*

**Branch:** `cloud/cb-accounts` from `main`. Open a PR against main; never push to `main`. **Pass marks:** the designer's
handoff for the look (`docs/design/ledgers-page/index.html`, `styles.css`, `app.js`, `README.md`); `docs/design/SYSTEM.md`
for the rules. The word "accounting" never appears on screen ("CB Accounts", "Ledger", "Day book" are fine).

## Build
1. **`public/accounts.html`** — a new page with the designer's layout: the left sidebar (the design's `NAV_ITEMS`: Day book ·
   Ledgers · Trial balance · P&L · Balance sheet · Dues · Cheques · Waiting · Month lock · Packs · Opening balances · Shop
   ledgers — add **Bills** after Dues), the pinned header with the shop name, a ⌂ Home link to `/`, and the app's avatar
   menu (Profile → `app.html#/app/profile`, Sign out — reuse the app's session in `localStorage.cb_sess` and sign-out
   behaviour; read `public/app.html` `restoreSession`/`logoutNow`). The sidebar collapses to an icon rail below 760px as
   designed.
2. **The screens are the existing ones** from `public/app/cap-books.js` (the views `bkDaybook`, `bkLedgers`, `bkTB`,
   `bkPL`, `bkBS`, `bkDues`, `bkChequesView`, `bkWaitingView`, `bkLockView`, `bkPacks`, `bkOpeningView`, `bkAccounts`),
   rendered into the page's content area — load `cap-books.js` and the small shared helpers it needs (`api`, `esc`,
   `tx`, `toast`, `confirmAsk` …) the way the app does; if they live only inside app.html, extract the minimum into a
   small `public/app/accounts-shell.js` that BOTH app.html and accounts.html use (no copy-paste of the same function into
   two places — one implementation). **Bills** shows the system folders `B-2100` / `B-1300` from
   `GET /api/folders` (`UI.sysFolders` in cap-folders.js shows how they arrive) as two tabs with each bill's step chip
   (`{ step, code, label, by, at }` from the server); a bill opens with the app's `openChit` in a new tab for now.
3. **The Ledgers view** takes the designer's look (sections Personal / Real / Nominal with their rule line, groups,
   Expand all / Collapse all, search with highlight, class chips with counts) with the real accounts from
   `GET /api/books/accounts` grouped by code exactly as the design's `data.js`, plus a Dr/Cr balance column from ONE
   `GET /api/books/trial-balance?asOf=` read. Clicking an account opens that ledger (the existing ledger view).
4. **One-shop gate**: accounts.html attaches the same gate as the Labs (`public/app/one-person.js`, see how
   `offer-lab-next.html` calls `CBOnePerson.attach`).
5. **Ledger off**: the page shows one card "CB Accounts is not switched on" with **Switch on** for the owner (the same
   `POST /api/books/enable` + confirm the Settings card uses — `bizLedgerSwitch` in `public/app/cap-admin.js`; reuse it,
   do not copy it) and "Ask the owner to switch it on" for others.
6. **The app**: its left-menu "Ledger" item becomes one link "CB Accounts ↗" to `/accounts.html` (same tab). The
   in-app Ledger screen stays reachable by URL for now (do not delete it in this PR).
7. **The index tile** (`index.html`): rename the third box **CB Accounts** (sentence: "…the ledger records it" stays);
   link to `/accounts.html`. Off → a **Switch on** button on the tile for the owner (same confirm), "Not switched on yet"
   for others. On → an **Active** badge and a lit tile (green edge + soft glow, from the page's tokens; reduced-motion
   safe), with its facts (ledger up to · bills to accept · overdue · waiting) as today.

## Proof (exit codes; commit outputs)
- New `e2e/cb-accounts.cjs` (pattern `e2e/books-web.cjs` + `e2e/index-page.cjs`: stand-in API on a free OS port, never
  localhost:3000, port 7351 or the live site): the page loads signed in; the sidebar lists every view and each opens its
  screen; Ledgers sections/groups/search/chips/balances; Bills tabs with step chips; avatar menu Profile/Sign out;
  Home → `/`; ledger off → Switch on (owner) → POST enable once → the page fills; a co-assist sees "Ask the owner";
  the one-shop gate stops a second shop; 390px → icon rail, `scrollWidth === 390`; no "accounting".
- Index: the tile says CB Accounts; off → Switch on works; on → Active badge present.
- Breaks file `e2e/cb-accounts-breaks.cjs` (restore from a COPY): a view missing from the sidebar, a per-row balance
  fetch, the Active badge shown while off, the gate not attached.
- `node scripts/check-syntax.js`, `node scripts/check-app-parses.cjs`, `node e2e/books-web.cjs`, `node e2e/index-page.cjs`,
  `node e2e/labs-flow.cjs`, `node e2e/one-person.cjs` → 0.
- Screenshots `e2e/shots/cb-accounts-{laptop,phone,ledgers,off}.png` and `index-cb-accounts-{off,active}.png`.

## Do not touch
`public/till.html`, `e2e/till-*`, `public/engine/*`, the API repo, SQL, `e2e/tests/*.spec.js`. Commit messages end with
`Co-Authored-By: Claude <noreply@anthropic.com>`.
