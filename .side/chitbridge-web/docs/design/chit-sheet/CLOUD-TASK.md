# Cloud task — the chit sheet: a bill in a popup, with the actions its step allows

**Outcome (one):** one reusable sheet (`public/app/chit-sheet.js`) that opens any chit as a popup over the current
screen — the bill as the counter prints it (lines, offers, GST summary, total, tender) — with an icon row of ONLY the
actions that chit allows in its current step; used by the Ledger's Day book and Ledger lines (the bill link), Dues,
the party Statement, and the index page's to-do list. Never navigates away. Athi (2026-10-01): *"the details has to be
in a popup, otherwise I couldn't go back at all … cart will not have dispute icon, but the task will have it, so how do
we bring those information here."*

**Branch:** `cloud/chit-sheet` from `main` (after the `cloud/daybook-todo` PR is merged — it edits the same file). Open a
pull request; never push to `main`. **Pass mark:** `docs/design/SYSTEM.md`. Never "accounting". Short strings.

## What to build
1. **The sheet**: a `<dialog>` (the app already has a modal pattern — `confirmAsk`, and the counter's `slipdlg`; follow
   the app's) that takes a chit id, fetches the chit the way `openChit(id)` does today (read `openChit` in `app.html`
   and the chit read route it uses), and paints: header (kind · number · date/time · counter · person), the lines with
   qty · price · offer · line total, the GST summary rate-wise with CGST/SGST (or IGST) as the counter prints it
   (`taxSummaryHTML` in `public/till.html` is the reference shape — do NOT import till.html; reproduce the rows from the
   chit's `by_rate` / tax lines; nothing recomputed: show what the chit holds), the total, the tender(s), the customer
   or supplier, and the step/status word. Phone first; the sheet scrolls, the page behind does not.
2. **The icon row — from the step flow, never hard-coded per screen.** Read how the app decides a chit's allowed
   transitions (`CBSteps` / the step engine the four screens share — see `public/app/` and `app.html` for `CBSteps`,
   `stepsFor`, `allowedTransitions` or similar, and `C:\Users\mahar\.claude\projects\C--users-mahar\memory\project-step-flow.md`
   if present in the repo docs; otherwise the chit's `status` + `purpose` + whether I am sender or receiver). Draw one
   icon per allowed action with its verb: Accept · Dispute · Goods in · Return · Receive payment · Cheque steps ·
   Print · Open page. A counter cart bill (self, completed): Print · Return · Open page. A received supplier bill:
   Accept · Dispute · Goods in · Open page. A task: Accept · Dispute · Done · Open page. Each icon calls the SAME
   function the full page calls for that action (find them; do not duplicate logic) and repaints the sheet.
   "Open page" goes where the link went before (the existing details page) — the only navigation.
3. **Callers**: the Day book / Ledger bill link (`cap-books.js`), Dues rows, the Statement rows, and the index page's
   to-do lines (if the `cloud/daybook-todo` PR added them) open the sheet instead of navigating. The counter is NOT
   touched.
4. **Who serviced**: in the Day book/Ledger source line, when `source.by` equals the shop's own name, render it as
   `<name> (owner)`.

## How it proves itself (exit codes; commit outputs)
- `e2e/chit-sheet.cjs` (pattern `e2e/books-web.cjs`, stand-in API on a free OS port, never localhost:3000/7351/live):
  opening from the Day book paints the bill with the lines, GST rows and tender from the stand-in chit; the icon row for
  a cart bill = Print · Return · Open page (no Dispute); for a received supplier bill = Accept · Dispute · Goods in ·
  Open page; pressing Accept calls the stand-in's status route once and the sheet repaints with the new step; Esc /
  Close returns to the Day book with its scroll position kept; `scrollWidth === 390` at phone width; no "accounting";
  "(owner)" suffix when by == shop name.
- `e2e/chit-sheet-breaks.cjs` (restore from a COPY): the Dispute icon on a cart bill (must be caught), navigation
  instead of the sheet, a recomputed GST row (must show the chit's own figures).
- `node scripts/check-syntax.js`, `node scripts/check-app-parses.cjs`, `node e2e/books-web.cjs`, `node e2e/index-page.cjs` → 0.
- Screenshots `e2e/shots/chit-sheet-{cart,supplier-bill,phone}.png`.

## Do not touch
`public/till.html`, `e2e/till-*`, `public/engine/*`, the API repo, SQL. Commit messages end with
`Co-Authored-By: Claude <noreply@anthropic.com>`.
