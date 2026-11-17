# CB CRM — internal, external and mail, in one place per party (MESSAGING)

**Status:** spec, phase 1. Nothing here is built. WEB = chitbridge-web/public, API = chitbridge-api `main` @ 33da275.

## 1 · What exists

| Piece | Where | What it does | Per party? |
|---|---|---|---|
| **Chit messages** | table `chit_messages` (baseline :459; per-copy b67, `line_id` b155, `read_at`/`kept` b156) | one copy per entity via `chit_message_deliver` (chits.js:3519-3546). `thread_type` external (all participants) / internal (author only); dispute messages to the dispute roster | no — per chit (and per line) |
| Post / read a thread | `POST /api/chits/:id/messages` (chits.js:3548) `{message_text, thread_type, line_id, is_dispute, dispute_id, msg_type}` · `GET /api/chits/:id/messages?thread_type=&line_id=` (:3663, with `attachments[]`) | who may post: `lib/access.js:80-85` (viewer none · commenter internal · editor both) | no |
| **Replies screen** | WEB `app/cap-messages.js` messagesScreen :182 · `GET /api/folders/messages` (folders.js:454) · mark `POST /api/folders/messages/:id/mark` (:583) | unread or kept **external** messages from others, one row per chit-line thread, track order/task | no — by chit |
| **Folder message levels** | `lib/folder-inventory.js:36-54`, `bill-privacy.js:93`, `PUT /api/folders/inventory/:code` | the steps of a folder are written External / Internal / None (ceiling; the shop can only go down) | — |
| **Bell (SSE)** | `/api/events` (server.js:271; routes/events.js `POST /ticket`, `GET /stream`), WEB `cbPushStart` core.js:626-656 | `cb` events `{kind,id,who,note}` for chit · paid · books · ask · shop… | — ⚠️ **posting a message emits nothing** (chits.js:3548-3659), so Replies updates only on poll |
| **Compose** | WEB app.html `CC` :6499, `compose()` :6738, steps Items · To · Details · Review (:6851-6876), `sendChit` :7476 → `POST /api/chits/send` (chits.js:269) | sends a **chit** (items + schema fields + attachments). Recipients via `GET /api/entities/search` (:7014), roles to / cc / for, limits to 5 · cc 5 · items 50 · attachments 10 | — ⚠️ the payload drops the picked `bridge` (app.html:7411); the server falls back to name resolution (chits.js:669-707) |
| **Attachments** | `POST /api/attachments` (6 MB, attachments.js:32), `GET /api/attachments/:id`; WEB `app/attach-ui.js` (`cbAttachList`, `cbAttachButton`, `cbAttachPick`) | per chit / message / line, one row per participant | via chit |
| **E-mail out** | `lib/notify.js` `sendEmail(to, subject, html)` :77 via **Resend** (env names `RESEND_API_KEY`, `FROM_EMAIL`) | OTP, a connector notice (connectors.js:216). One from-address for the platform | — |
| **WhatsApp out** | `lib/whatsapp-out.js` (Meta Graph), templates `lib/whatsapp-templates.js` | chit status notices (chits.js:3499) | — |
| **E-mail in** | `POST /api/capture/webhook/email` (capture.js:150) | inbound capture (documents into the shop) | — |
| "Mailbox" | a framing: Task / Order lists + folders (b63), menu group "Mailbox" app.html:5777 | — | — |
| Templates / signature | **none** for messages | — | — |

## 2 · One timeline per party

The party record's **Timeline** (REQUIREMENT-timeline.md) is the one place. It is a **read**, assembled by
`GET /api/crm/parties/:party_id/timeline` (DATA.md §4); nothing is copied into a CRM table except what has no home today.

| Entry | Source | Shown as | Opens |
|---|---|---|---|
| Chit sent / received | `chit_header` for this counterparty | the chit's subject · step chip | `openChitSheet(id)` (chit-sheet.js:246), else `openChit` |
| Chit message (external, from either side) | `chit_messages` copies on this party's chits | latest line per thread · unread dot · count | the chit sheet on that thread |
| Internal note on a chit | `chit_messages` internal | marked "internal" | the chit sheet |
| Dispute | dispute copies | red chip · status | the dispute thread (cap-dispute.js) |
| Bill / receipt / payment | `party_item` | amount · step label from `lib/bill-steps.js` (never decided in the browser) | the chit sheet |
| Call · visit · WhatsApp · note | **`party_interaction`** (new, DATA.md §5) | kind icon · one line · by · at | inline expand (`gsToggle` pattern) |
| Mail | **`party_mail`** (new, if approved) | subject · status (queued · sent · failed · bounced) | the mail, read-only, with Reply |
| Follow-up set / done | `party_followup` | due date · who | follow-ups |
| Party field changed | `books_change_log` | "Credit days 15 → 30 · by · at" (owner only) | — |

