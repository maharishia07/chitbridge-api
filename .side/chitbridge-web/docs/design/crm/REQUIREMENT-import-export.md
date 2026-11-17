# Requirement — import / export

**Status:** brief for design. **Not built.** Pass mark: `docs/design/SYSTEM.md`. Flows: FLOWS.md F9, F10.
Pattern to reuse: products CSV (`routes/products.js:778` export · `:827` preflight · `:875` import).

## 1 · Purpose
Bring a shop's existing party list in (from Tally, a phone, a spreadsheet) without creating duplicates, and take the
shop's parties out (CSV for a spreadsheet, vCard for a phone) — the shop's data is the shop's.

## 2 · Who
**Owner only**, both directions (an export is a copy of personal data — DPDP accountability).

## 3 · Where it sits
CB CRM sidebar **Import / export**; CRM home More → Import / Export (export uses the current view).

## 4 · What it shows
**Import — three steps:**
1. **File** — CSV or vCard (.vcf); a sample CSV to download; "Tally: export *List of Ledgers* as CSV".
2. **Map** — each file column → a party field (Name · Legal name · Phone · E-mail · GSTIN · PAN · State · Address ·
   City · Role · Group · Credit days · Credit limit · User ID · May mail (yes/no) · May message (yes/no)). Auto-guessed
   by header; unmapped columns ignored.
3. **Preview** (server's preflight) — **n new** · **n match a party you have** (by GSTIN / phone / e-mail / handle —
   "update" or "skip" per row, default skip) · **n on ChitBridge** (handle or GSTIN matches an on-ChitBridge identity:
   added as on ChitBridge) · **n errors** (row number + reason in words: "Row 14: GSTIN has 14 characters, needs 15").
   **Import n** button.
Result: "Imported 182 parties · 12 updated · 4 skipped" + **See them** (CRM home filtered to added_via = import, today).

**Export:** what (Current view · Everything) · format (CSV · vCard) · columns (checklist; default the list in F9) ·
**Export**. A line under it: "The file holds personal details. Keep it safe." Past exports: who · when · how many (owner).

## 5 · What it does
| Action | Route (new) |
|---|---|
| Preflight | `POST /api/crm/import/preflight` (file + mapping) → `{ rows:{new, match, onrail, errors:[{row, reason}]}, token }` |
| Import | `POST /api/crm/import {token, decisions}` → per row: add by handle / mint local (`local-identity.mint`, kind by role) / patch party fields; `added_via='import'`; prefs to `party_contact_pref` with `basis` from the file |
| Export | `GET /api/crm/export?format=csv|vcf&view=&cols=` (streamed; logged) |

## 6 · States
- **Empty file / wrong type:** "That file has no rows we can read. Use CSV or vCard." + **Choose another file**.
- **Too big (> 5,000 rows):** "Up to 5,000 parties at a time. Split the file." (PLAN.md Q8).
- **All rows match existing:** "Every row is already your party." + **Update them instead** / **Done**.
- **Errors only:** Import disabled; "Fix the rows below in your file and upload again." + **Download the error rows**.
- **Import interrupted:** the server import is resumable by token; "Import stopped at row 120. **Continue**".
- **Export of nothing:** "This view has no parties." (Export disabled).
- **One-sided / not on ChitBridge:** most imported rows are local — normal; the preview's "on ChitBridge" bucket shows
  how many could be linked.
- **Migration not run:** as CRM home.

## 7 · Phone
Steps stacked; the mapping is one row per column (file header above, field picker below); preview buckets as cards.
`scrollWidth === 390`. A phone can import a .vcf exported from its contacts.

## 8 · Words on screen
"Import" · "Export" · "Choose a file" · "Map columns" · "Preview" · "new" · "already yours" · "on ChitBridge" ·
"errors" · "Import n" · "Current view" · "Everything" · "The file holds personal details. Keep it safe."

## 9 · Data it reads
The routes above. Field list from the server (`GET /api/crm/import/fields`) so the page never hard-codes tax schemes
(party-fields.js:26).

## 10 · Must NOT
- Parse or validate GSTIN / phone in the page as the final word (the server's preflight is the answer; the page may
  pre-check only to save a round trip).
- Create a duplicate where a match exists unless the owner chose "add as new".
- Record marketing consent that the file did not state.
- Build the export in the browser.

## For the designer
**Standard:** SYSTEM.md; the step-flow pattern (`app/step-flow.js`) for the three steps; the products CSV import as the
existing precedent. **Design:** the three steps; the column mapper; the preview buckets and the error rows; the export
form and its warning line; the result line.
