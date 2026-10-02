# ChitBridge — API

The server for ChitBridge: businesses send each other **chits** (orders, bills, messages, disputes) on a governed rail,
and every chit lands in each party's own records — a counter bill becomes the seller's sale and the buyer's purchase in
their ledgers. Node.js + Express on PostgreSQL (Supabase), deployed on **Railway from `main`**.

ChitBridge is three repositories:

| Repo | What it holds |
|---|---|
| **chitbridge-api** (this one) | the server, the database migrations, the counter's master code, the Tally/Zoho connector kit |
| **chitbridge-web** | the app people use (Vercel, from `main`): the home page, the app, CB Accounts, the Labs, the counter page |
| **chitbridge-engines** | the pure engines (money, tax, offers, books…) every platform adopts as stamped, version-pinned copies |

**Read first:** [`CLAUDE.md`](CLAUDE.md) — the standing rules (reuse before you build, design, testing).
**What already exists:** [`docs/SEAMS.md`](docs/SEAMS.md) (functions reused across files) ·
[`docs/SOFTWARE-ASSETS.md`](docs/SOFTWARE-ASSETS.md) (modules that stand alone).

## Run it

```bash
npm install
cp .env.example .env        # DATABASE_URL and the rest — never commit .env
npm start                   # node server.js   (npm run dev → nodemon)
```

## Check it

| Command | What it proves |
|---|---|
| `npm run guards` | the offline gate before any commit — every guard and unit test that needs no database |
| `npm run lint:copy` | every on-screen string within the text budget |
| `npm test` | the full suite (slow; once, when a piece of work is finished) |
| `npm run check:trips` | round trips per screen within budget |
| `npm run rls:census` | row-level security covers every tenant table |
| `node ../chitbridge-engines/tools/adopt.cjs . --check` | the adopted engines are exactly their releases |
| `node scripts/regression.js` (and `lifecycle-iot.js`, `actor-harness.js`, `dispute-scope.js`, `cancel-request.js`, `erp-connector.js`) | ⚠️ drive the **LIVE API by default** (`CB_API=` to point elsewhere) — Athi's call to run, never part of the gate |

SQL is never run by a session: a migration is written into `migrations/` and Athi runs it.

## Where things are

```
server.js            entry point — mounts every route
routes/              HTTP routes (chits, books, till, counters, folders, integrations, …)
lib/                 the logic behind the routes; adopted engine copies (lib/tax.js, lib/money.js …) — never edit those
middleware/          auth, scopes, idempotency
db/                  connection, the schema snapshot, the RLS baseline
migrations/          numbered SQL migrations (MANIFEST.md indexes them)
src/                 the network module (mounted at /api/network)
governance/          entitlements, mint, resolver
tools/
  tally-connector/   the connector kit (Tally · Zoho · CSV) and the COUNTER'S MASTER (till.html, till.js) —
                     chitbridge-web/public/till.html is a vendored copy (scripts/vendor-till.cjs)
  seed/ …            round-trip budgets, endpoint usage, seed checks
scripts/             guards.cjs (the offline gate), lint-copy, rls-census, sql, vendor-till, backups
tests/               unit and offline tests (run by the gate); support/ holds the in-memory harness
data/                CMDB records (data/cmdb), test cases, fixtures
public/              the few server-rendered pages (chit, connections, inbox, register)
design-handoff/      the counter's design packages: A-screens/, B-fine-tuning/, stuck-bill/ (HANDOVER.md first)
design-style*/       screen-style and key-size specs the counter cites
docs/                design notes and contracts (COUNTER.md, CTP-DESIGN.md, THREAT-MODEL.md, NAMESPACE.md …),
                     docs/tasks/ for open cloud tasks, docs/drafts/ for work in progress
```

## Deploy

Push to `main` → Railway builds and deploys (check with `railway deployment list`). Cloud sessions work on
`cloud/<task>` branches and arrive as pull requests; nothing lands on `main` unread.
