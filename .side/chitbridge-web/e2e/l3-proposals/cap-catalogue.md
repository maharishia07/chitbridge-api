# L3 prose proposals — `public/app/cap-catalogue.js`

PROPOSAL ONLY. Nothing in the source file was modified.
Scan: `node e2e/prose-scan.cjs --interp --file app/cap-catalogue.js` → 8 interpolated sites.

Result: **8 propose-ready · 0 SKIP · 0 NEEDS-HUMAN** on the work-list.
Plus 2 off-list sites found in passing (1 propose-ready, 1 NEEDS-HUMAN) — listed at the end.
No money-formatting defects in this file.

⚠️ This file does not call `tx`/`txf`/`txn` anywhere today (0 occurrences). Applying any of these is also the
moment the file first depends on those globals. They are defined in `app.html` and this is a classic script in
shared global scope, so the reference resolves — but `toast`/`api` are already guarded with `typeof … === 'function'`
here, which suggests a defensive house style worth matching if the reviewer wants it.

Verified: `node e2e/l3-verify.cjs e2e/l3-proposals/cap-catalogue.md` → **8 pairs · 0 TEXT CHANGED**.
The 6 "plural reshaping — English may change, confirm" flags are expected and correct: every one is an
`item(s)`/`photo(s)`/`field(s)` dodge becoming a real `txn` singular/plural pair. That is the point of the pass.

---

### cap-catalogue.js:231
```
BEFORE  (s.where && s.where !== '—' ? 'in: <code>' + esc(s.where) + '</code> · ' : '')
AFTER   (s.where && s.where !== '—' ? txf('in: <code>{where}</code>', { where: esc(s.where) }) + ' · ' : '')
```
NOTE — The trailing `' · '` is a **separator between this fragment and the "spec ↗" link that follows**, not part
of the sentence, so it stays outside the translatable string. A translator handed `"in: <code>{where}</code> · "`
would reasonably think the middot were punctuation they may move or drop; it is layout.
`<code>` stays inside the string — a translator moves tags, that is normal.

---

### cap-catalogue.js:297
```
BEFORE  toast('Enriching ' + names.length + ' item(s) with AI…')
AFTER   toast(txn('Enriching {count} item with AI…', 'Enriching {count} items with AI…', names.length))
```
NOTE — The `(s)` dodge is exactly what `txn` exists to remove. `names.length` is guaranteed ≥ 1 here (the
`if (!names.length)` guard returns two lines above), so the `one` form is reachable and real.

---

### cap-catalogue.js:304
```
BEFORE  toast('Enriched ' + n + ' item(s) ✓ — local & botanical names added')
AFTER   toast(txn('Enriched {count} item ✓ — local & botanical names added', 'Enriched {count} items ✓ — local & botanical names added', n))
```
NOTE — The `✓` and the em-dash clause stay inside the string; they are part of what the sentence says, and a
translator may need to move the tick (some scripts place it differently) which they can only do if they have it.

---

### cap-catalogue.js:897
```
BEFORE  w._phNote = 'Read ' + items.length + ' item(s) from ' + slice.length + ' photo(s) — the counts differ, so nothing was filled in automatically for that batch. A photo of a price LIST holds several items; these cards are one item each.';
AFTER   w._phNote = txn('Read {count} item from {photos} photos — the counts differ, so nothing was filled in automatically for that batch. A photo of a price LIST holds several items; these cards are one item each.', 'Read {count} items from {photos} photos — the counts differ, so nothing was filled in automatically for that batch. A photo of a price LIST holds several items; these cards are one item each.', items.length, { photos: slice.length });
```
NOTE — ⚠️ **TWO INDEPENDENT COUNTS IN ONE SENTENCE, and gettext can only pluralise on one of them.** `txn`
pluralises on `items.length`; `{photos}` rides along as a plain variable, so "photos" is frozen plural and reads
wrong at `photos === 1`. That is a real (small) regression in English versus the current `photo(s)`.

Two honest ways out, both the reviewer's call:
- accept it — `slice.length` is the AI batch size, which is 4+ in practice (see the batching loop above), so
  `1` is close to unreachable; or
