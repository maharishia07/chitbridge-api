# The counter

*What the till is, what it may be trusted with, and the traps that have already been paid for.*
Last worked on 2026-09-18.

---

## 1 · What it is

An offline-first point of sale that runs in a browser tab or as a small desktop kit. It holds the shop's
catalogue locally, bills without a network, numbers its own documents, and sends them to ChitBridge when the
line comes back. A counter is a **standing identity** (`C1`, `C2`, …) held by one PC at a time — not a device
registration — and the document series follows the counter, not the machine.

The claim it is built on, and the reason a shopkeeper would choose it:

* **Offline integrity.** Numbers are kept, not re-derived. A bill issued on a dead line is a real bill with a
  real number, queued and replayed. One counter is locked to one PC so two tills cannot issue one series.
* **Numbers a shopkeeper can defend.** MRP is named, the gap is stated as "₹12.00 under" and never as a fake
  saving, tax is shown separately, and every document says what it was *issued* with rather than what today's
  settings would compute.
* **It explains its own failures.** Why a bill is stuck, what is in the queue, what never reached the cloud.

---

## 2 · Where it lives

| | |
|---|---|
| **Master** | `tools/tally-connector/till.html` — one file, one inline `<script>` |
| **Vendored copy** | `chitbridge-web/public/till.html` — **generated, never edit** |
| **Vendor step** | `node scripts/vendor-till.cjs` — also copies the shared engines |
| **Shared engines** | `lib/*.browser.js` → `chitbridge-web/public/engine/*.js`, served to the kit at `GET /api/till/engine/:name` |
| **Tile library** | `lib/screen-kit.js` → `public/engine/screen.js` (`window.CBScreen`) |
| **Desktop kit** | `tools/tally-connector/till.js` — a local Node program that proxies and queues |
| **Server routes** | `routes/till.js`, `routes/counters.js`, `routes/quick-keys.js`, and `routes/chits.js` (documents) |

> ⚠️ **Editing the vendored copy is the classic wasted hour.** `till-vendor.test.js` compares them byte for byte
> and will fail the build; the fix is always to edit the master and re-run the vendor script.

---

## 3 · The standards it answers to

| Rule | Where it lands |
|---|---|
| **GST §34** — a return is a *credit note*: its own document, its own consecutive series, naming the original invoice and the reason | `retIssue()`, `KINDS.credit` |
| **GST invoice numbering** — 16 characters, `[A-Za-z0-9/-]`, consecutive per series, FY Apr–Mar | `lib/docnumber.js` `RULES.IN` |
| **GST §31** — tax invoice vs bill of supply vs cash memo | `shopTax().kind` → `bill.kind` |
| **COTPA 2003 §6** — no tobacco to anyone under 18 | `item_data.age_check`, `ageAllow()` |
| **State excise ages** (21, and 25 in a few states) | the same field — the age is the product's, never this file's |
| **GS1 "2" prefix** — in-store weighed barcodes, price- or weight-embedded EAN-13 | `weighRead()`, `ean13ok()` |

> ⚠️ **Country first.** Every rule above is named for India and then generalised, never the other way round.
> `lib/docnumber.js` keeps *law* (what a country permits) and *a shop's scheme* (what it chose within that) in
> two separate halves on purpose.

---

## 4 · What the counter is told — the snapshot projection

`GET /api/till/snapshot` (header `X-Api-Key`) returns the shelf. The projection in `routes/till.js`
(`tillItem`) is deliberately narrow: a shop of ten thousand products crosses the wire on every pairing.

**⚠️⚠️ The consequence, which cost a day: a feature whose data lives in `item_data` and is *not named* in that
projection does not exist at the counter, however well it is built.** Modifiers, combos and age checks were each
built, each covered by a passing test, and each found dead on a real shop — the tests injected rows straight
into the counter's own `S.items`, and real products arrive through the snapshot, which dropped every one of
those fields in silence.

The fields a counter ACTS on, and which must never fall out of it: `image · modifiers · combo_of ·
age_check · mrp · tax_slab`. (The projection carries more than these — pricing tiers, aliases, the shop block —
but those six are the ones an engine in till.html reads to DECIDE something.)

`tests/snapshot-wire.test.js` now guards this list and fails when a field the counter *acts on* stops being
carried. **Anything a counter must act on belongs in the projection the moment it is built.**

---

