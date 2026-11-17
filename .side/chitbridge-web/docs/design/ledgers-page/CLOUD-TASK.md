# Cloud task — build the Ledgers redesign + the kural footer (Sonnet)

**Outcome (one):** CB Accounts › Ledgers rebuilt to the designer's handoff in THIS folder (index.html · styles.css · app.js · data.js ·
README.md · shots/, 2026-10-03), plus the kural footer on every CB page. Branch `cloud/ledgers-redesign`, PR (not draft) against `main`.
Never push to main. No SQL, no secrets, no live sites. Web only (don't touch chitbridge-api / chitbridge-engines).

## Read first
README.md here (every decision is explained, incl. "The brief's seven findings — answered", "The kural footer", "The list (a
CBList declaration)", "What the API must give", "Anything else I'd change") · REDESIGN-BRIEF.md · docs/design/DESIGNER-MEMORY.md ·
docs/design/list-standard/index.html (the FROZEN look) · the current page: public/app/cap-books.js (Ledgers view + tree) used by
public/accounts.html; public/app/list-ctl.js (CBList) · public/app/avatar.js (CBAvatar) · docs/design/kural-kit/kurals.json.

## Decisions already taken (Athi, 2026-10-03)
- The kural footer IS part of the frozen look, on EVERY CB page (accounts.html, crm.html, app.html where a footer fits, index.html):
  one band at the foot, outside the three-row head, the original couplet + the ENGLISH translation (other languages from
  meaning.<lang> when present, else English); NO Tamil prose meaning or transcription shown (the meaning.ta slot stays empty).
  Side by side when wide, meaning below when narrow, taking turns on a phone (tap; with Less motion only on tap). Closable. Never
  beside a warning, never in a dialog, NEVER inside an outgoing customer message. One kural per page from kurals.json (route → kural;
  CRM pages use the "crm" group; 552 never on tax screens). Build it as ONE unit (public/app/kural.js, window.CBKural) every page mounts.
- The designer's extras: build #2 (a short display name used where a long name wraps: read it if the API has it, else derive the
  display only, never store), #3 is an API/＋Entry rule (list it, don't build here), #4 the month-end "send statements" To-do (list it:
  API), #5 "Statement" action on a party's ledger (build the button; if no API route exists, open the existing party statement view),
  #6 remember the last ledger per person (local + the existing person-preferences sync if present), #7 Day book and Ledgers share one
  shell (CBList already; align the Ledgers mount with the Day book's).
- Narrow laptops (1024–1200 px): the head must stay ≤ 20% (the designer measured 22–27%): fix it (tools row folds into ⋯ or wraps
  the search full-width earlier), and add the measurement to the check.

## Build
The two panes (tree: bands → groups → ledgers → parties, one line per node, aligned amounts, light selection, find-as-you-type,
keyboard, resizable, folds to ☰ Ledgers; the list: CBList declaration per the README), the ONE figures line with "✓ parties agree" /
the amber "with no party" chip, Dr/Cr everywhere, the opened entry in place, a party's ledger without the party column, the
"✓ Agreed up to <date>" marker (draw it when the API sends agreement data; hide it otherwise), the phone as two pages. Every figure
from the API (cap-books.js already reads /api/books/ledger, /accounts, /dues…); where the README's "What the API must give" lists a
field the API lacks, keep the current behaviour for it and LIST it in the PR (it becomes an API task). The page computes no money.
DELETE the prototype's purple strip (PROTOTYPE ONLY — DO NOT BUILD).

## Proof
e2e/books-web.cjs + e2e/cb-accounts.cjs updated (one figures line; no minus; no sideways scroll at 1366/1080/390; party not repeated
on a party ledger; tree one line per node; head ≤ 20% at 1366×768 and 1080×768, ≤ 30% at 390); NEW e2e/kural-footer.cjs (on
accounts/crm/index: one band, outside the head, English shown, no Tamil prose, closable, never beside a warning, absent from any
message composer) + its breaks file. Fast checks + list-standard + cb-build-guard (one new stamp). Screenshots: ledgers states 01–09
laptop + phone in Cream/Dark/Terminal, kural on 3 pages. Playwright isn't in the cloud image: temp-install, NODE_PATH, say so.
**Commit and push after EACH logical step.** Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Do not touch
public/till.html, public/engine/*, the API and engines repos, SQL. list-ctl.js / avatar.js: use their contracts (report a gap).
