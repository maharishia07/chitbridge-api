# Variants — one product, many combinations

> Athi, 2026-09-19: *"that need not be only a restaurant problem, i could visualise in multiple other
> industries too — same product, but combinations can be different. in the cart, it has to be identified as a
> separate item, possibly product code with some other field to distinguish it differently. **if the same
> choice is chosen again, it has to be added to the existing cart.**"*
>
> And: *"these are all should be as a module and we should be able to re-use… a proper write-up has to be
> there."*

**Module:** `chitbridge-web/public/app/variant.js` → `CBVariant`
**Served as:** `/engine/variant.js` (web) · `/api/till/engine/variant` (shop PC) · `lib/variant.browser.js` (API)
**Tests:** `tests/variant.test.js` (20) · the seam is guarded in `tests/snapshot-wire.test.js`
**Drives:** the counter's bill lines, the chooser, kitchen tickets

---

## 1. What a variant is

A **variant** is a product plus the choices made about it.

| Trade | Product | Choices | Why they are different lines |
|---|---|---|---|
| Restaurant | Pizza | Pepsi · Cola | two people at one table |
| Hardware | 8 mm rod | cut to 4 ft · 6 ft | two different cuts, one SKU |
| Clothing | Shirt | blue/L · blue/M | one style, two garments |
| Services | Installation | standard · next-day | one service, two prices |
| Pharmacy | Syrup | 100 ml · 200 ml | one medicine, two packs |

It is **not** a restaurant idea. It is what happens whenever the catalogue entry is narrower than the thing
actually sold — which is most catalogues, most of the time.

---

## 2. The one rule

> **The same set of choices must always produce the same name, and a different set must never produce it.**

Both halves fail **silently**, and that is what makes this worth a module of its own:

- break the first → a bill grows **two identical rows**. A kitchen makes two of something ordered once; a
  warehouse picks twice; the customer is charged twice and the total looks perfectly correct.
- break the second → two different things **merge into one line**. Somebody receives the wrong goods, and
  again the arithmetic is flawless.

Neither shows up as an error. The bill adds up and is wrong.

### ⚠️ The bug this was extracted for

The signature used to be built in the order somebody **tapped**:

```
Paneer then Cheese  →  Extra:Paneer,Extra:Cheese
Cheese then Paneer  →  Extra:Cheese,Extra:Paneer      ← two keys, two lines, identical pizzas
```

It never showed up in single-choice groups, because the chooser walks the *groups* in order — so with one pick
per group the order was fixed **by accident rather than by rule**. The moment a group allowed two extras, the
same combination had two names.

**A signature built in the order somebody's hand moved is not a signature.** `CBVariant.sig()` sorts.

---

## 3. The shape of a choice

```js
{ group: 'Extra', option: 'Paneer', price: 20 }
```

Three fields, nothing else is read, so any surface can build one — a counter, a storefront, an order arriving
over WhatsApp, a connector importing from an ERP.

⚠️ **`price` is not part of the identity.** A price rise must not split a line in two.

---

## 4. The API

```js
CBVariant.sig(mods)                  // 'Extra:Paneer,Spice:Hot' — canonical, sorted
CBVariant.keyOf(itemId, mods)        // 'p1|Extra:Paneer,Spice:Hot' — the line's identity
CBVariant.same(a, b)                 // do two sets mean the same thing
CBVariant.addedPrice(mods)           // what the choices add to ONE unit, rounded to paise
CBVariant.groupsOf(item)             // the options a product offers, or []
CBVariant.missing(groups, mods)      // required groups still unanswered, by NAME
CBVariant.words(mods, money)         // 'Hot · Paneer +₹20.00'   — a bill line
CBVariant.wordsPlain(mods)           // 'Hot · Paneer'           — a kitchen ticket
CBVariant.byGroup(mods, groups)      // regroup a flat list, to reopen a chooser on a line
```

### What it deliberately does **not** do

- **It does not hold a cart** or know what a line is. It answers four questions about a set of choices; the
  surface owns its own list.
- **It does not format money.** `money` is passed *in*. `CBMoney` owns currency, and a second opinion about how
  to write ₹ is how one screen comes to disagree with another.
- **It does not price a bill.** `addedPrice` is per *unit*; quantity is the caller's business.

---

## 5. How the counter uses it

| Counter function | Delegates to |
|---|---|
| `lineKey(item_id, mods)` | `CBVariant.keyOf` |
| `modsOf(item)` | `CBVariant.groupsOf` |
| `modAdd(mods)` | `CBVariant.addedPrice` |
| `modWords(mods)` | `CBVariant.words(mods, money)` |
| `modWordsPlain(mods)` | `CBVariant.wordsPlain` |
| `modMissing()` | `CBVariant.missing` |

`addItem()` then merges on the key:

```js
var key  = lineKey(i.item_id, mods);
var have = CART.filter(c => (c.key || c.item_id) === key)[0];
if (have) have.qty = r2(have.qty + n);     // ⭐ the same choice again joins the existing line
```

⚠️ **No fallback copy.** A missing engine is a visible, blocking state on this counter
(`engineMissed('variant')` → *"press ↻ while online"*), never a quiet second implementation. Keeping the old
bodies "just in case" would be the drift the module exists to remove — and the copy left behind would be the
one with the bug.

---

## 6. The three ways a person gets a second combination

1. **Add, then another** — a button in the chooser. Commits what is on screen and reopens an empty chooser for
   the same product. A table of four ordering four combinations is one dialog, four times, with no trip back to
   the shelf. *(`modAddAnother`)*
2. **Split one** — on a line of two or more. Takes **one** off (a line of five becomes four and one, because
   the person asking is one customer at a table of five) and opens the chooser on it. If they change nothing,
   it rejoins — two identical lines is a kitchen making two of something ordered once. *(`cartSplit`)*
3. **Change** — on any line, reopens the chooser seeded with what is already chosen. If the new choices match
   another line, they **merge**. *(`modEdit`)*

---

## 7. Where else this belongs

Written for the counter, but the rule is the platform's. Anything that puts a chosen product on a document
should ask `CBVariant` rather than decide for itself:

- **the storefront** — a customer choosing before they arrive
- **order capture** — a WhatsApp order naming "pizza, no onion"
- **the connector** — an ERP line whose SKU is the product and whose description is the combination
- **inventory** — whether two picks are the same pick

⚠️ The day a second surface needs this, it calls the engine. **It does not reimplement the sort.**
