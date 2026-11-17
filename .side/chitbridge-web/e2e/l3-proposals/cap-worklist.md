# L3 prose proposals — `public/app/cap-worklist.js`

Source of the work-list: `node e2e/prose-scan.cjs --interp --file app/cap-worklist.js` (9 interpolated sites; :314 is listed twice because `hid` appears twice in one sentence).
**Nothing in the source file has been edited.** Every entry below is a proposal for human review.

Target primitives read from `public/app.html`: `txf` (line 3713), `txn` (line 3737).
`txf` does NOT escape — a value that was `esc(x)` stays `esc(x)`.
`txn` supplies `{count}` itself, formatted through `CBLocale.number()` — never pass `count` in `vars`.

---

## 1 — Sites that are NOT prose

### cap-worklist.js:223
```js
return '<div data-testid="wl-row" data-state="' + (done ? 'done' : 'open') + '" onclick="wlLine(&quot;' + r.line_id + '&quot;)"'
```
SKIP — not prose. A line UUID spliced into an `onclick` handler.

### cap-worklist.js:289
```js
return '<div data-testid="wl-head"' + (id ? ' onclick="wlToggle(&quot;' + esc(id) + '&quot;)"' : '')
```
SKIP — not prose. A group id inside an `onclick` handler.

### cap-worklist.js:354
```js
KEYS.map(function(x){ return chip(x[0], x[1], prim === x[0], 'wlPrimary(&quot;' + x[0] + '&quot;)', 'wl-view-' + x[0]); }).join('')
```
SKIP — not prose. `x[0]` is a group key (`who`/`date`/`chit`/`item`) being built into a handler call string and a test id.
NOTE  `x[1]` on the same line IS the visible chip label ("person", "date", "order", "product") — but it is a whole value from the `KEYS` table, not a concatenated sentence. L2 `tx()` at the table, not L3.

### cap-worklist.js:663
```js
return '<button class="btn' + (primary ? ' pri' : '') + '" data-testid="' + testid + '" onclick="' + call + '"'
```
SKIP — not prose. `wlBtn`'s generic button shell: test id and handler. The `label` argument passed through on :665 is a whole caller-supplied string, not a half-sentence.

### cap-worklist.js:695
```js
+ (opts.type ? ' type="' + opts.type + '" step="any" inputmode="decimal"' : '')
```
SKIP — not prose. HTML input attributes.

### cap-worklist.js:843
```js
wlBtn(o.verb, 'wl-' + k + '-add', 'wlMsgSave(&quot;' + k + '&quot;)', true)
```
SKIP — not prose. Thread key (`msg`/`ext`) in a handler call and a test id.
NOTE  `o.verb` — "Add note" / "Send", set at :1044 and :1049 — is real button copy, but it is a whole literal at the call site. L2 `tx()`, not L3.

### cap-worklist.js:846
```js
+ '<div style="margin-top:7px;font-size:11.5px;color:' + (o.tone || 'var(--grey)') + ';line-height:1.5">' + o.foot + '</div>'
```
SKIP — not prose. The flagged expression is `o.foot`, an already-complete sentence passed in whole by the caller; the two "halves" are a `<div>` open and close tag. Nothing spans it.
NOTE  Both `foot` values ARE important user-facing copy and are unbroken literals at :1046 and :1053 — `'🔒 Team only — the other party never sees these.'` and `'📤 The other party sees this, on their own copy. It cannot be unsent — a correction is another message.'`. Straight `tx()` wraps, L2. Worth doing: this is the string that stops someone typing a price complaint into the wrong box.

---

## 2 — Sites that ARE prose

