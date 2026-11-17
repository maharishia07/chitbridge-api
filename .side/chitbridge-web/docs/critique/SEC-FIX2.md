# SEC-FIX2 (web side) · H4 stored XSS — critique (2026-10-15)
Main critique: chitbridge-api docs/critique/SEC-FIX2.md. VERDICT: BUILD AS BRIEFED.
- Assumption TRUE: public/store.html:109 builds `setCat('…esc(c).replace(/'/g,"\\'")…')`; `esc` (app/helpers.js:11) makes `'` → `&#39;`, which the browser decodes before the handler runs, so the replace never matches. Same wrong order in lab/combo-mode.js:505/508/519 and app/cap-connector.js:99 (shop's own screens); network-shop.html:96 `pick('…bridge_id…')`.
- Fix: store.html chips use `data-cat` (one esc) + one delegated listener; the other inline handlers escape `\` and `'` for JS BEFORE esc. No new helper: `esc` stays the one in helpers.js.
- Guard: e2e/guard-xss-handlers.cjs (in `npm run check`) fails the wrong-order pattern anywhere under public/.
- Risks: none for data/money; CSP is Report-Only so it did not block this. Independent of the api PR; either landing order.
