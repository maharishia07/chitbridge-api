# L3 prose proposals — `public/app/cap-readiness.js`

Scan: 1 interpolated site. **1 SKIP.** Nothing here was edited.

---

### cap-readiness.js:391
```js
+'<div style="min-width:0;flex:1"><div style="font-weight:'+(on?'700':'600')+';font-size:var(--fs-2);color:'+(on?'var(--blue)':'var(--ink)')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(g.label)+'</div></div>'
```
SKIP — not prose. The interpolation is a bare data label (`g.label`, the commitment name)
between an inline-style string and a closing tag. There is no sentence: nothing before it,
nothing after it, no word order to decide. `esc(g.label)` stays as it is.

NOTE  The labels themselves — `'Working-capital need'`, `'Apply for finance'`, `'Funds advanced'`
and the rest of the `_rdCom…` tables around :384 — are English literals in a data structure.
They are user-visible and untranslated, but they are declarations, not concatenated sentences,
so they belong to the L2 literal pass (wrap at the point of *use*, once, the way `menuBtn`
does for the rail — not at each of the dozens of declarations).

NOTE  One nearby site the scan did not flag, for the record: `_rdComLadder` at :395 builds
```js
['attested',(attestor||'a bank')+' issues / confirms']
```
which **is** a concatenated sentence — *"HSBC issues / confirms"* — and would want
`txf('{attestor} issues / confirms', { attestor: attestor || tx('a bank') })`. It escaped
`--interp` because the expression starts the string rather than sitting between two halves.
Not counted in this file's totals; listed so it is not lost.
