# Project context (add these lines to your repo's CLAUDE.md)

## Thirukkural in the app
- Read `docs/kural/KURAL_GUIDE.md` before touching any page header, Home, sign-in, empty states, splash, or print templates.
- Data: `docs/kural/kurals.json` (single source; look up by route id; never use entries in `excluded`).
- Rules in short: one kural per screen; hero on Home only, strip elsewhere; user can hide for the day; never in forms/dialogs/errors/toasts; Tamil verse always shown; `kuralLang` swaps which line leads.
- Languages: Tamil + English required; others optional via `meaning.<code>` with fallback to English; Tamil verse always shown.
- When adding a new route, either map it in `kurals.json` or leave it without a kural — do not invent verses or translations.
