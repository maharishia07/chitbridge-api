# CRM-32 critique - the Parties list says "Settled" for an order not billed yet (walk W41, Priya)

(a) Assumptions checked
- FIN-2's unbilled test is reusable: TRUE - lib/work-rows.js unbilledOf + open-orders.MARKS_SQL (the Tasks Billed tag), orders_in tab only.
- The order row names its party: TRUE - select row `counterparty_id` (work-rows build -> row.party_id), same id as the CRM party_id.
- The list can take it in one go: TRUE - one select.rows read + one readBatch marks statement for the whole page, no per-row query.
- The list answer already has total/page/limit: TRUE (lib/crm.js list); unchanged.
(b) Conflicts: none. No second test: unbilledOf was split into unbilledItems (the test) + sumUnbilled (the sum); the by-party grouping calls the same two.
(c) Simpler way: none - the client cannot know it (the list holds no chits); the record computes it from its timeline and keeps doing so.
(d) Risks: +2 DB trips on GET /api/crm/parties (budget 1 -> 3, by hand); shops over the 5000-copy read limit get no figure (key left off, never a wrong 0);
    the contract gains `parties[].unbilled` (api master + web fixture byte copy, same change); no migration; read-only; same auth as before.
(e) VERDICT: BUILD AS BRIEFED
