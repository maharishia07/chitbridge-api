# L3 prose proposals — `public/app/price-resolve.js`

PROPOSAL ONLY. Nothing in the source file was modified.
Scan: `node e2e/prose-scan.cjs --interp --file app/price-resolve.js` → 4 interpolated sites.

Result: **4 propose-ready** on the work-list.
⚠️ **1 MONEY-FORMATTING DEFECT found off-list (line 150)** — see the section at the end. It is the serious one.

Verified: `node e2e/l3-verify.cjs e2e/l3-proposals/price-resolve.md` → **4 pairs · 4 faithful · 0 TEXT CHANGED**.

---

## ⚠️ READ FIRST — a decision that gates every proposal in this file

`price-resolve.js` is documented at the top of the file as **PURE** — *"Entries in, a decision out. It mutates
nothing, fetches nothing"* — and as **not wired** (*"Nothing calls this yet"*). Its strings are the `why` /
`explain` values that justify a price.

The file header also says why those strings exist:

> `resolve()` returns the winning entry AND every entry it rejected with the reason. **"Why am I paying 340 and
> not 325?" must have an answer six months later** … disputes are the product.

So there is a real question the reviewer must answer before any of these four are applied:

**Is a rejection reason UI text, or is it a record?**

- If it is **UI text**, `txf` is right and these four proposals stand as written.
- If it is ever **persisted** — into a chit, an audit row, a dispute — then translating it at generation time
  stores whichever language the *author's* browser happened to be in, and the counterparty six months later reads
  a reason in a language neither of them chose. The pure-function guarantee ("give the same answer months later")
  would then be broken by the localisation layer, quietly.

Nothing calls this file today, so nothing is broken either way right now. But the correct fix in the second case
is not `txf` at the string — it is to return a structured reason (`{ code:'region_mismatch', region, orderRegion }`)
and translate at the render site. That is a design decision, not a prose pass.

**All four proposals below assume the first answer (UI text).** If the reviewer picks the second, all four become
NEEDS-HUMAN and the work moves to whatever screen eventually renders them.

---

### price-resolve.js:55
```
BEFORE  return 'for ' + p.region + ', not ' + ctx.region;
AFTER   return txf('for {region}, not {orderRegion}', { region: p.region, orderRegion: ctx.region });
```
NOTE — Named, not positional, and the names matter more than usual here: the two values are *the same kind of
thing* (both region strings) in opposite roles. `{0}` and `{1}` would be a coin-flip for any translator who has
to reorder them, and the error would be silent and plausible-looking. `{region}` is the price's declared region,
`{orderRegion}` is the order's.

No `esc()` in the original, so none added — this is a pure engine with no DOM, matching the rest of the file.

---

### price-resolve.js:60
```
BEFORE  return 'priced in ' + p.currency + ', not ' + ctx.currency;
AFTER   return txf('priced in {currency}, not {orderCurrency}', { currency: p.currency, orderCurrency: ctx.currency });
```
NOTE — ⚠️ **Not a money-formatting defect, deliberately.** These are ISO 4217 currency *codes* being named as
codes ("priced in USD, not INR"), not amounts. Codes are the right thing to show in a mismatch message — the
whole point of the refusal, per the comment two lines above, is that *"a currency mismatch is a refusal, never a
conversion"*, and naming both codes is how a person sees which two. `CBLocale.money()` would be wrong here: there
is no amount.

---

