# CB CRM — the plan after the designer (PLAN)

**Status:** spec, phase 1 (this PR). The same four steps as CB Accounts: **standalone page · literature baseline ·
designer per screen · reuse what exists.** Nothing below starts until Athi accepts the designer's screens; the accepted
prototype becomes the spec for each screen (SYSTEM.md).

## The documents (this PR)
| File | What it settles |
|---|---|
| `INVENTORY.md` | what exists (input; unchanged) |
| `LITERATURE.md` | the baseline: 31 items, each HAVE / PARTLY / MISSING / OUT |
| `DATA.md` | one record per party; a decision for each of the 8 gaps; 3–4 new tables |
| `BRIDGE.md` | party_no ↔ identity ↔ on ChitBridge; what it unlocks; linking a local party |
| `MESSAGING.md` | one timeline; the mail form as a kind of the one compose; how mail is sent |
| `FLOWS.md` | 12 flows end to end |
| `REQUIREMENT-home · record · timeline · compose-mail · followups · segments · merge · import-export · settings` | one brief per screen, each ending "For the designer" |

## Phase 2 — the designer (no code)
Order for the designer, most-used first: **home → record → timeline → compose-mail → followups**, then segments, merge,
import-export, settings. Hand-off shape as `docs/design/ledgers-page/` (index.html, styles.css, app.js, data.js,
README.md) under `docs/design/crm/handoff/`. Athi judges by eye.

## Phase 3 — build A: one record (read-only CRM)
**Screens:** CB CRM page shell, home, record (read + edit), timeline (chits, messages, bills, disputes, changes — no
new kinds yet).
**Reuses:** `accounts.html` shell + `app/accounts-shell.js`; Task table (`listHeader`/`rowGrid`/`colTemplate`),
`list-ctl.js`, `rowPeek`, `gsToggle`; `openChitSheet`; `partyDueChipHTML`, `partyBooksHTML`, `partyStatementLoad`,
`partyEditOpen` (moved out of the Ledger-only block, widened to many tax ids); `custNamedGroupsHTML`, `custRewardsLoad`;
`CBOnePerson.attach` gate.
**API (chitbridge-api):**
- `GET /api/crm/parties`, `GET /api/crm/parties/:id`, `GET /api/crm/parties/:id/timeline` — new `routes/crm.js`, reads
  only; built on `party-fields.decorate`, `SEGMENT_SQL`, `select.counterparties`, `measure`, `books-store.parties`.
- `lib/local-identity.mayTrade` wrapping `onRail` + population; `tillMaySend` and till.js:213 call it (BRIDGE.md §2).
- First readers of `merged_into` (CRM reads; then `books-store.parties` and `/dues`).
- SSE: emit `message` on an external chit message (chits.js ~:3645).
- `high_value` in SEGMENT_SQL (after Q3).
**No migration.**

## Phase 4 — build B: one add, logging, follow-ups
**Screens:** Add party (one field, F1), Log sheet, follow-ups, record's Next block.
**API:** widen `local-identity.mint` for `kind:'cus'` (+ `entity_kind` from kind); customer add-by-name;
`POST /api/crm/parties/:id/interactions`; `/api/crm/followups` CRUD; nightly follow-up sweep → bell `followup`;
walk-in → party (mint + `rewards.claim`).
**Migration b276** (`party_interaction`, `party_followup`) — Athi runs.

## Phase 5 — build C: mail and consent
**Screens:** compose kind `mail`, CRM settings (mail, consent, segments), record's preferences.
**API:** widen `lib/notify.sendEmail` (from, reply-to, cc, bcc, attachments); `POST /api/crm/parties/:id/mail`;
scheduled-mail sweep; Resend status webhook; replies via `capture.js:150` (if Q1 b); statement PDF render;
`/api/crm/settings`; `party_contact_pref` routes. Fix compose dropping `bridge` (app.html:7411).
**Migrations b277** (`party_contact_pref`), **b278** (`party_mail`).

## Phase 6 — build D: merge, link, import/export, segments
**Screens:** duplicates & merge, link to ChitBridge, import / export, segments & groups; bulk select on home.
**API:** `/api/crm/duplicates`, `/api/crm/merge` (+ preview, undo), `/api/crm/parties/:id/link`, `/api/crm/import`
(+ preflight, fields), `/api/crm/export`, `/api/crm/groups/:name`, `/api/crm/segments`. Ledger transfer entry through
the existing journal. Export log.
**No new migration** beyond a `crm_export_log` if Athi wants exports kept in the DB (else `books_change_log`).

## Then
Retire the app's Customers / Suppliers screens to links (only after CB CRM has every HAVE/PARTLY item they show);
Supplies picks a party instead of free text (`supply_item.last_from`); parties in the app search.

## The conformance suite — "golden-parties" (like golden-books)
A seeded shop and the expected screens, run with a stand-in API on a free OS port (never localhost:3000, 7351 or the
live site), pattern `e2e/books-web.cjs` / `e2e/cb-accounts.cjs`.

