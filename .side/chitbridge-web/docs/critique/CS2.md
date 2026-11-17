# CS2 (web) — the critique is in chitbridge-api/docs/critique/CS2.md (VERDICT: BUILD WITH CHANGES); this is the web's share and the rows left

The web adopts engines v1.42.0 (locale · govcontext · reg-in/au/ae · regulation: `engines.lock.json`, written by the engines' adopt tool), re-vendors
the till (api `scripts/vendor-till.cjs`) and widens the Country setup step (`public/app/cap-country.js`, walked by `e2e/walk-country.cjs` C7–C11):
the picker = the server's `countries[]`; a country's pack paints currency · year · zones; a multi-zone pack asks the zone; a constituted shop
greys Country and Money with the reason and paints the server's 409 sentence. No new screen, no new style: the rows ARE the registration's gov panel.

## Item 5 — the ONE locale helper is `CBLocale` (money · number · date, hydrated from the shop's country). Where the big screens stand (2026-10-13)

| Screen | State |
|---|---|
| till.html (vendored) | money → `money()` → CBLocale.money; counts → `fmtCount()` → CBLocale.number (CS2, api master). Left: the VOICE language default `cb_till_lang` = 'en-IN' (7 lines: a speech language, not a format — a row below). |
| app.html · app/helpers.js | `fmtMoney` → CBLocale (R1); `inr_` is an alias kept for old callers; CBLocale.hydrate from the entity's country (app.html:5024). |
| accounts.html | CBLocale.money on every amount cell; dates through CBLocale. |
| finance.html | no hard-coded locale, symbol or GSTIN. |
| bill (chit sheet / print) | the live bill paints the server's `summary_json.money` through fmtMoney. `public/bill-print.html` is a static SAMPLE (a hard-coded shop, 'GSTIN' label) — a lab page, not a live screen. |

## Hard-coded India spots LEFT (live code only; comments and the engines' own INR fallback are not listed) — each a row, none decides a figure

| File:line | What | Why it stays this round |
|---|---|---|
| public/till.html (api master) 17173 · 17207 · 17274 · 26381 · 26398 · 26469 | voice language default `'en-IN'` and the language menu (en-IN · ta-IN · hi-IN · en-GB) | a SPEECH language, not a number format; the pack's `locale.langs` (v1.42.0) can feed the menu — its own round |
| public/bill-print.html:95,153 | sample shop with a GSTIN and the 'GSTIN' label | a static design sample; the live bill labels the tax number from the party-fields scheme (api party-fields SCHEMES now carries ABN · TRN) |
| public/store.html:61 | `rs()` = '₹' + toLocaleString('en-IN') | the public storefront's own money; should call CBLocale.money with the shop's currency — storefront round |
| public/supplier-design.html:154 · cart-design.html:124 · storefront-design.html:119 · network-design.html:202 | design labs' `money()` = '₹' + en-IN | design labs (not shipped screens) |
| public/offer-lab-next.html:1069,3237 · combo-lab.html:843 · list-lab.html:65-66 | labs' money and date words pinned to en-IN | labs |
| public/standards.html:201 | the standards page's "checked on" date in en-IN | a docs page |
| public/testing.html:2066,2186,2190 | the TTS test page's language menu | a test page |
| public/app/cap-admin.js:4166 | the number-system picker's example row for 'en-IN' | a label in a picker that offers every system; not a default |
| public/app.html:+91 (1) · storefront-design.html:+91 (1) | a phone placeholder | the party-fields phone rule is the server's; the placeholder should read the pack's dial code — its own row |
| 'GSTIN' as a word in app.html (15) · cap-admin.js (11) · cap-crm*.js (8) · screens.js (4) · cap-standards.js (3) | the India tax-number label in copy | the label belongs to the scheme (party-fields SCHEMES); a label-by-scheme pass is one round, not a string replace |

## PR body (the token could not open the PR; open it from the compare link with this body)

**VERDICT: BUILD WITH CHANGES** (api docs/critique/CS2.md; web share + the rows left in docs/critique/CS2.md). Lands LAST (engines v1.42.0 → api → web); works before the api lands (CBLocale.REGIONS fallback).
- Country setup step (public/app/cap-country.js — the registration's gov rows, no new style): the picker = the server's `countries[]` (exactly the packs, whatever the browser's locale); choosing a country paints ITS pack's currency · year · zones; a multi-zone pack ASKS the zone (device's preselected, else open with nothing picked); PUT carries `timezone`; a constituted shop greys Country and Money with the reason and paints the server's 409 sentence; `rederived` is said in the toast.
- engines v1.42.0 adopted (locale · govcontext · reg-in/au/ae · regulation; engines.lock.json via the adopt tool); till.html re-vendored (counts through CBLocale).
- Walk e2e/walk-country.cjs C7–C11: AU asks the zone · the picker is the packs · a correction before constitution re-derives and PUTs the zone · constituted → greyed · 409 painted. 11/11.
- Hard-coded India spots LEFT: the rows in docs/critique/CS2.md (till voice-language default, bill-print sample, store.html rs(), design labs, 'GSTIN' labels — label-by-scheme is its own round).
- Checks: check-syntax · check-app-parses · guard-static · token-guard · dup-functions · contract · a11y-contrast — all green. Flow step: Accounts · step "country" (flows.json note updated).
- Better than Zoho Books because the step shows WHY a field is fixed (products / chits / entries) on the row itself, instead of a disabled setting with no sentence.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
