# L3 prose proposals — `public/app/cap-legend.js`

Scan: 1 interpolated site. **1 SKIP.** Nothing here was edited.

---

### cap-legend.js:508
```js
+'<span style="margin-inline-start:auto;font-size:var(--fs-1);font-weight:800;color:'+c+';white-space:nowrap">'+lbl+'</span>'
```
SKIP — not prose. `lbl` is a status badge value pulled from the `S` map two lines above
(`'LIVE'`, `'BUILT · unverified'`, `'PARTIAL'`, `'ASPIRATION'`), sitting between an inline-style
string and a closing tag. No sentence, no word order, no plural.

NOTE  Those four badge words **are** user-visible English, declared here:
```js
const S={ real:['var(--ok-3)','LIVE'], built:['var(--warn-2)','BUILT · unverified'],
          part:['var(--warn-2)','PARTIAL'], aim:['var(--disp)','ASPIRATION'] };
```
They are literals in a lookup table, so they belong to the L2 pass — and the right place to
wrap them is here at the single declaration, not at the render site, since each is used once.
Flagging, not proposing.

NOTE  Also out of scope but worth the reviewer knowing: the REALITY tab's body copy
(`row('Governed peer two-way …', 'built', 'Per-entity co-held copies …', 'Run one live A↔B loop …')`,
:513 onward) is long-form English passed as function arguments. It is prose, it is
untranslated, and it is *deliberate* honesty copy about the product's maturity. Whether that
tab ever gets translated is a product decision, not a mechanical one — it is the one place in
this file where a mistranslation would misstate what ChitBridge claims to have proven.
