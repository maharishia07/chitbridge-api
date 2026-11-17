# L3 prose proposals — `public/app/cap-dispute.js`

Scan: 2 interpolated sites. **1 propose-ready · 1 SKIP.**
Nothing here was edited. This module renders disputes; neither site turned out to be a
dispute *statement* — one is a badge count, the other a progress toast. Nothing needed the
conservative treatment.

---

### cap-dispute.js:106
```js
return '<button class="advbtn'+…+'" onclick="…" title="Chits with an open dispute">⚠ '+n+'</button>';
```
SKIP — not prose. `n` is a bare badge count between a warning glyph and a closing tag; there
is no sentence for a translator to reorder, and a count with no noun beside it has no plural
form to get wrong. Wrapping it would add a msgid reading `⚠ {count}`, which is noise in the
catalogue and a chance to break the glyph.
NOTE  The `title="Chits with an open dispute"` on the same line **is** prose and **is** untranslated —
but it is a plain literal with no interpolation, so it is an L2 `tx()` wrap, not this pass.
Note it is built into a double-quoted attribute by concatenation, so whoever wraps it should
escape the result.

---

### cap-dispute.js:232
BEFORE
```js
if(mid && (UI.dispFiles||[]).length){ busyShow('Attaching '+UI.dispFiles.length+' file(s)…'); … }
```
AFTER
```js
if(mid && (UI.dispFiles||[]).length){
  busyShow(txn('Attaching {count} file…', 'Attaching {count} files…', UI.dispFiles.length)); … }
```
NOTE  Transient progress copy on an attachment upload — it is not part of the dispute record,
so the conservative rule does not bite here.
NOTE  `file(s)` was the English hedge; `txn` resolves it, and the singular now reads
*"Attaching 1 file…"*. That is new English for n=1 but it is plainly what the hedge meant.
NOTE  ⚠️ **Do not escape the vars here.** `busyShow` runs `esc()` over the whole message
(`app.html:8468`), so the value must reach it raw — the count does, unchanged. Same rule as
`toast()`. Worth stating in the L3 house notes: for `toast`/`busyShow` the string is escaped
downstream, so `txf`/`txn` vars stay **raw**; for strings concatenated into innerHTML the vars
stay **`esc()`-wrapped**. The existing call sites already get this right; a bulk find-and-replace
would not.
