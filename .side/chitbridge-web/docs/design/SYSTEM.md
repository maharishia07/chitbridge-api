# ChitBridge — the design system (the pass mark for every screen)

A screen is "according to standard" when it meets every line here. Cloud design sessions build against this file and
prove it with the checks at the end; Athi judges the screenshots by eye; the prototype he accepts becomes the spec.

## 1 · Who it is for
A shopkeeper at a counter, often on a phone, often unable or unwilling to read a paragraph. Every screen says **what
happened · what it means · what to do**, in that order, in the fewest words. A symbol, a digit or a colour beats a
sentence. Never the words "accounting" or "books of account" — it is the **Ledger**.

## 2 · Tokens (fixed — copy, never restyle)
```css
:root{
  --page:#FCFAF5; --card:#FFFFFF; --panel:#F3EFE6;
  --line:#DDD6C6; --line-soft:#E6E0D2; --hair:#F0ECE2;
  --ink:#1D1B16; --muted:#5E594D; --faint:#8A8374; --ghost:#A8A295;
  --green:#16693F; --green-d:#0D4A2B; --green-t:#E8F4ED; --green-b:#A9D3BC;
  --amber:#E0A020; --amber-t:#FDF3DC; --amber-b:#EFD39A; --amber-i:#7A5205;
  --red:#C4562F; --red-t:#FBEAE3; --red-b:#E7B9A8; --red-i:#8E3517;
  --blue:#2F74C9; --blue-t:#E4EEFA; --blue-b:#B9D2EF; --blue-i:#174A87;
}
```
Type: **Bricolage Grotesque** (700/800) for display, **IBM Plex Sans** for UI, **IBM Plex Mono** with
`font-variant-numeric: tabular-nums` for every figure. Base 15 px, line-height 1.45. Radius 12–16 px on cards, 9 px on
buttons. Green = live/good, amber = needs a hand, red = wrong now, blue = a draft or a link.

## 3 · The interface rules
1. **Only a failing thing earns a row.** Everything that is fine collapses into one line; an empty alert block renders
   nothing — no container, no border.
2. **Every warning carries the button that fixes it.**
3. **The same string never appears twice on one screen.**
4. **`error.message` never reaches a user.** The screen says what happened in its own words.
5. **Truncation is a bug.** Shorten the string; never widen the box; an inner scrollbar is truncation by another name.
   *Except the list's own rows area* (2026-10-02): a list's tools and column header stay fixed and its rows scroll in an area
   that fills the rest of the window. That is the page's scroll moved under the header, not a small box.
6. **One value, one control.** Preset buttons write into the field beside them and light up only while they match.
7. **Maximum three columns**, anywhere. A fourth is refused, not scrolled.
   *Lists* (2026-10-02): a list SHOWS its top three; every other column is kept and chosen with ⚙ columns.
8. **Phone first.** Every screen works at 390 px with `document.scrollWidth === 390`; tables become one card per row
   below 620 px and never scroll sideways; a 16 px side gutter.
9. **More panes, not denser.** When a screen fills, split it; never shrink the type.
10. **Hierarchy explains.** The arrangement carries the model (three boxes you live in, four Labs you visit); no
    paragraph about the product on any screen.
11. **A number is a reason to come back.** A tile with only a name is a menu item; give it one live fact. A fact that is
    a problem is amber and is the same number as the alert above it.
12. **Logic lives in engines.** The page paints; it computes nothing a counter or another page also computes.

## 3a · FROZEN: the list standard and the avatar (2026-10-02)
The look and feel is frozen. The pass mark is `docs/design/list-standard/index.html` (open it in a browser; the 📐 panel
lists every rule). Every list with column headers is a `CBList` mount (`docs/design/list-control/PLAN.md`). It has a
three-row head that takes ≤ 20% of the window, adjustable columns, only the rows scroll, ⚙ columns, ▤ grid / ☰ lines, and
expand. Every page carries the ONE avatar, `CBAvatar`, with the simple menu: 16 themes (the 15 app themes plus Terminal,
and My device), text size (Small 92% · Medium 100% · Large 115% · Extra large 132%), Normal / Bold, Less motion, and the
five reading fonts. A screen that draws its own list header or its own avatar fails the guards. A change to the frozen
look is a new decision (DECISIONS.md), not a build choice.

