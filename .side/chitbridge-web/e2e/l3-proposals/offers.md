# L3 prose proposals — `public/app/offers.js`

PROPOSAL ONLY. Nothing in the source file was modified.
Scan: `node e2e/prose-scan.cjs --interp --file app/offers.js` → 4 interpolated sites.

Result: **3 propose-ready · 1 NEEDS-HUMAN** on the work-list.
⚠️ **1 MONEY-FORMATTING DEFECT (line 309, the default `ctx.money`)** — see the section at the end.
Plus 7 off-list sites of the same class, listed briefly.

Verified: `node e2e/l3-verify.cjs e2e/l3-proposals/offers.md` → **3 pairs · 3 faithful · 0 TEXT CHANGED**
(the 4th site, :164, is NEEDS-HUMAN and carries no AFTER to check).

---

## ⚠️ READ FIRST — the same "is a reason UI text or a record?" question as price-resolve.js

The file header states the requirement these strings exist to satisfy:

> When someone asks "why was this ₹7,950 and not ₹8,400?" six months later, the answer cannot be "the engine
> decided". So **every adjustment carries: which offer, which rule fired, what the input was, and what it produced.**

Every string below is a `why` on an adjustment or a note. `evaluate()` is documented as pure, and its output *is*
already reaching the mint: `app.html:4438` re-evaluates offers at send time to collect `offer_id`s onto the chit.
Today only the ids travel, not the `why` strings — but if a `why` is ever persisted alongside them, translating it
at generation time freezes the author's browser language into a dispute record.

Same call as in `price-resolve.md`: **if `why` is UI text, these proposals stand; if it is a record, the right fix
is a structured reason translated at the render site.** All proposals below assume UI text.

`offers.js` calls `tx`/`txf`/`txn` zero times today, so applying any of these is also the moment this documented-as-pure
module acquires a dependency on the localisation layer in `app.html`. Worth a deliberate yes.

---

### offers.js:62
```
BEFORE  pct + '% off ' + ctx.money(base) + ' of eligible lines'
AFTER   txf('{percent}% off {amount} of eligible lines', { percent: pct, amount: ctx.money(base) })
```
NOTE — `ctx.money(base)` is preserved verbatim as the var value: the amount is formatted by the injected
formatter *before* it enters the sentence, which is the correct layering. (Whether that formatter is any good is
the separate defect at :309 below.)

The `%` sign stays inside the string on purpose — percent placement is not universal (`50 %` with a space in
French, and the sign precedes the number in Turkish: `%50`), so the translator must be able to move it.

No `esc()` in the original — this engine has no DOM — so none added.

---

### offers.js:111
```
BEFORE  'qty ' + l.qty + ' reaches the ' + hit.qty + '+ tier · ' + ctx.money(was) + ' → ' + ctx.money(now) + ' each'
AFTER   txf('qty {qty} reaches the {tier}+ tier · {was} → {now} each',
            { qty: l.qty, tier: hit.qty, was: ctx.money(was), now: ctx.money(now) })
```
NOTE — Four values, two of them quantities and two of them amounts, all four the same *shape* on screen. This is
the strongest argument in the cluster for named-over-positional: `{0}{1}{2}{3}` reordered by a translator who
cannot see the code would produce a wrong-but-readable price explanation, which is the worst possible failure in
a file whose job is defensibility.

`→` stays inside the string: it is directional, and an RTL locale needs to be able to flip it.

---

