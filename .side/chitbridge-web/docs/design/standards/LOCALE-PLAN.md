# LOCALE-PLAN — the conversion order, by traffic, sized by the baseline (LOC0 · 2026-10-13)

The rules are [LOCALE-STANDARD.md](LOCALE-STANDARD.md). The numbers below are `e2e/locale-baseline.json`, written by `e2e/walk-locale.cjs`
on 2026-10-13: per screen, the rendered text nodes still in plain English when the screen is opened in the pseudo-locale `qps`
(= hard-wired, no translator can reach them) and the text boxes that clip at +40 %. "pack" says whether the pseudo pack could reach the
screen at all. A later round lowers a screen's number and re-writes the baseline (`--write`); the ratchet then holds the new bar.

| # | screen | untranslated 1366 · 390 | clipped | pack | what is in the way |
|---|---|---|---|---|---|
| — | all screens | — | 0 · 0 | — | nothing clips at +40 % today; the tab strips and the roadmap table scroll instead (by design) |
| 1 | **till** (`public/till.html`, VENDORED from api `tools/tally-connector/till.html`) | 61 · 21 | 0 | no — no catalogue at all; `cb_till_lang` is a label and a voice hint | the master gets `tx()`/the packs (the api round), then `scripts/vendor-till.cjs` copies it |
| 1 | **bill** (`public/bill-print.html`, the printed bill + the buyer's copy) | not walked yet | — | — | the walk gets a `bill` screen with a frozen `business_json.invoice` fixture (walk-bill.cjs shapes) |
| 2 | **accounts** (`accounts.html`) | 30 · 4 | 0 | yes | the sidebar and tab names (Day book, Ledgers, Trial balance…, Collapse) are static markup; the todo sentence comes from the server (§ 7) |
| 3 | **finance** (`finance.html`) | 11 · 0 | 0 | yes | column heads (Age, Limit, Terms, To collect…) and the shell words |
| 4 | **crm** (`crm.html`) | 10 · 1 | 0 | yes | column heads (Party, Role, Dues, Last activity, Next follow-up, On ChitBridge), "Walk-in" |
| 5 | **tasks** (`tasks.html`) | 7 · 1 | 0 | yes | the tab names (Orders in, Orders out, Tasks, Done) and the page title |
| 6 | **employees** (`employees.html`) | 24 · 16 | 0 | **no locale layer** — the page does not load `locale.js`, so no pack can arrive | load `locale.js`; then the list words (Add a person, Can do, Filters, On/Off) |
| 6 | **network** (`network.html`) | 13 · 4 | 0 | **no locale layer** (same) | load `locale.js`; then Network, Offers, Design, Distance, City |
| 7 | **country setup** (`app.html#/country`) | 12 · 12 | 0 | yes | the source words (country, time zone, off), the month and country names (use `Intl.DisplayNames` / the format locale) |
| 8 | **shop** (`shop.html`, the public storefront) | 8 · 8 | 0 | no — its own 5-key `_L`/`t()` table, no `tx()` | retire `_L` into `tx()`; "Powered by", "About the shop", the order and support copy |
| 9 | **Home** (`index.html`) | 278 · 197 | 0 | yes | the manifest's `what` lines and the roadmap (`public/app/manifest.json`, `roadmap.js`) are copy held in JSON — 200+ strings; the shell's pillar and card names |

## The rounds (each a later brief; none converted in LOC0)
1. **LOC1 · till + bill** — the api round (the till master): `tx()` door in till.html, the four packs' keys for the counter, the pseudo pack reachable
   (so the walk's `till` count starts falling), the bill print and the buyer's copy. Sized: 61 + 21 nodes on the till, the bill TBC.
2. **LOC2 · server sentences** — api: `why_key` + `why_params` beside `why` on every may/why (12 `may:` sites in lib, 77 `why:` in routes),
   one `refuse()` (six local copies today: books.js, books-manual, books-pack, books-period, books-recurring, country-setup), the FIELDS entry,
   the contract (`docs/contracts/web-api.json`) re-written by hand; web: `txf(why_key, why_params) || why` in the one place that paints a refusal.
3. **LOC3 · accounts + finance** — 41 + 11 nodes; static sidebar/tab markup painted through `tx()`; column heads through CBList's label door.
4. **LOC4 · crm + tasks** — 11 + 8 nodes; the same CBList door (one fix lowers both).
5. **LOC5 · employees + network** — load `locale.js` on both pages (the standard's build rule 2), then 40 + 17 nodes.
6. **LOC6 · country setup + shop** — the source words; `Intl.DisplayNames` for country and month names; retire `shop.html _L`.
7. **LOC7 · Home** — the manifest and roadmap copy: a catalogue of JSON strings is still a catalogue — key it by the English and let the packs
   carry it (no second mechanism); 278 nodes, the largest and the last because the Home is read once a day and the till all day.

Each round ends with `node e2e/walk-locale.cjs --write` and the lower numbers committed; a round that raises any number fails its own build.
The extractor's figures on 2026-10-13 (`node e2e/strings-extract.cjs`): LABEL 114 · PROSE 163 · INTERPOLATED 12 · FRAGMENT 837 — the
FRAGMENT count is the concatenation debt (standard § 2) and is reported again at the end of every round.
