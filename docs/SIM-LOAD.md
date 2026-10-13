# Three years of a shop on your PC — `tools/sim-load.cjs` (round Y1b)

Y1 (`tools/simulate-years.cjs`) runs a three-year shop in memory and checks the ledger. Y1b puts that **same shop** (same
plan, `tools/sim-plan.cjs`) into the local stack's Postgres through the doors the app uses — the counter's bill chit, the
day-summary chit, the owner's expense entry, the month GST close, the lock, the year close — so every screen (till,
accounts, finance, CRM) shows three believable years.

## The three commands (on the dev PC)

```
C:/dev/toolset/local-stack.sh up                      # 1 · the stack: Postgres (docker) + api on 3100 + web on 8124, DEV_OTP armed
node C:/dev/chitbridge-api/tools/sim-load.cjs --db postgres://postgres:pw@127.0.0.1:5432/cb_local --shop simstores
                                                      # 2 · the load (≈ 2 min for 3 years; prints what it made and the proof)
start http://localhost:8124                           # 3 · sign in as simstores (or simstores@test.example) · code 123456
```

`--db` is the stack's own Postgres URL (see `local-stack.sh` for the password and database it starts). The api inside the
loader connects to **that** database only: a URL whose host is not `localhost`, `127.0.0.1`, `::1` or a bare docker service
name (`db`, `postgres`) is refused before anything connects. The api's `.env` cannot redirect it.

**Before the first load, run `migrations/b300_chit_deliver_clock.sql` on the local database** (as `postgres`, e.g.
`node scripts/sql.cjs migrations/b300_chit_deliver_clock.sql --as-owner --write` with `DATABASE_URL` pointing at the local stack). It
lets the chit writer stamp each bill with the simulated day; the loader refuses, in words, until it has run. The stamp is an
instant (M210): with `b299_created_at_timestamptz.sql` run too the column holds it as `timestamptz`; without it the column holds
the UTC wall clock the api's pinned session zone writes — the shop's day (Asia/Kolkata) is the same either way. `--schema` applies
both in number order.

## What you get

| | |
|---|---|
| shop | **Simulated Stores** · user id `simstores` · `simstores@test.example` (a `@test.example` fixture — a TEST business) · Country setup done (CS1: IN · INR · FY April · GSTIN 33… Tamil Nadu, regular) |
| counter | C1 · bills `C1/26-27/0001` … one series per financial year |
| shelf | 22 kirana items at 5 / 12 / 18 % (HSN on each), prices tax-inclusive (the shop's `price_includes_tax` default) |
| parties | Kumar Traders (supplier) · Ravi Stores (customer, credit bills, 10 days) |
| three years | 2–4 bills a day (cash · UPI · credit), a purchase on a third of the days, an expense on half, rent on the 5th; every month GST-closed and locked; each 31 March closed to the next year |
| books | opening cash 5,00,000 against capital · ≈ 3,300 bills · ≈ 400 purchases · ≈ 550 expenses · 36 months locked · 3 year closes |

The loader prints the proof it ran over the database: bills = the plan's count, day summaries = days with bills, purchases =
the plan's, the trial balance balances every month (lines AND the stored month summaries), cash opening + net flow = closing
for each year (stored summaries against the lines), 36 months locked, nothing waiting in `books_outbox`, every bill dated its
own simulated day. Exit 1 when a line is red.

## Running it again

* Same shop, same seed: **"already loaded"** — the counts, the login, nothing written.
* Same shop, another `--seed` / `--years`: refused — `--fresh` first.
* `--fresh`: removes that shop and its minted parties (a local database, as its owner), then loads.
* `--seed 11 --shop otherstores`: a second, different shop beside the first.

## RAM

The PC has about 2 GB free: run the load with **nothing else open** (no browser, no VS Code). The loader is the api itself
(≈ 150 MB) plus Postgres; the browser comes after step 2, not during it.

## An empty test database (not the stack's)

`--schema` gives an EMPTY database the repo's schema first (`migrations/000_baseline` → `_part2` → every `bNNN` in number
order, dry-runs / verifies / data scripts skipped; needs `psql` on PATH). It refuses a database that already has tables — the
stack migrates its own. The cloud round proved it on `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pw postgres:16`.

## What it does NOT do

* Never a raw INSERT into a tenant table; never a remote database; never a sealed `NODE_ENV`.
* Purchases from the local supplier post through `lib/books.postEntry` (the one writer the chit hook itself calls) — a
  minted local supplier has no rail copy to accept, exactly as Y1 posted them.
* `--country AU` (WX-R2R, 2026-10-13): a second shop beside the first — `--shop austores --country AU` — on a JULY year (the plan runs
  2026-07-01 → 2029-06-30; every item 10 %; AUD; Australia/Sydney days). Loads and proves 10 of 11 green on the cloud runner (WX-R2R, after main's engines v1.34): the outbox line is RED — every AU bill WAITS, in words, because the api's adopted accounts-packs (v1.20.0, India only) opens the AU ledger on India's chart, which has no GST head (the bill is never posted with its tax dropped), and the engine's `posting.daySummary` folds only India's heads. Both are engine work (web docs/testing/WX-R2R-2026-10-13.md E1 · E2). The calendar is the
  pack's: `lib/accounts-packs` fiscalYearOf · periodOf · fyRange with the Country setup's `fy_start_month`, never an April of the
  loader's own. The three api fixes the AU proof needed (the chit's currency is the sender's; `enable()` opens on the Country
  setup's currency and year start, on the shop's day; AU in `books-hooks` COUNTRY_ZONE) are held by `tests/chit-currency-default.test.cjs`.