### offers.js:135
```
BEFORE  o.percent + '% off — order of ' + ctx.money(have) + ' meets the ' + ctx.money(need) + ' threshold'
AFTER   txf('{percent}% off — order of {orderTotal} meets the {threshold} threshold',
            { percent: o.percent, orderTotal: ctx.money(have), threshold: ctx.money(need) })
```
NOTE — `have` and `need` are both amounts in opposite roles; named. "threshold" appears twice in the English
(once as the value's role, once as the noun) which is fine — it is one msgid and the translator sees both.

---

### offers.js:164 — NEEDS-HUMAN
```
BEFORE  take + ' × ' + (pct === 100 ? 'free' : pct + '% off') + ' — buy ' + x + ' get ' + y
        + ' (' + sets + ' set' + (sets === 1 ? '' : 's') + ', cheapest units taken)'
```
Three separate problems stacked in one expression, and only the first is a plain wrap:

1. **`sets === 1 ? '' : 's'` — English pluralisation by string surgery.** This is the exact thing `txn` exists to
   delete, and it is worse than the `item(s)` dodge elsewhere in the cluster because it appends a bare letter,
   which no non-English form can be expressed as.
2. **`pct === 100 ? 'free' : pct + '% off'`** — an alternative *phrase* spliced mid-sentence. The two arms are
   grammatically different (an adjective vs a quantified phrase) and in an inflecting language the surrounding
   words may need to change with the choice.
3. **The counted phrase is nested inside another sentence**, so even a correct `txn` for the sets becomes a
   fragment glued into a `txf`.

A defensible mechanical form, offered for the reviewer to accept or reject:
```js
var deal  = (pct === 100) ? tx('free') : txf('{percent}% off', { percent: pct });
var setsN = txn('{count} set', '{count} sets', sets);
adj(o, 'line', pool[i].key, -R2(pool[i].unitPrice * take * pct / 100),
    txf('{units} × {deal} — buy {buy} get {get} ({sets}, cheapest units taken)',
        { units: take, deal: deal, buy: x, get: y, sets: setsN }));
```
This removes the hard-coded `'s'` (a genuine win) but keeps two nested fragments, which is a known gettext
compromise rather than a correct answer. The fully-correct form is **two complete msgids** — one for the free case
and one for the discounted case, each written out end to end and each a `txn` on `sets` — which doubles the
string but gives a translator whole sentences. That is a call about how much duplication is acceptable in this
codebase, so: **NEEDS-HUMAN.**

Also worth the reviewer's eye: `x`, `y`, `take` and `sets` are all raw numbers here, and `buy 2 get 1` is the
sort of phrase a locale may render entirely differently ("3 for the price of 2").

---

## ⚠️⚠️ MONEY-FORMATTING DEFECT — offers.js:309 — NEEDS-HUMAN, not a translation problem

```js
money: input.money || function (n) { return String(R2(n)); }
```

**What it does:** when a caller does not inject a money formatter, every amount this engine puts into a `why`
string renders as a **bare number with no currency and no locale formatting**. `ctx.money(7950)` returns
`"7950"`, so the explanations above come out as:

```
10% off — order of 7950 meets the 5000 threshold
```

Not ₹7,950. Not $7,950. Just `7950`.

**Why it matters here more than usual:** the file header's own example of what this engine must answer is
*"why was this **₹7,950** and not **₹8,400**?"* — with the currency. The default formatter cannot produce that
sentence. And it is not a hypothetical default:

- `catalogue-ui.js:399` **does** inject one — `money: function (n) { return money(ns, n); }` — good; but
- `app.html:4439`, the call at the mint, **injects nothing**. It only reads `offer_id`s off the result and
  discards the strings, so nothing is visibly wrong today. The moment anyone renders or persists a `why` from
  that call site, they get currency-less numbers in a chit.

**And the injected path is itself weak.** Following it through: `catalogue-ui.money(ns, n)` → `CBCart.fmt(ns, n)`
(`cart-ui.js:536`), which is:
```js
return sym(ns) + (opt(ns, 'groupDigits', false) ? Number(n).toLocaleString(...) : String(n));
```
i.e. **symbol concatenation** — `symbol + number`, always in that order, with grouping **off by default**. Both
are documented decisions in `cart-ui.js` (the grouping default deliberately reproduces old output to avoid
restyling a public page mid-refactor, and it broke `e2e/tests/variants.spec.js` when it was on), so this is a
known debt rather than an oversight. But it is still not `CBLocale.money(amount, code)`, and symbol-prefix is
wrong for the locales that put the symbol after the number.

**Not applied. Not wrapped in `txf`.** Suggested direction only, for the human:
- the safe, local, no-behaviour-change fix is to make the *default* honest — either `CBLocale.money(n, ctx.currency)`
  (`ctx.currency` is already a documented input at :277 and is currently unused by the formatter), or throw/omit
  rather than silently emit an unlabelled number;
- `app.html:4439` should pass `money` and `currency` even though it discards the strings today, so that the day
  someone starts reading them they are not reading `7950`;
- the `CBCart.fmt` → `CBLocale.money` migration is a separate, wider piece of work with a test (`variants.spec.js`)
  already pinned to the current output. Do not fold it into a prose pass.

---

## ALSO SEEN — same class, not on the scan's work-list

All are `why`/`note` strings built by concatenation; the scanner skipped them because they open with an
expression or a ternary rather than a literal. Listed for completeness, **not proposed**:

- `:84` — `ctx.money(give) + ' off' + (give < amt ? ' (capped at the order value of ' + ctx.money(base) + ')' : '')`
  — a conditionally-spliced parenthetical, same shape as the cap-catalogue.js:965 case. Needs two whole msgids.
- `:89` — `ctx.money(g) + ' off' + (g < amt ? ' (capped at the line value)' : '')` — same.
- `:130` — `(need - have) + ' more item(s) needed'` — `(s)` dodge, clean `txn` candidate.
- `:131` — `ctx.money(need - have) + ' more needed'`.
- `:139` — `ctx.money(amt) + ' off — order meets the ' + (o.min_qty ? need + ' item' : ctx.money(need)) + ' threshold'`
  — a ternary that swaps a *quantity* phrase for an *amount* phrase mid-sentence. Note `need + ' item'` is
  unpluralised in **both** directions (reads "meets the 5 item threshold"), which may be intentional attributive
  usage or may be a bug.
- `:181` — `'flat shipping at ' + ctx.money(o.flat)`.
- `:184` — `o.percent + '% off shipping'`.
- `:201`–`:202` — `ctx.money(l.unitPrice) + ' is outside the seller's band ' + (…) + '–' + (…)` — a range built
  from two ternaries around an en-dash, each arm either an amount or `'—'`.
- `:321` — `'unknown kind: ' + o.kind` — developer-facing diagnostic text that reaches the same `skipped[]` array
  as user-facing reasons. Arguably should not be translated at all; worth deciding which of these strings are
  operator-facing.
