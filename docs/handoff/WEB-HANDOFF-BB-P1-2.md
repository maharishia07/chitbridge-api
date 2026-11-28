# Web hand-off, BB-P1-2 (api branch fix/bb-p1-2-propose-1141)
Under a grant with posting = owner_approves, the Bank page sends the SAME bodies to POST /api/books/events and POST /api/books/events/batch (X-Books-For, X-Books-Role: adviser, bank: client_ref).
- single: 202 with the held action { action_id, state: waiting_review, total_minor, currency, body, ... } (not posted: the line stays open until the owner accepts).
- batch: 202 { results: [{ index, client_ref, ok, held?: true, action_id?, state?, total_minor?, currency?, duplicate? | status, code, detail }], held, written: 0, posted, failed }. held counts lines proposed. A line already waiting or posted is ok + duplicate.
- 422 ACTION_KIND_INVALID: a body that is not the Bank page's (the whole batch is refused); 429 ACTION_QUEUE_FULL: 200 lines already wait for the owner.
- still refused (403, in words): /payments, /bank/marks, /bank/statements, a line naming a supplier or party (until #1439's kind is added to the one body test).
- the owner approves in the existing queue (GET /api/books-actions, POST /:id/accept with body_hash, total_minor, currency).
