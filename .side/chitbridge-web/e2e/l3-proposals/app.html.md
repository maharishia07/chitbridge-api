# L3 prose pass — proposals for `public/app.html`

**PROPOSAL ONLY. No source file was modified.** One entry per interpolated site reported by
`node e2e/prose-scan.cjs --interp --file app.html` (32 rows, 31 distinct lines — 8483 carries two).

Escaping facts established before proposing (they decide every `esc()` question below):

| sink | escapes? | consequence for the var value |
|---|---|---|
| `toast(msg)` (1539) | `esc(msg)` — whole message | value stays **raw**; adding `esc()` would double-encode |
| `showBusy(msg)` (7674) / `busyShow(msg)` (8468) | `esc(msg)` — whole message | value stays **raw** |
| `announce(msg)` (7673) | `textContent` | value stays **raw** |
| `confirmAsk(title, bodyHtml, …)` (4690–4693) | **title** `esc()`d, **bodyHtml** raw | title vars raw; body vars keep whatever they had |
| `.innerHTML = …` (5735, 5744, 6388, 8199…) | nothing | value keeps its existing `esc()` |

---

### app.html:1864
BEFORE
```js
var counts=v.counts?'<div style="font-size:11.5px;color:var(--grey-2);margin-bottom:9px">'+v.counts.finishes+' finishes · '+v.counts.combinations+' combinations · '+v.counts.colours+' colours · '+v.counts.fields+' schema fields</div>':'';
```
AFTER
```js
var counts=v.counts?'<div style="font-size:11.5px;color:var(--grey-2);margin-bottom:9px">'
  + [ txn('{count} finish',       '{count} finishes',      v.counts.finishes),
      txn('{count} combination',  '{count} combinations',  v.counts.combinations),
      txn('{count} colour',       '{count} colours',       v.counts.colours),
      txn('{count} schema field', '{count} schema fields', v.counts.fields) ].join(' · ')
  + '</div>':'';
```
NOTE  The scanner flagged only `colours`, but this is **four** counted noun-phrases on one line and they
have to be handled together — a single `txf` cannot pluralise four independent counts. `' · '` is a
separator, not prose, so it stays outside.
⚠️ **This changes the English at n=1**: today it renders "1 finishes"; `txn` renders "1 finish". That is a
fix, not a rewrite, but it is a visible change — please confirm. If you would rather change nothing at
all, the alternative is one `txf('{finishes} finishes · {combinations} combinations · {colours} colours ·
{fields} schema fields', {…})`, which preserves today's wording exactly but hard-codes English plurals.

---

### app.html:3201
BEFORE  `reject(new Error('Could not load the '+name+' capability.'))`
AFTER   `reject(new Error(txf('Could not load the {capability} capability.', { capability: name })))`
NOTE  `name` is an internal slug (`connector`, `dispute`) that stays English — that is fine, it is an
identifier. The message does reach a user via `toast`.

---

### app.html:4334
BEFORE
```js
toast('AI filled '+rows.length+' line item'+(rows.length>1?'s':'')+' — review, edit, then send ✓')
```
AFTER
```js
toast(txn('AI filled {count} line item — review, edit, then send ✓',
          'AI filled {count} line items — review, edit, then send ✓', rows.length))
```

---

### app.html:4509
BEFORE
```js
throw new Error('A term this chit cites could not be read (' + r.missing.length + '). Nothing was sent.');
```
AFTER
```js
throw new Error(txf('A term this chit cites could not be read ({count}). Nothing was sent.',
                    { count: r.missing.length }));
```
NOTE  Deliberately `txf`, not `txn`: the current wording does **not** vary with the count, and switching to
`txn` would mean inventing a second English sentence — a rewrite, not a reshaping.
Two things worth a human's eye, neither changed here:
(a) the English is awkward — "A term … could not be read (3)" says *a* term but prints a count of three;
(b) because this is `txf`, `{count}` is **not** run through `CBLocale.number`, so an Arabic reader gets
Western digits. Both are fixed at once by rewording to `txn('{count} term this chit cites could not be
read. Nothing was sent.', '{count} terms this chit cites could not be read. Nothing was sent.', …)` —
flagged, not applied.

