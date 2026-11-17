# Critique · INT7b-GREEN (written before any code, 2026-10-15) — on integrate/1015b (web #301 · api #252)

## (a) What the brief assumes, checked
- "Sign in" at 1.00 light = text colour equals the background — FALSE. Measured in the page: the door is white on `color(srgb .062 .296 .178)` (≈ rgb 16,76,45, ~9:1). `e2e/walk-cx4-shop.cjs:57` has its OWN colour parser (`rgba?(` only), cannot read the `color()` a `color-mix` computes (`avatar.js:299`), climbs to the header's white and reports 1.00. The one reader `e2e/lib/theme-measure.cjs` (canvas) reads it right and every other walk uses it.
- Dark "▣" 3.40 · "S" 3.12 · "+" 3.12 — TRUE and real: the dark theme sets `--ok #2E9E5E` and `--blue #6892DB` (`engine/screen.js` APP_THEMES.dark) but no `--on-accent`; the storefront's `:root{--on-accent:#ffffff}` (`shop.html:18`), the logo initial `color:#fff` (`shop.html:740`) and `.cbcat-add{color:#fff}` (`cart.js:2968`) paint white on them. The mark is `--sh-on:var(--on-accent,#fff)` on `--sh-green` (`shell.js:97,114`).
- "the shared shell's storefront variant" — there is no storefront CSS in the shell: bar mode is the same CSS; the only storefront-specific thing is `title`/`homeHref` (`shell.js:22-23`). The on-colour belongs to the THEME APPLIER (`avatar.js themeApply:95`, the one place every page's tokens come from) and the engine's one calculation `CBScreen.onColour` (`engine/screen.js:476`, adopted — not editable here).
- walk-shell-frame fails 6 rows: `know-your-business · authority-forms · standards` × Cream/Dark at 390 px, "clipped Fixture Shop" (the shop name in `.cbsh-who b`, `shell.js:117`). Measured: the bar is 390 px with mark 28 · shop 83 · switcher 48 · chip 59 · bell 28 · ⌂ 27 · avatar 34 + 7 gaps × 9 + padding 26 = 405 > 390; the name needs 95 px, gets 55. Pane pages (tasks, crm, finance …: bar 326 px beside the sidebar) "pass" only because the name is 0 px wide there (the audit skips 0-width) — the area pitfall "the top bar cuts the shop name at 390" is unresolved there too; not this round's red, and a fix here must not turn it into "F…".
- The api has no readability tool of its own — TRUE: `api/tests/readability-guard.test.cjs:21` spawns the web's `tools/readability.cjs --repo api --root <api>`. "The api equivalent" = that command.

## (b) Conflicts with standing rules
- Rule 1/one calculation: the cx4 walk's private contrast reader is the second copy of `theme-measure.cjs` → lift to the one (and `rule13.cjs audit` for scroll / app.html).
- Rule 12 engines serial: the right home for `--on-accent` / `--on-ok` per theme is APP_THEMES (engines `src/screen.js`); this round does not own engines → derive them in the web's applier through the engine's `onColour`, only where the theme did not say them; the engines change is described in the report.
- Area pack "theme TOKENS only": the storefront's three `#fff` on the accent become `var(--on-accent,#fff)`; the mark's on-colour becomes `--on-ok` first.

## (c) A simpler way
- None simpler than tokens: a page-local dark override would be the pitfall the pack names.

## (d) Risks
- `--on-accent` derived in dark changes app.html's dark accent text from white to ink where the accent is light — that is the AA fix, same tokens, all pages (cap-*.js read `--on-accent`); Cream (no vars) is untouched.
- The 390 fix (phone bar: gap 6 · name 14 px · the who takes the slack · a container query hides the name whole under 360 px instead of cutting it) must keep every other tour row green — re-run the whole tour.
- No migration (b706–b708 unused), no api code change (api #252 gets only its PR body numbers), no engines tag.

## (e) VERDICT: BUILD WITH CHANGES
1. cx4 X3 measures with the ONE reader (theme-measure + rule13 audit), the AA rule unchanged (4.5 / 3). 2. On-colours from the theme applier via `CBScreen.onColour` (web), the storefront and cart on `--on-accent`, the shell on `--on-ok`. 3. The phone bar in `shell.js` only. 4. PR bodies carry the readability numbers.
