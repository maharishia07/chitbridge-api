# NET-40 critique · becoming a customer needs the customer's will (2026-10-25)
Source: cb-critic verdict given in the brief (DECISIONS 2026-10-25 10:30). Checked against the code below.
(a) Assumptions
- customer_list is the link, written unilaterally in two places: routes/relationships.js POST /customers (manual) and routes/chits.js sendCustomers (any non-draft send) - TRUE.
- Buyer-willed writers stay: chits.js sendCustomers order block, catalogue.js storefront, local-identity, move-in - TRUE, untouched.
- A `general` chit with zero lines sends: web cap-bank.js sends purpose general with line_items [] (bank_query) - TRUE (existing product path).
- One status writer: moveStatus (local) and ctpreturn.applyStatus (event from another installation) both end in lib/rail-status.setStatus - TRUE; the hook is called after each, one function.
- customer_list.added_via has a CHECK (baseline :3261) that does NOT list 'invite' - NEW FINDING -> migration b795 (draft); code falls back to 'manual' until it runs.
(b) Constructs: no new table, no cb_edge reuse; the invite is a chit (purpose general, business_json.invite); accept/reject are the rail's own statuses.
(c) Simpler way: none found; a flag on customer_list would be a second place for the state.
(d) Risks: the till's custKnown reads customer_list - an auto-add removed means a first app bill no longer creates a customer (decided); existing rows are kept and still counted (UPDATE only). send-golden must be re-frozen for the one changed statement.
(e) VERDICT: BUILD WITH CHANGES - added_via 'invite' needs b795; bill to an existing customer still counts (UPDATE, not INSERT).
