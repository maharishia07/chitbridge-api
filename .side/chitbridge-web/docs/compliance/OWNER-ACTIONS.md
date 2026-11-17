# Owner actions — compliance acts no code can do

Each row is an organisational act: done only when the owner does it and records the date + evidence here. Never ticked by a build round.
Source: `docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md`. Rounds add their own section; do not reorder others'.

## CO3 · record-keeping (2026-10-13)
| ☐ | Act | Why (law) | Evidence to keep |
|---|---|---|---|
| ☐ | Run `chitbridge-api/migrations/b305_records_floor.sql` (Supabase SQL editor, as postgres); paste P1–P4 output here | Companies Act s.128(5) · CGST s.36 · r.3(1) audit trail | P1 = 0 · P2 '9 years' · P3 5 rows `O` · P4 0 rows |
| ☐ | Confirm in the Supabase dashboard: plan, **daily backup on**, backup region = ap-south-1, PITR on/off, backup retention days | Companies (Accounts) Rules r.3(5): daily backup on servers in India | Screenshot of Database › Backups, dated |
| ☐ | Do one restore drill (restore a backup to a scratch project; count `journal_entry` rows against live) and log the date | r.3(5) / ISO 27001 A.8.13 | Drill date · rows matched |
| ☐ | Record the Railway (api) region and its log retention | r.3(5)–(6) facts; CERT-In 180-day logs (CO2) | Railway settings screenshot |
| ☐ | Approve (or not) a Settings sheet "for your ROC filing" (provider name · IP/cloud address · server location); until then the facts live in api `docs/compliance/RECORD-KEEPING.md` §3 | r.3(6): companies file these every year | Athi's yes/no |
| ☐ | A lawyer/CA ticks the ◐ citations used by the four CO3 Standards rows (IN s.128(5)/s.36, r.3(5)–(6), AU s.382-5/s.286, AE TPL/CT Art.56) | the CO0 doc §0: ◐ needs one human check | Name + date per row |
| ☐ | Queue the engines change: `reg-in` `retentionYears: 8`; `reg-au` / `reg-ae` note 7 years for companies / corporate tax | per-country precision of the floor | the engines round that ships it |

## CO1 · privacy (13 Oct 2026)

| # | Do this | Why (law) | Owed | What the product does once it is done | Done (date · who) |
|---|---|---|---|---|---|
| O1 | **Run migrations `b306_party_contact_pref.sql` and `b307_privacy_request.sql`** (chitbridge-api/migrations, Supabase SQL editor, as postgres), then the check query at the foot of each | — | now | Consent rows and the request register switch on; until then those routes answer "not migrated yet" (503) | |
| O2 | **Publish a privacy policy / notice** (India SPDI r.4; Australia APP 1 + an AU section naming India as where data sits; UAE PDPL). Have a lawyer read it. Give it a version, e.g. `2026-11-01`, and set env `PRIVACY_NOTICE_VERSION` on Railway | SPDI Rules 2011 r.4 · DPDP s.5 · APP 1, 5, 8 · PDPL Art.4 | **today** (SPDI) | Every consent row records the notice version; `GET /api/privacy/facts` says it is in force | |
| O3 | **Name a grievance / privacy officer** with an e-mail and phone; set env `PRIVACY_CONTACT` (e.g. `Name · privacy@… · +91…`) | SPDI r.5(9) (one month) · IT Intermediary Rules r.3(2) · DPDP s.8(9) | **today** (SPDI) | The facts answer shows it; requests are logged in the register with their due date | |
| O4 | **Ask a lawyer the open questions**: is ChitBridge an intermediary (IN-12)? may we hold an encrypted full Aadhaar (IN-16)? UAE Executive Regulation status and India's adequacy for UAE transfers (AE-4, AE-8)? DIFC / ADGM shops? AU small-business opt-in (s.6EA)? | CO0 §7 open questions | before May 2027 | The register's clocks change if the answers do (`lib/privacy.js` `DUE_DAYS`) | |
| O5 | **Sign data-processing agreements** with Supabase, Railway, Vercel, Resend, Meta, Anthropic, OpenAI (as each is used); keep the signed copies | DPDP s.8(2) · APP 8.1 / s.16C · PDPL Art.8, 22–23 | before selling outside India | The Standards row "who holds your data" moves to In force | |
| O6 | **Write a DPA template for shops** (shop = controller, ChitBridge = processor), with transfer clauses for AU and UAE shops | DPDP s.8(2) · APP 8 · PDPL Art.23 | before the first AU / UAE shop | — | |
| O7 | **Sign off the RoPA and DPIA drafts** (`docs/compliance/ROPA.md`, `DPIA.md`) — read, correct, date | PDPL Art.7, 21 · ISO/IEC 27701 | before the first UAE shop | The Standards row moves to In force | |
| O8 | **Tick the ◐ citations** in CO0 §2–4: open each official link once and confirm the rule says what the row says | — | before any privacy row says In force | Rows can move to In force | |
| O9 | **Region facts not in the repo**: confirm the Railway region (env `RAILWAY_REGION` — also on `/health`) and the Vercel region; tell the build so `lib/privacy.js` `FACTS` can state them | APP 8 · PDPL Art.22 | soon | The facts answer stops saying "not stated" | |

