# Sign-off pending, landing 1118v2 (api batch/api-2026-11-18v2)

Refreshed 2026-11-18 from docs/api-register.json after the independent sign-off of the last 4 routes.

**0 routes await sign-off.** Register: 688 of 688 meet the standard (13 machine columns true and a dated cb-api sign-off), partial 0, not started 0. `node tools/api-register.cjs --check` ok.

The 4 routes closed in this pass (ASSIGN-NET), each 13 of 13 at the hash signed:

| route | hash | evidence |
|---|---|---|
| GET /api/chits/holds | 81458bec565bedf2 | tests/api-problem-chits-holds.test.cjs (statuses 401 403 422 500; closed 200 held), budget line fired |
| GET /api/chits/my-work | 59f0477990988da7 | same test (401 422 500), budget line fired |
| POST /api/chits/hand-over-all | d6d2b0ad65a744bd | same test (400 401 403 404 422 500), budget line measured: 4 trips, 19 statements, status 200 |
| PATCH /api/crm/followups | 8c30a1af937c4861 | tests/api-problem-crm.test.cjs (400 401 403 500), closed 200 shape in docs/contracts/api-output-shapes.json from recordings, budget line measured: 1 trip, 5 statements |

Ratchet against origin/main: not meeting 0 of 688, raw error text 1 (base 1), no new route without @does. What is left is not a sign-off: docs/api-ratchet.json still carries the pre-batch totals (0 of 684, and the reported-column ceilings rate_limited, role_matrix, junk_fuzz one batch low), so `api-ratchet --base origin/main` prints 4 FAIL lines until the coordinator decides on `api-ratchet --write` (it raises the reported ceilings for the new routes; not run here by instruction).
