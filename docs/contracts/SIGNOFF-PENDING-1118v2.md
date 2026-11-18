# Sign-off pending, landing 1118v2 (API head cfea8a18f vs main e9d5e316)

Generated 2026-11-18 from docs/api-register.json on branch next/contract1118-api. Not signed: docs/api-signoffs.json is edited only by a human or cb-api sign-off pass. 12 routes await sign-off (hash moved or new, status partial). Columns are the 13 machine columns (Y pass, N fail); a route with an N is a STOP, not a sign-off.

| route | hash | change vs main | schema_in | schema_out | error_shape | codes_registered | missing_input_answer | error_tests | status_codes | strict_input | output_allowlist | foreign_id_404 | idempotent_money_write | inbound_validated | trips_budgeted | owner |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET /api/actors | eb0db62880056a92 | hash moved from dd3e882c46f16e5c (row @does: Optional status, type and page in -> we list your co-assists with their role, load and acc) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-people |
| GET /api/actors/settings | b3c485806b007a65 | hash moved from 640e90743374e79a (row @does: Nothing in -> we read your shop's rules for handing out work (pull or push, default load, ) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-people |
| GET /api/books-grants/practice | ae02b5d898952d8a | hash moved from 543795c4bf5ca265 (row @does: Optional page and limit in -> we read, for every client that lets this firm read its books) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-accounting |
| GET /api/signin/provider/:key/callback | 9a3855961c8a6a36 | NEW route: The provider's answer and the start cookie -> we check the answer end to end, spend the start row, f | Y | Y | N | N | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-security |
| GET /api/signin/provider/:key/start | 14a7d28ca54bfc5e | NEW route: A provider key, this device's id and a page to return to -> we write a one-use start row and send th | Y | Y | N | N | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-security |
| POST /api/books-grants/practice/baseline | b2c7a11d153d6aed | hash moved from 869f9ac6f7ec6fdd (row @does: A client and the check point the Day book showed in -> we store that this person has check) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-accounting |
| POST /api/chits/assign-bulk | 4a8d97c747b5fd48 | hash moved from e8a8e5f640b02b78 (row @does: Up to 200 chit ids and an actor in -> we assign them all to that person, honouring your as) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-rail |
| POST /api/testing/incidents | a4181224e164d20c | hash moved from daf25f3eea1e168c (row @does: What was observed, where and how bad in -> we record an incident under the person who rais) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-qa |
| POST /api/testing/requirements | ea88b14ebd32d8c9 | hash moved from 01b811fd15475d92 (row @does: What was observed and what is needed, with the case that found it, in -> we raise a requir) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-qa |
| PUT /api/actors/:id/status | 80c3b39219d1d203 | hash moved from d21dfa8eab8017d4 (row @does: Deactivate, remove or reactivate plus what to do with their tasks in -> we let the owner c) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-people |
| PUT /api/actors/break | 352798665a5b0e6a | hash moved from 384478f656dc3004 (row @does: Short break, leave or end of break, and what to do with open tasks in -> we set the status) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-people |
| PUT /api/actors/settings | ac60c7fe6ab6d500 | hash moved from a28cbf5d48a25637 (row @does: Assignment model, default load, visibility and auto-assign rules in -> we let the owner sa) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | cb-people |

## Notes
- 57 of the 69 moved or new routes already carry a sign-off at their current hash; the 12 above do not.
- STOP rows: GET /api/signin/provider/:key/start and /callback read N on error_shape and codes_registered. Their handlers answer through the file's helpers unknownProvider and refuseVisit, so the scanner finds no problem( in the handler text (routes/signin-provider.js:91). Codes PROVIDER_OFF and PROVIDER_UNKNOWN are in docs/ERROR-CODES.md. Fix belongs to cb-security (inline problem() or a scanner follow of same-file helpers); it moves the hash and needs a re-sign.
- Ratchet against e9d5e316 fails on purpose: not meeting 12 of 684 (allowed 0 of 678 plus new routes), docs/api-ratchet.json still reads 0. Do not run --write; it falls to 0 only after these 12 are signed and the two signin rows fixed.
- Raw error text 1 (base 1). Routes with no @does 0 (base 6).