---

### app.html:4546
BEFORE  `catch(e){ toast('Attachment "'+f.name+'" failed.'); }`
AFTER   `catch(e){ toast(txf('Attachment "{file}" failed.', { file: f.name })); }`
NOTE  `f.name` stays raw — `toast` escapes the finished string. The `"` quotes are inside the msgid so a
translator can swap them for « » or „ “.

---

### app.html:4549
BEFORE  `catch(e){ toast('Attachment "'+f.name+'" failed.'); }`
AFTER   `catch(e){ toast(txf('Attachment "{file}" failed.', { file: f.name })); }`
NOTE  Identical msgid to 4546 and 8483 — three call sites, one catalogue entry. Correct and intended.

---

### app.html:5453
BEFORE
```js
+ 'Asked for, not agreed — '+esc(supName(x))+' confirms the date and the price.</div>';
```
AFTER
```js
+ txf('Asked for, not agreed — {supplier} confirms the date and the price.',
      { supplier: esc(supName(x)) })
+ '</div>';
```
NOTE  Raw `innerHTML` sink, so `esc()` is preserved exactly. `</div>` moved out of the msgid — it is
structural and closes a tag opened on 5452.

---

### app.html:5590
SKIP — not prose. `'/api/relationships/suppliers/' + encodeURIComponent(sid) + '/catalogue'` is a URL path.

---

### app.html:5735
BEFORE
```js
+ 'This is <b>'+label+'</b>&rsquo;s readiness — the supplier you are looking at. <b>Not yours.</b> '
```
AFTER
```js
+ txf('This is <b>{supplier}</b>&rsquo;s readiness — the supplier you are looking at. <b>Not yours.</b>',
      { supplier: label })
+ ' '
```
NOTE  `label` was already `esc()`d at 5720, so it is passed through unchanged.
⚠️ The English possessive `&rsquo;s` is glued to the name — exactly the construction that has no equivalent
in Tamil or Hindi. Keeping it **inside** the msgid is the point: a translator can drop it and use a case
ending instead. The `<b>` tags stay in the string for the same reason.
The trailing space is moved outside the msgid — translators reliably lose trailing whitespace, and this one
is a real separator from the `<span>` on 5736.

---

### app.html:5744
BEFORE
```js
+ 'Status and validity only — the documents themselves stay with '+label+'. Nothing here is your own readiness; '
+ 'for that, open <b>Trade readiness</b> from the menu.</div>';
```
AFTER
```js
+ txf('Status and validity only — the documents themselves stay with {supplier}. Nothing here is your own '
    + 'readiness; for that, open <b>Trade readiness</b> from the menu.', { supplier: label })
+ '</div>';
```
NOTE  Two adjacent literals joined into one unit (the sentence was split only for source width). `label` is
already escaped. `</div>` moved out.

---

### app.html:5870
BEFORE  `confirmAsk('Remove '+_n+' from your supplier list?', …)`
AFTER   `confirmAsk(txf('Remove {name} from your supplier list?', { name: _n }), …)`
NOTE  `_n` stays raw — `confirmAsk` escapes the **title** argument (4691).

---

### app.html:6045
BEFORE  `showBusy('Categorising '+B.ids.length+' product'+(B.ids.length===1?'':'s')+'…');`
AFTER   `showBusy(txn('Categorising {count} product…', 'Categorising {count} products…', B.ids.length));`
NOTE  The ellipsis is inside the msgid on purpose — some scripts use a different one, and a translator who
cannot see it will not add it.

---