## 5 · The documents it issues

| Kind | Tag | Example | Series |
|---|---|---|---|
| Sale | *(none)* | `C1/26-27/0041` | the counter's own run |
| Goods receipt | `G` | `G/C1/26-27/0007` | its own |
| Despatch note | `D` | `D/C1/26-27/0004` | its own |
| **Credit note** (a return) | `C` | `C/C1/26-27/0001` | **its own — §34** |

`KINDS` in `lib/docnumber.js` is the whole vocabulary, and the counter's own short tags (`GRN`, `DC`, `CN`) map
through `DOC_TAGS` in till.html.

> ⚠️⚠️ **An unregistered kind silently becomes a sale.** `compose()` looks up `KINDS[kind]`, gets `undefined` for
> a kind it does not know, skips the tag — and hands back the next *sales* number. Two document types in one
> run, discovered at filing. `tests/docnumber.test.js` asserts this fallback deliberately, so the next person
> meets it in a test rather than in a return.

> ⚠️ **The tag costs a character.** A credit note's till-id ceiling is one lower than a sale's. `maxPrefix()` is
> advisory (only tests read it) but it is true.

**A bill goes out as a chit**, not to a till endpoint: `POST /api/chits/send` with `purpose:'order'`, the
document number as `client_ref`, and everything else in `business_json`. A credit note is the same road with
`purpose:'credit_note'`. Replay is safe because `client_ref` + `billed_at` dedupe server-side; a same-number
different-moment clash returns **409 `TILL_SERIES_COLLISION`** and the counter renumbers.

---

## 6 · Where each setting lives

Three places, and confusing them is the most common bug in this file.

| Scope | Stored | Examples |
|---|---|---|
| **This device** | `localStorage`, keyed per shop (`shopLs`) | the chosen group, photos on the shelf list, the printer, the look |
| **This counter** | server, per counter | active quick-key groups, sold-out items, screen config |
| **The shop** | server, shop-wide default | quick-key *groups*, the default screen config, `config.till` |

> ⚠️⚠️ **A setting that only lives on the device is a setting a chain must configure by hand on every machine.**
> This has now bitten three times: quick-key groups, the screen config, and the kitchen/weighing switches. Each
> was authored centrally, reachable through an endpoint both key allow-lists already permitted, and simply never
> fetched. The pattern to copy is `quickSyncGroups()` / `quickSyncScreen()`: throttled, cached so it survives the
> line dropping, and **filling blanks only** — a choice made at this counter always wins.

`config.till` on the shop-wide screen config carries the counter's *kind*: `{ kot: true }` for a hotel,
`{ weigh: { on: true, prefix: '2', kind: 'price' } }` for a market.

---

## 7 · Offline

`CloudHost.tillPost(path, body, opts)` queues anything it cannot send — **there is no allow-list in the browser
host**, so a new endpoint queues automatically. Three behaviours to design around:

1. **A 4xx is final and is never queued.** A server-side validation refusal is *lost*, not retried. This is why
   a new `purpose` must be added to `routes/chits.js`'s `.isIn([...])` before anything sends one.
2. `{ noQueue: true }` makes a failure a real failure — for anything that is an *intention* rather than a fact.
   A sale, or a return that has already happened at the counter, must queue.
3. The **409 renumber** path only runs for `isSaleRow(bill)`, which is an **allow-list** of sale kinds
   (`null | 'cash' | 'tax' | 'supply'`). It used to be a deny-list, so anything invented later was a sale by
   default and a credit note would have been renumbered out of the sales series.

### ⚠️⚠️ The two allow-lists that gate a till key

A route is refused with a bare 403 unless it is in **both**:

1. `KEY_ROUTES.till` in `middleware/auth.js`
2. `ALLOW` (POST) / `READ` (GET) in `tools/tally-connector/till.js` — exact strings, no patterns

`POST /api/till/flags` once shipped without the first, so "show on the shop screen" saved locally and was
refused by the server every single time.

---

## 8 · What it does, and what proves it