- reword so only one count is inflected, e.g. *"…from a batch of {photos}"*. That is a wording change and
  therefore outside this pass's remit (rule 5).

`{photos}` is a count and is **not** passed through `CBLocale.number()` — only `{count}` is, automatically. In an
Arabic locale that gives one Arabic-digit number and one Western-digit number in the same sentence. Same issue at
:902; flagged once here.

---

### cap-catalogue.js:902
```
BEFORE  'Read ' + read + ' photo(s) — ' + filled + ' field(s) proposed. Check each one: they are the model\'s reading, not yours, until you edit or confirm them.'
AFTER   txn('Read {count} photo — {fields} fields proposed. Check each one: they are the model\'s reading, not yours, until you edit or confirm them.', 'Read {count} photos — {fields} fields proposed. Check each one: they are the model\'s reading, not yours, until you edit or confirm them.', read, { fields: filled })
```
NOTE — Same two-count limitation as :897. `filled` is only reached when non-zero (this is the truthy arm of the
ternary), but it can legitimately be exactly 1, so "fields" reads wrong more often here than at :897. This one is
the weaker of the two; if the reviewer wants to split it, *"Read {count} photos."* + a separate counted sentence
for the fields would be fully correct — but that is two sentences where there was one, i.e. a wording change.

---

### cap-catalogue.js:903
```
BEFORE  'Read ' + read + ' photo(s) and could not make anything out. Nothing was filled in — type the details instead.'
AFTER   txn('Read {count} photo and could not make anything out. Nothing was filled in — type the details instead.', 'Read {count} photos and could not make anything out. Nothing was filled in — type the details instead.', read)
```
NOTE — Clean single-count case. No vars object needed; `{count}` is supplied by `txn`.

---

### cap-catalogue.js:962
```
BEFORE  toast('Adding ' + priced.length + ' item(s) to your Catalogue…')
AFTER   toast(txn('Adding {count} item to your Catalogue…', 'Adding {count} items to your Catalogue…', priced.length))
```
NOTE — Clean. Guarded by `!priced.length` returning above, so ≥ 1.

---

### cap-catalogue.js:1016
```
BEFORE  return 'Currency <b>' + esc(_catfCcy()) + '</b> · country <b>' + esc(_catfCountry())
        + '</b> — from <b>Settings</b> (set at registration), inherited here.';
AFTER   return txf('Currency <b>{currency}</b> · country <b>{country}</b> — from <b>Settings</b> (set at registration), inherited here.',
                   { currency: esc(_catfCcy()), country: esc(_catfCountry()) });
```
NOTE — `esc(…)` is preserved on both values exactly as the original had it; `txf` does not escape.
⚠️ **Not a money-formatting defect.** `_catfCcy()` renders a currency *code* as a code ("INR"), which is the
correct thing to show when naming a setting. No amount is being formatted here.
`<b>Settings</b>` is the name of a screen inside the sentence and stays in the string — a translator needs to see
which words carry the emphasis, and in several languages the screen name moves.

---

## ALSO SEEN — same defect class, not on the scan's work-list

The scanner reports only *literal–expression–literal* triples, so these two slipped past it. They are the same
problem and, in the second case, worse. Flagging rather than proposing, since they are outside the brief's list.

### cap-catalogue.js:961
```
toast(unpriced + ' item(s) need a price before they go live.')
```
Starts with the expression, so there is no left-hand literal for the scanner to pair. Straightforward `txn`:
`txn('{count} item needs a price before it goes live.', '{count} items need a price before they go live.', unpriced)`.
⚠️ Note the *verb* changes too (`needs`/`need`, `it`/`they`) — which is precisely the reason a whole sentence
must be the translation unit, and a good example to keep.

### cap-catalogue.js:965 — NEEDS-HUMAN
```
toast(ok + ' item(s) added to Catalogue' + (unpriced ? ' · ' + unpriced + ' still need a price' : '') + ' ✓')
```
A **conditionally assembled** sentence: an optional clause is spliced into the middle of a message that then has
a `✓` glued to its end. There is no single msgid here — a translator would be handed three fragments and could
not tell that the middle one is optional. It needs to become two whole alternatives (one with the clause, one
without), each its own `txn`, which is a restructure of the call site rather than a wrap. Human decision.
