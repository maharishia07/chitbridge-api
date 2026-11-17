# THE LOCALE STANDARD — how every word, figure and direction on a ChitBridge screen follows the reader

Owner, 2026-10-13: *"are we building the system according to locale standard … when we change the language, does every entry in
the menu, chip, icon change according to language, say how Microsoft changes the language?"*

This is the rule book. It adopts the STANDARD practice (Microsoft's globalization guidance, Unicode CLDR / UTS #35, GNU gettext,
ECMA-402 `Intl`) — not anyone's screens. Registered in the standards register (`public/app/cap-standards.js`, row *Pseudo-localisation*,
Localisation group); the guard is `e2e/walk-locale.cjs`; the conversion order is [LOCALE-PLAN.md](LOCALE-PLAN.md).

## 0 · What already exists (reuse — never a second copy)
| decision | the one place | notes |
|---|---|---|
| language · direction · numerals · number · money · date · time · sort · zone · week · workdays | `public/app/locale.js` (CBLocale) — ADOPTED from chitbridge-engines, edited only there | every screen calls it; `toLocaleString` direct is a defect |
| the words | `tx(english, context)` · `txf(english, vars)` · `txn(one, other, n, vars)` in `public/app/accounts-shell.js` | gettext model: the English IS the key; `\u0004` context, `\u0005` plural category |
| the catalogue per language | `public/app/strings-<lang>.js` (ar · fr · hi · ta), fetched on the switch by `CBLocale.pack()` | same key set in every pack (`e2e/pack-parity.test.cjs`) |
| the pseudo-locale | `public/app/strings-qps.js` — a pack like the others | § 5 |
| what a translator is handed | `e2e/strings-extract.cjs` → `e2e/strings.catalogue.json` | LABEL · PROSE · INTERPOLATED · FRAGMENT |
| RTL structure | `e2e/rtl-audit.cjs` (bidi isolation · physical CSS · Arabic glyphs · arrows) | § 6 |
| Settings ↔ Profile | `e2e/locale-map.cjs` | every control moves a row |

## 1 · Every visible string comes from the catalogue
- A word a person can read on a screen is written **once, in English, in source**, and reaches the screen through `tx()` / `txf()` / `txn()`.
  Static HTML text is painted by the page's own renderer through the same door; a `<span>Save</span>` in markup is a defect.
