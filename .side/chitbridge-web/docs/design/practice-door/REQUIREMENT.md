# REQUIREMENT — the PRACTICE DOOR: one door for a CA's 150 clients (round CA1 · reworked CA1b · 2026-10-13 · design, no code)

**Status:** requirement + design. Nothing here is built. Pass mark for the screens: `docs/design/list-standard/index.html` +
`docs/design/SYSTEM.md` §2–3b (FROZEN look). Literature: `docs/research/COMPARE-AU-BOOKS-2026-10.md` §2–3 is a BASELINE, never a
spec (owner, 2026-10-13: *"we should not replicate the same here, but we have to make it better than that, otherwise, it will be seen as
copied"*). Every figure on every screen names the code that computes it today, or says **MISSING**. Nothing is invented.

Shape already decided (owner, 2026-10-12): a PRACTICE (the CA firm) is an entity; each CLIENT GRANTS the practice access — consent,
revocable, by access level (role ≠ access: `api:lib/access.js` viewer · commenter · editor); a PRACTICE DASHBOARD across all
clients; open any client's books in one click with the practice's own staff; MOVE IN from Xero / QuickBooks (round IM1, later).

Reuse search done first (CLAUDE.md rule 1): `docs/SEAMS.md` + grep over `api:lib/` for `viewer|commenter|editor|access_level|
whole_entity|access_events|person-session|entity_kind|last_check|todo|periodAdvice|packs|basPeriods|msg_type|thread_type|
acknowledged_at|prev_sha256`. What exists is named in §5 and §6; what does not is marked MISSING with the evidence. §11 lists every
new path and why nothing existing served.

---

## 0 · Why this is not a Xero HQ (what CA1b removed, and what each job stands on instead)

The incumbents (R1 §2) all run the same machine: the practice is a **user inside the client's file**; a **client list** ranks files by
cached insight columns (cash · receivables · unreconciled count, refreshed hourly); an **"ask the client"** feature emails a question out
of the file and collects the answer in a portal; **sign-off** is an e-signature product bolted on; the practice's staff are **another
permission system** (my.myob, Team tab). CA1 kept those bones. CA1b throws them away and stands each job the CA needs on OUR construct:

- the client's Ledger is a **sealed record** the practice READS under a grant — nothing is copied out (`api:lib/person-session.js`:
  the session IS the client, RLS unchanged; `api:migrations/b273_books_journal.sql` insert-only);
- a supplier's bill **arrives as a chit both parties hold** (`api:README.md`), so most "what was this?" questions never start;
- a question **is a message on that chit's thread** (`CBThread`, `POST /api/chits/:id/messages`), and the external thread reaches the
  client's **SUPPLIER** (`engines:src/rail.js message_external`) — no incumbent has the other side in the room;
- the audit trail **is the hash-chained monthly pack the client acknowledges** (`api:lib/books-pack.js prev_sha256`,
  `POST /api/books/packs/:id/ack`);
- anomalies **come from the nightly recompute** — rules with names, never guesses (`api:lib/books-nightly.js check()` → `problems[]`);
- the practice's own staff **use the same IAM** (`api:lib/access.js`, `access-events.js`): one ladder, one event log.

### 0.1 Removed as "theirs" (layout · verb · flow), and what replaced it

| Removed (CA1 had it; R1 names it as theirs) | Why it was a copy | Ours instead |
|---|---|---|
| a client list whose columns are Xero's insight columns (Books · Bank unreconciled count · TB · Anomalies · Packs · Queries as peer columns) | Xero Client insights = cached per-file metrics in a sortable grid | three columns that are the CONSTRUCT: **Client · Sealed to · Nightly says** (§5) — the pack chain and the recompute, each dated |
| "Queries" screen, "Ask client", a query with a **due date** and an **answered** flag | QBO Ask client / Xero Ask: a request object with a due date, in a portal | no request object: a question is a message on the record; the thread's TURN says whether it waits on the client (§9). `msg_type = 'query'` already exists (baseline CHECK) — no new value, no `due`, no `answered_at` |
| INVITED → ACTIVE with a **14-day expiry** and DECLINED/EXPIRED states; "Invite" / "Remove access" | Xero's invite life; QBO's "Accounting firms → Invite firm → Remove" | the rail's own verbs: the practice **sends** a request, the client **accepts** or **rejects**, either side **ends** it (§3). A request does not expire — it is a To-do row until answered, like every other "needs you" row |
| Clients · Queries · Staff sidebar | QBOA's Clients · Work · Team tabs | **Clients · Replies · People · Practice** — Replies is the existing cross-chit screen (`cap-messages.js`), People is `employees.html`'s own word |
| "Your accountant" card (client side) | QBO "My accountant" | Setup › **Who may read your Ledger** — the card says the construct: who reads, at what level, every open listed |
| bank "unreconciled count · value · date" as a headline column | Xero's column verbatim | Bank stays in ⚙ with OUR fact: **statement lines with no chit** — the only lines a CA ever needs to ask about (§5, owner Q3) |
| Check now as a refresh of cached insight | Xero hourly refresh, faster | *Check now* = the nightly RECOMPUTE of that client, one trip, the row shows its time (§0.2) |

