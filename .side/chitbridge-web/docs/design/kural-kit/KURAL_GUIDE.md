# Kural guide — how Thirukkural lives in the app

Design reference: https://claude.ai/artifact/Mme3VH7NkGxdZCUXVub6WZ
(01 Index + library, 02 Home, 03 Module strip, 04 Placements, 05 Library page-fit)

The kural is **context, not decoration**. It should feel like a quiet line of wisdom at the top of the page, never something the user has to get past.

## 1. Data
- `kurals.json` is the single source. Each entry: `no`, `route`, `group`, `page.en/ta`, `verse` (2 Tamil lines), `meaning.en`, `meaning.ta` (empty for now), `why.en/ta`, `placements`.
- Look up by the screen's `route` id. No match → show nothing.
- `excluded` lists verses that must never appear (552).

## 2. Rules (the "not overwhelming" contract)
1. One kural per screen. Never two.
2. `hero` placement only on Home. Every other screen uses `strip`.
3. Every user can hide the strip for the day. The owner can switch kurals off for the whole business.
4. Never inside forms, dialogs, modals, error messages, toasts or alerts.
5. On paper (`print`) only for reports, bills and statements — in the footer, the verse's two lines (line 1: 4 words, line 2: 3 words), never joined into one line, never cut with an ellipsis.
6. Follows the app language (section 4). The Tamil verse is always shown.
7. Only the sign-in ticker moves. Respect `prefers-reduced-motion` (stop it).

## 2a. On CB pages (frozen standard) — the kural footer, proposed, awaiting Athi's decision
- **One place, every size:** a band at the foot of the page (`CBKural`, one mount like `CBAvatar`). Never in the head (the head
  stays ≤ 20% / ≤ 30%), never beside a warning, never in an opened entry or a dialog.
- **Meaning by space:** wide = verse and meaning side by side, centred; 641–1100 px = meaning below the verse; phone = they take
  turns every 7 s in one place, tap to switch; Less motion = tap only.
- **Tokens only:** `--panel` + `--hair` fibre lines + a `--line` top edge, seal in `--muted`. Never amber, never blue, no italic.
- A line breaks only at its middle, with a hanging indent. ✕ hides it until tomorrow (a small `குறள் N ›` line brings it back).
- Which kural comes from the API per record (`ledger.kural`), not from the page.
- Reference build: ledgers-page-redesign.zip (README → "The kural footer").

## 2b. CB CRM — one kural per page (group `crm` in kurals.json)
| CRM page (route) | Kural | Idea |
|---|---|---|
| Parties list (`crm-parties`) | 120 | the same verse as Ledgers › People, so the two apps speak with one voice |
| Party page & timeline (`crm-party`) | 783 | a relationship deepens with every visit |
| Messages & dues reminders (`crm-messages`) | 100 | ask for the money, kindly |
| Service & complaints (`crm-service`) | 788 | help comes at once |
| Disputes (`crm-disputes`) | 108 | close the matter, keep the relationship |
| Loyalty & offers (`crm-loyalty`) | 103 | goodwill without counting |
| Leads & enquiries (`crm-leads`) | 94 | kind words at first contact |
- Same footer, same rules as every CB page (section 2a): never in the head, never beside a warning, one per screen.
- **Never inside an outgoing message.** The kural is for the shopkeeper on screen; a reminder sent to a customer carries no verse
  unless the owner adds one himself. (A verse about kind words, pasted into a demand for money, reads as a lecture.)

## 3. Components to build
| Component | Placement | Where | Notes |
|---|---|---|---|
| `KuralStrip` | strip | Under each page title — **not on CB pages; the footer replaces it** (see 2a) | Teal bar, red cord line at bottom, verse + meaning on one row, `குறள் N`, close button (`aria-label="Hide the kural for today"`). Collapses to a small "Show kural" pill. |
| `KuralHero` | hero | Home only | Palm-leaf panel with Valluvar seal. |
| `KuralEmpty` | empty | Empty lists | Message + verse + one action button. |
| `KuralSplash` | splash | App start, long reports | Seal, verse, thin progress bar. |
| `KuralPrintFooter` | print | Report/bill/statement PDFs | The verse's two lines (never joined, never cut), black on white, no colour. |
| `KuralLibrary` | — | Bottom of index (sign-in) page | All kurals grouped: Modules, Tax & compliance, Governance. Card = page name, `குறள் N`, verse, meaning. |

Sign-in page: "Today's kural" = `kurals[dayOfYear % kurals.length]`; ticker shows the Modules group.

## 4. Language (Tamil ⇄ English)
- Setting `kuralLang`: `"ta"` | `"en"`. Defaults to the app's UI language; user can override in Settings.
- `ta`: verse is primary (Noto Serif Tamil, bold), English meaning secondary (Spectral italic).
- `en`: English meaning primary (Spectral), Tamil verse secondary and smaller.
- The verse is never removed or transliterated. Put `lang="ta"` on Tamil text.
- Page names and the `why` line switch with it (`page.ta`, `why.ta`).
- When `meaning.ta` gets written, `ta` mode may show it as the secondary line instead of English.
- Tamil UI strings (labels, buttons) come from the normal i18n files, not from this data.

### More languages later
- Tamil and English are required for every kural. Other languages are optional and listed in `languages.optional` (e.g. `"hi"`, `"te"`).
- Add a language = add `meaning.<code>` (and optionally `translit.<code>`, the Tamil verse in that script) to every kural, then add the code to `languages.optional`.
- The Tamil verse is always shown. Only the meaning line changes language.
- Missing meaning → fall back to `meaning.en`. Only list a language in the picker when all kurals have it.
- Picker: two buttons (தமிழ் / English) while there are two languages; a dropdown once there are more.
- Load the script's font from `languages.fonts` (Noto family). Set `lang="<code>"` on each line.
- Right-to-left languages (e.g. Urdu) go in `languages.rtl`; mirror the strip and cards for them.
- Use translations you own or have permission for; do not copy published Thirukkural translations without checking copyright.

## 5. Persistence
- Hidden for today: `localStorage["kural.hidden.<route>"] = "YYYY-MM-DD"`; show again when the date changes.
- Business-wide switch: `settings.kural.enabled` (owner only), default `true`.
- Language: `settings.kural.lang` per user.

## 6. Look
- Colours: page `#F3EBDD`, ink `#2B1D14`, muted `#6B5646`, leaf `#E6CF97` / edge `#C9A75E`, cord `#8E2A23` (light) / `#C2493F` (on teal), gold `#C98A12` / `#E0A532`, strip `#14423F`, strip text `#F3E6C4`, card `#FBF6EC`.
- Fonts: Noto Serif Tamil (verse), Spectral (English meaning), IBM Plex Sans / Noto Sans Tamil (UI).
- Valluvar seal: inline SVG from the design canvas; no emoji anywhere.
- Close/toggle buttons ≥ 44px touch target; text contrast ≥ 4.5:1.

## 7. Done when
- [ ] Every route in `kurals.json` shows its strip; unknown routes show none.
- [ ] Hide-for-today works and resets next day; owner switch hides all.
- [ ] Language toggle swaps primary/secondary without layout jump.
- [ ] No kural appears in dialogs, forms, errors or toasts.
- [ ] Index page shows the full library at the bottom, grouped, in the chosen language.
- [ ] Print footer only on reports, bills, statements.
- [ ] Reduced motion stops the ticker.
