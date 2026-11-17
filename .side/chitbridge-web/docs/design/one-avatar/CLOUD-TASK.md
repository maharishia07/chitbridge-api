# Cloud task — ONE AVATAR: the same avatar, menu, theme and font on every ChitBridge page (Sonnet)

**Outcome (one):** one avatar module that every page loads — the app (`public/app.html`), CB Accounts (`public/accounts.html`), the counter (prepared — item 6),
the index page (`index.html`), and the Labs and other standalone pages that show who is signed in — so the person, their
profile, their theme and their font are the same everywhere. Branch `cloud/one-avatar` (this file is its only commit) → PR
against `main`; never push to `main`. **First `git merge origin/main`** (web #15 lands just before this — it also touches app.html).

Athi, 2026-10-02: *"we have to have the same avatar in every application, so the profile and theme and other details can be used
across all the applications. also, it has to be part of the index page as well"* · *"only the settings we keep it as part of
backend app"*.

## Today there are THREE (read them first)
| Page | What it has | Where |
|---|---|---|
| app.html | the full menu: name + role, Profile, Settings (owner), the theme PALETTE and font, Support, Sign out; the person's appearance synced to the server (b166) | the avatar button + menu ~:5486–5510 (`UI.avMenu`), `THEMES` :4180, `themeApply` :4564, `FONTS` :4664, `fontSet` :4677, `appearancePush` :4730, `themeSet` :4813, the palette card builder near :4822 |
| accounts.html | its own copy: Profile, Sign out — **no theme, no font** (the page ignores `cb_theme`) | `$('who').innerHTML` ~:395–408 |
| index.html | a plain letter, **no menu**, no theme | ~:516 |

## Build — MOVE, never copy (CLAUDE.md rules 1–5)
1. **`public/app/avatar.js`** — one module (`window.CBAvatar`) holding what app.html has today: the button, the menu, the theme
   palette and font picker, `THEMES` / `FONTS` / `themeApply` / `themeSet` / `fontSet` / the appearance pull + `appearancePush`.
   **Moved out of app.html**, which then calls it — app.html's own look and behaviour must not change (its harnesses prove it).
   Inputs as arguments (the session, the mount element, which items to show), not `UI.*` reads, so any page can mount it.
2. **Theme and font apply on EVERY page at load**, before paint, from the same source the app uses (`cb_theme`, the font key,
   then the server's per-person appearance) — so a theme chosen in the app is the theme of CB Accounts and the index page.
3. **The menu, everywhere:** name + role · **Profile** (→ `/app.html#/app/profile`) · **Appearance** (theme palette + font) ·
   **Support** · **Sign out** (the app's `logoutNow` behaviour: session and per-person nav memory go; other tabs follow via the
   `storage` event). **Settings stays in the app only** (Athi) — on app.html the menu keeps its owner-only Settings item exactly as
   today; on every other page there is no Settings item (a "Settings ↗" link into the app is fine for the owner only, nothing more).
4. **Mount it on:** accounts.html (replace its copy — delete it), index.html (replace the plain letter; signed out → a "Sign in"
   button where the avatar goes), and every standalone page that shows a signed-in person (grep `cb_sess` in `public/*.html`:
   the Labs, network, testing …). A page that has no signed-in person stays as it is.
5. Same CSS tokens; no new style (rule 5). The avatar circle and menu look as the app's do today.

6. **The counter too (Athi: "including the counter app") — prepared here, wired separately.** `public/till.html` is VENDORED
   from the API repo (`tools/tally-connector/till.html` → `scripts/vendor-till.cjs`), so this task does NOT edit it. Make
   `avatar.js` counter-ready instead: (a) **no network needed** — theme and font apply from local storage alone; the server sync
   is optional and silent when offline; (b) **no build step, no imports, one global** (`window.CBAvatar`), so the counter can load
   it as `/engine/`-style vendored file; (c) a `person` input that can be the counter's signed-in cashier (name + role "Cashier ·
   Counter C2") rather than the app session; (d) items configurable, so the counter shows Appearance · Sign out of this counter ·
   Profile ↗ (opens the app). Document the counter mount in `docs/design/one-avatar/COUNTER.md` (what to call, where, which items)
   — the API-side wiring and vendoring follow in their own PR.

## Proof (exit codes; commit outputs)
- NEW `e2e/one-avatar.cjs` (stand-in API on a free OS port — never localhost:3000, port 7351 or the live site): on app.html,
  accounts.html and index.html — the avatar is present, its menu has Profile · Appearance · Support · Sign out, Settings only on
  app.html and only for the owner; choosing a theme on one page → the next page loads in that theme (`data-theme` / the token
  values); Sign out on any page → every page signed out; 390px: no sideways scroll.
- `e2e/one-avatar-breaks.cjs`: a page with its own avatar copy (grep for a second `avmenu` builder) → caught; a page that ignores
  `cb_theme` → caught; Settings shown on accounts.html → caught.
- Existing, still 0: `e2e/cb-accounts.cjs`, `e2e/index-page.cjs`, `e2e/books-web.cjs`, and the app's harnesses that touch the
  avatar/theme (grep `avatar-menu`, `apbar-font`, `themeSet` in `e2e/`). `node scripts/check-syntax.js`,
  `node scripts/check-app-parses.cjs`, `node e2e/cb-build-guard.cjs` (bump CB_BUILD), `node e2e/docs-guard.cjs` (MODULES.md
  via tools/gen-modules-doc.cjs — a module moved).
- `npm run check`: run every `check:*` script except those needing the sibling repos (`check:engines`, `check:till`,
  `check:envelope`) — list the skipped ones in the PR.
- Playwright is not in the repo: install it in a temp dir, point NODE_PATH at it; say so in the PR.
- Screenshots: `e2e/shots/one-avatar-{app,accounts,index}-{laptop,phone}.png` and the same page in a dark theme.

## Do not touch
`public/till.html`, `public/engine/*` (vendored), the API repo, SQL, `e2e/tests/*.spec.js`. Commit messages end with
`Co-Authored-By: Claude <noreply@anthropic.com>`.
