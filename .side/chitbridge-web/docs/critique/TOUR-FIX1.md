# TOUR-FIX1 — critique before build (rule 00, 14 Oct)

**(a) What the brief assumes, checked**
1. returns 422 = "a shop the pack does not cover" — TRUE: an IN shop's pack has no `returns` (api lib/books-period.js:554 throws RETURN_FROM_RAIL → routes/books.js:60 422). The web already swallows it (web cap-period.js:534) — the console/tour sees a failed request on every GST visit.
2. owner sees a bare "Shop not found" — TRUE: the api ALREADY lets the owner through a private gate with `?preview=1` + bearer (api routes/catalogue.js:713 ownerOf); shop.html only sends it when the URL says preview=1 (shop.html:1350). Home's card links /shop.html?s=<id>.
3. "187 in" vs "0" — TRUE, two readers: Home rail `in` = every open received chit (api lib/home-facts.js:236, measure over select.rows); Tasks counts folders (lib/work-rows.js countsOf). Same select read, different classification.
4. ＋ New → app.html#/app/compose — TRUE (cap-tasks.js:223). No compose outside app.html; the self-chit body exists (cap-readiness.js:88, POST /api/chits/send).
5. till ignores the theme — TRUE: applyLook reads only `cb_till_theme` (till.html:26582), never cb_theme; screen.js already has `counterThemeFor` (THEME_PAIRS cream/dark). PIN window — TRUE: usignAfterIn / whoAdoptPending open usigndlg as a modal to OFFER a counter PIN when nobody asked to sign in.
6. cbsh-tools overlap — TRUE: it is `position:sticky` (shell.js:188), cards scroll under it. promo pair* — promo.html is the till kit's vendored page (api tools/tally-connector/promo.html).
7. Dark contrast — TRUE: tasks.html's own :root (--ground/--surface) stays cream while the theme turns --ink light; kural.js falls back to cream `--panel` on pages without list tokens (settings).

**(b) Conflicts** — the till and signin-ui are vendored (till master in api, signin-ui master in web): till changes are made in the api master and copied with vendor-till (twin PRs, same branch). Rail `in/out` moving to the Tasks count changes the Home door: it opens Tasks (the list that count comes from), not CRM's chit list (one reader, one list).
**(c) Simpler** — #2 needs no api change (retry with the owner's own token on 404). #1: answer 200 `{ form:null, code, why }` in the route; the web's `r.form ? r : null` already reads it.
**(d) Risks** — rail `in` falls on shops whose open received chits were bills/notes (that is the point); home-facts tests re-pinned. No money, no SQL, no migration (b517–b519 unused). Twin: land web FIRST, then api (till-vendor reads web main). promo overlap may need a run of the tour to confirm — the tour needs a Postgres stack, not run here unless time allows.
**(e) VERDICT: BUILD WITH CHANGES** — #1 200-with-code (not a new "return" for IN: India's GSTR stays on the rail); #2 web-only; #3 rail in/out = work-rows counts (+ `tasks`), doors to Tasks; #4 a "New task" sheet in tasks.html (self-chit, the existing body) — an order to a supplier stays out (no compose outside the workshop yet); #5–#7 as briefed.
