<!-- Owner: cb-api -->
<!-- Status: CONTRACT for the web lane (l16-marks-web). Builds on lane l16-marks-api, branch feat/marks. Shapes below are what the routes answer; a change to them is announced before it is made. -->
<!-- Reviewed: 2026-11-15 -->
# Marks and queries: the API contract (adopter `acc.audit`)

Design: docs master `capability/MARK-AND-QUERY-CAPABILITY.md` (section 2, 3, 5) and `ACC-358-AUDIT-MARKERS-REQUIREMENT.md`.
Errors are RFC 9457 problems with a `code`; the table at the end is the full list, each with its shopkeeper sentence.
Money is never in a mark. Dates are ISO 8601 UTC (`2026-11-15T09:30:00.000Z`). Keys are snake_case.

## 0 · Who calls, and how

| Caller | Sends | Sees |
|---|---|---|
| The owner of the books | his own sign-in, no extra header | the marks, the thread, may reply (never sets a class) |
| The auditor (a network parent holding the `auditor` grant) | sign-in + `X-Books-For: <member entity id>` (the books' own header) | reads, sets marks, replies |
| The adviser (`adviser` grant, #1349) | sign-in + `X-Books-For: <member>` + `X-Books-Role: adviser` | reads, replies; never sets |

The header is honoured on `/api/marks` exactly as on `/api/books`; anywhere else it is refused (`BOOKS_FOR_NOT_HERE`).
`actions` in every answer is the server's verdict: the web greys a button and shows `why`; it never decides.

## 1 · The vocabulary of `acc.audit`

`adopter` is always the string `"acc.audit"` for now (other adopters are added by the server, not the web).

| `kind` (send this) | Shown as | `class` (neutral) | note |
|---|---|---|---|
| `checked` | Checked | `clear` | no note |
| `query` | Query | `open` | note required: the question (the owner sees it) |
| `on_hold` | On hold | `hold` | note optional: the reason (the owner sees it) |
| `removed` | (mark taken off) | `removed` | note optional; history keeps it |

The answers carry `vocabulary: [{ kind, label, class, note: 'none'|'optional'|'required' }]` so the buttons come from the server.

## 2 · The Mark object

Used everywhere. `null` = no mark (or the reviewer removed it).

```json
{
  "mark_id": "1204",
  "adopter": "acc.audit",
  "subject_id": "<journal entry id>",
  "thread_id": "<uuid>",
  "kind": "query",
  "class": "open",
  "label": "Query",
  "note": "Why was this posted to 4100?",
  "at": "2026-11-15T09:30:00.000Z",
  "by_name": "A. Auditor",
  "by_firm": "Harbour Audit Pty",
  "open": true,
  "open_since": "2026-11-12T08:00:00.000Z",
  "age_days": 3,
  "altered": false,
  "altered_by": null,
  "recheck_needed": false,
  "message_count": 2,
  "actions": {
    "set":   { "ok": true,  "why": null },
    "reply": { "ok": false, "why": "Only the owner and the adviser answer a Query." }
  }
}
```

- `mark_id` is a string (bigint). `class` is one of `clear | open | hold | reject | removed`.
- `open` is true while the class is `open` or `hold`; `open_since` is the first row of the current open run (a removed row does not reset it); `age_days` is whole days to now.
- `altered` is true when the record changed after the mark (for `acc.audit`: the entry was reversed). `altered_by`
  is `{ entry_id, entry_no, at, by_name }` of the reversing entry, else null. The chip reads "changed after review".
- `recheck_needed` true = the rule that detects change was edited since this mark: the chip reads "re-check needed", not "altered".
- A record that no longer reads is never returned as a mark; the id is simply absent from `marks` (see 3.1, `not_found`).
- `message_count` counts replies in the thread (the question itself is `note`, not a message).
- `by_firm` is the name of the reviewer's own business (null when the owner set it).

## 3 · Routes

All paths under `/api`. All JSON. Every write carries `Idempotency-Key` (a uuid per press; a replay answers the first answer).

### 3.1 `GET /api/marks?adopter=acc.audit&ids=<id>,<id>,...`

The latest mark per subject for a list of records. `ids` is capped at 200 (`MARK_IDS_TOO_MANY`, 422). Above that use 3.2.

```json
{ "adopter": "acc.audit",
  "marks": { "<subject_id>": { Mark } , "<subject_id>": null },
  "not_found": ["<subject_id>"],
  "vocabulary": [ { "kind": "checked", "label": "Checked", "class": "clear", "note": "none" } ],
  "actions": { "set": { "ok": true, "why": null }, "reply": { "ok": true, "why": null } } }
```

For the day book and the ledger do NOT call this: the marks arrive embedded (section 4).

### 3.2 `POST /api/marks/query` (a READ, for more than 200 ids)

Body `{ "adopter": "acc.audit", "ids": ["..."] }` (1 to 500). Answers exactly as 3.1. Status 200.

### 3.3 `GET /api/marks?adopter=acc.audit&open=1[&from=YYYY-MM-DD&to=YYYY-MM-DD]` the open queries

```json
{ "adopter": "acc.audit",
  "from": "2026-11-01", "to": "2026-11-15",
  "open": [ { Mark, "subject_label": "MJ/2026/0041", "posting_date": "2026-11-12" } ],
  "total_open": 4,
  "checked": 31, "of": 120,
  "oldest_age_days": 6,
  "vocabulary": [ ... ], "actions": { ... } }
```

- `open` is oldest first (class `open` or `hold`). "Checked n of m entries this period" is `checked` of `of` (`of` = entries posted in `from..to`, `checked` = those whose latest mark is Checked and not altered). Defaults: the current month.
- `from`/`to` bound the period of the count only; the open list is every open item.
- The owner's bell badge count = `total_open` (read from this; no store of its own).

### 3.4 `POST /api/marks` (the ONE set door)

Body:
```json
{ "adopter": "acc.audit", "subject_id": "<entry id>", "kind": "query", "note": "Why 4100?" }
```
`subject_ids: [..]` may replace `subject_id` only where the adopter allows bulk (`acc.audit`: no, so more than one id answers `MARK_BULK_NOT_ALLOWED`, 422).
Unknown keys are refused (`422`, `errors[]` lists every field). Answer `201`:
```json
{ "mark": { Mark }, "vocabulary": [ ... ] }
```
Refusals (see table): `MARK_NOT_ALLOWED` 403 (not the auditor: the owner and the adviser get this, and no row is written), `MARK_SUBJECT_NOT_FOUND` 404, `MARK_WORDS_REQUIRED` 422 (a Query with no note), `MARK_KIND_UNKNOWN` 422, grant refusals (`BOOKS_GRANT_*`, 403/503: grant revoked, expired, edge ended).
Setting a mark the same as the latest (same kind and note) is accepted and returns the existing mark (200).

### 3.5 `GET /api/marks/:thread_id/messages`

```json
{ "thread_id": "<uuid>", "adopter": "acc.audit", "subject_id": "<entry id>", "subject_label": "MJ/2026/0041",
  "mark": { Mark },
  "history": [ { "mark_id": "1198", "kind": "query", "class": "open", "label": "Query", "note": "...", "at": "...", "by_name": "...", "by_firm": "...", "seal_changed_before": false } ],
  "messages": [ { "message_id": "<uuid>", "sender_display_name": "Owner Name", "message_text": "...", "msg_type": "info", "created_at": "...", "mine": true } ],
  "actions": { "set": { "ok": true, "why": null }, "reply": { "ok": true, "why": null } } }
```
`history` is oldest first, every mark row of the subject (removed ones included). `seal_changed_before: true` = the record changed between this mark and the one before ("changed between").
`messages` oldest first. The question is `mark.note` and is shown at the head; it is never repeated in `messages`.
`mark.actions.reply.ok` is false (with `why`) when the thread is closed (latest class is not Query/On hold): then the thread is read only.
404 `MARK_THREAD_NOT_FOUND` for an unknown thread or one of another business (never 403).

### 3.6 `POST /api/marks/:thread_id/messages` (the ONE reply door)

Body `{ "message_text": "Posted to 4100 because ...", "msg_type": "info" }` (`msg_type` optional: `info` or `query`). Answer `201`:
```json
{ "message": { "message_id": "<uuid>", "sender_display_name": "...", "message_text": "...", "msg_type": "info", "created_at": "...", "mine": true }, "mark": { Mark } }
```
A reply never changes the class. Refusals: `MARK_REPLY_NOT_ALLOWED` 403, `MARK_THREAD_CLOSED` 409, `MARK_THREAD_NOT_FOUND` 404, `MESSAGE_TOO_LONG` 422 (existing).
Nothing leaves the installation: no WhatsApp, no mail, no other business hears it.

## 4 · Embedded in the books lists (adopter 1; no extra trip)

`GET /api/books/daybook` and `GET /api/books/ledger/:account` add one key per row, next to `entry_id`:

```json
{ "entries": [ { "entry_id": "...", "entry_no": "MJ/2026/0041", ..., "mark": { Mark } | null } ],
  "mark_actions": { "set": { "ok": true, "why": null }, "reply": { "ok": true, "why": null } },
  "mark_vocabulary": [ ... ] }
```
Ledger: `lines[i].mark` and the same two root keys. `mark` is null when the entry has no mark or the mark was removed. Both root keys are absent (not null) when marking is not switched on (b868 not run): the chip is then simply not drawn.
`altered`/`altered_by` for a Checked mark whose entry was reversed: `altered: true`, `altered_by` = the reversing entry. A Query on an entry that is then reversed stays in the open list (section 3.3) until the auditor decides.
The reversal entry and the re-post carry no mark (new records).

## 5 · What the web may rely on

- Every list answer carries `actions`; never compute "may I" in the page.
- Open count for the badge: `GET /api/marks?adopter=acc.audit&open=1` → `total_open`.
- The sheet = 3.5 once on open, then 3.4/3.6 and re-read 3.5 (or use the returned `mark`).
- Not switched on: every `/api/marks` route answers `503 MARK_NOT_SWITCHED_ON`; the books lists omit the two root keys.

## 6 · Error codes (shopkeeper sentences; the register is docs/error-codes.json)

| Code | Status | Sentence |
|---|---|---|
| `MARK_NOT_SWITCHED_ON` | 503 | Marking and queries are not switched on yet. |
| `MARK_ADOPTER_UNKNOWN` | 422 | We do not know that kind of review. |
| `MARK_NOT_ALLOWED` | 403 | Only the auditor can mark a record. You can read the marks and answer a query. |
| `MARK_KIND_UNKNOWN` | 422 | Choose Checked, Query or On hold. |
| `MARK_WORDS_REQUIRED` | 422 | Write the question first. The owner will read it. |
| `MARK_BULK_NOT_ALLOWED` | 422 | Mark one entry at a time. |
| `MARK_IDS_TOO_MANY` | 422 | Ask for 200 records at a time or fewer. |
| `MARK_SUBJECT_NOT_FOUND` | 404 | We could not find that entry in these books. |
| `MARK_THREAD_NOT_FOUND` | 404 | We could not find that question. |
| `MARK_REPLY_NOT_ALLOWED` | 403 | Only the owner and the adviser answer a question. |
| `MARK_THREAD_CLOSED` | 409 | This question is closed. The auditor can open it again by marking the entry. |
| `MARK_WRITE_NOT_LISTED` | 403 | This part of the books is not open to an auditor. |
| `BOOKS_GRANT_*` (existing) | 403/429/503 | as the books say them: no access given, ended, expired, too many requests, could not record the look. |

## 7 · Not in this contract

Internal (private) notes, bulk marking, reviewers outside the installation, any gate on the entry.
