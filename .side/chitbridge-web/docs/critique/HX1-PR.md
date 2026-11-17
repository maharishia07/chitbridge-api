VERDICT: BUILD WITH CHANGES (critique: chitbridge-api docs/critique/HX1.md) — base round/HX0 + main. Land AFTER the api PR of the same branch.
ONE api base: `public/config.js` sets `window.CB_API` — the only address in the site; every page that calls the api loads it first (index, app, 25 pages, shell.js `apiBase()`, cap-connector/cap-workforce installers now use `CFG.API_BASE`). The 33 Railway literals in 28 files are gone.
The web image writes `/config.js` from CB_API_BASE at start (deploy/40-cb-api-base.sh; no more sed across every page). Vercel: nothing to set — the committed value is the production api, so prod is unchanged.
CTP: `vercel.json` rewrites everything EXCEPT `/.well-known/`, and nginx returns the file or 404 there — discovery is never swallowed by index.html (proof: web 404, api 200).
Counter: till.html/promo.html vendored from the api master (`scripts/vendor-till.cjs`): `window.CB_API`; service-worker shelf cb-till-v5 keeps /config.js offline. Named debt (guarded): till cbHome's vercel fallback for pre-HX1 kits.
Guard: `e2e/guard-static.cjs` §17 fails on any *.railway.app / *.vercel.app in public/, index.html, vercel.json, deploy/ outside config.js, and on a page that reads the api base without /config.js. e2e harnesses keep their env-overridable prod defaults (out of scope).
Checks: guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses all exit 0. Stack proof (api deploy/proof.sh with MinIO): walk 4/4 against the web container calling the stack's api via /config.js.
Reuse: `window.CB_API` was already the name till.html read; `CFG.API_BASE` for the installers; no new screen, no new style. Flow: platform ops (no O2C step).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
