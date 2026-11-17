# L3 prose proposals — `public/app/cap-messages.js`

Scan: 1 interpolated site. **1 SKIP.** Nothing here was edited.

---

### cap-messages.js:301
```js
return '<span data-testid="msg-track-' + (k || 'all') + '" onclick="rplTrack(&quot;' + k + '&quot;)"'
```
SKIP — not prose. `k` is a track key (`''` / `'order'` / `'task'`) being written into a JavaScript
`onclick` handler inside an HTML attribute. Both halves are markup and code; there is no
sentence here and nothing a translator should ever see.

NOTE  The prose on the surrounding lines is already in good shape and does not need this pass:
the chip label comes from `RPLTRACK[k].label`, the tooltip from `RPLTRACK[k].hint` (both
table-declared literals — an L2 `tx()` job at the point of use), and `'All'` is a plain literal.

NOTE  One thing worth passing on, at :304 — the count badge:
```js
+ lbl + (n ? ' <span style="opacity:.7">' + n + '</span>' : '')
```
That is a bare number rendered beside the label with no noun, so it needs no plural form and
no msgid — correct as it stands. Recording it so a later pass does not "fix" it into a
`txn` that would put a translatable string around a decoration.