### price-resolve.js:62
```
BEFORE  return 'needs ' + p.minQty + '+, this order has ' + ctx.qty;
AFTER   return txf('needs {minQty}+, this order has {qty}', { minQty: p.minQty, qty: ctx.qty });
```
NOTE — Two quantities, again the same kind of thing in opposite roles; named placeholders are load-bearing.
⚠️ Check the var keys against the placeholders when applying: a key that does not match leaves `{qty}` visible on
screen (by `txf`'s design) rather than printing `undefined`. That is the intended failure mode, but it is still a
bug someone has to report.

Both are raw numbers, **not** run through `CBLocale.number()`. Unlike `txn`'s automatic `{count}`, a `txf` var is
interpolated verbatim, so an Arabic or Devanagari locale gets Western digits inside a translated sentence. That is
a pre-existing gap this pass does not create and does not fix; if the reviewer wants it fixed, the values become
`CBLocale.number(p.minQty)` — but note that would put grouping separators into a quantity, which may not be
wanted. Worth deciding once for the whole codebase rather than here.

---

### price-resolve.js:151
```
BEFORE  if (p.minQty != null) bits.push('for ' + p.minQty + '+ units');
AFTER   if (p.minQty != null) bits.push(txf('for {minQty}+ units', { minQty: p.minQty }));
```
NOTE — **`txf` and not `txn`, on purpose.** `minQty` *is* a count, so `txn` looks like the obvious choice:
`txn('for {count}+ unit', 'for {count}+ units', p.minQty)`. But that would print *"for 1+ unit"* where the
shipped English prints *"for 1+ units"* — a change to what the English says, which rule 5 forbids in this pass.
An "N+" range is idiomatically always plural in English regardless of N.

That said, "always plural" is an **English** idiom, and a language with real number agreement may well need the
singular at 1. So the strictly-correct long-term form probably *is* the `txn` above, accepting the English
change. Reviewer's call — flagging rather than deciding.

---

## ⚠️⚠️ MONEY-FORMATTING DEFECT — price-resolve.js:150 — NEEDS-HUMAN, not a translation problem

Off the scan's work-list (it is a two-expression concatenation with no bracketing literals, so the scanner does
not pair it), but it sits on the line directly above :151 and it is the more serious finding of the two.

```js
bits.push((p.label || p.basis || 'price') + ' = ' + (p.currency || c.currency || '') + p.amount);
```

**What it does:** builds a price by pasting an ISO currency *code* directly onto a raw number, with no separator
and no formatting. For `{ currency:'INR', amount:340 }` this renders literally:

```
list = INR340
```

Three separate defects in one expression:

1. **A currency code used as if it were a symbol.** "INR340" is not a price in any convention. `CBLocale.money(340,'INR')`
   would give the symbol, the correct placement (which is *after* the number in several locales, e.g. `340 €`),
   and the correct grouping.
2. **`(p.currency || c.currency || '')` can fall through to the empty string** — so a Part D entry with no
   declared currency, priced in a context with no currency either, renders as a **bare number with no currency
   at all**: `list = 340`. In a file whose entire job is producing a defensible answer to *"why am I paying 340
   and not 325?"*, an unlabelled 340 is the one output that cannot be defended. 340 of what?
3. **The amount is never localised.** `p.amount` is stringified by `+`, so no grouping and no locale digits.

**Why this is not fixed by wrapping it in `txf`.** Wrapping would translate the word "=" around a still-broken
number. The amount and its currency are one value, `{ amount, currency }`, and must be formatted as one by
`CBLocale.money(amount, code)` before any sentence gets near them. Only then does the surrounding text become a
translation question.

**Suggested shape (for the human to accept or reject — NOT applied):**
```js
var ccy = p.currency || c.currency || null;
bits.push(txf('{basis} = {amount}', {
  basis:  p.label || p.basis || tx('price'),
  amount: ccy ? CBLocale.money(p.amount, ccy) : String(p.amount)   /* ⚠️ and the no-currency case needs a real answer */
}));
```
The `ccy == null` branch is deliberately left unresolved: silently dropping the currency is what the current code
does and it is the actual bug. Whether a currency-less Part D entry should render bare, render with the session
currency, or be *refused by `why()` the way a mismatch already is*, is a pricing decision — and the file's own
posture (*"never a conversion"*, *"never silently improve"*) suggests the third.

**Related, same function, same class (not proposed):**
- `price-resolve.js:153` — `'valid ' + (p.validFrom || '—') + ' to ' + (p.validTo || '—')` renders raw ISO
  date strings inside prose. Dates need `CBLocale` treatment for the same reason money does, and the `'—'`
  placeholder means the string sometimes reads *"valid — to 2026-11-15"*.
- `price-resolve.js:54` / `:53` — `'starts ' + p.validFrom`, `'ended ' + p.validTo`: same raw-ISO-date issue,
  plus they are single-sided so the scanner did not list them.
- `describe()` returns `bits.join(' · ')` — a sentence assembled from independently-translated fragments. Even
  with every fragment wrapped, the *order* of the bits is fixed in English reading order. Acceptable for a
  middot-separated list of badges; not acceptable if it is ever presented as a sentence.