### app.html:6388
BEFORE
```js
+ (group ? 'Lines sharing the same <b>'+esc(group)+'</b> now show as one product'+(options.length?', told apart by <b>'+options.map(esc).join(', ')+'</b>':'')+'.' : 'Every line is its own product.')
```
AFTER
```js
+ (group
    ? (options.length
        ? txf('Lines sharing the same <b>{group}</b> now show as one product, told apart by <b>{options}</b>.',
              { group: esc(group), options: options.map(esc).join(', ') })
        : txf('Lines sharing the same <b>{group}</b> now show as one product.',
              { group: esc(group) }))
    : tx('Every line is its own product.'))
```
NOTE  The inline conditional built the sentence out of a stem plus an optional tail plus a floating full
stop — three fragments no translator can reassemble. Two **complete** sentences instead; the clause that was
optional is now the difference between two msgids. Both `esc()` calls preserved. The `else` branch is a
plain literal, so it takes `tx()` (out of scope for this pass, included for completeness — drop it if you
want this diff limited strictly to the interpolated sites).

---

### app.html:6534
BEFORE  `confirmAsk('Import using ' + using + ' column' + (using===1?'':'s') + '?', …)`
AFTER   `confirmAsk(txn('Import using {count} column?', 'Import using {count} columns?', using), …)`

---

### app.html:6535
BEFORE
```js
(creating ? 'It also adds <b>' + creating + ' new column' + (creating===1?'':'s') + '</b> to your catalogue.<div style="margin-top:7px">' : '<div>')
+ 'Products are <b>added or updated</b>. Nothing is deleted.</div>',
```
AFTER
```js
(creating ? txn('It also adds <b>{count} new column</b> to your catalogue.',
                'It also adds <b>{count} new columns</b> to your catalogue.', creating)
            + '<div style="margin-top:7px">'
          : '<div>')
+ tx('Products are <b>added or updated</b>. Nothing is deleted.') + '</div>',
```
NOTE  ⚠️ The original msgid would otherwise end with an **unbalanced opening `<div>`** whose `</div>` lives
on the next line — a translator would have no idea what it is and would break the layout by moving it.
Pulled out; only the sentence is translatable. `<b>` wraps the count-and-noun exactly as before.
This is a `confirmAsk` **body**, which is raw HTML — `creating` is a number, nothing to escape.
The 6536 literal is a plain string (`tx()`), listed only because it is on the same expression.

---

### app.html:6598
SKIP — not prose. `' data-testid="cat-catg-' + esc(c.id) + '" onclick="…"'` is an attribute fragment.

---

### app.html:6793
BEFORE  `catUnusedRow(k, k, 'used by ' + seen[k] + ' other item' + (seen[k] === 1 ? '' : 's'), false)`
AFTER   `catUnusedRow(k, k, txn('used by {count} other item', 'used by {count} other items', seen[k]), false)`

---

### app.html:7314
BEFORE  `if(ids.length>1) showBusy('Moving '+ids.length+' records to '+cap(to)+'…');`
AFTER
```js
if(ids.length>1) showBusy(txn('Moving {count} record to {status}…', 'Moving {count} records to {status}…',
                              ids.length, { status: cap(to) }));
```
NOTE  Guarded by `ids.length>1`, so the singular form is unreachable today — it is still required, because
Arabic's *dual* and Russian's *few* are reachable at counts this guard allows through.
⚠️ Separate issue, **not** fixed here: `cap(to)` upper-cases an internal key into "Open"/"Act"/"Close", so
the status word stays English inside a translated sentence. Fixing it means a status→label map wrapped in
`tx(…, 'status')` (the context separator the `tx` header describes), shared with 7318, 7323 and 7324.
Flagging for a human — it is a behaviour change, not a reshaping.

---

### app.html:7318
BEFORE  `announce('Moved '+ids.length+' record'+(ids.length>1?'s':'')+' to '+cap(to));`
AFTER
```js
announce(txn('Moved {count} record to {status}', 'Moved {count} records to {status}',
             ids.length, { status: cap(to) }));
```
NOTE  Same `cap(to)` caveat as 7314. `announce` writes `textContent`, so nothing is escaped either way.

