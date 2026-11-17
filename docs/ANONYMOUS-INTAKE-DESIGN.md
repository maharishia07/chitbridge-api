# Anonymous-intake chit — public/widget helpdesk submissions (design note)

**Status:** design / not built. Captured 2026-07-04 (Athi). The workaround for "the new gap-capture needs a signed-in
asker" (see `B1-RLS-STEP-D-STATUS.md` / the assist.js rework): let a **public web visitor with no C&B login** ask a
help desk a question that lands in its Task inbox — **without** minting a per-visitor identity, and with the reply
going out by **email**. This stays inside the "nobody writes another entity's data" rule.

## The three constraints (Athi) — and why they make it simpler

1. **No customer-user-id per asker.** An anonymous visitor must NOT become an `identities` row — a public widget
   would mint *millions* of junk identities inside the entity. → Use **one shared sentinel identity** for the FK, and
   carry the visitor's real contact as **data on the chit**, not as an identity.
2. **Only the Task copy — hide the Order.** There's no persistent asker to hold a "sent/Order" copy, so create **only
   the help desk's received (Task) copy.** This reuses the per-copy control we already have (`self_copy_pref` =
   `both | sent | received` on the sender) — anonymous intake is just the **"received only"** case. No new machinery.
3. **Reply via SMTP, not an in-app mailbox.** The visitor has no mailbox, so the answer is emailed to them.

Because it's a **single own-entity (help desk) write**, it does **not** need `chit_deliver` (which enforces
sender = caller, for cross-entity delivery). It's an ordinary own-copy write under `withEntity(help_desk)` — the help
desk receiving a submission **into its own inbox**. That's its own data (`entity_id = help_desk`) → passes the
owner-only `WITH CHECK`. RLS-clean, no cross-tenant write, no new definer.

## Model

- **One shared sentinel identity** `Public Intake` (e.g. `public-intake@system`, sealed, cannot log in) — used as
  `sender_entity_id` for ALL anonymous intakes. Satisfies the NOT-NULL FK with a *single* row, forever. The chit's
  **sender snapshot** carries the visitor: `sender_entity_display_name = <visitor name or email>`,
  `sender_entity_bridge_id = 'PUBLIC'` — so the operator sees "Question from jane@acme.com" while the FK stays the sentinel.
- **The intake chit = ONE received copy** written under `withEntity(help_desk_id)`:
  - `chit_header`: `entity_id = help_desk`, `sender_entity_id = sentinel`, sender snapshot = visitor, `purpose = inquiry`,
    `role = Act` (an actionable task), `direction = received`; the visitor's contact in `business_json.contact`
    (`{ reply_email, name, channel }`) — this is where the email to reply to lives.
  - `chit_detail`: the question text / line items (the question).
  - `chit_status`: `current_status = pending`, `direction = received` (shows in the Task inbox).
  - `state_log`: `entity_id = help_desk`, `action = created`, detail "Public question from <visitor>".
  - **No sender/Order copy.** Single copy only.
- **Trigger — a public intake endpoint** `POST /api/assist/intake` with the help desk's **embed key** + `{ q, email, name }`.
  It resolves the help desk from the key, then `withEntity(help_desk_id)` writes the single Task copy. The help desk
  opted into public intake (it runs a widget/key), so the platform depositing into *its own* inbox is legitimate —
  like a contact form dropping into your mailbox. **Public surface → rate-limit + captcha + optional email-verify.**

## Reply path (SMTP)

- The operator handles the intake in the **Task inbox** exactly like any chit — assign (co-assist/hat), answer with a
  **message**, **close** (audit), optionally **Publish** the Q&A to the KB.
- A hook: when a message is posted on an intake chit that carries `business_json.contact.reply_email`, the platform
  sends that message by **SMTP/email** (reuse `lib/notify` — already used for OTP via Resend) to the visitor, instead
  of an in-app reply. The asker has no mailbox; the thread of record stays the chit, the *delivery* is email.

## Why it respects every rule

- **No cross-entity write** — the help desk writes its own inbox copy (`withEntity(me)`), enforced by `WITH CHECK`.
- **No identity explosion** — one sentinel + contact-as-data; zero rows per visitor.
- **No Order copy** — single received copy, via the existing per-copy control.
- **Reply leaves by email**, never into another tenant's mailbox.

## Open questions / caveats

- **Abuse surface** — a public POST needs rate-limiting, captcha, and probably a one-time **email verification** before
  the operator sees it (cut spam; also confirms the reply address is real).
- **Threading a follow-up** — if the visitor replies to the email, how does it thread back to the chit? v1 = one-shot
  Q&A (answer + close). Inbound-email → append-to-chit is a later parser (a `Reply-To` that encodes the chit id).
- **PII / retention** — the visitor's email lives on the help desk's copy (needed to reply). Note it for GDPR
  (retention window; erasable). Ties to the residency note if the deployment is region-homed.
- **Sentinel semantics** — sealed, non-login, excluded from discovery lists; one per installation.
- **Relation to productize roadmap** — this is the "anonymous intake" item from the embeddable-helpdesk vision
  (`[[project-assistant-db-backed]]`): widget + embed key + machine-auth + anonymous intake + email reply = the
  sellable embeddable helpdesk. This note is the *intake* piece.
