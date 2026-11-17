# MOVE-IN W1 · critique before build (2026-10-18, cb-connect)
Requirement: C:/dev/docs/23-connectors-and-integrations/MOVE-IN-GAPS-REQUIREMENT.md (G1+G2 passed). Twin: engines move-in/w1.

(a) Assumptions, checked against api origin/main 57d4f9fe · engines 0b156c3
- plan() forces Australia — TRUE (lib/move-in.js plan: `require('./reg-au')`; supplyKindFor / abn.check read from it).
- country.packFor answers null for an unknown code, never India — TRUE (api lib/country.js, adopted v1.65.0); accounts-packs.packFor falls back (B.packOf) — so the gate must not read world.pack.
- only AU carries `moveIn` — TRUE (ids IN AU AE SG MY US JP; `moveIn` on AU only). US / IN shops → refused whole (C2).
- items are written outside the move-in's transaction — TRUE (catalogue-write.writeItems opens its own withEntity, :120).
- X-1: the bill key is account|reference — TRUE (lib/books.js planItems twoParties :387-401) — Xero's "AP" twice refuses the whole lane.
- no home for a party's source pair or for a proof — TRUE (no source_* on customer_list / supplier_list; no import table) → migration FILES b765 · b766.
- money.round(n, currency) + decimals exist in adopted lib/money v1.0.0 — TRUE; tax.splitLineTax rounds at LINE_DP_ (2 outside determine) — TRUE.
- the AU QBO sample: no invoice/bill line uses the two unmatched codes (Adjustment, GST free exports) — TRUE (59 lines: GST, GST on non-capital) → they are HELD in the proof's tax-code table, 0 documents.

(b) Conflicts with rules / constructs
- catalogue-write is the catalogue area's file: W1.6 needs ONE additive widening (`writeItems({ db })` runs the insert on the caller's connection). Flagged to catalogue; no other change there.
- books.js (area 14) is NOT changed: X-1 is solved in the move-in plan (a reference two parties share is qualified per party; a blank one is generated) — the M2 guard stays as it is.
- W2.3 (country word → code) is not W1: a country given as a word is refused with its own code until W2.3 widens it. Never a guess.
- New keys (source_country, source_company, hold codes, proof, party source pair, unit) → FIELDS.md rows in this change.

(c) Simpler: the gate is one engines door (`country.moveInFor`) the plan calls first; every kind inherits it. No per-kind country code.

(d) Risks: engines tag v1.67.0 is LOCAL (not pushed, per brief) — another round may take 1.67.0; the gatekeeper must re-check before tagging.
  Before b765/b766 run: the proof is answered but not stored (`proof.stored: false`, said); contact ids live in the proof only; one-company check is not possible (said).
  A new hold code `unit` (an unknown unit is held, never "unit") — beside country · tax_code · rounding · bill_key.

(e) VERDICT: BUILD WITH CHANGES — the four above (catalogue widening flagged · X-1 in the planner · word refused until W2.3 · `unit` hold code).
