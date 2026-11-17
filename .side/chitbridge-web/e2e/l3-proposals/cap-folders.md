# L3 prose proposals — `public/app/cap-folders.js`

Scan: 5 interpolated sites. **5 propose-ready · 0 SKIP · 0 NEEDS-HUMAN** (two carry a copy question).
Nothing here was edited.

---

### cap-folders.js:344
BEFORE
```js
out += '<div style="…">'
  + '⚠️ <b>Your selection was ignored.</b> This server does not support totalling a ticked set yet, so the figures below are for the <b>whole track</b>, not your ' + _FLD.gsIds.length + ' chits.</div>';
```
AFTER
```js
out += '<div style="…">'
  + txn('⚠️ <b>Your selection was ignored.</b> This server does not support totalling a ticked set yet, so the figures below are for the <b>whole track</b>, not your {count} chit.',
        '⚠️ <b>Your selection was ignored.</b> This server does not support totalling a ticked set yet, so the figures below are for the <b>whole track</b>, not your {count} chits.',
        _FLD.gsIds.length)
  + '</div>';
```
NOTE  The whole warning is one sentence pair and goes in as one msgid; the `<div style>` wrapper stays outside. Both `<b>` runs stay inside — the translator moves them with the phrases they mark.
NOTE  `n === 1` is reachable (the guard is `gsIds.length` truthy), so the singular form matters.

---

### cap-folders.js:349
BEFORE
```js
var miss = (g.selection_requested || 0) - (g.chits || 0);
… + (miss > 0 ? ' ⚠️ ' + miss + ' of the ' + g.selection_requested + ' you ticked are not on this track and were left out.' : '')
```
AFTER
```js
… + (miss > 0 ? ' ' + txn('⚠️ {count} of the {total} you ticked is not on this track and was left out.',
                          '⚠️ {count} of the {total} you ticked are not on this track and were left out.',
                          miss, { total: CBLocale.number(g.selection_requested) }) : '')
```
NOTE  Two numbers in one sentence: `miss` drives the plural so it is the `txn` count; the total rides as a named var. This is exactly why placeholders must be named — `{0}`/`{1}` here would be a coin-flip for any translator who reorders them, and a language that puts the total first will reorder them.
NOTE  ⚠️ **Copy change at n=1.** Today it prints *"1 of the 7 you ticked are not on this track and were left out."* The singular form above fixes the agreement. New English — confirm.
NOTE  `CBLocale.number(...)` on `{total}` is deliberate: `txn` already formats `{count}` through the localisation layer, and two numbers side by side in one sentence written in two different digit systems is worse than either. If the reviewer prefers zero behavioural change, pass `g.selection_requested` raw.
NOTE  The leading space moves outside the msgid (it joins this to the preceding sentence).

---

### cap-folders.js:508  ⚠️ the trap — read the `+`
BEFORE
```js
+ _mBox('Overdue', m.overdue, 'open for ' + m.overdue_days + '+ days', m.overdue ? 'bad' : null)
```
AFTER
```js
+ _mBox('Overdue', m.overdue, txf('open for {days}+ days', { days: m.overdue_days }), m.overdue ? 'bad' : null)
```
NOTE  **The `+` before ` days` is a literal plus sign in the copy, not concatenation.** The rendered string is *"open for 30+ days"* — a threshold, not a count. It stays inside the msgid, immediately after `{days}`, where a translator can see it belongs to the number.
NOTE  `txf`, **not** `txn`, and that is the point of the trap: `30+` has no plural category. CLDR would classify the bare `30`, and there is no language where "open for 1+ days" would want the singular noun. Treating this as a count would be wrong.

---

### cap-folders.js:594
BEFORE
```js
+ '<span title="Runs ' + (i === 0 ? 'first' : 'after the ' + i + ' above') + '" style="…">' + (i + 1) + '</span>'
```
AFTER
```js
+ '<span title="' + (i === 0 ? tx('Runs first')
                             : txn('Runs after the {count} above', 'Runs after the {count} above', i))
  + '" style="…">' + (i + 1) + '</span>'
```
NOTE  Two problems in one line. First, `'Runs ' + (…)` splits a two-word sentence across a ternary — "Runs" and its complement have to travel together, so each branch becomes a whole sentence. Second, the count.
NOTE  The two English plural forms are **identical on purpose** — English does not inflect here ("Runs after the 1 above" / "the 2 above"). Other languages do: Russian needs three forms for that noun-less numeral phrase and Arabic six. Keeping it a `txn` opens that door; a `txf` closes it permanently. The apparent redundancy is the correct gettext shape.
NOTE  This lands inside a **double-quoted HTML attribute** built by string concatenation. Today's English contains no `"`, so it is safe; a translation that does would break the tag silently. Worth an `esc()` on the whole title when this is applied — flagged, not proposed, because adding escaping is a behaviour change beyond this pass.

---

### cap-folders.js:610
BEFORE
```js
+ (r.match_count ? ('filed ' + r.match_count + ' chit' + (r.match_count == 1 ? '' : 's') + (r.last_matched_at ? ' · last ' + esc(String(r.last_matched_at).slice(0, 10)) : '')) : 'has not matched anything yet')
```
AFTER
```js
+ (r.match_count ? (txn('filed {count} chit', 'filed {count} chits', r.match_count)
                    + (r.last_matched_at ? ' · ' + txf('last {date}', { date: esc(String(r.last_matched_at).slice(0, 10)) }) : ''))
                 : 'has not matched anything yet')
```
NOTE  `esc(...)` on the date is preserved verbatim; `txf` does not escape.
NOTE  The ` · ` separator stays outside both msgids — it is punctuation between two independent fragments, not part of either.
NOTE  `'has not matched anything yet'` is a plain literal (no interpolation), so it is an L2 `tx()` wrap, not this pass's business.

---

## Extras the scan did not list (same file, same problem — different shape)

Not counted in this file's totals.

**cap-folders.js:348** — ternary plural
```js
+ '☑ <b>' + (g.chits || 0) + ' ticked chit' + ((g.chits === 1) ? '' : 's') + '</b> — not this folder or the whole track.'
```
suggested
```js
+ txn('☑ <b>{count} ticked chit</b> — not this folder or the whole track.',
      '☑ <b>{count} ticked chits</b> — not this folder or the whole track.', g.chits || 0)
```

**cap-folders.js:497** — ternary plural inside the money chips
```js
… + ' <span style="color:var(--grey)">· ' + b.chits + ' chit' + (b.chits === 1 ? '' : 's') + '</span>'
```
suggested: `txn('{count} chit', '{count} chits', b.chits)` inside the inner span.

**cap-folders.js:501** — interpolated prose the scanner read as markup (left half ends `">`)
```js
'<div style="…">' + mo.excluded.awaiting_agreement + ' chit(s) have no agreed value yet and are excluded — they are not counted as zero.</div>'
```
suggested
```js
'<div style="…">' + txn('{count} chit has no agreed value yet and is excluded — it is not counted as zero.',
                        '{count} chits have no agreed value yet and are excluded — they are not counted as zero.',
                        mo.excluded.awaiting_agreement) + '</div>'
```
NOTE  Another `(s)` hedge; the singular English above is new. Confirm.
