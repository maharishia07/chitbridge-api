# CX6 critique — Connector (K1) and Employees (E1) for IN · AU · AE (written before any code, 2026-10-13)

(a) What the brief assumes, checked
- K1 "Tally offered to AU/AE, no country filter": TRUE — api `routes/integrations.js:29-36` (CATALOGUE), `:142` GET /catalogue has no auth and no country; web `app/cap-admin.js:4612-4626` draws every card with live Download buttons.
- "filter on `pack.export` (reg-in only)": TRUE — only reg-in carries `export` (api `lib/reg-in.js:614`, `export.tallyXml` `:546`); reg-au/reg-ae do not. `regulation.packFor` is node-loadable (`lib/regulation.js:129,187`).
- "the greyed line with `tally.why`": FALSE as a pack member — no pack has `tally.why`; the only `tally.why` is the books-pack manifest (`lib/books-pack.js:88`), a different thing (A9, CX2's row). The sentence is the connector's own (it is a fact about Tally's kit, not a country rule).
- Only Tally is named, but GoFrugal and Zoho are ALSO India-shaped: "GST %", "GSTIN equal to this account's", "IGST has to be applied", `zohoapis.in` (`integrations.js:37-58`, `:165`). Same bug → same gate (`pack.tax.supply === 'state'`, the gate web `packSplitsByState()` already uses, helpers.js:36). Till and CSV fit every pack.
- E1 "paint `pack.scope.out.payroll`": the member is TRUE in all three packs (reg-in `:630`, reg-au `:595`, reg-ae `:732`) but the sentences are developer prose ("OUT OF SCOPE (this file's header) — named so they are not forgotten"). Painting them verbatim breaks rule 3 (shopkeeper copy).
- employees.html loads no regulation script (`employees.html:62-73`); its one read is GET /api/people (`routes/people.js:19`), which has no country today.

(b) Conflicts: no country `if` in core — both gates read the pack (`export.tallyXml`, `tax.supply`, `scope.out.payroll`), never `=== 'IN'`. Server answers may/why: the catalogue gains `may {ok, why}` per connector and the download refuses (409) what the catalogue greys — the web only paints. One read: people's country rides the SAME statement (no new trip).

(c) Simpler: no engines change. E1 = the server's one shop line, shown when the pack lists payroll as out of scope; the pack's dev sentence stays in the pack. Engines request (queued, not built): a shop-facing `messages.payroll_out` per pack so the line can name PF·ESI / PAYG·super·STP per country.

(d) Risks: catalogue was anonymous — stays so (auth only when credentials are offered, as /download); an unknown country = offered, never a guess. Budget: catalogue 0 → 1 trip signed in; people stays 1. No migration (b343-b345 unused). Twin landing: api first (web degrades: no `may` → shown as today; no `payroll` → no line). Other rounds: CX2 touches books-pack, not integrations/people.

(e) VERDICT: BUILD WITH CHANGES — gate GoFrugal and Zoho with Tally; the greyed sentence is the connector's own; E1 paints a shopkeeper line gated on the pack (dev prose not shown); engines wording queued.
