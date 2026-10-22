<!-- Owner: cb-marketing -->
<!-- Status: Live -->
# Critique · Marketing first slice (MKT-2 · MKT-3 · MKT-4 · MKT-17 · MKT-19 + advisor card) · 22 Oct 2026

The critic stage ran BEFORE this build: `C:/dev/docs/12-marketing/reviews/MKT-critic-2026-10-22.md` (cb-critic, verdict CHANGE, 8 changes). It is the spec.
This file is the repo's copy of the assumptions, checked against the code at the start of the build (origin/main api 8912554b, web d9a9636b).

| Brief assumed | Checked | Evidence |
|---|---|---|
| A new marketing.html can mount Leads/Groups/Shop window | false | their shell lives inline in crm.html (modal, session, whoPaint); a copy would drift. Build: a Marketing FACE of crm.html (`?app=marketing`) |
| channel_outbound is Offers sent | partly | no party / purpose / send / consent columns; whatsapp-out `_log` dropped party_id and purpose. Build: b776 adds four columns, no new table |
| A group send logs its refusals | false | crm-groups.send refused consent and "No phone number" before any sender was asked. Build: `logRefused`, one multi-row INSERT |
| Who came back can read the Ledger | false | party_item exists for credit bills only; cash till bills are missing. Build: lib/select.js widened (counterparty_ids, until) |
| T3.1 "regulars who stopped" is a segment | false | `inactive` includes one-bill customers; the 90 is a literal. Build: the card says "have not bought in 90 days" (MKT-18 out) |

SIMPLER WAY: none that passes the pass test; the face + four columns + one read is the least.
RISKS: two writers of channel_outbound (cb-connect reviews); the select.js widening touches every folder (its tests run); live use stays 0 until an offers template is approved (the screen says so).
VERDICT: BUILD WITH CHANGES (the review's 8). Out: held-back control, paid advice, birthday, SMS, MKT-18, a separate marketing.html.