---

### app.html:7347
BEFORE  `if(ids.length>1) showBusy('Archiving '+ids.length+' records…');`
AFTER   `if(ids.length>1) showBusy(txn('Archiving {count} record…', 'Archiving {count} records…', ids.length));`
NOTE  The English never had a singular form here (the guard made it unnecessary). Supplying one invents no
new wording — it is the obvious singular of the existing sentence — and it is what other plural systems need.

---

### app.html:7354
BEFORE  `if(ids.length>1) showBusy('Restoring '+ids.length+' records…');`
AFTER   `if(ids.length>1) showBusy(txn('Restoring {count} record…', 'Restoring {count} records…', ids.length));`
NOTE  Same as 7347.

---

### app.html:7356
BEFORE  `if(ids.length>1) showBusy('Unarchiving '+ids.length+' records…');`
AFTER   `if(ids.length>1) showBusy(txn('Unarchiving {count} record…', 'Unarchiving {count} records…', ids.length));`
NOTE  Same as 7347.

---

### app.html:7358
BEFORE  `confirmAsk('Delete '+ids.length+' item'+(ids.length===1?'':'s')+' permanently?', …)`
AFTER   `confirmAsk(txn('Delete {count} item permanently?', 'Delete {count} items permanently?', ids.length), …)`

---

### app.html:7362
BEFORE  `if(ids.length>1) showBusy('Deleting '+ids.length+' records…');`
AFTER   `if(ids.length>1) showBusy(txn('Deleting {count} record…', 'Deleting {count} records…', ids.length));`
NOTE  Same as 7347.

---

### app.html:8199
BEFORE
```js
+ esc(p.asked_differs.map(function(a){ return a.name+' — they said '+inr(a.asked)+', your catalogue says '+inr(a.ours); }).join('; '))
```
AFTER
```js
+ esc(p.asked_differs.map(function(a){
      return txf('{item} — they said {asked}, your catalogue says {ours}',
                 { item: a.name, asked: inr(a.asked), ours: inr(a.ours) });
  }).join('; '))
```
NOTE  Escaping unchanged: `esc()` is applied to the joined result **outside** the map, exactly as today, and
`txf` adds no escaping of its own. `'; '` is a list separator, not prose, so it stays out of the msgid.
Note this line is preceded by `p.asked_differs.length+' line'+(…?'':'s')` on 8197–8198 — a plural the
scanner reported as *joinable*, not interpolated; it belongs in the same edit
(`txn('on {count} line: ', 'on {count} lines: ', …)`) but is out of scope for this pass.

---

### app.html:8202
BEFORE
```js
+ esc(p.ambiguous.map(function(a){ return '"'+a.name+'" matches '+a.matches+' catalogue lines'; }).join('; '))
```
AFTER
```js
+ esc(p.ambiguous.map(function(a){
      return txn('"{name}" matches {count} catalogue line', '"{name}" matches {count} catalogue lines',
                 a.matches, { name: a.name });
  }).join('; '))
```
NOTE  `a.matches` is ≥2 by the definition of "ambiguous", so the singular is unreachable in English —
still needed for other plural categories (see 7314). `esc()` position unchanged.

---

### app.html:8483 (first string on the line)
BEFORE  `busyShow('Attaching '+UI.msgFiles.length+' file(s)…');`
AFTER   `busyShow(txn('Attaching {count} file…', 'Attaching {count} files…', UI.msgFiles.length));`
NOTE  ⚠️ **This one does change the rendered English**: "file(s)" becomes "file" or "files". `(s)` is a
plural dodge rather than a wording choice, and it is untranslatable by construction — no language outside
English-and-friends can express a plural with a suffixed bracket. I read this as the reshaping the pass is
for, not a rewrite, but it is the only site here where a reader sees different words, so please confirm.
Compare 4546/8483's sibling `'Attaching files…'` on 4546/4549, which is countless and needs only `tx()`.

---

