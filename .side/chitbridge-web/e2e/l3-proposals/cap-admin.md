# L3 prose proposals — `public/app/cap-admin.js`

Source of the work-list: `node e2e/prose-scan.cjs --interp --file app/cap-admin.js` (11 interpolated sites).
**Nothing in the source file has been edited.** Every entry below is a proposal for human review.

Target primitives read from `public/app.html`: `txf` (line 3713), `txn` (line 3737).
`txf` does NOT escape — a value that was `esc(x)` stays `esc(x)`.
`txn` supplies `{count}` itself, formatted through `CBLocale.number()` — never pass `count` in `vars`.

---

## 1 — Sites that are NOT prose

### cap-admin.js:101
```js
+'<input class="inp" style="…" placeholder="label it — e.g. Export receipts" value="'+esc(sec.label||'')+'" oninput="vaultSetSection('+i+',this.value)">'
```
SKIP — not prose. The interpolation is `i`, a section index spliced into an `oninput` handler. Attribute/handler markup.
NOTE  The same line does carry real user-facing copy — the literal `placeholder="label it — e.g. Export receipts"` — but that is an unbroken literal, so it is an L2 `tx()` wrap, not an L3 interpolation. Out of scope here.

### cap-admin.js:123
```js
val='<input class="inp" style="…" value="'+esc(r.value||'')+'" placeholder="'+esc(hint)+'" oninput="vaultSetRow('+i+','+j+',\'value\',this.value)">';
```
SKIP — not prose. The flagged interpolation is `esc(hint)` sitting inside a `placeholder="…"` attribute; the surrounding "halves" are attribute syntax (`" placeholder="` / `" oninput="`), not a sentence.
NOTE  `hint` comes from the `VAULT_HINT` table. If the hint texts are to be translated, that belongs at the table (an L2 `tx()` per entry), not at this render site.

### cap-admin.js:129
```js
+'<input class="inp" list="vsug_'+esc(type)+'" style="…" placeholder="detail name — e.g. IFSC code" value="'+esc(r.name||'')+'" oninput="vaultSetRow('+i+','+j+',\'name\',this.value)">'
+val
+'<button type="button" title="Remove this detail" …>×</button></div>';
```
SKIP — not prose. The flagged expression is `val`, a fully-built `<input>`/`<select>` control being concatenated between two markup fragments. There is no sentence spanning it.
NOTE  Two literal strings on these lines are user-facing (`placeholder="detail name — e.g. IFSC code"`, `title="Remove this detail"`) — L2 `tx()` candidates, not L3.

### cap-admin.js:706
```js
return '<div class="row misrow' + (profSec() === s.key ? ' sel' : '') + '" data-testid="prof-sec-' + s.key + '" onclick="profSetSec(\'' + s.key + '\')">'
```
SKIP — not prose. `s.key` inside a `data-testid` and an `onclick`. The visible copy on the next line (`esc(s.name)`, `esc(s.q)`) is data from `PROF_SECS`, not a concatenated sentence.

### cap-admin.js:1469
```js
var row = '<div class="row misrow' + (setSec() === s.key ? ' sel' : '') + '" data-testid="set-sec-' + s.key + '" onclick="setSetSec(\'' + s.key + '\')">'
```
SKIP — not prose. Same shape as :706 — test id + handler.

### cap-admin.js:1474
```js
return '<div class="row misrow sub' + (on ? ' sel' : '') + '" data-testid="gov-layer-' + i + '" onclick="govSetTab(' + i + ')">'
```
SKIP — not prose. Governance-layer index in a test id and a handler.

### cap-admin.js:1570
```js
+     'background:' + b[1] + ';color:' + b[2] + ';border-radius:4px;padding:1px 6px">' + b[0] + '</span>';
```
SKIP — not prose. Inline CSS: `b[1]`/`b[2]` are colour tokens from the `BADGE` table.
NOTE  `b[0]` on the same line IS the visible badge word (e.g. the in-force / partly / planned label). It is a whole value from `BADGE`, not a concatenated sentence, so it is an L2 `tx()` at the table — flagged here only so it is not lost.

### cap-admin.js:2203
```js
if(def.type==='number') return '<input type="number"'+dis+' data-testid="pol-'+esc(def.key)+'" value="'+esc(String(v))+'" onchange="setPolFlag(\''+def.key+'\',this.value)" style="…">';
```
SKIP — not prose. Policy-flag key and current value inside `data-testid` / `value` / `onchange` attributes.

---

## 2 — Sites that ARE prose

### cap-admin.js:526
```
BEFORE  '<b>' + m.waiting.length + ' waiting</b> — ' + m.waitTheirs
        + ' on <span class="misclock theirs">◷ Theirs</span> ' + m.waitMine
        + ' on <span class="misclock mine">◷ Mine</span>'

AFTER   txn('<b>{count} waiting</b> — {theirs} on <span class="misclock theirs">◷ Theirs</span> {mine} on <span class="misclock mine">◷ Mine</span>',
            '<b>{count} waiting</b> — {theirs} on <span class="misclock theirs">◷ Theirs</span> {mine} on <span class="misclock mine">◷ Mine</span>',
            m.waiting.length, { theirs: m.waitTheirs, mine: m.waitMine })
```
NOTE  The plural driver is `m.waiting.length`; `{theirs}` and `{mine}` are its two components, not separate plural drivers. English does not inflect "waiting", so the `one` and `other` forms are deliberately identical — that is not a mistake, it is what lets a language that DOES inflect supply two forms.
NOTE  Markup kept inside the string on purpose: the two `<span class="misclock …>` chips must move with the words they label, and a translator moving a tag is normal gettext.
NOTE  `{theirs}` / `{mine}` are numbers rendered with raw JS digits today. `CBLocale.number()` would be the consistent treatment (it is what `{count}` already gets), but that is a rendering change, not a re-shape — **left as-is; flag for a human decision.**

