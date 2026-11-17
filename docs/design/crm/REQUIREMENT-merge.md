# Requirement — duplicates and merge

**Status:** brief for design. **Not built.** Pass mark: `docs/design/SYSTEM.md`. Mechanism: BRIDGE.md §5 (merge = link
within the shop). Flow: FLOWS.md F8, F11.

## 1 · Purpose
Find parties that are the same trader recorded twice, and fold them into one — keeping every bill, payment, point,
note and message — so dues, history and offers stop being split.

## 2 · Who
**Owner only** (merge moves Ledger balances). Co-assists see the Duplicates count on CRM home but not the action:
"Ask the owner to review duplicates."

## 3 · Where it sits
CB CRM sidebar **Duplicates** (live fact: pairs found). Also: the record's More → **Merge with…**, and the 409
`DUPLICATE_PARTY` prompt from Edit (party-fields.js:89-92: "This GSTIN is already on P-0012").

## 4 · What it shows
**The pairs list** (Task table + list-ctl): Party A · Party B · **Why** ("Same GSTIN 33ABCDE1234F1Z5" · "Same phone
98…21" · "Same e-mail" · "Similar name") · strength (rule order: tax id > phone > e-mail > name). Filter by why; **Not a
duplicate** dismisses a pair (remembered).

**The merge view** (one pair):
- Keeper choice (default: the on-ChitBridge one; else the lower party_no). A local party can never be the keeper over an
  on-ChitBridge one.
- Field-by-field, **only fields that differ**: name, legal name, phone, e-mail, address, tax ids (union — both kept
  unless the same scheme differs, then choose), state, credit terms per role, groups (union), notes (both kept),
  category / preferred.
- **What moves** (server's numbers): bills n, open dues ₹, points n, follow-ups n, chits n. Each from the server's
  preview — never added in the page.
- Confirm sheet: "P-0012 *Ravi Trdrs* will be folded into P-0007 *Ravi Traders*. Its 4 bills, ₹2,300 due and 120 points
  move to P-0007. You can undo this until the month is locked." **Merge** / **Cancel**.

## 5 · What it does
| Action | Route (new) |
|---|---|
| Find | `GET /api/crm/duplicates` → pairs with why |
| Dismiss | `POST /api/crm/duplicates/dismiss {a, b}` |
| Preview | `GET /api/crm/merge/preview?keep=&fold=` → moves + differing fields |
| Merge | `POST /api/crm/merge {keep, fold, fields:{…choices}}` → party fields patched on keeper (party-fields.patch), `merged_into` set on fold, Ledger transfer entry (books-store journal), points moved (rewards two-entry), follow-ups / interactions / mails re-pointed, one `books_change_log` row each |
| Undo | `POST /api/crm/merge/:id/undo` (owner; refused after month lock with the lock date) |

## 6 · States
- **No duplicates:** "No duplicates found." (one line; the screen is otherwise empty).
- **Two on-ChitBridge parties:** **refused**: "Both are separate ChitBridge accounts — they can't be merged. If they are
  the same business, ask them to close one." (no button to force it).
- **Month locked** for a period the fold party has entries in: merge is still allowed (the transfer is dated today);
  undo is not, after lock.
- **Fold party has an open dispute:** "P-0012 has an open dispute. Settle it first, or merge anyway — the dispute stays
  with its bill." **Merge anyway** / **Open dispute**.
- **Different currencies / states that change place of supply:** shown as a differing field with the consequence in one
  line (server's words).
- **Error:** "Merge didn't happen. Nothing was changed." + **Try again** (the server merge is one transaction).
- **One-sided / not on ChitBridge:** the normal case (two locals, or a local folded into an on-ChitBridge party = link).

## 7 · Phone
Pairs as cards; the merge view stacks A over B per field with the choice as a two-option control.
`scrollWidth === 390`.

## 8 · Words on screen
"Duplicates" · "Same GSTIN" · "Same phone" · "Same e-mail" · "Similar name" · "Not a duplicate" · "Keep" · "Fold into"
· "Merge" · "Undo merge" · "No duplicates found."

## 9 · Data it reads
The routes above; the CRM list in memory for names.

## 10 · Must NOT
- Merge two on-ChitBridge identities, or delete any row (fold = `merged_into`, never DELETE).
- Move or recompute balances in the page.
- Merge without the confirm sheet stating what moves.
- Be available to co-assists.

## For the designer
**Standard:** SYSTEM.md (rules 2, 3, 6); the Task table for pairs. **Design:** the pair row with its "why"; the
side-by-side field chooser showing only differences; the "what moves" summary; the confirm sheet; the refused state.
