# Critique ACC-176b web (adviser access, maker-checker) - before code, 2026-11-14
Stacks on web #709 (ACC-176), twins api #1313. Checked against `gh pr diff 1313`.
(a) Brief assumptions
- Headers X-Books-For + X-Books-Role: adviser; owner sends none: TRUE (middleware/books-grant.js roleNamed, mayUseGrant).
- Every POST carries store_id, mismatch 409 STORE_MISMATCH: TRUE (routes/books-actions.js rightStore). Owner's store = its own entity (token), TRUE.
- Grant answer warnings[], revoke actions_withdrawn, rows carry preset: from the brief; the grants contract diff names `preset` and consent words; the warning/revoke fields are taken from the builder (UNKNOWN in the diff text, held loose: read if present).
- "Firm member sees no Open books" gap: GET /api/books-grants is memberOnly (the member's OWNER only, routes/books-grants.js) so a team member of the parent gets 403 and held() = {} -> NOT fixable in web. api must let GET /api/books-grants answer `received` for a firm person who may use a grant (mayUseGrant true). Stated, not worked around.
- Extra refusal codes the brief did not list: ACTION_FIRM_ONLY, ACTION_NOT_FOR_YOU, OWNER_ONLY, ACTION_REASON_NEEDED, ACTION_BODY_INVALID: worded too.
(b) Conflicts: none with the chit/rail; the server decides who may (the web greys nothing it cannot know, says the sentence on refusal). Money: carry total_minor + currency, never add across currencies (bulk shows one total per currency).
(c) Simpler way: no new page. One acting context (books-acting.js) + one queue view (books-actions-view.js) reached from the existing Open books and My books. No prepare form (not in the brief; the api door exists).
(d) Risks: data mixed between clients is the one that matters: every request is built from ONE context object (header + store_id from the same place), a switch clears drafts and caches, a stale tab gets STORE_MISMATCH and nothing is saved. Twin landing: web after api is safe (503 BOOKS_ACTION_NOT_SWITCHED_ON is worded). CBList/CBAction/confirm reused; no new control.
(e) VERDICT: BUILD WITH CHANGES - firm-member listing stays an api ask; prepare form out of scope.
