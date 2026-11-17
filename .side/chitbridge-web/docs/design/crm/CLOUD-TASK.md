# Cloud task — CB CRM, PHASE 1: THE SPEC (Opus). Write the requirements; build nothing.

**Outcome (one):** on this branch (`cloud/crm-spec`), in a PR against `main`, the documents a DESIGNER can design each CB CRM
screen from, and a later build session can build from without asking anything. **No code changes.** Never push to `main`.
No secrets, no SQL, never call the live site.

Athi, 2026-10-02: *"create a CRM module collating supplier and customer details we already gather … like accounts, see what are
the CRM specs and build independent screens and flow and see how our bridge id information can be integrated … so we can follow
one rule across the board"* · *"each screen give the designer a chance to design the screen according to standard"* · *"we already
have messaging, internal, external messaging, and so on, and how we can integrate a standard mailing form inside as well"*.

## The rule across the board (what "like accounts" means)
CB Accounts is the pattern: its OWN page and menu (`public/accounts.html`, docs/design/cb-accounts/CLOUD-TASK.md), the
designer's handoff first (`docs/design/ledgers-page/`), the existing screens reused inside it, the LITERATURE as the baseline
(what any accounting package must do — `chitbridge-engines/tests/golden-books.test.js`), and only our customisation on top.
CB CRM follows the same four steps: standalone page · literature baseline · designer per screen · reuse what exists.

## Read first
- `docs/design/crm/INVENTORY.md` — everything already gathered and shown about parties, with file:line, and 8 gaps. **The
  CRM is built from this.** "Party ≠ a new table" (`SPEC-books-v2.md` §1, copy summarised in the inventory).
- `docs/design/SYSTEM.md` (the design system), `docs/design/cb-accounts/CLOUD-TASK.md`, `docs/design/receive-a-bill/REQUIREMENT.md`
  (a REQUIREMENT's shape), CLAUDE.md rules 1–5 (reuse; one calculation; one shape per slot; no new style).
- Messaging that exists: `public/app/cap-messages.js` (messagesScreen), chit threads (`routes/folders.js`, `routes/chits.js`
  messages), the bell (SSE), compose (the one compose — find it by grepping `compose` / `sendChit` in app.html), mailbox model.

## The documents to write (under `docs/design/crm/`)
1. **`LITERATURE.md` — the CRM baseline.** What any CRM (Zoho CRM, HubSpot, Salesforce Essentials, Tally's party masters for a
   shop) is expected to do without being told, as a numbered checklist: contacts and their organisations, one record per party
   with every channel, activity timeline, notes, tasks / follow-ups / reminders, segments and tags, interactions log (calls,
   visits, messages, mails), email from inside the record (a standard compose form: To · Cc · Bcc · Subject · body · attachments
   · templates · signature · send / schedule, thread kept on the record), duplicates and merge, import / export (CSV, vCard),
   consent and contact preferences (DPDP Act 2023 for India), owner / assignment, search and saved views, reports (new parties,
   activity, top parties, dues). Each item marked **HAVE** (with the inventory's file:line), **PARTLY**, or **MISSING** — and
   which items are out of scope for a shop (e.g. sales pipelines / deals: say whether a shop needs them and why).
2. **`DATA.md` — one record per party.** How the CRM's party record is assembled from what exists (customer_list +
   supplier_list + party fields + identities + party_tax_id + rewards + party_item + chits), and the decision for each of the
   inventory's 8 gaps (e.g. a party on both lists is ONE party with two roles; GSTIN read from one place; local customers
   minted like local suppliers — `lib/local-identity` mint, no second path). New columns/tables only where unavoidable, each
   justified and named; mark which need a migration (Athi runs SQL).
3. **`BRIDGE.md` — how ChitBridge identity is integrated.** party_no (the shop's number) ↔ identity (user_id, bridge_id) ↔
   on ChitBridge or not (`lib/istest` mayTrade: active, on the rail, same sandbox) ↔ what that unlocks: two-sided bills,
   chits, catalogue, offers "for you", rewards, disputes, messages. What a local party (not on ChitBridge) gets instead
   (one-sided bills, mail/phone only), and how a local party is LINKED when it later joins ChitBridge (one party, history kept).
4. **`MESSAGING.md` — internal, external and mail, in one place per party.** What exists (chit threads, messages screen,
   bell, compose) and how the party record shows ONE timeline of it; the standard mail form inside the CRM — reuse the
   existing compose, and say exactly what a mail adds (address book from the party record, templates, attachments from the
   party's documents) and how an outbound mail is sent (provider, from-address, replies) — mark what needs a decision.
5. **`FLOWS.md`** — the flows end to end: add a party (on ChitBridge by handle / local by name), find a party, open its
   record, log an interaction, write a mail, set a follow-up, see dues and statement, merge duplicates, export.
6. **One `REQUIREMENT-<screen>.md` per screen**, in `receive-a-bill/REQUIREMENT.md`'s shape (purpose, who, what it shows,
   what it does, states: empty / loading / error / one-sided / not on ChitBridge, phone, words on screen, data it reads —
   API + fields, what it must NOT do). At least: CRM home / parties list (the Task table — `listHeader`/`rowGrid` reuse),
   party record, timeline, compose mail, follow-ups, segments & groups, merge, import/export, CRM settings. Each one ends with
   **"For the designer"**: the standard it follows and what to design; NO visual decisions in the requirement.
7. **`PLAN.md`** — phases after the designer: which screens first, what each phase reuses, API work (with routes), the
   conformance suite (like golden-books: a seeded set of parties and interactions with the expected screens), and open
   questions for Athi, each with a recommended answer.

## Proof
Every LITERATURE item has a HAVE / PARTLY / MISSING mark; every inventory gap has a decision in DATA.md; every screen has a
REQUIREMENT; `node scripts/check-syntax.js` untouched (no code). Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