- The English is the key (gettext). An untranslated label therefore shows **correct English**, never a leaked key like `btn.save`.
- Context when one English word is two things: `tx('Open', 'status')` vs `tx('Open', 'verb')`. The context note is for the translator.
- No new string style: no second table (`shop.html _L`, the till's hard-wired words), no `lang === 'ta' ? … : …` in a screen.

## 2 · Whole sentences, placeholders, plural rules — never concatenation
- A sentence is ONE catalogue entry with named placeholders: `txf('{n} products in {category}', { n, category })`.
  `'<b>' + n + ' products</b> in ' + cat` is three untranslatable fragments (German puts the number after the noun; Tamil changes the case
  ending). The extractor reports these as FRAGMENT / INTERPOLATED; the number must fall, never rise.
- Counts use `txn(one, other, n, vars)`: the category comes from `Intl.PluralRules(locale)` — Arabic has six forms, Tamil one, English two.
  `n === 1 ? 'product' : 'products'` hard-codes English grammar and is a defect.
- The placeholder syntax is ICU MessageFormat's argument form, `{name}`, and ICU's plural CATEGORIES (zero · one · two · few · many · other).
  The full ICU `{n, plural, …}` grammar is NOT adopted (no library, no new dependency); a pack supplies one string per category under the
  gettext plural key. Values dropped into a sentence are bidi-isolated (`bidiWrap`, U+2068/U+2069) exactly as ICU does.
- Markup inside a sentence stays inside the one entry (`'A chit is a <b>shared record</b>'`), so the translator moves the emphasis with
  the words. Never split a sentence at a tag.

## 3 · The fallback chain — counted, never blank
reader's first language → reader's next languages (RFC 4647 priority list, `CBLocale.langs()`) → **English**. A missing pack or a missing
key renders the English; nothing renders empty and nothing renders a key. The gap is COUNTED, not hidden: `e2e/pack-parity.test.cjs` names
every key a pack lacks; `e2e/walk-locale.cjs` counts every string that never reached the catalogue.

## 4 · What is NOT translated
Names (shops, parties, people, products, places, the brand *ChitBridge* — the product AREAS "CB Accounts", "Tasks & Orders" are words and
ARE translated), amounts and their currency (the currency's own convention — `CBLocale.money`), document
numbers and identifiers (`.mono`, `<code>`, `translate="no"`), the author's own words in a chit (a shared record reads the same to both
parties — `CBLocale.match` chooses between AUTHORED versions and never translates), a quotation in its own language (the kural band: the
Tamil verse carries `lang="ta"`, its English meaning `lang="en"`). An element that declares its own `lang` is content, not chrome.
Build chrome a customer never sees (app.html's Build-preview ribbon: the API URL and the stage switches) carries `data-dev-only` and is
neither translated nor counted by the walk — mark such a strip by the attribute, never exclude it by its words.
Formats (dates, numbers, grouping) follow the FORMAT locale, which is a separate choice from the language (an Indian trader reads English
with lakh grouping) — a date in `qps` still reads `01 Jun 2026` because the format locale is `en-IN`.

## 5 · Pseudo-locale testing (`qps`)
- `qps` is a pack, `public/app/strings-qps.js`: every key comes back accented, ~40 % longer and bracketed — `Sales` → `[!! Ŝàļéš !!]`.
  Tags, `{placeholders}`, `&entities;` and digits survive untouched. It is chosen only by a test or a lab (`localStorage cb_lang = qps`);
  Settings never offers it (not in `LANG_NAMES`).
- One screen in `qps` shows three things at once: plain English = hard-wired (no translator can reach it); a box that clips at +40 % will
  clip in German or Tamil; brackets around pieces = concatenation.
- The guard: `e2e/walk-locale.cjs` opens Home, till, shop, accounts, finance, crm, tasks, employees, network and country setup at 1366 and
  390, counts untranslated text nodes and clipped boxes per screen, and FAILS when either rises above `e2e/locale-baseline.json`. The baseline
  is lowered with `--write` after a conversion round — never raised to make a build pass.

## 6 · Direction, icons and mirroring (RTL)
- Direction follows the LANGUAGE's script (`CBLocale.dir()`), never the region. Layout uses logical properties (`margin-inline-start`,
  `text-align: start`); `e2e/rtl-audit.cjs` counts the physical ones left.
- Icons are universal and do NOT mirror: ✓ ✕ ⚑ 🔔 ⚙ 🧾 ⚖️ and every pictogram keep their sense in either direction.
- Only DIRECTIONAL icons mirror in RTL, and they are the ones that mean "forward / back / next level": → ← ▸ ◂ » « ↗ ↩ ‹ › and the chevron
  that opens a row. They are wrapped `<span class="arw">` so the CSS flips them under `[dir=rtl]`. A clock, a progress bar, media controls
  (▶) and a tick do not mirror (Microsoft and Material agree on this list).
- Identifiers inside RTL prose are isolated (`.mono` carries `unicode-bidi: isolate`; substituted values get FSI/PDI).

## 7 · Server sentences
The server decides may / why; the screen only paints. Today `why` is an English sentence (`{ ok:false, why:'Only the owner may …' }`),
which the screen cannot translate. The standard: a refusal carries **a key and its params beside the sentence** — `why` stays the English
rendering (the fallback, so nothing is blank), plus `why_key` (a stable English sentence-template, the same gettext key the web catalogue
holds) and `why_params` (`{ role:'owner' }`). The screen renders `txf(why_key, why_params)` and falls back to `why`. Additive — no existing
reader changes. Each new key gets its line in the api's `docs/FIELDS.md` (number · source · writer · readers). Queued in LOCALE-PLAN; not
built in LOC0.

## 8 · The build rules (what a PR must show)
1. New visible copy goes through `tx`/`txf`/`txn` — the locale walk's count must not rise (it fails the build if it does).
2. New screens load `locale.js` AND `accounts-shell.js` (employees.html and network.html do not, so no pack can reach them — see the plan).
3. A new label is added to the four packs in the same PR or is listed as missing by `pack-parity` — never silently English.
4. Nothing calls `toLocaleString`, `toFixed` for money, or builds a sentence by `+`.
5. A new directional glyph is wrapped `.arw`; a new icon is checked against § 6.
