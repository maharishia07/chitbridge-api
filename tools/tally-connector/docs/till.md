# The counter — billing on your own PC, or on a phone

A till that works when the internet does not, and puts every sale on ChitBridge the moment it can.

**What you need.** Any PC with Node.js 18 or newer (the installer puts it there if you have none) — or nothing at all, if you would
rather use a phone or a tablet.

---

## The short way — a phone or a tablet, no installation

1. ChitBridge › **Settings › Integrations › Keys** → mint a key, scope **till**. Copy it.
2. On the device, open **`<your ChitBridge address>/till.html`**.
3. Press ⚙, paste the key, Save. It reads your shop once.
4. Your browser will offer to **install** it — say yes, and it opens like an app, with or without a connection.

## The counter way — a PC at the till

1. Download the connector kit (Settings › Integrations › Connectors) and unzip it on that PC.
2. Double-click **start.cmd** once — it installs Node.js if needed and stores your key.
3. Then run: `node till.js` — it prints **http://127.0.0.1:7071**. Open that in the browser, and leave it open.
4. To have Windows keep it running: `node index.js install` registers the connector; run `node till.js` from a shortcut in Startup,
   or ask us and we will register the counter the same way.

---

## Using it

| | |
|---|---|
| **F2** | jump to the search box |
| **↓ ↑ and Enter** | choose an item and add it |
| **F9** | save and print |
| **Esc** | clear the bill |
| **F4** | read the shop again (new prices, new items) |
| **F6** | park the bill — a customer walked off, the queue carries on |
| **F7** | who is at the counter, and handing over |
| **F8** | today's bills, and earlier ones |
| **F10** | the day-close sheet |

A barcode scanner types — scan into the search box and the item is added.

### Three of something, or three-quarters of a kilo

Type the quantity **in front of** the name:

- `3*rice` — three of it, in one go.
- `0.75 x tomato` — nought point seven five. This is how a weight you read off the scale gets onto the bill.

A green line above the list tells you what is about to happen. A product genuinely called "2x4 nail" is still found — the x only
counts as a multiplier when there is a space after it.

### Closing the day

**F10**, or the button in F8. It prints on the same paper as a bill and says: how many bills and from which number to which, what the
offers gave away, the tax split by rate, how it was paid, who billed, the ten that sold most, and what should be in the drawer —
the float you started with plus the cash taken. Count the drawer, then hand over (F7) to record the difference.

It counts **this counter**, today, and says so at the bottom. A shop with two counters closes each of them; ChitBridge is what adds
them up.

The **⚙** button holds everything that belongs to this device: the counter's name (it becomes the bill number's prefix), the text
size, and light or dark. None of it leaves the device.

## What the bill number means

`C1/26-27/0041` — counter C1, financial year 2026-27, the forty-first bill. The series is continuous within the year and belongs to
this counter, so two tills never issue the same number, and a till with no internet never has to ask anybody.

## What happens when the line goes down

Nothing stops. The bill is written down, the number carries on, and the screen says how many are waiting. When the line returns they
go across by themselves — **once**: each bill carries its own number, and ChitBridge answers a repeat with the bill it already has.

Prices are the ones from the last time the shop was read; the header says when that was. Change a price in ChitBridge and the counter
picks it up at the next read, or when you press F4.

## What it does not do yet

Returns, credit notes, cancelling a bill that has been issued, holding a bill while a customer fetches one more thing, stock
counting. Version 2 — and if you need stock control today, connect Tally, Zoho or GoFrugal and keep using them for it.

## If something looks wrong

| You see | It means | Do |
|---|---|---|
| `No copy of the shop yet` | it has never reached ChitBridge | press ↻ once with the internet on |
| `no key yet` | the browser till has not been paired | ⚙ → paste a key with scope **till** |
| `prices as at 09:14 · 6 h old` | it has been offline for a while | fine to keep billing; press ↻ when the line is back |
| `3 bills waiting to reach ChitBridge` | they are safe on this device | nothing — they go by themselves |
| `the offers engine is not here yet` | the first read has not happened | press ↻ with the internet on, once |
| the printed slip is cut short | the printer's paper width is set wrong | printer settings → paper = the roll (80 mm or 58 mm), margins none, scale 100% |

## For whoever maintains this

- The page is one file with two hosts (the little program, or the browser on its own) — `tools/tally-connector/till.html`, copied to
  the web by `scripts/vendor-till.cjs`. Never edit the copy.
- It prices with the same two engines the server runs (`CBOffers`, `CBTax`), cached on the device. It does not reimplement anything.
- A bill becomes an ordinary chit through the ordinary send path, with `client_ref` for idempotency. There is no second writer.
- Proofs: `[TILL-01]` (a real browser, online and offline) and `tests/till-vendor.test.js` (the copies, and the money).
