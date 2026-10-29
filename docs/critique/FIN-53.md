# Critique · FIN-53 (api + web twin, 2026-10-29) — one gate for money above what is owed

(a) Assumptions checked (base fin52-zero-payment @ 2141a61)
- "the route has its own over-quote rule": TRUE — routes/chits.js markChitPaid `payment.amount > quoted * 1.005 + 1` unless `payment.note`; a second calculation beside the books' W2 (lib/books.js duplicateWarnings).
- "the note is never passed on": TRUE — the route passes only `req.body.acknowledge` to hooks.chitPaid; the note sits on the copy.
- "warningWords says Already paid? for every list": TRUE — one opening for W1–W4.
- "the web Mark-paid popup cannot answer the 409": TRUE — app.html chitPaySubmit toasts e.message; no acknowledge path, no note field (the Ledger's Receive/Pay sheet in cap-books.js has one).
- "the excess posts through the existing ledger path": TRUE — recordChitPayment allocates min(amount, open) and recordPayment leaves the rest on account (outcome.on_account_minor); nothing new to post.

(b) Conflicts: none. DECISIONS.md "Money paid above what is owed" (Athi, 2026-10-29) picks (c). PAYMENT_ABOVE_QUOTE is deprecated, never deleted (ERROR-CODES rule). The web composes no money words: W1/W2 carry `over_words` from the books' money().

(c) Simpler way: acknowledge `excess` in the route when its own gate let the press through (option a) — rejected by the decision: two rules for one question and no confirm.

(d) Risks: tests/books-payments.test.cjs §2 froze the old sentence; the api-problem-chits scenario payment-above-the-quote retires (frozen entry removed in place); web-api.json's books/payments #409 example changes keys (over_minor, over_words) → the web fixture is a byte copy, so the web twin carries it and lands FIRST (the web tolerates both behaviours); laptop2's gorilla GP-3/GP-10 in #497 assert the old route answer — they need a rewrite after this lands (named in the PR). Landing order: web, then api (api drafts until #504 merges).

(e) VERDICT: BUILD AS BRIEFED.
