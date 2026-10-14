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
* `--start 2023-04-01 --shop pastStores`: the three years END before today (2023-24 · 2024-25 · 2025-26), so today is an open year after
  them — what a walk does today is the newest record, in an unlocked month. The default (2026-04-01) runs into 2029 with every month locked:
  a bill made today then posts on the first open day (1 Apr 2029) and sits under 2½ years of newer rows (WX-O2C, 2026-10-13).

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
* `--country AU` and `--country AE` are accepted (CX0, 2026-10-13) but unproved — IN is what Y1b checked. The loader READS the
  shop's currency, financial year, tax heads, scheme and rate menu from its regulation pack (`lib/regulation.packFor`), and types
  only what no pack says (`SHOPS` in sim-load.cjs: a sample GSTIN · ABN · TRN that passes the pack's own check, the street, the
  city's clock offset and zone). The plan's 5 · 12 · 18 % draws land on a one-rate scheme's standard rate (AU 10 %, AE 5 %); a `upi`
  sale becomes `card` where the pack has no upi mode. ⚠️ Until the api adopts the books engines ≥ v1.41 (its `accounts-packs` is
  v1.20 — `PACKS.IN` only, so `packFor('AU'|'AE')` is India's chart with `fallback: true`, and `posting` knows only cgst · sgst · igst ·
  cess), an AU/AE load gets India's books: purchases carrying a `gst` / `vat` head post no tax and the proof is RED on them. The audit
  and the fix order: chitbridge-web `docs/design/standards/COUNTRY-COVERAGE.md`.

## Scale — ONE shop at 10k · 50k · 100k journal lines (PERF1, 14 Oct 2026)

Athi, 14 Oct: *"assuming a ledger has 1000 entries … are you loading all at once? … check all the data retrieval logic"*. `--scale` grows the
shop past the plan and times every hot read (`tools/sim-scale.cjs`, called by this loader):

```
node tools/sim-load.cjs --db postgres://postgres:pw@127.0.0.1:5432/cb_sim --shop scale100 --start 2023-04-01 --years 3 --scale 100k
node tools/sim-load.cjs … --scale 100k --scale-reads [--scale-only ledger]      # time again, nothing written
```

* **Grows** (resumable — a second run tops up): 500 customers (POST /api/relationships/customers) · 10,000 products (POST /api/products/bulk) ·
  credit and cash bills through `lib/books.postEntry` (the one writer, `source_ref scale:<n>`) · payments through POST /api/books/payments
  until ≤ 5,000 bills stay open — all in the open year after the plan (1 Apr → 13 Oct 2026). Then `ANALYZE` (a shop bulk-loaded a minute ago has
  no planner statistics; a live database is analysed as it grows — without it a ledger page read in 15 s on row estimates of 1).
* **Times** each read 20× over HTTP: p50 / p95 ms, rows, KB, `X-DB-Trips` (lib/trips, `CB_TRIPS=1`). A read past 3 s (or failing) is timed once.
* **Proves**, on the real database: the cash ledger walked in pages of 500 = the whole ledger, line for line and running balance for running balance.

The shops (runner, Postgres 16 in docker, api in the loader's process): **10k** = 1 plan year + growth (9,999 lines · 2,401 entries · 749 open
items) · **50k** = 3 plan years + growth (49,999 lines · 12,830 entries · 3,281 open) · **100k** = 3 plan years + growth (99,989 lines · 26,827
entries · 24,665 party items, 5,781 open) — each with 500 customers and 10,000 products. **Before** = main at 3efa3539 without b406; **after** =
PERF1 with `migrations/b406_perf1_read_indexes.sql`. Budget: every read < 300 ms p95 at 100k.

| read (p95 ms over 20 calls) | 10k before | 10k after | 50k before | 50k after | 100k before | 100k after | rows · KB at 100k after |
|---|---|---|---|---|---|---|---|
| Day book · one day | 19 | 10 | 77 | 10 | 355 | 16 | 99 · 79 |
| Day book · FY (whole) | 1455 | 85 | 9188 | 994 | **HTTP 500 at 15015** | 1471 | 24163 · 18462 |
| Day book · FY, page 1 (limit 100) | 1451 | 19 | 9201 | 38 | **HTTP 500 at 15017** | 72 | 100 · 80 |
| Ledger · cash FY (whole) | 225 | 30 | 5440 | 101 | **HTTP 500 at 15045** | 243 | 14442 · 3519 |
| Ledger · cash FY, page 1 (limit 100) | 222 | 18 | 5443 | 29 | **HTTP 500 at 15046** | 34 | 100 · 24 |
| Party statement · busiest | 29 | 17 | 167 | 28 | 1144 | 62 | 58 · 23 |
| Trial balance | 307 | 17 | 760 | 44 | 2482 | 84 | 12 · 1 |
| P&L | 302 | 15 | 782 | 43 | 2462 | 78 | — · 0 |
| Balance sheet | 317 | 17 | 758 | 48 | 2467 | 78 | — · 4 |
| Dues | 56 | 29 | 370 | 107 | 941 | 221 | 251 · 66 |
| Cheques | 238 | 5.1 | 240 | 24 | 234 | 24 | 0 · 0 |
| CRM list | 134 | 132 | 206 | 214 | 329 | 327 | 500 · 454 |
| Customers list | 28 | 30 | 102 | 92 | 219 | 228 | 500 · 330 |
| Inbox p1 | 15 | 16 | 34 | 34 | 33 | 34 | 20 · 69 |
| Inbox p50 (OFFSET) | 23 | 14 | 62 | 37 | 60 | 37 | 20 · 69 |
| Inbox p50 (keyset ?after) | 21 | 13 | 61 | 5.7 | 60 | 8.4 | 20 · 69 |
| Till snapshot · full | 145 | 140 | 169 | 173 | 217 | 208 | 10000 · 6666 |
| Till snapshot · since | 31 | 29 | 60 | 55 | 98 | 97 | 0 · 594 |


**Still over budget at 100k, said plainly:** *Day book · FY (whole)* 1.5 s / 18 MB and *Ledger · cash FY (whole)* — the screens still ask
for the whole range; the pages exist (`?limit · ?after`, 34–72 ms) and the web's Day book / Ledger adopt them in PERF2 (CBList `remote` needs the
server-side filters first — docs/critique/PERF1.md). *CRM list* 327 ms — its own select over 500 parties (~95 ms) and the open-items engine over
every listed party (lib/crm.js; the party-fields read is now only the page's parties). *Till snapshot · full* is 16 trips and 6.6 MB for 10,000
products — unchanged by PERF1 (the `since` poll is the one the counter repeats).
The plans (EXPLAIN ANALYZE, before / after) for the top five: `docs/perf/PERF1-EXPLAIN.md`.

## The three shops the WX walks load (real-stack setup)

```
node tools/sim-load.cjs --db postgres://postgres:pw@127.0.0.1:5432/cb_sim --shop simstores --country IN --years 1
node tools/sim-load.cjs --db postgres://postgres:pw@127.0.0.1:5432/cb_sim --shop simsydney --country AU --years 1
node tools/sim-load.cjs --db postgres://postgres:pw@127.0.0.1:5432/cb_sim --shop simdubai  --country AE --years 1
```
Sign in as the shop's user id with the DEV_OTP code; each shop is its own entity (a country is fixed at registration — no conversion).
* `--country AU` (WX-R2R, 2026-10-13): a second shop beside the first — `--shop austores --country AU` — on a JULY year (the plan runs
  2026-07-01 → 2029-06-30; every item 10 %; AUD; Australia/Sydney days). Loads and proves 10 of 11 green on the cloud runner (WX-R2R, after main's engines v1.34): the outbox line is RED — every AU bill WAITS, in words, because the api's adopted accounts-packs (v1.20.0, India only) opens the AU ledger on India's chart, which has no GST head (the bill is never posted with its tax dropped), and the engine's `posting.daySummary` folds only India's heads. Both are engine work (web docs/testing/WX-R2R-2026-10-13.md E1 · E2). The calendar is the
  pack's: `lib/accounts-packs` fiscalYearOf · periodOf · fyRange with the Country setup's `fy_start_month`, never an April of the
  loader's own. The three api fixes the AU proof needed (the chit's currency is the sender's; `enable()` opens on the Country
  setup's currency and year start, on the shop's day; AU in `books-hooks` COUNTRY_ZONE) are held by `tests/chit-currency-default.test.cjs`.
