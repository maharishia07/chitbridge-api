# L3 prose proposals — `public/app/cap-categories.js`

PROPOSAL ONLY. Nothing in the source file was modified.
Scan: `node e2e/prose-scan.cjs --interp --file app/cap-categories.js` → 1 interpolated site.

Result: **1 propose-ready · 0 SKIP · 0 NEEDS-HUMAN.**
No money in this file at all — no formatting defects to report.

Verified: `node e2e/l3-verify.cjs e2e/l3-proposals/cap-categories.md` → **1 pair · 1 faithful · 0 TEXT CHANGED**.

---

### cap-categories.js:230
```
BEFORE  showBusy('Adding ' + set.nodes.length + ' categories…')
AFTER   showBusy(txn('Adding {count} category…', 'Adding {count} categories…', set.nodes.length))
```
NOTE — Clean single-count case, and the clearest `txn` in the whole cluster.

Two things worth saying about it:

1. **The shipped English is plural-only** — `'… categories…'` with no `(s)` dodge — because in practice a starter
   set never has one node (`CB_STARTER_CATEGORIES[vertical].nodes` is a curated list of many). So the `one` form
   proposed above is *new English that does not exist today*. It is not a rewrite of what the string says, it is
   the singular that English grammar requires and that the current code could never produce; and it is
   unreachable in practice. If the reviewer prefers strict rule-5 fidelity, `txf('Adding {count} categories…',
   { count: set.nodes.length })` is the alternative — but that hard-codes the English plural into every language,
   including the ones (Arabic, Russian) whose *other* categories are not the plural, so `txn` is the better answer
   even for an unreachable branch.
2. `{count}` is supplied automatically by `txn` and formatted through `CBLocale.number()`, so no vars object is
   needed and none should be passed.

`set` is guarded non-null by `if (!set) return;` two lines above, so `set.nodes.length` is safe.

---

## Context worth one line

`cap-categories.js` has **23 joinable** sites (the L2 pass) against this single interpolated one — it is a file of
long, wrapped, fully-literal explanatory paragraphs (the seed-modal copy at :217–:223, for instance). The L3 work
here really is just this one call. The file calls `tx`/`txf`/`txn` zero times today.