### 0.2 The jobs the CA needs, each rebuilt on our construct — and why it is better, one line each

| Job | Built on | Better than Xero HQ / QBOA / MYOB Practice because … |
|---|---|---|
| **J1 See 150 clients, worst first** | the pack chain + the nightly recompute, read as stored facts (§5, §8) | the row says **which month is sealed** (locked · pack built · hash chained · client acknowledged) and **what the recompute found**, dated — not a cached ratio from an hourly job; nothing on the row was guessed |
| **J2 Open one client's books** | a client-scoped person session minted from the grant (§7) | the practice reads the SAME ledger under the SAME RLS as the client's own co-assist; nothing is exported; the client sees every open, by name and device (§4) — no incumbent shows a client who looked |
| **J3 Verify ("Audit me")** | `bookpack verify()` over the chain + `last_check.problems[]` (§6) | an audit is a READ: the chain proves nothing was altered, the recompute names what differs and by how much, the rule version is on every posting — Xero's answer is a dashboard of manual codings, MYOB cannot print when a client approved |
| **J4 Ask about a line** | the chit's thread; external thread to the supplier (§9) | most questions never start (the supplier sent the bill with lines, tax and totals frozen); when one does, it lives ON the record, in both copies, and an editor can ask the **supplier** from the client's seat — no portal, no e-mail, no lost history |
| **J5 Lock a month / adjust** | the client's own period lock + reversal-not-edit, inside the session (§7) | the editor does what the client's owner would do, stamped with the person; a locked month is sealed by the PACK and the client's acknowledgement, not by an adviser-only lock date |
| **J6 Prepare the BAS figures** | `engines:src/reg-au.js bas()` over the posted ledgers, citing the three packs (§10) | the quarter's figures name the pack hashes they rest on and the acknowledgement rows under them — that IS the sign-off trail; MYOB's imported statement locks and goes stale, ours is read when copied |
| **J7 Take on / end a client** | one consented edge between two entities, moved by rail verbs (§3) | four states, no expiry timer, one button ends every session within 60 s; every client with a Ledger appears — no "business plan only" gate |
| **J8 Run the practice's own people** | the one IAM: `access_level` per person, `effectiveLevel = min(grant, person)` (§3) | a junior's reach is the lower of two existing numbers in the one place that answers "what may this identity do" — not a second permission system per file |

### 0.3 The complaints the incumbents carry (R1 §3 complaint column), removed by design

| Complaint (whose) | Removed how |
|---|---|
| **Hourly refresh; cached insight** (Xero) | a dashboard figure is a stored result of a recompute from the lines and carries its time on the row; what changes during the day — a chit arriving, a reply — is the rail, not a cache; *Check now* recomputes one client in one trip. We do not claim live figures: the nightly is nightly, and the row says so |
| **Lost history of questions** (Xero Ask has none; new Workpapers dropped Ask) | the question is a message on the chit, insert-only, held in both parties' copies; the Replies screen is a READ of the threads, not a mailbox; nothing to migrate, nothing to lose |
| **No sign-off trail** (MYOB: cannot print when the client approved) | the pack's `acknowledged_at` + who + `sha256` + `prev_sha256` is the trail; the BAS figures cite the three packs; the audit list shows "acknowledged by ‹who› on ‹date›" per month |
| **Read-only advisers who cannot act** (MYOB advisor silently downgraded) | every action's may/why is the server's answer, painted greyed WITH its sentence (`CBRail.WHY`); the level is the client's one switch on one card, applied to every session within 60 s; no plan tier changes it |
| **Future-dated requests vanish** (QBO) | there is no request object and no due date to mis-file; the thread's last message decides whose turn it is |
| **Removal one user at a time** (Xero) | the grant is the one thing: ending it delists every session minted from it |
| **Only business-plan clients appear** (Xero insights) | every ACCEPTED grant is a row; a client with the Ledger off is a row that says so ("Ledger off", three answers never collapsed) |
| **Access tied to an e-mail domain** (MYOB) | per PERSON, from the practice's own IAM; every open is listed to the client with the person's name |
| **Statement locks on import, goes stale** (MYOB Practice BAS) | the figures are read from the posted ledgers at the moment of *Copy BAS figures* and name the pack hashes; a month re-opened after that shows a newer pack in the chain |

---

## 1 · Who (users) and what they come for (jobs)

