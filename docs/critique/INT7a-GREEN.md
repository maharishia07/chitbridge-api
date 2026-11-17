# Critique · INT7a-GREEN — make web walk (4) e2e/till-bill-checks.cjs green on integrate/1015a (written before any code)

**(a) What the brief assumes, checked against the code**
- "7 lines fail after W1-TILL" — run on the runner: 6 fail (BF1 slip title · BF2 clash + warn line · M41 not_invoice, paper, dialog); the brief's 7th is the same root. TRUE in substance.
- "W1-TILL's rule is right: no India for an unstated country" — TRUE. `packSplitsByState()` (api till.html:5938) now answers only for a pack whose `tax.supply === 'state'`; `shopStateClash()` (:18239) returns null without it; `schemeWord()` (:5933) prints 'Tax' with no pack, so the slip says "no Tax charged on: Poori" instead of "GST charged on".
- "the shop's country comes from one reader" — TRUE: `docCountry()` (:5921) reads `S.shop.country`; `shopPack()` reads it; W1-TILL did not touch `billWarnHTML`, `shopStateClash` or `slipHTML` (git diff main...integrate/1015a shows no hunk there).
- "the walk's stand-in never STATES India" — TRUE: e2e/till-bill-checks.cjs:34 sets `S.shop` with a 29 GSTIN and state_code 29 but no `country`; BUY1 (:183) already states `country: 'IN'` and passes, which proves the reader works once India is stated.
- "'Day not opened' is shown INSTEAD of the GSTIN line" — FALSE as a mechanism: `billWarnHTML` (:18280) pushes day · norate · state · buyer, each its own line; the GSTIN line is simply absent because the clash is null. Nothing hides anything. The order (day first) is unchanged from before W1-TILL.

**(b) Conflicts with DECISIONS-level rules / constructs** — none. Fixing the walk keeps ONE reader for the country (docCountry) and does not reintroduce an India default. Editing the till master to re-run India's checks for an unstated country would break W1-TILL's rule and T2-NATDEF.

**(c) Simpler way** — state `country: 'IN'` once on the walk's stand-in shop (line 34; BF2/M41/BF3 reuse that object). No till change, no vendor step, no api PR content.

**(d) Risks** — none to data/money/security; no migration (b676–b678 unused); no engines change. Twin: the api PR #246 needs no commit for this (the master is already byte-equal to the web copy — verified with cmp). Other rounds: only this walk file is touched.

**(e) VERDICT: BUILD WITH CHANGES** — fix the WALK (state India on its stand-in), not the reader; leave the warn-line order as before W1-TILL (day · rate · GSTIN · buyer — the brief's "GSTIN first" is not what the pre-W1-TILL code did, and the walk's assertion is order-free).
