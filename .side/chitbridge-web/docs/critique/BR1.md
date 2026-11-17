# Critique · BR1 bank reconciliation through the rail (written before any code, 2026-10-13)

**VERDICT: BUILD WITH CHANGES.** (1) The other party's answer reuses the M30 payment advice (it carries the bank ref and the bills). No new "answer" shape. (2) Accepted marks, notes and learned rules stay ON THE DEVICE (localStorage), next to the statement. No migration, so b319–b321 go unused. (3) One new read route, `GET /api/books/bank/rail`. The ask goes out through the existing `POST /api/chits/send`. (4) The web moves bank-recon from 1.18.0 to the new tag. Its pack dependency (regulation, reg-in) is already on accounts.html through app/tax.js.

## (a) What the brief assumes, checked
- "Engine matches, the screen paints, no actions, no learning": **true**. `engines src/bank-recon.js:352` match, `:451` suggest (keyword rules only). `web public/app/cap-bank.js:141` CBList with Add missing / Record it in Dues and nothing else.
- "A customer's payment advice chit already says paid ₹X for bills A, B by ref R": **true**. `api lib/books.js:605` adviceBody gives `business_json.payment_advice { action, amount_minor, reference, paid_on, adviser_payment_id }` and `line_items[].ref_chit_id` = the bill's chit id, the same on both copies. **But nothing reads a received advice yet.** M31 Accept is not built (`lib/books.js:559`), and no route lists advices for a date window. So we need one read (one query on chit_header ⨝ chit_detail ⨝ chit_status, by `business_json->>'kind'`).
- "Our own payment from Finance is known": **true**. It is already a bank ledger line (`/books/ledger/:account`, `source.how_ref`, `source_chit_id`). The three-way link is chit ↔ ledger line by `source_chit_id` or payment id.
- "One ↔ many already lists the bills": **true** for advices. The engine's `subset_` (`bank-recon.js:326`) already sums lines, so it is reused for one deposit = several advices.
- "CBList and the count on Accounts Home": CBList is **true** (`cap-bank.js:143`). The Home count is **unknown/new**. The statement never reaches the server, so the count is the device's last run. It must say so ("on this device").

## (b) Conflicts with rules
- Rail verbs, not theirs: the actions are **Accept** · **Ask {party}** · **Undo** · **Note** (rail.js ACTIONS accept; a message chit). There are no Match · Create · Transfer · Discuss verbs and no "For review" tab.
- The server's may/why: Ask is shown always, greyed with `rail.byLevel` words (read_only / comment_only) that the new route answers. chits/send still decides.
- One books writer: Accept on a line the party told us about, but that is not in the books yet, opens the existing pay sheet (`payOpen`). It is pre-filled with the advice's amount, ref and bills, so the person still presses Record. Nothing posts by itself.
- New key `business_json.kind = 'bank_query'` (the ask chit) is documented in api docs/FIELDS.md in the same change.

## (c) Simpler
No server store for rec state: the statement is device-only, so its marks are too. No answer parser: the payer's advice echoes our ref and the ordinary ref match settles it.

## (d) Risks
- Rules and marks live on one device. A second device starts clean (said on screen). A server copy is a later round (needs a migration).
- An advice the payer typed with no or a wrong ref falls back to amount + date and is accepted only when it is unique both ways. Otherwise it is listed under Check, never guessed.
- Engines are serial: v1.44.0, taken above the highest tag after `git fetch --tags`. Twin landing: engines tag → api (route + contract) → web.
- Hot files: cap-bank.js (ours), cap-books.js payOpen (one optional argument added), routes/books.js (one route appended).

## (e) Verdict
BUILD WITH CHANGES, as listed in the first line.