### cap-worklist.js:314 (both scanner hits — one sentence, `hid` twice)
```
BEFORE  'Everything here is done — ' + hid + ' finished line' + (hid === 1 ? '' : 's')
        + ' hidden. Tick “show ' + hid + ' done” to see them.'

AFTER   txn('Everything here is done — {count} finished line hidden. Tick “show {count} done” to see them.',
            'Everything here is done — {count} finished lines hidden. Tick “show {count} done” to see them.',
            hid)
```
NOTE  The scanner reports this line twice; it is ONE sentence with the count appearing twice. `txn`'s substitution is a global regex, so both `{count}` occurrences are filled from the same value — no second var needed, and `count` must not be passed in `vars`.
NOTE  `(hid === 1 ? '' : 's')` is the hard-coded-English-plural pattern; `txn` is its replacement.
NOTE  ⚠️ **Cross-string dependency, and it is a real one.** The quoted `“show {count} done”` is this sentence QUOTING the checkbox label built separately at :373 (`'show ' + wlDoneCount(d2) + ' done'`). If a translator translates one and not the other, the sentence tells the reader to tick a control whose label no longer matches, which is worse than leaving both in English. **These two must be applied together** — see the next entry — and the catalogue should carry a translator note saying so.

### cap-worklist.js:373 — the label :314 quotes (not on the scan list)
```
BEFORE  ' onchange="wlDone()" style="…">show ' + wlDoneCount(d2) + ' done</label>'
AFTER   ' onchange="wlDone()" style="…">'
        + txn('show {count} done', 'show {count} done', wlDoneCount(d2))
        + '</label>'
```
NOTE  Included because :314 quotes it verbatim; fixing :314 alone leaves the instruction pointing at a string that can drift. Identical `one`/`other` (English does not inflect here) so that a language which does inflect can still supply two forms.
NOTE  Lower-case "show" preserved exactly as shipped.

---

## 3 — Same-file prose the `--interp` scan did not surface

Not proposals — listed so they are not lost. Each is the same class of defect (a count or a value concatenated into a sentence) that the scanner missed because the flagged half fell outside its window.

- **:280** `r.lines + ' line' + (r.lines === 1 ? '' : 's')` — hard-coded English plural. `txn('{count} line', '{count} lines', r.lines)`.
- **:283** `r.undated + ' undated'` — `txn`, identical forms.
- **:285** `'<span style="…">' + r.overdue + ' overdue</span>'` — `txn`, identical forms, markup inside.
- **:316** `' (filtered to ' + esc(WL.due) + ')'` — `txf(' (filtered to {due})', { due: esc(WL.due) })`. Note this fragment is appended to THREE different preceding sentences (:314–:315), so the parenthetical is a separate unit by design; keep it one.
- **:363** `'not split — every line under its ' + esc(prim === 'who' ? …)` — a sentence whose tail is a chosen noun. Needs `txf` with a `{key}` var AND the four nouns wrapped individually; the noun is inflected in several target languages, so this one is genuinely harder than it looks.
- **:825** `n + (n === 1 ? ' message' : ' messages')` — hard-coded English plural in the thread-section hint.
- **:350** `'Every line assigned to ' + (mine2 ? 'you' : 'your team') + ', across every chit.'` — a sentence split around a pronoun choice. Two whole `tx()` sentences would be safer than one `txf` with a `{who}` hole, because "you"/"your team" take different verb agreement in most target languages.

---

## Summary — cap-worklist.js

- **Propose-ready: 1** of the 9 scanned sites (:314, which the scanner counts as 2), plus **1 linked site** (:373) that must be applied in the same change because :314 quotes it.
- **SKIP — not prose: 7** (:223, :289, :354, :663, :695, :843, :846) — all handler strings, test ids, HTML attributes, or a whole pre-built value passed through a `<div>` wrapper.
- **NEEDS-HUMAN: 0.** No site in this file was ambiguous. The one thing wanting a decision is scope: whether to apply :373 (and ideally section 3) in the same pass, since :314 alone leaves a dangling quotation.
- **Not anticipated by the brief:** (1) The `--interp` scan is a poor proxy for L3 debt in this file — it surfaced 9 sites of which 7 are markup, while at least 7 genuine concatenated sentences (section 3) went unflagged because their interpolation sat at a line edge. The scan should be read as a starting point, not a work-list. (2) **A quoted UI label is a cross-string coupling the tooling cannot see.** :314 quotes :373 by value; gettext has no mechanism that keeps two catalogue entries in step, so this needs a translator note rather than a code fix. (3) Most user-visible copy in this file lives in option objects (`WLTHREAD` call sites, `KEYS`, `WLG` labels) as unbroken literals — invisible to an interpolation scan, and the larger share of what a reader reads.
