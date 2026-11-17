# Cloud task — Manual entries, the SCREEN: "＋ Entry" on the CB Accounts Day book (Sonnet)

**Outcome (one):** the ＋ Entry flow in CB Accounts, per `docs/design/manual-entry/REQUIREMENT.md` (four plain steps: What
happened? · With whom / what? · How much, when, on what paper? · Check and save), on THIS branch (`cloud/manual-entry-web`,
cut from feat/cbavatar = CBList #30 + CBAvatar #32, plus main), as a DRAFT PR against `main` ("stacked on #30/#32; API is
chitbridge-api cloud/manual-entry-api"). Never push to `main`. No secrets, no live sites, no SQL.

## ⚠️ Deviation, named: no designer drawing for this screen (Athi asked to build it now)
So the pass mark is the FROZEN look: `docs/design/list-standard/index.html` + `docs/design/SYSTEM.md` §3a (three-row head,
CBList for any list, CBAvatar, tokens, phone first, never "accounting", short words, a symbol beats a sentence: memory
"assume they cannot read") and the requirement. The PR lists every screen state with a screenshot so a designer can review
after.

## Build
- The ＋ sits on the Day book (a CBList mount in public/app/cap-books.js; CB Accounts = public/accounts.html). It opens a
  sheet (the app's popup pattern, like public/app/chit-sheet.js) with the four steps. Phone first.
- **Step 1, the event grid**, drawn from `GET /api/books/events` (the API names the events, their words, icons and fields;
  the page holds NO rules). "Write a journal" (free Dr/Cr lines, Tally F7 style) is the last tile.
- **Step 2/3** asks only the fields that event needs: party (the CRM party list; local customers by name), ledger (the
  Ledgers view's list, grouped by the four bands), bank, asset class; amount to the paisa; date (a locked month is refused
  as soon as it's picked); paid by (cash/bank/UPI/cheque with no. and date); document no.; a photo of the paper (the vault
  upload already in the app); narration prefilled.
- **Step 4, Check and save**: `POST /api/books/preview` → the lines as the Day book draws them (code · ledger · Dr · Cr), each
  with its TYPE (personal / real / nominal) and the RULE that placed it ("Bank: real, comes in → Dr"), the voucher
  (MJ · Payment). Save is OFF until balanced and no refusal. Save posts to the event's route; the new entry appears in the
  Day book, Ledgers and Trial balance with no new style.
- **Reverse this entry** on a Day book row (POST /entries/:id/reverse) with a plain confirm (the app's confirmAsk).
- The page computes NO money: every figure comes from the API.

## Proof
`e2e/manual-entry.cjs` (stand-in API on a free OS port; never localhost:3000 / 7351 / live): each event's flow ends with the
preview's lines shown and the right route called; Save off when unbalanced; locked month refused at the date; double tap
posts once; free journal must balance; Reverse posts the mirror; 390 px scrollWidth === 390; no "accounting"; every warning
has its fix button. `e2e/manual-entry-breaks.cjs`: a page that computes a line's amount → caught; Save enabled when
unbalanced → caught. Plus check-syntax, app-syntax, dup-functions, missing-functions, markup-balance, list-standard,
cb-build-guard (bump CB_BUILD). Playwright isn't in the cloud image: temp-install, NODE_PATH, say so. Screenshots:
e2e/shots/manual-entry-{grid,form,preview,saved,locked,journal}-{laptop,phone}.png.
**Commit and push after EACH logical step.**

## Do not touch
`public/till.html`, `public/engine/*`, list-ctl.js / avatar.js internals (use their contracts), the API repo, SQL.
Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
