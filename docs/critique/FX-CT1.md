# FX-CT1 critique — the day report must not close a day the server disagrees with
(a) Brief's assumptions, checked
- Day report reads only the device copy: TRUE — dayClose() → HOST.bills() → DB.all('bills') (till.html dayClose, CloudHost.bills).
- An existing server read holds the counter's bills: TRUE — GET /api/till/bills (routes/till.js:2316), already called by
  CloudHost.history(); each row carries till.id. FALSE that it can answer "this counter today" well: no counter filter, and
  LIMIT runs before any filter (a busy shop's other counters crowd it out) → WIDEN it with an optional `till=` (SQL), add no route.
- "F4 / re-read the shop" re-reads bills: FALSE — refresh() reads the snapshot (products, prices) only → widen it to also
  pull this counter's day from the server into the device store.
- A wiped browser keeps the same counter id: TRUE once the shop is read — the snapshot's till.counter sets tillId() (till.html ~6060).
(b) Conflicts: none with one-place rules — the comparison is set-of-bill-numbers + the till's own r2 sum of totals the
  report already shows (no second tax/money engine). The server answers what it holds; the page only greys the close WITH its
  sentence. Close the COUNTER (sureSheet 'close', break/billing stop) is a different act and is not touched.
(c) Simpler: compare count + total only → cannot say WHICH bills, and a fix that re-reads would need the list anyway. Comparing
  bill numbers gives the same count/total sentence and the exact rows to restore. Chosen.
(d) Risks: restored rows must never re-send (they carry _sent.chit_id + _verified, never enter the queue); a restored row's shape
  is the /bills row, normalised (customer → {name}). Rows the DEVICE has and the server lacks are usually still queued — the
  sentence says so and its button sends them (HOST.drain), not a re-read. No migration (b370–b372 unused). Twin PRs: web first
  (vendored copy + harness), then api. Other rounds touching till.html: merge risk only.
(e) VERDICT: BUILD WITH CHANGES — widen GET /api/till/bills with `till=`; compare by bill number; the reverse case's button
  is "Send them now", not a re-read.
