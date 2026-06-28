# Perspective coverage checklist — was each module checked from every angle?

Three perspectives: **Entity owner** (the business admin) · **Actor** (co-assist / sub-user) · **End-customer**
(the external, no-login buyer). ✓ audited · ~ incidental/partial · ✗ not yet · — N/A.
Honest headline (updated 2026-06-28): **all three perspectives now audited** — Entity + Actor + End-customer.
The Customer flow audit is done (`catalogue.js`); remaining items are backlog (OTP attempt-counter, order price
validation), not unexamined gaps.

| Module | Entity owner | Actor (co-assist) | End-customer | Notes |
|---|---|---|---|---|
| Compose | ✓ | ✓ (send-as actor) | — | customers don't author |
| Task panel | ✓ | ✓ (row acts, My/All, pull/push, per-actor unread, `'a1'`→real id) | ~ (checkbox/acts hidden for customer) | actor side deep |
| Order panel | ✓ (sent-endpoint fix) | ✓ | ~ (customer has separate my-orders) | |
| Messages | ✓ | ✓ | ~ (external scope only for customer) | customer msg view not audited |
| Notifications (bell) | ✓ | ✓ (assigned_to_me / dispute_for_me) | ~ (hidden for customer) | actor-aware done |
| Co-assists / Actors | ✓ (manage) | ✓ (login/PIN, shift, break/leave) | — | the actor model itself |
| Disputes | ✓ (raise/resolve) | ~ (acts via entity ctx) | ✗ (can a customer raise/see a dispute?) | customer-side dispute NOT checked |
| Catalogue | ✓ (manage) | ✓ (entity ctx) | ✗ (the PUBLIC catalogue browse) | end-customer browse NOT audited |
| Suppliers | ✓ | ✓ (entity ctx) | — | |
| Network | ✓ (auth fix + cascade analysis) | — | — | entity-level |
| Settings | ✓ | ✓ (settings affect actors) | — | settings labeled "not yet active" |
| Profile | ✓ (user_id fix) | ~ (actor profile not separately audited) | — | |
| **Customer flow** | — | — | ✓ (audited 7a63490) | browse visibility-gated · per-shop scope · my-orders isolated · rate-limited; OTP attempt-counter + price validation backlogged |

## What "from both perspectives" really means here
- **Actor coverage is genuinely deep:** assignment (push/pull/bulk), per-actor unread (`chit_reads`), dispute-handler
  routing, the `'a1'`→real-actor fix, login/PIN/shift/break/leave, actor settings (found dead), and the actor
  acts under the entity's context (`ctx = parent_entity_id`) everywhere — so an actor inherits the entity's
  tenant scope on every panel.
- **Entity owner coverage is complete** for every audited panel.
- **End-customer coverage is the gap.** We touched the `role==='customer'` branches *incidentally* (hidden
  checkbox/acts/bell, external-only messages), but we have NOT audited the end-customer EXPERIENCE: the public
  catalogue browse, the OTP/no-login customer auth, my-orders, and whether/how a customer raises or sees a dispute
  or messages. That is the pending **Customer flow** audit — and it's the externally-facing one, so it deserves the
  same careful security treatment Network got.

## To be confident, still to do (End-customer)
- [ ] Public catalogue browse (`catalogue.js`) — what's exposed without login; tenant/visibility scoping.
- [ ] Customer auth (OTP / no-login) — abuse limits, what a customer token can do.
- [ ] My-orders — a customer sees only THEIR orders (isolation across customers).
- [ ] Customer ↔ dispute / messages — can a customer raise a dispute, see external messages, and is it scoped?
- [ ] Customer-priority flag (`custFlag`) end-to-end.

Once the Customer flow is audited, this table is all ✓/~/— with no ✗.
