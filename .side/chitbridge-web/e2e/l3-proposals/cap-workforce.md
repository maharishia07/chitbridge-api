# L3 prose proposals — `public/app/cap-workforce.js`

Scan: 6 interpolated sites. **3 propose-ready · 2 SKIP · 1 propose-ready with a copy question.**
Nothing here was edited. Apply by hand after review.

---

### cap-workforce.js:216
```js
function fld(id,label,ph){ return '…<input class="inp" id="'+id+'" data-testid="'+id+'" placeholder="'+ph+'" value="'+esc(d[id]||'')+'" …>'; }
```
SKIP — not prose. The interpolation sits between two HTML attribute fragments (`" data-testid="` … `" placeholder="`). The *value* of `ph` is prose, but it is prose supplied by the caller — this line is markup plumbing, and the placeholder text should be wrapped where it is declared (an L2 literal job), not here.

---

### cap-workforce.js:334
```js
… ;display:inline-block"></span>' + esc(h) + '</span></div>'
```
SKIP — not prose. `h` is the health word (`online` / `offline` / …) dropped bare into a status pill; the two halves are CSS and closing tags, not a sentence. The health vocabulary itself is server data — translating it is a separate decision (a value map), not a `txf` site.

---

### cap-workforce.js:421
BEFORE
```js
const routed = x.load>0 ? ' Their '+x.load+' active task(s) return to the pool.' : '';
```
AFTER
```js
const routed = x.load>0 ? ' ' + txn('Their {count} active task returns to the pool.',
                                    'Their {count} active tasks return to the pool.', x.load) : '';
```
NOTE  The leading space is a joiner between two sentences — keep it **outside** the msgid, as shown, so the catalogue does not carry invisible whitespace.
NOTE  `task(s)` was an English hedge for "I don't know the number at write time". `txn` removes the need for it, so the singular now reads *"Their 1 active task returns to the pool."* — new English for the n=1 case, but it is the sentence the hedge was standing in for. Confirm the wording.
NOTE  `routed` is consumed at :433/:434 through `esc(routed)`. The `txn` output is plain text with no markup, so escaping stays correct and unchanged.

---

### cap-workforce.js:428
BEFORE
```js
if(r&&r.covers_removed>0) parts.push('was leave-cover for '+r.covers_removed+' — those cover links removed');
```
AFTER
```js
if(r&&r.covers_removed>0) parts.push(txn('was leave-cover for {count} — that cover link removed',
                                         'was leave-cover for {count} — those cover links removed', r.covers_removed));
```
NOTE  ⚠️ This one **changes the English at n=1**. Today the branch is guarded on `>0`, so `covers_removed === 1` currently prints *"was leave-cover for 1 — those cover links removed"*, which is already wrong. The singular form above is a fix, not a rewrite — but it is new copy and a human should sign it off.
NOTE  If the reviewer would rather change nothing at all, the strictly-lossless alternative is `txf('was leave-cover for {count} — those cover links removed', { count: r.covers_removed })`. That preserves today's English exactly but hard-codes the English plural into every language. Recommend the `txn` form.

---

### cap-workforce.js:433
BEFORE
```js
confirmAsk('Deactivate co-assist', 'Deactivate <b>'+esc(x.name)+'</b>? They can no longer sign in until reactivated.'+esc(routed), 'Deactivate', run, true);
```
AFTER
```js
confirmAsk('Deactivate co-assist',
  txf('Deactivate <b>{name}</b>? They can no longer sign in until reactivated.', { name: esc(x.name) }) + esc(routed),
  'Deactivate', run, true);
```
NOTE  `esc(x.name)` stays exactly as it was — `txf` does not escape. The `<b>` tags stay inside the msgid; a translator moving them around the name is normal and correct (German and Tamil both put that clause elsewhere).
NOTE  `esc(routed)` stays appended outside: it is an independent sentence built at :421, not part of this one.

---

### cap-workforce.js:434
BEFORE
```js
confirmAsk('Remove permanently', 'Permanently remove <b>'+esc(x.name)+'</b>? This cannot be undone.'+esc(routed), 'Remove', run, true);
```
AFTER
```js
confirmAsk('Remove permanently',
  txf('Permanently remove <b>{name}</b>? This cannot be undone.', { name: esc(x.name) }) + esc(routed),
  'Remove', run, true);
```

---

## Extras the scan did not list (same functions, same problem — different shape)

These are `n === 1 ? … : …` ternaries rather than a bare interpolation, so `--interp` did not
catch them. They hard-code English plural grammar just as firmly. Listed for the reviewer,
**not** counted in this file's totals.

**cap-workforce.js:426**
```js
parts.push(r.tasks_routed+' task'+(r.tasks_routed>1?'s':'')+(body.task_action==='actor'?' reassigned to a colleague':' returned to the pool'));
```
suggested
```js
parts.push(body.task_action==='actor'
  ? txn('{count} task reassigned to a colleague', '{count} tasks reassigned to a colleague', r.tasks_routed)
  : txn('{count} task returned to the pool',      '{count} tasks returned to the pool',      r.tasks_routed));
```
NOTE  The current form also splits the *verb phrase* from the noun across a ternary, which is unbuildable in a verb-final language. Two whole sentences, one per branch, is the right shape.

**cap-workforce.js:430**
```js
parts.push(r.disputes_cleared+' dispute hand-off'+(r.disputes_cleared>1?'s':'')+' cleared');
```
suggested
```js
parts.push(txn('{count} dispute hand-off cleared', '{count} dispute hand-offs cleared', r.disputes_cleared));
```