**Not built in CO1, waiting on a screen** (the API is there): a party's consent block in the CRM record, the privacy-request register
screen, and a live call to `/api/privacy/facts` from the Standards page. The round-trip budget marks these routes `awaiting_client`
since 13 Oct — the api test fails on 27 Oct if no screen calls them by then. Also not built: the per-person export file (today the CRM
record + timeline routes ARE the access summary) and erase-a-person (large; dry-run first, like b171).

## CO2 · security controls (2026-10-13)
| ✔ | Action | Why (rule) | Proof to keep |
|---|---|---|---|
| ☐ | **Run `chitbridge-api/migrations/b315_state_log_append_only.sql`** (Supabase SQL editor, as postgres), steps 1–3 | Chit history append-only (ISO 27001 A.8.15; Companies Act r.3(1) spirit) | Step 3 output: `update_grant_must_be_0 = 0`, `delete_guard_must_be_1 = 1` |
| ☐ | **Set `CB_ALERT_WEBHOOK`** on Railway (an on-call channel's incoming webhook), then raise one test critical | Wakes a person inside the CERT-In 6 h clock | Screenshot of the alert arriving |
| ☐ | **Register a CERT-In point of contact** (name, designation, phone, e-mail) | CERT-In Directions 2022, dir.(iii) ◐ | CERT-In acknowledgement |
| ☐ | **Logs kept 180 days (≥ 1 year advised) in India** — ship Railway logs to a sink in an Indian region, or move the API's region | CERT-In dir.(iv) 180 days in India ◐; DPDP Rules r.6(1)(e) 1 year (May 2027) ◐. Today the API runs in **Singapore** (`public/app.html`, API_BASE note) | Sink config + a sample line ≥ 180 days old |
| ☐ | **Clocks synced to NIC/NPL NTP** (or a provider statement that the host clock tracks them) | CERT-In dir.(i) ◐ | Provider statement / config |
| ☐ | **Lawyer-checked notice wording** for India (Board + person), Australia (OAIC + person), UAE (Data Office + person) | DPDP s.8(6) · Privacy Act s.26WK · PDPL Art.9 | Signed templates in a private folder |
| ☐ | **First tabletop drill** of `INCIDENT-RUNBOOK.md`; record it in `INCIDENT-REGISTER.md` | K5 evidence; SOC 2 CC7.4 / ISO 27001 5.24 | The register row |
| ☐ | **Watch the report-only CSP** for a week (browser console on the live site), then ask for it to be enforced | Threat model F1 | List of violations seen |
| ☐ | **Decide owner MFA** (second sign-in step) — a build round, needed before any ATO lodging (DSP framework) | ISO 27001 A.8.5; ATO DSP OSF ◐ | The decision + round name |

## SEC0 · the Supabase project ref (2026-10-14)
| ✔ | Action | Why (rule) | Proof to keep |
|---|---|---|---|
| ☐ | **Decide what to do about git HISTORY**: the project ref was in 7 public api files until SEC0 (now env only, a gitleaks rule + guards in api and web fail a new one) and it stays in every clone's history — history was NOT rewritten. Either accept it (the ref alone opens nothing: the keys are env, RLS is on, the dashboard needs the owner's login) or create a new Supabase project and move the data. A build round does neither | ISO 27001 A.8.12 / SOC 2 CC6.1 (attack surface a reviewer will ask about) | The decision, dated; if a new project: its region (ap-south-1) and the cut-over date |
| ☐ | **Confirm open legal questions** 1–7 of CO0 §7 with a lawyer (intermediary status, UAE Executive Regulation, AU coverage) | — | Written advice |
