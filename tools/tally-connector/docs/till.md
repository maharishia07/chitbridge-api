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

## Three jobs, one screen

The menu at the top left says which job the counter is doing. Each has its own rules, and they never mix.

| | |
|---|---|
| **🧾 Sell** | the counter — bill a customer, take the money, print the slip |
| **📥 Receive** | goods coming in — count what the lorry actually brought |
| **📦 Despatch** | goods going out — pack an order, scanning every item |

The search box works the same way in all three; what it *does* changes. In Sell it puts an item on the bill, in Receive it counts an
item in, in Despatch it checks the item against the order.

## Receiving goods

Press **📥 Receive**.

1. **Choose the order** at the top, if you placed one. The lines appear with what is still owed. If there was no order — a lorry with
   just a challan — leave it on *"No order — goods at the door"* and simply scan what arrived.
2. **Who it came from**, and **their bill number** if they brought one. Those four boxes (who, bill no, date, total) are all we ask.
3. **Count.** Scan or type each item; `3*` and `0.75 x` work here too. Type the count in the box beside each line.
4. **A difference needs a reason.** Short by two bags? The screen asks why — damaged, not sent, rejected at the door. Two extra?
   That is accepted too, and marked. **What you counted is what the receipt says.** We never change your count to match their bill.
5. **Freight and costs — F5.** Lorry, loading, duty, anything else. They are spread across the lines by value, so each item's *real*
   cost includes its share of the freight. That is what your margin should be worked out on.
6. **F9** confirms. A receipt is recorded and printed, and if it was against an order, what arrived is recorded on that order too —
   in both your copy and the supplier's.

If their bill total is typed in, the screen says plainly whether it agrees with what you counted, and by how much if it does not.

## Sending goods out

Press **📦 Despatch**.

1. **Choose the order** you are packing. Every line shows what is owed.
2. **Scan each item as it goes in the carton.** The count fills up; a full line turns green.
   - Scan something that is not on the order → refused, with the reason.
   - Scan more than was ordered → refused at the ordered quantity.
3. **Next carton — F8** starts a second box. Type the weight of each if you have a scale; it goes on the slip.
4. **Short?** Say why — no stock, damaged, collecting later. The customer hears it today rather than at delivery.
5. **F9** packs and despatches: a packing slip prints, and the order is updated in your copy and the customer's.

If the customer is on ChitBridge, that despatch note becomes **their** receiving screen, already filled in with what you say you sent.
Their count at the door is the second, independent record — and if the two disagree, both are kept and neither is quietly corrected.

## What is deliberately NOT here

Bin locations, pick routes, stock counting, a warehouse system. We record what the shop **witnesses** — what came in, what went out,
what was sold. Whatever you count on a Sunday belongs in Tally, and we connect to it.

## When the supplier calls it something else

Their delivery note says **SUNFL OIL 1L RB**; your shelf says **Sunflower oil 1 L**. Tell the counter once — on the received line,
press **what do they call it?**, type their wording, and if their pack holds more than one of yours, say how many (1 carton = 24
pieces).

From then on: typing or scanning **their** code finds **your** product, and one of their cartons counts as twenty-four of yours.
Without that conversion a perfectly correct delivery reads as a twenty-three unit shortage, which is where most arguments with a
supplier actually start.

## When a difference is not worth a phone call

A lorry of rice does not arrive to the gram. Your trade sets, once, how much it absorbs — half a percent on weighed goods by
default, and **nothing** on packed goods, because a packet is a packet.

- Inside that, the line says *"short 2 kg — within what this trade absorbs"* in green, and asks you for no reason at all.
- Outside it, the line turns orange and asks **why**, as before.

Both numbers always stay: what was ordered and what you counted. Tolerance decides what is worth a conversation, never what is true.

## If you sell medicine, food or anything with a batch

Set your trade once in ChitBridge (Profile → sectors). The counter then asks for what that trade needs, per line, when goods come in:

- **Medicine** — the batch and the expiry (MRP and the manufacturing date if you want them).
- **Food** — the batch, and the best-before if it is printed.
- **Electronics** — the serial number of each unit.
- **Anything else** — nothing at all. A general shop never sees these boxes.

**You will rarely type any of it.** Scan the barcode on the pack: a GS1 code carries the batch and the expiry, and the boxes fill
themselves. If the barcode will not read, type it as printed — `(10)AC2431(17)280331` — and it is read the same way.

**Stock that has already expired cannot be taken in.** That is a refusal, not a warning: the date is on the pack, and accepting it is
your licence rather than a preference. A missing batch or expiry is simply asked for — the answer is in your hand.

## The printer

A USB till printer needs its **driver installed once**. Plugging in the cable is not enough — until the driver is there, Windows has
the device but no printer to send anything to, and nothing on this PC can print to it.

**Epson TM series** (TM-m30, TM-T82, TM-T88 and the rest): install Epson's **Advanced Printer Driver**, from
`download.epson-biz.com` → Printer Driver → your model. Run the installer with the printer plugged in and switched on; it creates a
printer called something like *EPSON TM-m30 Receipt*.

Anything else: the maker's own Windows driver. A "Generic / Text Only" printer also works, but you lose the automatic cut.

Then, in the counter: **⚙ → Printer**. Choose it, say whether the paper is 80 mm or 58 mm, tick the cash drawer if one is plugged
into the printer, and press **Print a test slip**. If the test comes out, every bill from then on prints by itself — no dialog, no
choosing, and the paper is cut for you.

| What you see | What it means |
|---|---|
| The list is empty | Windows has no printer at all yet — install the driver above |
| The printer is listed but nothing prints | Check the paper roll and the lid; then press *Print a test slip* again and read the line under it |
| "not printed — …" under a bill | The bill is **saved and sent**; only the paper failed. Fix the printer and reprint from 🧾 bills |

The counter never waits for a printer. A jammed or unplugged printer is a small line under the bill, never something to dismiss
before the next customer.

**In a browser** (a phone, a tablet, or the counter opened from ChitBridge) there is no way to print without the print dialog — that
is a rule of browsers, not a choice of ours. Pick the till printer in that dialog once and it is remembered. To have slips print by
themselves, put the counter on the shop PC.

## How an update reaches this counter

The counter checks with ChitBridge every fifteen minutes, and it keeps itself current — you never download the kit again.

- **A new screen** is written to this PC straight away. The footer then says *"A newer counter screen is ready — press F5 between
  customers."* Press F5 when there is a gap. Nothing on the bill is lost.
- **A new program** is downloaded but **not** used until the next time this PC starts the counter. The footer says so, and there is
  nothing for you to do. If the new one would not start, it is refused and the counter goes on using the one it has — the version it
  replaced is always kept beside it as `till.js.bak`.

Nothing is ever written unless it arrives whole, and nothing is downloaded twice.

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