Filters on the timeline: All · Messages · Bills · Notes & calls · Mail · Follow-ups (list-ctl.js filter). Read state
for chit messages reuses `read_at` / the mark route — the CRM never keeps its own unread flag.

**SSE gap:** add `events.emit({kind:'message', id: chit_id, who})` after a successful external post (chits.js ~:3645).
One line, API phase 2; then the Replies badge, the party record and the timeline refresh on arrival.

## 3 · The standard mail form — reuse the compose

Literature (LITERATURE.md item 7): To · Cc · Bcc · Subject · body · attachments · templates · signature · send / schedule;
the thread kept on the record.

**Decision: one compose, two kinds.** The existing compose (`compose(prefill)`) gains a kind:

- **kind `chit`** (today, unchanged) — for a party on ChitBridge.
- **kind `mail`** — opened from the party record for any party with an e-mail. Same shell, same pill
  (`renderComposePill` / `resumeCompose` / `discardCompose`, app.html:15932-15934), same recipient picker, same
  attach-ui. Steps become **To · Write · Review** (no Items).

What `mail` adds, exactly:
| Adds | From | Note |
|---|---|---|
| **To / Cc / Bcc** address book | the party record's e-mails (identity email + any contact e-mail) and the shop's other parties | Bcc is new to compose (limit 5, like cc). Free text allowed if it is an e-mail. |
| **Subject**, **body** | new fields — compose has **no body today** | plain text + simple formatting; body stored as text and HTML |
| **Templates** | shop's `settings.crm.templates[]` `{name, subject, body}` with placeholders `{party.name}`, `{party.no}`, `{dues.total}`, `{shop.name}` | values filled **server-side** at send from the record (dues from `/api/books/dues` — never computed in the page) |
| **Signature** | `settings.crm.signature` | appended at send; editable per mail |
| **Attachments** | attach-ui from device **plus** "from this party": their bills, statements (PDF from `/api/books/party/:id/statement`), chit attachments | a picked document is referenced by id, not re-uploaded |
| **Send / Schedule** | send now, or `scheduled_at` | a scheduled mail is a `party_mail` row `queued`; a sweep sends it (reuse the books-nightly scheduler pattern) |
| **Consent check** | `party_contact_pref` (DATA.md §5) | e-mail `allowed=false` → Send disabled with the reason and **Change preference**; marketing templates require `purpose=marketing` consent |

Also fixes in the same compose work (bugs, not features): send the picked `bridge` with each recipient
(app.html:7411) so the server stops resolving by name.

### How an outbound mail is sent (needs decisions — PLAN.md Q1)

- **Provider:** Resend, already a dependency and already wired (`lib/notify.js` `sendEmail` :77). Widen `sendEmail` to
  take `{from, replyTo, cc, bcc, attachments, headers}` — do not add a second mail module.
- **From-address — decision needed.** Options: (a) `<shop name> via ChitBridge <shops@<platform domain>>` with
  `Reply-To: <shop's own e-mail>` — works for every shop on day one, no DNS per shop; (b) the shop's own domain after
  DNS verification in Resend — better deliverability, setup per shop. **Recommended: (a) now, (b) later as a CRM
  setting.**
- **Replies — decision needed.** (a) Reply-To the shop's own inbox: replies leave ChitBridge; the record shows only
  what was sent. (b) Reply-To a per-mail address on the platform (`r+<mail_id>@…`) received by the existing inbound
  webhook (capture.js:150), which files the reply as a `party_mail` with `in_reply_to` — the thread stays on the
  record. **Recommended: (b), reusing the inbound webhook; (a) as the fallback while (b) is built.**
- **Bounces / failures:** Resend webhook → `party_mail.status`. A bounce makes the e-mail amber on the record
  ("Mail to ravi@… bounced — check the address").
- **Limits:** per-shop daily cap (default 200) so the platform domain is not burned; marketing mail needs consent.
- **Never:** the API key in the browser; a mail sent from the page directly; a mail to a party whose e-mail preference
  is off.

## 4 · Phone, SMS, WhatsApp

- **Call** — a `tel:` link and then "Log this call" (a `party_interaction` with kind `call`).
- **WhatsApp** — a `wa.me` link with the text prefilled (no API cost), then "Log it". Template-based WhatsApp
  through `whatsapp-out.js` stays for system notices; using it for CRM messages is a later decision (PLAN.md Q6).
- **SMS** — no adapter exists (`notify.sendOtpSms` is a stub). Out of scope.
