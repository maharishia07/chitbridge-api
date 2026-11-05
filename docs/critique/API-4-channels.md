# Critique · API-4 sweep: channels (10 routes of routes/channels.js) · written after the capture of the untouched base, before the first route edit

(a) The brief assumes, checked against the code
- 10 routes, mounted at /api/channels (server.js:454): TRUE. Seven are session routes (`auth`); three are the PLATFORM doors (approve, template-approve, revoke), behind the local `admin` gate (header x-cb-admin-key against CB_ADMIN_KEY, 503 when the key is unset, 403 when wrong), never `auth`. The gate refuses BEFORE any lookup with one body, whatever the id: door-gated, safe. Not turned into a 404.
- The catches answer `err.status || 500` with `err.message` at three modes: any status (provider-ref, auto-raise, approve, revoke, DELETE), only below 500 (template, bind, template-approve), never (GET /, GET /outbound): TRUE. Kept exactly (`faultOf(e, req, label, relay)`, the idea of the capture sweep, api #380; its file is not on main, so the helper is written here on `failed`/`said` of lib/products-contract.js).
- TRACE of every err.message that can reach an answer: only lib/channels.js throws a `status`, and every sentence is fixed words ('Binding not found', 'Not found', 'Unknown template', 'State must be approved or pending', 'Only the platform can mark a template approved.', 'Unknown channel', '<label from the CHANNELS table> is required', 'That <label> is already in use.', 'Channels not migrated yet (b123).', 'Auto-raise is not migrated on this environment (b131).'). A pg error carries no `status` (db/index.js sets none), so a database sentence is never relayed. TRUE for all ten error paths.
- BUT a 200 relays stored provider text: GET /outbound lists `reason` of each receipt, which lib/whatsapp-out.js writes from the provider's `error.message` or a failed fetch's `e.message` (lib/whatsapp-out.js:276,280). By round-1 rule 1 GET /outbound is NOT proposed for 7/7 sign-off; FINDING for cb-security, left to SEC-95 (lib/whatsapp-out.js is not touched, not even a comment).
- No `human{}` sign-off exists on these rows: stays unsigned.

(b) Conflicts with existing rules
- tests/channels.test.js (two source-reading checks: the approve door is not `auth`; the gate fails closed with `if (!key) return res.status(503)` and compares in constant time) read the gate's text: they are re-pointed to the new text and made stricter (they now also load the contract and demand 503 and 403 from the words), never weakened. The gate stays in the route file, in the same place, same two refusals and same `timingSafeEqual`.
- Frozen, not touched: lib/channels.js, lib/whatsapp-out.js, the three doors' who-may-call, auto-raise switching, every success body.

(c) A simpler way: none. The Problem fields ride beside the old `{ error, message }`; the schemas say what the handlers already take (names, nothing required, an array body still read as nothing, as today).

(d) Risks / findings listed, not fixed
- A malformed binding id in a path is a pg 22P02 answered as the safe 500, not a 404 (same as capture); unchanged.
- The template name check is `tpl.TEMPLATES[name]` on a plain object: `constructor`, `toString`, `__proto__` pass it (P3, lib/channels.js:230, for cb-connect/security).
- 503 'Admin disabled' tells whoever asks that CB_ADMIN_KEY is unset and names it (frozen word; for cb-security).
- Query values given twice on GET /outbound (?status=a&status=b) become a 400 (the schema); the web never doubles a key (grep). The only caller-visible edge.

(e) VERDICT: BUILD WITH CHANGES: (1) GET /outbound is built to 7 machine columns but NOT put forward for sign-off (relayed provider text in a 200); (2) the platform doors are `public: true` in the contract (no session; the key is their credential) with the 403/503 of the key declared; (3) the two source-reading tests are re-pointed; (4) everything else as briefed.
