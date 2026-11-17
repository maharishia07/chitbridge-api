# L3 prose proposals — `public/app/catalogue-ui.js`

PROPOSAL ONLY. Nothing in the source file was modified.
Scan: `node e2e/prose-scan.cjs --interp --file app/catalogue-ui.js` → 2 interpolated sites.

Result: **0 propose-ready · 2 SKIP** on the work-list.
Both scan hits are false positives — markup, not prose.
⚠️ But the two lines they sit on carry **untranslated user-facing text the scanner cannot see**, noted below.

Verified: `node e2e/l3-verify.cjs e2e/l3-proposals/catalogue-ui.md` → **0 pairs** — both sites are SKIPs, nothing to check.

---

### catalogue-ui.js:163
```
BEFORE  ' aria-label="more" onclick="' + call('add') + '">+</button>'
SKIP — not prose
```
REASON — The interpolated expression is `call('add')`, a generated JavaScript **event-handler string**
(`CBCart.add('ns','id')`). The literals bracketing it are an HTML attribute boundary and a closing tag. There is
no sentence here; the only "word" in the fragment is `more`, which belongs to the `aria-label` attribute the
scanner happened to include in its left half. Wrapping any of this in `txf` would put executable code through the
string catalogue.

---

### catalogue-ui.js:165
```
BEFORE  ' aria-label="add" onclick="' + call('add') + '">+</button>'
SKIP — not prose
```
REASON — Identical to :163; this is the no-quantity arm of the same ternary.

---

## ⚠️ WORTH A LOOK ANYWAY — real untranslated UI text on and around these lines

The scanner is looking for *concatenated* sentences, so it is blind to hard-coded English that is already a
single literal. Both SKIPs above sit inside a stepper control that is full of it. Reporting, **not proposing** —
these are `tx()` (L2) work, not `txf`/`txn` (L3) work, and they are outside this pass's remit:

- **`aria-label="more"` (:163) and `aria-label="add"` (:165)** — these *are* prose. They are the only label a
  screen-reader user gets for these two buttons, and they are hard-coded English inside an HTML attribute. A
  blind user in a Tamil or Arabic locale hears "more" and "add" in English. Same for `aria-label="less"` (:159)
  and `aria-label="quantity"` (:160).
  ⚠️ Note this needs `esc()` discipline if it is ever wrapped, because the value goes into a quoted attribute.
- **`'✓ Added'` / `'Add'` (:156)** — the visible label on the `pick`-mode button, hard-coded.
- **`'Offers could not be applied just now — the prices above stand.'` (:405)** — a whole user-facing error
  sentence, hard-coded. Single literal, so L2 not L3.

The file calls `tx`/`txf`/`txn` **zero** times today, so it has no string-layer coverage at all yet.

---

## ⚠️ MONEY — no defect *in this file*, but this file is where the good path is

Noting it here because the brief asked for money findings across the cluster, and `catalogue-ui.js` is the file
that gets it *most* right of the three that touch money:

- `catalogue-ui.js:399` correctly **injects** a money formatter into the offers engine
  (`money: function (n) { return money(ns, n); }`), which is why `offers.js`'s bad default (see `offers.md`) does
  not bite on this screen.
- But the formatter it injects, `money(ns, n)` at **:59**, delegates to `CBCart.fmt` — which is symbol-prefix
  concatenation with digit grouping off by default, not `CBLocale.money(amount, code)`. The file's own comment at
  `cart-ui.js:524` already calls the fallback *"the same defect as catalogue-ui: the fallback assumed India"*, so
  this is known and tracked, not a new finding.

No action proposed. Flagged so the reviewer can see the whole money picture for the cluster in one place.