| Feature | Case | Covered by a test? |
|---|---|---|
| Quick keys, groups, sold-out tray | `[TILL-28]` | ✅ e2e |
| The menu, both widths | `[TILL-31]` | ✅ e2e |
| Left / right-handed mirror | `[TILL-32]` | ✅ e2e |
| Weighed labels (EAN-13, GS1 "2") | `[TILL-34]` | ✅ e2e |
| Age-restricted items, and the chooser the search box skipped | `[TILL-41]` | ✅ e2e |
| Returns as GST §34 credit notes | `[TILL-42]` | ✅ e2e + docnumber unit tests |
| Modifiers | `[TILL-33]` | ⚠️ partial — the [TILL-41] chooser test covers required groups |
| Kitchen tickets, order types, tables | `[TILL-35]` | ✅ e2e — sent-once, and no money on the ticket |
| The shop's groups reach the counter | `[TILL-36]` | ✅ e2e — including copy-on-write |
| The shop's screen config reaches it | `[TILL-36b]` | ⚠️ **no e2e** |
| The bill in pictures, the cart chip | `[TILL-37]` `[TILL-38]` | ⚠️ **no e2e** |
| Arrange — drag a key where you want it | `[TILL-39]` | ✅ e2e — including "a tap must not sell" and Escape |
| The printable day report | `[TILL-40]` | ⚠️ **no e2e** |
| Combos | `[TILL-43]` | ⚠️ **no e2e** |

> ⚠️ **The second half of that table is the honest state, not an oversight to be tidied away.** Those features
> were built and verified by hand against a real shop; they have no standing assertion, so nothing will tell
> anyone when one of them breaks. Three of them ([TILL-33], [TILL-36], [TILL-43]) were found DEAD on a real
> shop precisely because the thing that would have caught it did not exist.

Run everything: `node scripts/guards.cjs` (781 checks, 46 files) · `npm run check` in chitbridge-web ·
`node e2e/till-contrast.cjs` (78 contrast + registry-parity checks) · the Playwright specs in
`chitbridge-web/e2e/tests/till-*.spec.js`.

---

## 9 · What it cannot do

Stated plainly, because a gap somebody discovers in a shop is worse than a gap written down.

* **A return is recorded, but only cash actually moves.** "Back in UPI" is a fact the shopkeeper asserts; there
  is no NPCI mechanism here to send it.
* **Points already given on a returned bill are not clawed back.** `lib/rewards.js` refuses to *mint* on a
  non-positive net, so the credit note awards nothing, but `POST /api/till/reward` is append-only by design.
* **GSTR-1 has no credit-note tables.** `lib/tax-lines.js gstr1()` emits `b2b`/`b2cs`/`hsn` and no
  `cdnr`/`cdnur`. The file already says *we do not file*, so this is not a live wrong answer — but a shop
  reconciling by hand will find returns missing.
* **A return must be taken at the counter holding the bill.** `retOpen()` reads the local store.
* **No training mode, no void/discount authorisation by role, no tips.**
* **Self-checkout weight verification** is not built (and is only worth it if a kiosk ever takes payment
  unattended).

---

## 10 · Working on it

1. Edit the **master**, never the vendored copy.
2. `node scripts/vendor-till.cjs`
3. `node scripts/guards.cjs` — and if a guard fails for a reason that is *not* the reason it exists, fix the
   guard's expression rather than weakening the assertion (the tax-reformula guard read a fixed 2400-character
   window and failed on a comment; it reads to the closing brace now).
4. Syntax-check the inline script before trusting a patch — `node -c` does not see inside HTML.

### Traps already paid for

* **Two functions, one name.** A second `offerWords()` hoisted over the first and every key printed *"off — the
  offer does not reach this product"* under its price. Legal JavaScript, clean parse, 774 guards green, caught
  only because somebody was looking at the screen. `tests/one-name-one-function.test.cjs` exists for this.
* **A fixed pixel height inside a flexible tile.** `--sk-ph:150px` in a 137px tile with `overflow:hidden`
  rendered the name at y=396 in a button ending at y=378. Photos take an **aspect ratio** and *give way first*;
  the words never shrink.
* **A second `class=` attribute is silently ignored.** The tile library already writes the button's class;
  state rides on `data-` attributes instead.
* **Escape clears the bill.** Any new mode you can back out of must claim Escape *before* the basket sees it —
  `[TILL-30]` is the scar.
* **Read the answer before closing the dialog.** `modClose()` nulls the state `modChosen()` reads, so closing
  first added every order with no choices at all.
* **A CSS override must come after the rule it overrides.** A media query adds no specificity.
* **`node -e` eats backslashes.** Write patch scripts to a file and run the file.
