# Requirement — the party timeline

**Status:** brief for design. **Not built.** Pass mark: `docs/design/SYSTEM.md`. Data and sources: MESSAGING.md §2,
DATA.md §4. Flow: FLOWS.md F3, F4.

## 1 · Purpose
Everything that happened with one party, newest first, in one list: chits, messages, bills and payments, disputes,
calls and notes, mails, follow-ups — so "what did we last say to Ravi?" has one answer.

## 2 · Who
Owner and co-assists. A co-assist sees chit messages only where `GET /api/folders/messages` would show them
(folders.js:457-469: assigned lines). Changes (`books_change_log`) are owner only.

## 3 · Where it sits
Inside the party record (head: latest 5) and full-height via **See all** (a view of the record, `#/party/<no>/timeline`).

## 4 · What it shows
One entry per event. Each: kind mark · one line (what) · who (`by`, user id or name) · when · state chip where it has
one · unread dot for unread external messages. Entry kinds and sources:

| Kind | Line | State | Opens |
|---|---|---|---|
| Chit | subject, from `manual_subject`/`auto_subject` | step chip from `bill` (lib/bill-steps.js) | `openChitSheet(id)` |
| Message (external) | latest line of the thread, sender name, "+n more" | unread | chit sheet on that thread |
| Message (internal) | as above, marked internal | — | chit sheet |
| Bill / receipt / payment | `party_item` doc no · amount (server minor units, painted with `CBMoney`) | paid / due / disputed | chit sheet |
| Dispute | subject | open / settled | dispute thread |
| Call · Visit · WhatsApp · Note | body (one line; long text expands in place — `gsToggle` pattern, cap-folders.js:333) | in / out | expand |
| Mail | subject · to | queued · sent · failed · bounced | read-only mail + Reply |
| Follow-up | what · due | due / done | follow-ups |
| Change (owner) | "Credit days 15 → 30" | — | — |
| Linked / merged | "Linked to ChitBridge" / "Merged from P-0012" | — | — |

Day dividers ("Today", "Yesterday", date). Filter chips: All · Messages · Bills · Notes & calls · Mail · Follow-ups
(list-ctl filters, counts from the server). Search within the timeline.

## 5 · What it does
Open an entry (above) · **Log** (F4) at top · mark a thread read when opened (existing mark route — no CRM flag) ·
Reply to a mail · tick a follow-up done.

## 6 · States
- **Empty:** "Nothing yet with this party." + **Log a call or note**.
- **Loading:** the existing loading row; older pages via the lazy sentinel ("↓ Show 50 more").
- **Error:** "Couldn't load the history. Try again." + **Try again**; the record's other sections still show.
- **One-sided (local party):** no chits or messages kinds; bills (mine), notes, calls, mails only — the filter chips that
  would be empty are not drawn.
- **Not on ChitBridge, later linked:** entries before the link date stay, under a divider "Linked to ChitBridge · date".
- **A message posted elsewhere arrives (SSE `message`, MESSAGING.md §2):** the entry appears at top with its unread dot.

## 7 · Phone
One column, full width cards (one per entry), the line wraps — never truncated (SYSTEM rule 5). Filter chips wrap.

## 8 · Words on screen
"Nothing yet with this party." · "Log a call or note" · "internal" · "Queued" · "Sent" · "Bounced" · "Linked to
ChitBridge" · "Merged from …" · "+n more" · "Today" · "Yesterday".

## 9 · Data it reads
`GET /api/crm/parties/:party_id/timeline?kind=&q=&before=<cursor>` (new, server-paged, 50 a page) →
`{ entries:[{ id, kind, at, by, line, state?, chit_id?, thread?:{line_id, unread, count}, amount_minor?, currency?,
mail_id?, followup_id?, interaction_id? }], next_before, counts:{ all, messages, bills, notes, mail, followups } }`.

## 10 · Must NOT
- Keep its own unread state or copy message text into a CRM table.
- Decide a bill's step or amount (server `bill` and `party_item`).
- Show internal messages to the other party (server copies already enforce this; the screen never merges copies).
- Load the whole history at once (it is server-paged; this is NOT a list-ctl in-memory list).

## For the designer
**Standard:** SYSTEM.md; the chit status-line grammar from the Bills folder brief (`code · label · by · at`); Task's
group sum expander (`gsToggle`) for in-place expand; lazyWrap's sentinel for "more". **Design:** the entry line per
kind (mark, line, who, when, chip) so ten kinds read as one list; the day dividers; the filter chips; how unread and
"theirs" (the other party wrote it) are marked; the in-place expand of a note.