| User | Who they are in the IAM | Jobs, in the order they do them |
|---|---|---|
| **Practice owner** (the CA, a registered tax/BAS agent) | the PRACTICE entity's owner (`identity_type = 'entity'`, a new `entity_kind = 'practice'` — MISSING, §11) | J1 · J2 · J3 · J4 · J5 · J6 · J7 · J8 (§0.2) |
| **Practice staff** (bookkeeper, junior) | an actor of the practice entity (`identities.parent_entity_id = practice`, `access_level`, `whole_entity` as today, `api:migrations/b173_access_level.sql`) | J1–J5 within the grant AND their own level (§3) |
| **Client owner** (the shop) | the CLIENT entity's owner — the only one who may accept, reject, change the level or end | accept / reject the request · pick the level · see who opened the Ledger and when · reply on a thread · end |
| **Client staff** | the client's actors, unchanged | a thread addressed to the team (internal), as today on Replies |
| **The client's supplier** | a participant on the chit, unchanged | answers an external message on their own copy — never knows or cares that a practice asked |
| **The server** | — | decides every may / why; the practice page paints what it is handed (`CBRail.WHY`, `engines:src/rail.js`) |

A practice is NOT a network root and NOT a branch: `whole_entity` stays entity-scoped (b173 §"IAM-SPEC §28 parked"); the grant is
a new, separate, consented edge between two entities (§3), never a path re-root. A practice may also be a client of another practice
(a bookkeeper's firm reviewed by a CA) — the same edge, the other way; nothing special.

---

## 2 · The screens (practice side: `public/practice.html` — the CB Accounts skeleton, sidebar + full-width main)

The page is `accounts.html`'s skeleton (sidebar · pinned header · CBAvatar · CBKural) with four sidebar items. Every list is a
`CBList` mount (`public/app/list-ctl.js`); a row's next level opens the way Task's Group sum does (expand); a record opens the existing
sheet. No new rows, cards or expanders drawn by the page (CLAUDE.md rule 5). Icons: words for now (ICON-MAP: "CB Accounts and CRM
screens: a later round").

| # | Screen | What it is | Reuse |
|---|---|---|---|
| S1 | **Clients** (home) | one CBList row per ACCEPTED grant: **Client · Sealed to · Nightly says** shown, the rest in ⚙ (§5); notice chips in the title row count the clients in trouble; expand a row for "Audit me" (§6) | `CBList` · title-row chips (`cbl-chip warn/bad`) · expand (`next`) · ⬇ CSV · search · Filters ▾ (state · due · person) · sort |
| S2 | **A client's Ledger** | the client's own CB Accounts (`public/accounts.html`, `public/finance.html`) opened AS the practice person, with a strip at the top "You are in ‹client› as ‹practice› · ‹level›" and a way back | the pages as they are; the strip is the `top` bar's `.shop` slot; level sentences are `CBRail.WHY` |
| S3 | **Replies** | the existing cross-chit threads screen, across the practice's clients: every thread where the practice asked and waits, or was answered; a row opens the thread | `public/app/cap-messages.js` (its own header: "one list assembled from every chit") + `CBThread` — the ONE composer, never a second messaging path |
| S4 | **People** | who is in the practice and their level | `public/employees.html` as it is; the per-client assignment is the ONE new field (§11, later phase) |
| S5 | **Practice** (settings) | the practice's name, ABN, agent number, the handle, the plan | the Profile / Settings sections pattern (left set · right selected) |

### The client side (inside the client's CB Accounts, no new page)

| # | Screen | What it is | Reuse |
|---|---|---|---|
| C1 | **Setup › Who may read your Ledger** | one card: the practice (name · ABN), the level in one sentence, since when, who accepted, every open of the Ledger by a practice person (who · when · device), two buttons: *Change level* · *End access*. Nobody yet: "Ask your accountant to read your Ledger" with a handle box (the empty state `api:lib/sides.js:143` already names) | the Settings card (`accounts.html .card`), the access level words `api:lib/people.js accessWords`, the audit list `GET /api/actors/access-events` pattern |
| C2 | **A request** | a row on the To-do home: "‹practice› asks to read your Ledger › Accept · Reject" with the level asked and what it means | `GET /api/books/todo` rows (`api:lib/books-todo.js`) — one new kind `practice_request` (§11) |
| C3 | **A question on a chit** | the Replies screen as today: a thread on a chit where the practice spoke last | `public/app/cap-messages.js` + `CBThread` — nothing new |

Phone (390 px): S1 rows become one card per row (CBList's container query); the strip in S2 is one line; C1 is the card as is.

---

## 3 · The grant — consent lifecycle, moved by the rail's verbs

The grant is the ONLY thing that lets a practice person into a client's Ledger. It is an edge between two entities, carries ONE access
level, and is moved only by the acts below — the same verbs a chit moves by (`engines:src/rail.js ACTIONS`: accept · reject), never a
new vocabulary. Every move writes one event row (the `api:lib/access-events.js` shape: before · after · who · why). One pair holds at
most one live grant.

```
   practice sends (by the client's handle)  ─┐        client sends (by the practice's handle)
                                             ▼                       │
   (none) ─────────────────────────────►  SENT  ◄────────────────────┘
                                           │ │
            client owner accepts           │ └──── client rejects ──────────────► REJECTED  (same as none; the sender sees the word)
            (picks the level)              │       sender ends it (withdraws) ──► ENDED
                                           ▼
                                        ACCEPTED ◄── client changes the level (stays ACCEPTED; the event row says from → to)
                                           │
            client ends ───────────────────┴─────── practice ends
                                           ▼
                                         ENDED  (ended_by says which side)
```

| State | Who moves it | What the server does | What the client sees | What the practice sees |
|---|---|---|---|---|
| **SENT** | either side, by the other's handle (the `resolve` idea of `api:docs/NAMESPACE.md`: a handle is looked up once; the id is stored) | writes the grant row `status = sent`, `level_asked`, `sent_by` (the PERSON — DESIGN-NOTES 2026-10 §1.1 Q5 names that loss); a notice through the channels that exist (`api:lib/notify.js sendEmail`; WhatsApp when `whatsapp-out.canSend()`) | To-do row C2 with the level in words — it stays until answered, like every other To-do row; **no expiry timer** | the client row in S1 greyed "Request sent ‹date›", no figures |
| **ACCEPTED** | the client OWNER accepts (an actor cannot: consent is the owner's act) and picks the level | `status = accepted`, `level`, `accepted_by`, `accepted_at`; from now `ops.f_practice_clients(practice)` lists the client (§8) | C1 card filled; every open of the Ledger by a practice person is listed there | the row fills with figures at the next nightly check, or at once through *Check now* (`POST /api/books/check`) |
| **REJECTED** | the client owner, one button, no reason needed | `status = rejected`, the date | nothing further | greyed row with the word; may send again |
| **ENDED** | the client owner (any time) OR the practice (owner or editor); from SENT by the sender = withdrawn | `status = ended`, `ended_by`, `ended_at`; every session minted from the grant is delisted — refused everywhere within 60 s (`api:lib/person-session.js` CACHE_MS) | "‹practice› no longer reads your Ledger · ended ‹date› by ‹side›"; *Ask again* | the row says "Ended ‹date›", figures frozen at the last check, greyed; Filters ▾ Ended shows it |

Rules that hold in every state:
- **Consent is the client's act, revocable, by level.** The practice never self-serves a level; it may only ASK for one (`level_asked`),
  the client sets it.
- **Ending is immediate and total.** No "pending removal". What the practice already posted stays — the ledger is insert-only
  (`api:migrations/b273_books_journal.sql`), every entry carries who (`app.current_actor`), so nothing is lost by ending.
- **A level, not a role.** Viewer reads · commenter reads and asks the client's team (the INTERNAL thread) · editor also changes
  records and may ask the client's SUPPLIER (the EXTERNAL thread). The exact ladder of `engines:src/rail.js byLevel` — no new word. On
  screen the sentence is the model's own (`api:lib/access.js PRESETS[].why` style): "Reads everything. Says nothing." · "Reads everything
  and can ask your team." · "Can post entries, lock months, and ask your team or your suppliers."
- **Costs:** the practice sees cost and margin only when the grant says so (`can_see_costs` on the grant, the `api:lib/cost.js` gate),
  default **yes** for a practice (a CA must see margin) — the client may switch it off on C1 (owner question 2 of CA1, kept).
- **The effective level of a practice PERSON in a client = min(grant.level, person.access_level)**: a viewer-level junior stays a viewer
  in an editor-granted client. One rule, in `access.js` (widened, with a test) — never in a route.

---

## 4 · What a client sees and can end (the client's rights, in one place)

| The client sees | Where it comes from | Can end / change |
|---|---|---|
| who the practice is (name · ABN · agent number) | the practice entity's header (`GET /api/entities/header`, `api:lib/entity-header.js`); ABN checked by `engines:src/reg-au.js abnCheck()` | — |
| the level, as one sentence, and whether costs are shown | the grant row | **yes**: change level, costs on/off (an event row each time) |
| since when, who accepted | `accepted_at`, `accepted_by` (a person's display name) | — |
| every open of their Ledger by a practice person: who · when · from which device | the grant's open log (§11: `practice_open` rows, the `signin_events` idea of M06) | — (a record, not a switch) |
| every entry the practice posted | the Day book as today: `by` is the person (`app.current_actor`), the audit trail (`books_change_log`) | — (insert-only; a wrong entry is reversed, never deleted) |
| every question the practice asked | the chit's thread (`CBThread`), on Replies | — |
| the grant's history | the grant event rows | — |
| **End access** | one button on C1 | **yes**, immediate |

What the client does NOT see: the practice's other clients, the practice's people list, the practice's notes about them (a practice
"internal" note is the PRACTICE entity's own thread, never written into the client's Ledger — §9).

---

## 5 · The dashboard (S1) — every column, every number's source, every alert's rule

Shown columns (SYSTEM §3 rule 7: three; the rest in ⚙): **Client · Sealed to · Nightly says**. Every figure is READ from the client's
stored check; the practice page computes nothing. Money in minor units (AUD cents), painted by the M36 money unit; balances in Dr/Cr
words. Three answers everywhere: has it · **can't tell** · not there.

**Sealed** (one word, derived, never typed): a month is sealed when it is **locked** (`api:lib/books.js setPeriod`), its **pack is built**
with its hash chained to the previous (`api:lib/books-pack.js build` → `sha256`, `prev_sha256`), and the client **acknowledged** it
(`POST /api/books/packs/:id/ack` → `acknowledged_at`). Three facts that exist; the word is the AND of them.

| Column | What it shows | Where the number comes from TODAY (file:function) | Gap |
|---|---|---|---|
| **Client** | name; under it the level word · since | `identities.display_name`; the grant row | ABN (⚙) = AU1's identity slot |
| **Sealed to** | **Sep ✓** (sealed) · **Aug ✓ · Sep open** · **Sep built · not acknowledged** · **chain broken at Jun** · **none yet** · **Ledger off**; red when the BAS quarter's months are not sealed and the statutory due is ≤ 14 days away or past: **Q1 open · due 28 Oct** | months: `api:lib/books.js periodAdvice()` via `GET /api/books/periods`; packs: `GET /api/books/packs` (`sha256`, `prev_sha256`, `acknowledged_at`); chain: `engines:src/bookpack.js verify()` over the stored manifests; BAS due: `engines:src/reg-au.js basPeriods({ frequency, fy })[].due` (statutory — a weekend/holiday or the agent lodgment-program date needs a calendar the pure file does not have; say "statutory" on hover) | the four reads exist per shop; the ONE stored word per shop is MISSING (§8 widens the nightly's summary) |
| **Nightly says** | **✓ clean · 02:10 today** · **2 named · TB 1500 by A$40.00 Dr** (count + the first rule's name) · **not run yet** · **Ledger off** | `api:lib/books-nightly.js check()` → `books_setting.last_check.at`, `.problems[]` (each has `what`: 'entry does not balance' · 'monthly balance differs from its lines' · '‹role› control ≠ the open items' · the controls' `mismatches[]` · 'walk-in day' · sweep limits) + `health.waiting[]` (posts parked with a reason, `api:lib/books-hooks.js waitingRow`) | stored per shop; the cross-client read is MISSING (§8) |
| On the rail (⚙) | **n bills waiting to accept** — chits suppliers SENT that the client has not accepted; the oldest's date | `api:lib/books-todo.js todo()` kind `bills_to_accept` | — |
| Waiting on client (⚙) | **n threads · oldest ‹date›** where the practice spoke last | the chit messages (`thread_type`, author); the practice's own messages are stamped with the practice person (`app.current_actor`) | the COUNT as one stored number is MISSING (§8); no new message key |
| Bank (⚙) | **statement to ‹date› · n lines with no chit** · **Can't tell** | MISSING on the server: reconciliation runs IN THE BROWSER and the statement is never uploaded (`web:public/app/cap-bank.js` header; the match is `engines:src/bank-recon.js match()` → `unmatched_stmt[]`). Nothing stores the result | §11 new key: the client's device posts the SUMMARY only (counts + statement end date), never the lines — owner Q3 |
| Months not locked (⚙) | **n** · the oldest | `periodAdvice()` rows open with end < today (`books-todo.js months_not_locked`) | — |
| Manual entries (⚙) | **n this quarter** (series MJ — SA 240 "manual journals tested first") | `api:lib/books-manual.js` | a stored count (§8) |
| Access (⚙) | the level word · since · costs on/off | the grant row | new table (§11) |
| Last entry (⚙) | the last entry's date | MISSING as a stored figure: the Day book has it (`books_entry` max date); the nightly can store it (§8) | §8 |
| Person (⚙) | who at the practice is on this client | §11, later phase | — |

### The alerts (title-row chips, and the amber/red on a row) — each with its rule

Only a failing thing earns a chip (SYSTEM §3 rule 1); all fine = one line "✓ 150 clients, every month sealed". Every chip is a filter.

| Chip | Rule (read, not computed on the page) | Colour | The button it carries |
|---|---|---|---|
| **n BAS overdue** | `basPeriods().due < today` and the period's GST close not posted (`api:lib/books-period.js settledAsOf` / the `gst_due` to-do kind) | red | *Open* (the client's GST close & pay screen, `web:public/app/cap-period.js peGstClose()`) |
| **n quarters unsealed · due in 14 days** | `due − today ≤ 14` and a month of the quarter not sealed | amber | *Ask n clients* (one message each on their month's pack thread, §9 · §10) |
| **n chains broken** | `bookpack verify()` fails on a stored manifest | red | *Open* the client's Ledger packs |
| **n nightly findings** | `last_check.problems.length > 0` | red | expand (§6) |
| **n waiting on client over 7 days** | the oldest waiting thread's date (7 days is the chip's filter threshold, not a field on anything) | amber | *Open Replies* (S3) |
| **n bills waiting on the rail** | `bills_to_accept.count > 0` older than 7 days | amber | *Ask client to accept* |
| **n waiting to post** | `health.waiting.length > 0` | amber | *Retry* (`POST /api/books/outbox/retry`, owner-only today → the grant's editor may call it, §11) |
| **n requests sent** | grants in SENT | grey | *Send again* (a reminder notice through the same channels) |
| **n Ledgers off** | `books_setting.enabled = false` | grey | *Ask client to switch the Ledger on* |

Row colour = the worst chip that applies to it. A row with nothing applying is plain. Every row carries the nightly's time
("checked 02:10 today") so a figure is never older than it says. "Months not locked" is not a chip: an unlocked month is an open
month, and the **Sealed to** pill on the row already says so (its expand line carries *Ask to lock* / *Lock*). The title row holds at
most five notices so it stays one line at 1366 px (the head ≤ 20 % of the window); CBList folds them into one "n notices ▾" chip on a phone.

---

## 6 · "Audit me" — the per-client list the row expands to (S1 next level)

Three groups, each a READ of what we keep — no new calculation anywhere:

| Group | Line | Source | Fix button |
|---|---|---|---|
| **The seal chain** | one line per month of the open quarter: "Jul ✓ sealed · acknowledged by Dee Marrick 4 Aug · a3f9…" / "Sep locked · pack not built" / "Aug pack not acknowledged" / "chain broken at Jun — the stored pack does not match its manifest" | `GET /api/books/packs` (`sha256` · `prev_sha256` · `acknowledged_at` · by) + `periods` + `engines:src/bookpack.js verify()` | *Build pack* (`POST /api/books/packs`, owner-only today → editor grant, §11) · *Ask to acknowledge* · *Open* |
| **The nightly found** | one line per `problems[]` entry, in the rule's own words with the amount in Dr/Cr: "Monthly balance for 1500 Bank differs from its lines by A$40.00 Dr" · "2 entries could not post: supplier not on the rail" · "Suspense A$312.50 Cr — must be nil at close" · "3 manual entries this quarter (MJ)" | `last_check.problems[]` (`books-nightly.js check()` — named, never auto-fixed) · `health.waiting[]` · TB line for role `suspense` (`LINES_AU`) · `books-manual.js` series MJ | *Open the ledger* · *Retry* · *Open* · *List them* |
| **On the rail** | "1 supplier bill waiting to accept · Allied Flour Mills A$1,240.00 · sent 29 Sep" · "Bank: statement to 30 Sep · 2 lines with no chit" (or "Bank: can't tell — the client reconciles on their device") · "Waiting on client: 2 threads · oldest 6 Oct" | `todo()` kind `bills_to_accept` · the stored bank summary (§11) · the threads count (§8) | *Open the chit* · *Ask for the statement* · *Open Replies* |
| **GST** | "Q1 figures read from the posted ledgers: G1 A$… · 1A A$… · 1B A$… · net A$… · statutory due 28 Oct · rests on packs Jul a3f9… · Aug 71c0… · Sep (open)" | `engines:src/reg-au.js bas({ period, simpler }, rows)` — read from the POSTED ledgers, nothing recomputed from invoices | *Open GST close & pay* · *Copy BAS figures* |

The last line of every expand: "Open the Ledger as ‹practice› · ‹level›" → S2. A viewer-level grant greys *Build pack* · *Lock* ·
*Retry* · *Open GST close* WITH the sentence (`CBRail.WHY.read_only`) and offers *Ask the client* instead — the complaint "read-only
adviser who cannot act" becomes a greyed button that says why and a button that asks.

---

## 7 · Opening a client's Ledger in one click (S2) — how the server lets a practice person in

Today one token = one shop (`api:middleware/auth.js entityOf = parent_entity_id || identity_id`); a co-assist's RLS runs AS the shop with
the person stamped as `app.current_actor` (`runWithActor`). The practice door reuses exactly that: a practice person opening a client
gets a **client-scoped person session** — entity = the client, actor = the practice person, level = min(grant, person) — minted from the
grant, bound to the device and listed under it (`api:lib/person-session.js`: jti · device_id · surface · life), so it is revocable and
dies within 60 s of an end. One new route does it (`POST /api/practice/clients/:client_id/open`, §11); after that every existing books
route answers as it does for any co-assist, RLS unchanged (no cross-entity branch — the thing DESIGN-NOTES §1.2 item 2 feared is
avoided by NOT widening RLS: the session simply IS the client, as a co-assist's is). Nothing is copied out of the client's Ledger
into a practice store: the dashboard holds counts and words (§8), the Ledger stays where it is.

Each open writes one `practice_open` row (who · client · when · device) — the "who opened your Ledger" list on C1.

---

## 8 · The cross-client read (what makes 150 rows one query)

RLS is per entity; the dashboard must not run 150 × 5 reads (BRIEF-RULES 4: no per-row queries). What exists: the nightly
(`api:lib/books-nightly.js runAll()`) already visits every ledger-on shop through ONE cross-shop id read (`ops.f_books_enabled()`,
SECURITY DEFINER, b272) and stores `books_setting.last_check` per shop. So:

1. **Widen the nightly's stored result** (additively, with a test): `last_check.summary = { sealed_to, chain_ok, packs: { last,
   acknowledged, not_acknowledged: n }, months_not_locked: { n, oldest }, findings: n, waiting_to_post: n, bills_to_accept: { n, oldest },
   threads_waiting_on_client: { n, oldest }, manual_entries_quarter: n, last_entry_date, bank: { to, no_chit } | null }` — every value a
   read the nightly already makes, or a count of it. Dictionary entry in `api:docs/FIELDS.md` in the same change.
2. **One SECURITY DEFINER read for the practice**: `ops.f_practice_clients(practice_entity_id)` → one row per ACCEPTED grant with
   `display_name`, the grant's level, and that shop's `last_check.summary` + `periods` status. The route `GET /api/practice/clients`
   is one trip. The `basPeriods` due is pure (no read).
3. *Check now* on one row = `POST /api/books/check` through the client session (exists; owner-only today → editor grant) — a
   RECOMPUTE, not a cache refresh; the row's time changes because the check ran.

Nothing recomputed on the practice side. A number on the dashboard is the SAME number the client sees on their own To-do home
(SYSTEM §3 rule 11).

---

## 9 · Asking — a message on the record, never a request object

A question from the practice is **a message on the client's chit**, posted by the practice person through the one composer
(`CBThread.mount` / `CBThread.send`, `POST /api/chits/:chit_id/messages { thread_type, message_text, msg_type: 'query' }`).
`msg_type = 'query'` already exists (`api:migrations/000_baseline_part2.sql` CHECK) — no new value. Two audiences, both existing:

- **internal** (`thread_type = 'internal'`): the client's team — a commenter or editor may post (`engines:src/rail.js byLevel`,
  `api:lib/access.js canMessage`); the team answers from the Replies screen in its own login. A viewer sees the thread and the sentence
  `CBRail.WHY.read_only`, exactly as an auditor does today.
- **external** (`thread_type = 'external'`): the client's **supplier**, on the supplier's own copy of the same chit — an editor-level
  practice person may post (`message_external`), the supplier answers as they answer any customer message. "Was the 29 Sep delivery
  short?" goes to the party who knows, from the client's seat, with the client's team able to read it. No incumbent has the other side.

**No due date, no answered flag.** The thread's last message decides: the practice spoke last → *waiting on client* since that date;
anyone else spoke last → *answered*. Replies (S3) already lists threads by latest message and who said it (`cap-messages.js` header:
"THREADED BY LINE"). The 7-day chip is a filter threshold, not a field. Nothing to mis-file, nothing to expire.

**Where a practice note to itself goes:** the PRACTICE entity's own thread (its own chits/records), never into the client's Ledger.

**The open decision (owner Q1, rephrased):** a chit anchors a thread, but "September" — a bank line with no chit, a manual MJ entry,
"please lock the month" — is not a chit. In our construct the record the client holds for a MONTH is its **pack** (built, hashed,
acknowledged). So the anchor for a month's questions is the month's pack: widen the messages route to accept `pack_id` as a subject
beside `chit_id` (one shape, one more subject; the thread list and RLS as today; a question and the acknowledgement that closes the
month sit on the same record). The alternative is CA1's: mint one "review" chit per client per period. Recommendation: the pack.
If the owner picks the pack, `rail.js actions()` gains a subject kind — an engines CHANGELOG + tag in that round (CA2-BUILD).

---

## 10 · Bulk work (phase 1 = one thing)

| Bulk action | What it does | Reuse | Phase |
|---|---|---|---|
| **Ask n clients** (select rows → one text → one message each) | the same text posted on each selected client's current month pack thread (§9), each its own thread; the turn says who owes a reply | CBList `bulk` + `CBThread.send` in a loop, one `CBAction.run` per client (busy · one press one write · the outcome said per row) | 1 |
| **Build packs** for selected clients for a period | `POST /api/books/packs` per client through the client session | the pack route; editor grant | 2 |
| **Check now** for selected | `POST /api/books/check` per client — a recompute each | exists | 2 |
| **BAS figures for the quarter, all clients** | one CSV: client · G1 · 1A · 1B · net · statutory due · the three pack hashes and their acknowledgement dates (the sign-off trail travels with the figures) | `reg-au.js bas()` over each client's posted ledgers; CBList ⬇ | 2 |
| **Lodge** | **never in this scope** — no SBR, no DSP registration (R1 §5.2 row 3). The honest button is *Copy BAS figures* for the agent portal | — | not planned |

Every bulk run reports per row (done · refused with the server's sentence · failed), never one toast for 150.

---

## 11 · New paths (each with why nothing existing served) and the dictionary entries they need

| New | Kind | Why nothing existing served |
|---|---|---|
| `entity_kind = 'practice'` | a value on `identities.entity_kind` (b157) | the kinds today are supplier · network · actor · shopper · internal · test (`api:lib/entitykind.js`); a practice is none of them and must never be a `network` branch (re-rooting the path would make `sameNetwork` true — DESIGN-NOTES §1.1 Q2) |
| `practice_grant` (table) + `practice_grant_event` (log) | migration `bNNN_practice_grant.sql` (api; b299 is taken by M210 — CA2 takes the next free number) | "No cross-business permission model": a connection is a status with no scope (`api:db/schema.sql:56-75`, `net01_network.sql`); one actor row = one shop (b173). Nothing holds a level between two entities. States: sent · accepted · rejected · ended (§3). The event log copies the `access_events` shape rather than adding a column to it, because its subject is an entity pair, not an identity |
| `practice_open` (table) | same migration | nothing records an open of the Ledger by name (DESIGN-NOTES §1.1 Q5: `access_events` records access CHANGES only; `signin_events` is M06) |
| `GET /api/practice/clients` · `POST /api/practice/request` · `POST /api/practice/clients/:id/open` · `POST /api/practice/clients/:id/end` · client side `POST /api/books/practice/request` · `/accept` · `/reject` · `/end` · `PATCH /api/books/practice/level` | routes | no route today is called by an entity about ANOTHER entity's Ledger; each says who may call it (the server decides): practice owner/editor for request · end · open; the CLIENT OWNER only for accept · reject · end · level |
| `last_check.summary` | a new key under an existing stored object | the dashboard needs one stored number per fact per shop; `last_check` is where the nightly already stores per-shop results. Entry in `api:docs/FIELDS.md`: number — derived (counts of reads the nightly makes); written by `books-nightly.js check()`; read by `ops.f_practice_clients` / `GET /api/practice/clients` and the client's own health |
| `ops.f_practice_clients(uuid)` | SECURITY DEFINER function | the one cross-shop read, the `ops.f_books_enabled()` pattern (b272) |
| `books_setting.bank_summary` `{ to, no_chit, at }` | a new key, written by the client's device after a reconcile (`cap-bank.js` posts counts only — the statement never leaves the device, as its header promises) | nothing stores a reconciliation; the practice cannot see it any other way without uploading the statement, which the design refuses (owner Q3) |
| messages: `pack_id` as a subject beside `chit_id` | a column on the message row, if the owner picks the pack as the month's anchor (§9) | a month has no chit; the pack is the record the client holds and acknowledges |
| To-do kind `practice_request` | one more kind in `books-todo.js KINDS` | the client's request must appear where every other "needs you" row appears, with its buttons |
| `access.js effectiveLevel(grant, person)` | one function, widened in place | min(grant, person) must live in the ONE place that answers "what may this identity do" (the file's own header: eighteen places became one) |
| `practice_client_person` (who at the practice is on which client) | table, **later phase** | `whole_entity` is entity-scoped by design (b173); a per-client reach is a new fact |

NOT new (CA1b removed from the new list): `msg_type = 'query'` (exists), a message `due`, an `answered_at`, an invite expiry, the
DECLINED/EXPIRED states, a "Queries" list (Replies is it), the levels, the sentences, the sessions, the nightly, the To-do feed, the
packs, the periods, the BAS labels, the list, the thread.

---

## 12 · Phase 1 vs later

| Phase 1 (CA2 → CA4) | Later |
|---|---|
| practice entity kind · grant table + routes + migration FILE · client-side accept / end card (C1, C2) | person-per-client assignment (S4 column) |
| S1 with Client · Sealed to · Nightly says · the ⚙ columns from the nightly summary · "Audit me" expand | Bank column (needs the device-posted summary, owner Q3) |
| open a client (client-scoped person session) · the strip · the open log | bulk Build packs · Check now · BAS CSV with pack hashes |
| questions on chits (internal + external) + Replies across clients (S3) + the month's pack as anchor (owner Q1) | — |
| Ask n clients (bulk message) | BAS prep view per client (figures + the agent-portal copy) · import from Xero / QBO (IM1) · pricing (`api:lib/plans.js` has no practice tier; R1 §5.3 Q5) |
| AU dates from `reg-au.js basPeriods` (statutory) | holiday / agent-program calendar for due dates |

Out of scope, said plainly on the screen when a CA looks for it: bank feeds, STP payroll, ATO lodgement (R1 §5.2 rows 1–3).

---

## 13 · Copy (shopkeeper words; what happened · what it means · what to do)

- Client, the request: "Harbourline Accounting asks to read your Ledger. They would read everything and could ask your team. › Accept · Reject"
- Client, after: "Harbourline Accounting reads your Ledger and can ask your team · since 3 Oct · accepted by you" · *Change level* · *End access*
- Client, under the buttons: "Ending stops them within a minute. Whatever they already posted stays in your Ledger, with their name on it."
- Practice, a row: "Bondi Surf Supplies · Aug ✓ · Sep open · Q1 due 28 Oct · ✓ clean 02:10 today" ; expanded: "Sep locked · pack not built › Build pack" · "Bank: statement to 30 Sep · 2 lines with no chit › Ask for the statement"
- A refused action, greyed, with the sentence: "Your access is view-only. You can read this chit but not change it." (`CBRail.WHY.read_only`) and beside it *Ask the client*
- A thread row on Replies: "Marrickville Bakehouse · Allied Flour Mills A$1,240.00 · you asked 6 Oct · waiting on client 6 days"
- Never: "accounting", "books of account", "query queue", "request", a raw error, a number without its date.
