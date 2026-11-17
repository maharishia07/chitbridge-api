# L3 prose proposals — `public/app/attach-ui.js`

Scan: 2 interpolated sites. **2 propose-ready** — and they are the **same sentence, duplicated**.
Nothing here was edited.

---

### attach-ui.js:271  (`cbAttachStage` — the staged-file picker)
BEFORE
```js
toast('"' + file.name + '" is ' + cbAttachSize(file.size) + ' — the limit is ' + cbAttachSize(CBATT.maxBytes) + '. Send a smaller copy.');
```
AFTER
```js
toast(txf('"{name}" is {size} — the limit is {limit}. Send a smaller copy.', {
  name:  file.name,
  size:  cbAttachSize(file.size),
  limit: cbAttachSize(CBATT.maxBytes)
}));
```
NOTE  ⚠️ **Vars stay raw — do not add `esc()`.** `toast()` escapes the whole message itself
(`app.html:1539`), so escaping the filename first would double-encode it: a file called
`Q&A.pdf` would show as `Q&amp;A.pdf`. Today's code passes it raw and that is correct.
NOTE  Three placeholders, three names. This is the clearest case in the whole set for named
over positional: the sentence is *size vs limit* and the two are the same shape and unit.
`{0}` and `{2}` would be swapped by somebody, in one language, and nobody would notice —
the message would still read as a plausible sentence, just with the numbers the wrong way round.
NOTE  The straight `"` quotes around the filename stay **inside** the msgid so a translator can
replace them with the right marks for the language (German „…", French « … »).

---

### attach-ui.js:399  (`cbAttachUpload` — the immediate-upload path)
BEFORE
```js
toast('"' + file.name + '" is ' + cbAttachSize(file.size) + ' — the limit is ' + cbAttachSize(CBATT.maxBytes) + '. Send a smaller copy.');
```
AFTER — **identical to :271 above.**

NOTE  Same string, character for character, at two call sites. gettext will fold them into one
msgid automatically, so translation is not harmed — but the two copies can still drift, and
then the catalogue silently grows a near-duplicate key that gets translated twice, differently.
NOTE  Recommendation for the reviewer: extract the whole guard, not just the string —
```js
function cbAttachTooBig(file){          // returns true and warns, or false
  if (file.size <= CBATT.maxBytes) return false;
  toast(txf('"{name}" is {size} — the limit is {limit}. Send a smaller copy.',
            { name: file.name, size: cbAttachSize(file.size), limit: cbAttachSize(CBATT.maxBytes) }));
  return true;
}
```
Both sites become `if (cbAttachTooBig(file)) return null;`. That is a refactor beyond this pass,
so it is proposed as a note rather than as the AFTER — but the `esc`/no-`esc` rule and the
placeholder names then live in exactly one place, which is the point.
