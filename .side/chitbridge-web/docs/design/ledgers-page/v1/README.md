# Ledgers – Chart of Accounts (handover)

Standalone page: plain HTML, CSS and JavaScript. No build step, no dependencies.

## Run
Open `index.html` in a browser (or serve the folder with any static server).

## Files
- `index.html` – page structure (sidebar, sticky header, content area)
- `styles.css` – all styling; colours and fonts are CSS variables in `:root`
- `data.js` – the chart of accounts and sidebar items (swap for an API call)
- `app.js` – rendering and interactions

## Behaviour
- Sections (Personal / Real / Nominal) collapse and expand; "Expand all" / "Collapse all" in the toolbar
- Sidebar collapses to an icon rail (auto icon rail below 760px)
- Search matches account code or name and highlights the match; searching opens all sections
- Filter chips by account class, with counts
- Header stays pinned while the ledger list scrolls; sidebar scrolls independently
- Clicking an account fires `document` event `ledger:open` with `{ code }` – wire this to your ledger view

## Fonts
IBM Plex Sans (UI), IBM Plex Mono (codes), Source Serif 4 (headings) – loaded from Google Fonts.

## Not included
Balances per account (no data was available). Add a Dr/Cr balance column in `app.js` → `.acct` row.
