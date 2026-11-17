# Requirement — compose mail (the standard mail form)

**Status:** brief for design. **Not built.** Pass mark: `docs/design/SYSTEM.md`. Decisions and sending: MESSAGING.md §3
(provider, from-address, replies — PLAN.md Q1). Flow: FLOWS.md F5.

## 1 · Purpose
Write an e-mail to a party from inside their record — with the standard fields any mail form has — and keep the mail
(and, if approved, its replies) on the party's timeline.

## 2 · Who
Owner and co-assist editors. A commenter / viewer cannot send (lib/access.js).

## 3 · Where it sits
**The existing compose** (app.html `compose(prefill)` :6738), opened in kind `mail` from the party record, Dues, or a
bulk selection (phase 3). Same shell, same minimise pill (`renderComposePill` / `resumeCompose` / `discardCompose`
:15932-15934), same recipient picker (`ccRcptSearch`), same attach-ui (`app/attach-ui.js`). Steps: **To · Write ·
Review**. It is not a second compose.

## 4 · What it shows
| Field | Source | Rule |
|---|---|---|
| From | `settings.crm.from_name` + platform address (Q1) · Reply-To | shown read-only: "Sent as *Chola Auto Care* · replies come back here" |
| To · Cc · Bcc | address book: this party's e-mails, then the shop's other parties' e-mails; free text if an e-mail | To ≥ 1; Cc 5, Bcc 5 (compose's limits, :6498). A recipient whose mail preference is off is shown struck with the reason and cannot be sent to. |
| Template | `settings.crm.templates[]` | picking one fills Subject + Body; placeholders shown as chips (`{party.name}` …) and filled at send by the server |
| Subject | text | required |
| Body | text with simple formatting (bold, list, link) | required |
| Signature | `settings.crm.signature` | appended, editable per mail |
| Attachments | device (attach-ui) · **From this party**: bills, statement PDF, chit attachments | 10 files (compose limit), 6 MB each (`POST /api/attachments` limit) |
| Send / Schedule | now · a date-time (presets: Tomorrow 9am · Monday 9am) | schedule writes a queued mail |

## 5 · What it does
**Send** → `POST /api/crm/parties/:id/mail` (new) `{ to[], cc[], bcc[], subject, body, template_id?, attachments:[{
attachment_id | doc_ref }], scheduled_at? }` → server checks consent + daily cap, fills placeholders, adds signature,
writes `party_mail` (queued), sends through Resend (`lib/notify.sendEmail` widened) → status updates on the timeline.
**Save draft** = the compose pill (existing behaviour). **Discard** = existing.

## 6 · States
- **Mail not set up** (owner hasn't set a from-name / Q1 undecided): "Mail isn't set up yet." + **Set up** (owner) /
  "Ask the owner to set up mail." (others). The Mail button on the record is still shown so the fix is reachable.
- **Party has no e-mail:** To is empty with "Add an e-mail for *Ravi Traders*" + **Add e-mail** (writes the record).
- **Preference off:** that recipient struck through: "They asked not to be mailed (since 12 Sep)". Owner: **Change
  preference**.
- **Marketing template without marketing consent:** Send disabled: "This template is marketing — *Ravi Traders* hasn't
  agreed to marketing mail." + **Use a service template**.
- **Sending / sent / failed:** Review button shows progress; on failure "Mail couldn't be sent. It's saved — try again."
  + **Try again** (the queued row stays). Never `error.message`.
- **Daily cap reached:** "Today's mail limit is reached (200). It will go tomorrow at 9am." + **Schedule** / **Cancel**.
- **One-sided / not on ChitBridge:** mail is the main channel; nothing differs in the form.
- **On ChitBridge:** a hint above To: "*Ravi* is on ChitBridge — a message reaches them in the app." + **Message
  instead** (opens kind chit). Mail still allowed.
- **Offline:** the compose pill keeps the draft (existing); Send disabled with "You're offline".

## 7 · Phone
Full-screen sheet; Cc/Bcc collapsed under "Cc, Bcc"; attachments as a wrapping list; Send fixed at bottom.
`scrollWidth === 390`.

## 8 · Words on screen
"To" · "Cc" · "Bcc" · "Subject" · "Template" · "Signature" · "Attach" · "From this party" · "Send" · "Schedule" ·
"Sent as … · replies come back here" · "Mail isn't set up yet." · "They asked not to be mailed".

## 9 · Data it reads
Party record (e-mails, prefs) · `GET /api/crm/settings` (from-name, signature, templates, cap) · party documents:
`/api/books/party/:id/statement` (PDF render — PLAN.md API work), chit attachments via `GET /api/chits/:id/messages`
`attachments[]` · address book from the CRM list in memory.

## 10 · Must NOT
- Send from the browser or hold the provider key.
- Fill `{dues.total}` or any figure in the page — the server fills placeholders from the engines.
- Be a second compose module or a second attachment uploader.
- Send to a recipient whose preference is off, or marketing without consent.
- Drop the picked identity (fix app.html:7411 in the same work).

## For the designer
**Standard:** SYSTEM.md; **the existing compose** is the frame — its steps, pill and recipient chips. Literature's mail
form (Gmail/Zoho Mail): To · Cc · Bcc · Subject · Body · Attach · Send/Schedule. **Design:** the Write step (subject,
body, template picker, signature); the From line; the "From this party" document picker; the consent and not-set-up
states with their fix buttons; the Schedule control (presets writing into the field, SYSTEM rule 6).