**The seed (`e2e/fixtures/golden-parties.json`):**
| Party | Set-up | Expected |
|---|---|---|
| P-0001 Agro Mills | on ChitBridge, supplier only, 3 bills received, ₹481.65 due | one row, Supplier chip, On ChitBridge, dues chip ₹481.65 |
| P-0002 Chola Auto Care | on ChitBridge, **customer and supplier** | **one** row, both chips; segment counted; dues `side:'both'` netted once |
| P-0003 Ravi Traders | local supplier (`~shop.sup-0001`) | Local chip; no Message button; Call/Mail |
| P-0004 Ravi Trdrs | local customer, same phone as P-0003 | duplicate pair "Same phone"; merge → one party, history kept |
| P-0005 Meena | customer, 0 bills in 120 days | segment Inactive |
| P-0006 Big Buyer | customer, top value | segment High value (computed, not override) |
| walk-in 98…21 | phone points only | Walk-in row; Add to my parties → points claimed |
| P-0007 Test Co | other population | never listed |
| P-0008 Folded | `merged_into` P-0001 | never listed; its link opens P-0001 |
| Interactions | 1 call, 1 note on P-0003; 1 external + 1 internal message on P-0002's chit; 1 mail (sent), 1 (bounced) | timeline order and kinds; bounced is amber with Fix address |
| Follow-ups | 1 late (P-0001), 1 today (P-0003), 1 done | home alert "1 late"; follow-ups groups Late/Today |
| Prefs | P-0005 e-mail off | Mail disabled with the reason |
| GSTIN | P-0001 party_tax_id ≠ identities.gstn | amber "GSTIN differs" with both buttons |

**Asserts:** every LITERATURE HAVE/PARTLY item visible on the screen named; 390 px `scrollWidth === 390`; no
"accounting"; every alert has its fix button; no per-row fetch on home (request count); the page computes no money
(the dues it shows equal the API's string); a co-assist sees no Import/Export/Merge. **Breaks file**
`e2e/crm-breaks.cjs`: a both-roles party drawn twice, a merged party listed, Message offered to a local party, mail
offered with preference off, a per-row fetch — each restored from a COPY.
API side: `tests/crm-*.test.js` for the read model, mayTrade, mint `cus`, merge/link ledger transfer (balances before
= after across the two parties), import preflight buckets.

## Open questions for Athi (each with a recommended answer)
| # | Question | Recommended |
|---|---|---|
| Q1 | **Mail:** from-address and replies. | From `<Shop> via ChitBridge` on the platform domain with Reply-To the shop's verified e-mail now; per-mail reply address through the existing inbound webhook so replies land on the record (phase 5); own domain later. Provider: Resend (already used). |
| Q2 | **Link a local party when it joins ChitBridge** — today's code says "never migrate… not now". | Allow it as *link, don't move*: `merged_into` + a Ledger transfer entry dated the link day; history stays on the old id; undo until month lock (BRIDGE.md §5). |
| Q3 | **High value rule.** | Top 10 % of customers by 12-month bill value, at least 3 bills; shop can change it; override still wins. |
| Q4 | **A party on both lists** — one row or two? | One party, two roles, one netted dues figure (as Dues already does). |
| Q5 | **Owner / assignment of parties.** | Not now — assignment on follow-ups only; revisit when a shop has more than ~5 co-assists. |
| Q6 | **WhatsApp from the CRM.** | `wa.me` link + "Log it" now (free, no template approval); API WhatsApp stays for system notices. |
| Q7 | **Contact people under a business party** (literature item 2). | Phase 6+: named contacts (name · role · phone · e-mail) on the party; not needed for the first screens. |
| Q8 | **Very large lists** (list-ctl holds the whole list). | Keep in-memory up to 5,000 parties (no shop is near it); above that, server paging like Platform's `platPagerHTML`. |
| Q9 | **Where CB CRM lives** — own page or inside the app? | Own page `crm.html` like CB Accounts, with an index tile later; the app's Customers/Suppliers link to it. |
| Q10 | **Customers removal** — no DELETE route today. | Allow "Remove from my parties" only with no open dues; it hides the row (no history deleted). |
| Q11 | **Consent for existing parties** (DPDP). | Record service messaging as `legitimate_use` (they bought/sold), marketing as not given until recorded; show the gap as a count on Settings, never block service mail. |

## Reuse points named (CLAUDE.md rule 1) and new paths justified (rule 4)
**Reused:** Task table (`listHeader`, `rowGrid`, `colTemplate`, `rowPeek`), `list-ctl.js`, `gsToggle`, `openChitSheet`,
`openChit`, compose (`compose`, `ccRcptSearch`, compose pill), `attach-ui.js`, `accounts.html` shell, `CBOnePerson`,
`partyDueChipHTML`, `partyBooksHTML`, `partyStatementLoad`, `partyEditOpen`, `custNamedGroupsHTML`, `custRewardsLoad`,
`bizLedgerSwitch`; API `party-fields` (decorate, patch, ensureNo, numberAll), `local-identity` (mint, onRail),
`customer-groups` SEGMENT_SQL, `select.counterparties`, `measure`, `books-store.parties`, `/api/books/*`,
`reward-store` / `rewards.claim`, `chit_messages` routes, `/api/events`, `notify.sendEmail` (Resend), capture inbound
webhook, `/api/attachments`, products CSV preflight pattern, `step-flow.js`.
**New, and why** (searched: docs/SEAMS.md, docs/SOFTWARE-ASSETS.md, greps listed in MESSAGING.md §1 / DATA.md §2):
`routes/crm.js` (no route returns both roles as one party; the old routes keep their contracts) · `mayTrade` (the
check is split three ways; one function replaces the split) · `party_interaction` (calls/visits/notes have no store) ·
`party_followup` (no per-party reminder exists) · `party_contact_pref` (no consent store exists) · `party_mail` (no
outbound mail store exists) · `settings.crm` (no CRM settings exist; slot to be confirmed with FIELDS.md) ·
`crm.html` (the CB Accounts pattern: its own page).