## 3c · ONE FRAME on every page (SHELL-ONE, 2026-10-15 — Athi, 14 Oct: "lot of in-consistencies in each page before sign-in itself")
Every page — Home, every small app, the standards page, the storefront (shop · network shop · store · embed), the shop screen and the labs —
renders the SAME header through `CBFrame.mount` (`public/app/page-frame.js`) → `CBShell` (`public/app/shell.js`): mark · the app's name ·
the screen chip · ⌂ Home · the bell · the ONE avatar (or "Sign in"). A page draws none of it: no `<header>`, no `.top` / `.bar`, no
`CBAvatar.mount` of its own. Three shapes, one unit: `skeleton` (sidebar + main pane), `host` (an app with its own sidebar puts it at the
top of its main pane, `fit:'pane'`, 56 px to meet the brand row), `bar: true` (the header only, over the page's own body — the storefront
and the labs). The storefront keeps the shop's brand colour as `--accent`; its ⌂ Home is the shop's own front (`homeHref`). Type is §2's
stack on every page: `var(--f-ui,'IBM Plex Sans',system-ui,sans-serif)` for the body (the avatar's reading font reaches it), the display
face for headings — no serif, no page-local face. Design references (`screen-id.js` DECLARED.references → `docs/SCREEN-LIST.md`) wear no
frame and are not customer navigation. Proved by `e2e/walk-shell-frame.cjs` (every page, signed in and out, Cream/Dark at 1366/390) and
`e2e/skeleton-guard.cjs` (a page without the frame fails).

## 3b · The kural footer, `CBKural` (Athi's decision, 2026-10-03; part of the frozen look)
Every CB page carries ONE band at the foot: `public/app/kural.js`, `window.CBKural`, mounted like `CBAvatar` (`CBKural.mount()`, then
`CBKural.set(route)` as the screen changes). The kural of a page is its `route` in `docs/design/kural-kit/kurals.json`
(`public/app/kurals.json` is its copy; `e2e/kural-footer.cjs` proves they are one). Rules, kept inside the unit so no page can forget one:
- It is OUTSIDE the three-row head: it takes its height off the window (`--cbk-h`), so only the rows scroll and the head's 20% / 30% holds.
- The original couplet and the ENGLISH translation (another language only from `meaning.<lang>`, else English). No Tamil prose meaning and no
  transcription are shown — the `meaning.ta` slot stays empty.
- By space: wide (> 1100 px) side by side · 641–1100 the meaning below the verse · a phone (≤ 640) the two take turns every 7 s, a tap switches;
  with Less motion only a tap does. The verse is Noto Serif Tamil; a line breaks only at its middle.
- ✕ puts it away until tomorrow; it returns as one small `குறள் N ›` line.
- Never beside a warning (an amber or red chip, an alert, a bad card), never in a dialog, NEVER inside an outgoing customer message. 552 is never used.
- Tokens only (`--panel`, `--hair`, `--line`, `--ink`, `--muted`, `--faint`); never amber (needs a hand), never blue (a link), no italic.
`app.html` (the till-side app) does not mount it yet: its screens are repainted from one `#root` and its Messages composer sits beside the shell;
each of its screens needs a route in `kurals.json` first.

## 4 · The checks (all must pass; a cloud session runs them and commits the output)
- `node scripts/check-syntax.js` and `node scripts/check-app-parses.cjs` exit 0.
- `node e2e/a11y-contrast.cjs <page>` — WCAG AA on every text/background pair.
- A harness for the screen (Playwright, a stand-in API on a free port, never the live site) that asserts:
  `document.scrollWidth === 390` at 390 px; no horizontal scroll at 1080 px; the word count budget the design states;
  every alert has a fix button; no `alert()`; the strings "accounting" / "books of account" absent.
- Screenshots committed under `e2e/shots/<screen>-{laptop,phone,alerts}.png`, taken by the harness.
- The copy pass: strings fit the budget in `feedback-text-budget` (short, what happened · means · to do).