### app.html:8483 (second string on the line)
BEFORE  `catch(e){ toast('Attachment "'+f.name+'" failed.'); }`
AFTER   `catch(e){ toast(txf('Attachment "{file}" failed.', { file: f.name })); }`
NOTE  Third occurrence of the 4546 msgid.

---

### app.html:8585
BEFORE  `showBusy('Assigning '+ids.length+' record'+(ids.length>1?'s':'')+' to '+who+'…');`
AFTER
```js
showBusy(txn('Assigning {count} record to {who}…', 'Assigning {count} records to {who}…',
             ids.length, { who: who }));
```
NOTE  `who` stays raw — `showBusy` escapes the finished string. `who` is a co-assist name or the fallback
literal `'the co-assist'` set on 8584; that fallback is itself an unwrapped English string (`tx()`
candidate, out of scope).

---

### app.html:8586
BEFORE  `announce('Moving '+ids.length+' record'+(ids.length>1?'s':'')+' to '+who);`
AFTER
```js
announce(txn('Moving {count} record to {who}', 'Moving {count} records to {who}',
             ids.length, { who: who }));
```
NOTE  ⚠️ Do **not** merge this msgid with 7314's "Moving {count} records to {status}…" — same English verb,
different sentence (a person here, a status there), and gettext keys on the English. They must stay two
entries or a translator will be handed one string that has to work as both. Kept distinct by the
placeholder name and the absent ellipsis; a human may prefer to disambiguate them explicitly with `tx`
contexts if the two ever converge.

---

### app.html:8699
SKIP — not prose. `'…" src="'+esc(a.src)+'" loading="lazy" alt="'+esc(a.n||'')+'"'` is HTML attribute
construction; the interpolated values are a URL and a filename, neither of which is a sentence.

---

### app.html:9255
BEFORE  `toast('Noted: “'+s.term+'” may mean “'+s.means+'”');`
AFTER   `toast(txf('Noted: “{term}” may mean “{meaning}”', { term: s.term, meaning: s.means }));`
NOTE  Both values stay raw — `toast` escapes the whole message. The curly quotes are kept **inside** the
msgid so a translator can substitute their own quotation marks (French « », German „ “). The var is renamed
`{meaning}` rather than `{means}` because a placeholder has to say what it is, not mirror the field name.

---

## Summary

- **29 propose-ready** — 12 `txf` sites, 17 `txn` sites (1864 counts once though it takes four `txn` calls; 8483's two strings count separately). 29 + 3 SKIP = the 32 the scanner reported.
- **3 SKIP — not prose**: 5590 (URL path), 6598 (`data-testid` attribute), 8699 (`src`/`alt` attributes).
- **0 NEEDS-HUMAN** — every site was unambiguous once ±10 lines were read, but **five carry a confirm flag** that a human should sign off before anything is applied: 1864 and 8483 change the rendered English (`1 finishes`→`1 finish`, `file(s)`→`file`/`files`); 4509 keeps awkward English on purpose; 6535 and 5735 move markup out of a msgid; 7314/7318 leave a real bug unfixed.
- **Not anticipated by the brief, worth knowing:** (a) three msgids strictly outrank the count — sentences carrying **markup that is structurally unbalanced** (6535's dangling `<div>`, and the `</div>` tails at 5453/5744/6388). Rule 3 says markup stays inside the string, and that is right for `<b>` spans that wrap a phrase; it is wrong for a tag whose partner is on another line, because the msgid then cannot stand alone. I split on that distinction and flagged each one. (b) `cap(to)` at 7314/7318 injects an **English status word** into an otherwise translatable sentence — a class of bug placeholders hide rather than fix, and there is no reshaping that repairs it; it needs a `tx(…, 'status')` label map, which is a behaviour change and so is only flagged. (c) Several flagged lines sit beside *joinable*-classified plural fragments on the same expression (8197–8198 most clearly) — applying the interpolated fix alone would leave half a sentence still concatenated, so these two work-lists should be applied together per line, not per pass.