### cap-admin.js:523 — adjacent, same sentence as :526
```
BEFORE  '<i class="dot" style="…"></i> <b>' + m.open_disputes + ' open</b>'
AFTER   '<i class="dot" style="…"></i> '
        + txn('<b>{count} open</b>', '<b>{count} open</b>', m.open_disputes)
```
NOTE  Not on the scan list (its right half is markup) but it sits in the same rendered line as :526 and cannot honestly be left behind. The `<i class="dot">` stays OUTSIDE the string — it is a coloured dot with no words in it, so there is nothing for a translator to move.
NOTE  Identical `one`/`other` for the same reason as :526. The `false` branch, `'<b>No open disputes</b>'`, is an unbroken literal — plain `tx()`.

### cap-admin.js:529–530 — adjacent, same block
```
BEFORE  '<div class="misnote" style="margin-top:6px">⚠ <b>' + m.unattended.length + ' unanswered message'
        + (m.unattended.length === 1 ? '' : 's') + '</b> — oldest ' + esc(m.unattended[0].age) + '</div>'

AFTER   '<div class="misnote" style="margin-top:6px">'
        + txn('⚠ <b>{count} unanswered message</b> — oldest {age}',
              '⚠ <b>{count} unanswered messages</b> — oldest {age}',
              m.unattended.length, { age: esc(m.unattended[0].age) })
        + '</div>'
```
NOTE  This is the `n === 1 ? '' : 's'` pattern the brief names — English grammar hard-coded. `txn` is exactly its replacement.
NOTE  `esc(m.unattended[0].age)` preserved verbatim; `txf`/`txn` do not escape.
NOTE  Not on the scan list only because the flagged half landed on the neighbouring line. Same sentence, same fix.

### cap-admin.js:534
```
BEFORE  '<div class="misnote"><b>' + m.parties + ' counterparties</b> · ' + m.captured + ' of '
        + m.chits + ' chits captured from a channel · ' + m.suppliers + ' suppliers</div>'

AFTER   '<div class="misnote">'
        + txn('<b>{count} counterparty</b>', '<b>{count} counterparties</b>', m.parties)
        + ' · '
        + txn('{captured} of {count} chit captured from a channel',
              '{captured} of {count} chits captured from a channel',
              m.chits, { captured: m.captured })
        + ' · '
        + txn('{count} supplier', '{count} suppliers', m.suppliers)
        + '</div>'
```
NOTE  **Three units, not one.** The line is a `·`-joined LIST of three independent facts, each with its own count. A single string would have three counts and only one plural driver, which is unfixable in any language with real plural rules. The ` · ` separator stays in code — it is punctuation, not words.
NOTE  ⚠️ **This introduces English that did not exist before.** Today the strings are always plural, so one counterparty renders as "1 counterparties". `txn` requires a singular form, so the proposal supplies "counterparty" / "chit" / "supplier". That is a (correct) change to what the English says at n=1 — **rule 5 says flag it rather than slip it in, so: flagged.** If the reviewer wants strictly no English change, pass the plural in both slots.
NOTE  `{captured}` is a second number in the middle unit; same `CBLocale.number()` question as :526.

### cap-admin.js:1980
```
BEFORE  'These come from <b>CLDR</b> for your region — ' + esc(weekend) + ' is the weekend here. Tap a day to override.'

AFTER   txf('These come from <b>CLDR</b> for your region — {weekend} is the weekend here. Tap a day to override.',
            { weekend: esc(weekend) })
```
NOTE  `esc(weekend)` preserved exactly. `txf` does not escape.
NOTE  `weekend` is built at :1867 as `(wi.weekend||[]).map(x => DAY[x]||x).join(' + ')` — so the day NAMES and the ` + ` joiner are themselves untranslated English assembled by concatenation. Fixing that is a separate site (:1867), not this one, but a translated sentence with "Saturday + Sunday" inside it is only half-done. **Worth queuing :1867 as its own L3/L2 item.**
NOTE  The sibling branch at :1979 and the fixed warning at :1981–1983 are unbroken literals — plain `tx()`, L2.

---

## Summary — cap-admin.js

- **Propose-ready: 3** of the 11 scanned sites (:526, :534, :1980), plus **2 adjacent sites** (:523, :529–530) that the scanner did not flag but that sit inside the same rendered sentences and must move with them.
- **SKIP — not prose: 8** (:101, :123, :129, :706, :1469, :1474, :1570, :2203) — all `data-testid` / `onclick` / `placeholder` / inline-CSS fragments.
- **NEEDS-HUMAN: 0** as blockers. Two judgement calls are flagged inside the entries and want a yes/no rather than more context: (a) the new singular English at :534, (b) whether the non-`{count}` numbers should go through `CBLocale.number()`.
- **Not anticipated by the brief:** (1) The interpolation scanner's line-granularity under-reports — the MIS "Friction" block is one rendered sentence spread over :522–:531 and only :526 was flagged; a per-site pass would have left :523 and :529 concatenated inside a sentence that was otherwise fixed. (2) The real translation debt in this file is not the 11 interpolations — it is the DATA TABLES (`PROF_SECS`, `SET_SECS`, `GOV`, `BADGE`, `VAULT_SECTION_TYPES`, `VAULT_HINT`, the `STD` rows). Those are unbroken literals so L3 never sees them, but they are most of what a reader actually reads on these screens. (3) Neither file currently calls `tx`/`txf`/`txn`; `app.html` defines them as plain globals in a classic (non-module) script, so they are in scope at render time — no import needed, but this file would be the first capability module to depend on them.
