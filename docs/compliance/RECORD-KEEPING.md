# Record-keeping — what an auditor can check (round CO3, 2026-10-13)

From web `docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md` controls K3 · K7 · K8 (IN-9, IN-10, IN-11 · AU-9 · AE-9). Not legal advice.

## 1 · The books' edit trail cannot be disabled — Companies (Accounts) Rules r.3(1) proviso · CGST r.56(8)
| Claim | Where | Run it |
|---|---|---|
| Five books tables refuse UPDATE/DELETE by trigger | `migrations/b273_books_journal.sql:201-213`, `b295` (books_payment: only the two advice columns, once) | `node tests/records-keeping.test.cjs` (A1–A2) · on the database: b303 **P3** |
| …and by grant; the app role owns none of them (only an owner can disable a trigger) | b273 `REVOKE UPDATE, DELETE … FROM cb_app` | b303 **P4** (expect 0 rows) |
| No runtime code stands a trigger aside; no setting turns the log off | lib · routes · db · middleware · scripts · tools · server.js; `lib/policy.js` FLAGS; `books_setting` | test A3–A5 (one named exception: `tools/sim-load.cjs`, local-only by refusal) |
| Every master change is logged: who · when · field · old → new | one writer `lib/books-store.js` `logChange` → `books_change_log` (insert-only); callers: ledgers, periods, settings, terms, party fields | test A6 · screen: Day book › Audit trail |
| A correction is a reversal, never an edit | `journal_entry.reverses_entry_id`; chits: amendments beside the original (b137) | — |

## 2 · Retention floors — IN 8 FY (s.128(5)) / GST 72 months (s.36) · AU 5–7 y · AE 5–7 y
One floor: **9 years from the day a copy is minted** (`lib/policy.js` `RECORDS_FLOOR_YEARS`) — the longest of the three countries'
laws counted from the mint (IN: a record from the first day of a financial year is kept to the end of the eighth year after it).
- The mint: `routes/chits.js` `retainDaysFor` = MAX(records floor, the shop's `retention_floor_days`, the sender's ask). No flag lowers it.
- The sweep: `lib/retention.js` `planRetirement` never lists a copy younger than the floor (and is still a dry run; nothing deletes).
- The schema: `migrations/b303_records_floor.sql` (owner runs) — default `now() + 9 years`, existing copies lengthened, never shortened. Proof P1 = 0.
- **Engines request (not built here; engines are serial):** `chitbridge-engines/src/reg-in.js` add `retentionYears: 8` (s.128(5));
  `reg-au.js` 5 → note 7 for companies (s.286); `reg-ae.js` 5 → note 7 for corporate tax (Art.56). Then the floor may become per pack.
- Privacy laws (DPDP s.8(7), APP 11.2, PDPL Art.5) ask for deletion when no longer needed; each excepts records the law requires — the floor is that exception.

## 3 · Where the books live and where the daily backup is — r.3(5), r.3(6)
| Fact | Value | Source |
|---|---|---|
| Database | Supabase Postgres, AWS **ap-south-1 (Mumbai, India)** | `db/index.js:28-29` pooler hosts `aws-1/aws-0-ap-south-1`; `migrations/b188_which_database.sql:10` |
| Daily backup | Supabase's managed backup of that project — same region. **Plan, schedule, PITR and retention are a dashboard setting, not in any repo: unproven** | owner action (web `docs/compliance/OWNER-ACTIONS.md`) |
| API host | Railway — region not stated in the repo | owner action |
| Web host | Vercel (static app; holds no books) | `vercel.json` (web) |
| Data residency per country (AU/AE data also sits in India) | the hosting track's, not this round's — `docs/DATA-RESIDENCY-DESIGN.md` | — |

**For a company's ROC filing (r.3(6))** the shop states yearly: the service provider's name, the internet address, the location of the
servers and the cloud address. Ours today: *ChitBridge · database Supabase on AWS ap-south-1 (Mumbai, India) · backup same region (to be
confirmed by the owner).* Kept here until a Settings sheet is approved (a new screen needs Athi's yes).
