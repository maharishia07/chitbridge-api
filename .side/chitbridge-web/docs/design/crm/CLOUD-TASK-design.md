# Cloud task — CB CRM, PHASE 2: THE DESIGNER (Opus). Design the screens; no app code.

**Outcome (one):** a designer's HANDOFF for the first five CB CRM screens, under `docs/design/crm/handoff/`, in the shape of
`docs/design/ledgers-page/` (index.html · styles.css · app.js · data.js · README.md — plain HTML/CSS/JS, no build step, no
dependencies), that Athi can open in a browser and judge by eye, and that the build phase can wire to the API without
redesign. Branch `cloud/crm-design` → PR against `main`; never push to `main`. No secrets, no SQL, never call the live site.

Athi, 2026-10-02: *"each screen give the designer a chance to design the screen according to standard"* · *"happy with the CRM
requirement and can be designed and build on its own thread"*.

## Read first
- `docs/design/crm/PLAN.md` (Phase 2: order and hand-off shape), `LITERATURE.md`, `DATA.md`, `BRIDGE.md`, `MESSAGING.md`,
  `FLOWS.md`, and the five requirements: `REQUIREMENT-home.md`, `REQUIREMENT-record.md`, `REQUIREMENT-timeline.md`,
  `REQUIREMENT-compose-mail.md`, `REQUIREMENT-followups.md`. Each ends with **"For the designer"** — that is the brief.
- `docs/design/SYSTEM.md` — the design system. **No new style**: the tokens, type and components there (CLAUDE.md rule 5).
- The sibling handoffs to match: `docs/design/ledgers-page/` (CB Accounts — the CRM's page shell is the same family: sidebar,
  pinned header, content), `docs/design/index-page/`, `docs/design/chit-sheet/`.
- The screens they replace/absorb, to see real data shapes: `public/app.html` customersScreen/custDetailHTML,
  suppliersScreen/supInfoCardHTML, `public/app/cap-books.js` partyBooksHTML/partyStatementLoad, `public/app/cap-messages.js`.

## Design (in this order — most used first)
1. **CRM home / parties list** — the Task table look (same columns header, row grid, group rows, row peek) — not a new table.
2. **Party record** — one party, both roles; the ChitBridge identity block (party no · user id · bridge id · on ChitBridge or
   "one-sided — why"); dues + statement; groups, segment, rewards; Next follow-up.
3. **Timeline** — chits, bills, payments, messages, mails, disputes, changes: one stream, filterable.
4. **Compose mail** — the standard form (To · Cc · Bcc · Subject · body · attachments · template · signature · send / schedule)
   in the family of the existing compose — the requirement says what is reused.
5. **Follow-ups** — list + the record's Next block.
Each screen: laptop and phone (390px, no sideways scroll), and the states every requirement lists (empty, loading, error,
one-sided / not on ChitBridge, disputed). `data.js` holds realistic sample data using the REAL field names from DATA.md (party_no,
user_id, bridge_id, on_rail, one_sided.why, balance_minor, oldest_due …) so the build swaps it for API calls one to one.

## Proof
- `docs/design/crm/handoff/README.md` lists each screen, its states, how to see them (hash or toggle), and every element's data
  field; an "Open questions for Athi" list only where the requirement left a visual choice.
- Screenshots committed: `docs/design/crm/handoff/png/{home,record,timeline,compose,followups}-{laptop,phone}.png` (Playwright:
  `npm i @playwright/test@1.61.0` in a temp dir, NODE_PATH at it; say so in the PR).
- `node scripts/check-syntax.js` unaffected (nothing under public/ changes).

## Do not touch
Anything under `public/`, `e2e/`, the API repo, SQL. Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## For the build phase after Athi approves (note only)
PLAN.md Phase 3 says "lib/local-identity.mayTrade" — it already exists as **`lib/istest` `mayTrade` / `mayTradeSql`** in
chitbridge-api (merged 2026-10-02, PR #9): reuse it, do not add a second one. Customer and supplier lists already return
`on_rail` from it, and a party is numbered when added (api branch `feat/party-no-at-add`).
