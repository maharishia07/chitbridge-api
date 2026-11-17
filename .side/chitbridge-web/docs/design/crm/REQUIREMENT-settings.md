# Requirement — CRM settings

**Status:** brief for design. **Not built.** Pass mark: `docs/design/SYSTEM.md`. Data: `settings.crm` (DATA.md §5–§6),
mail decisions MESSAGING.md §3.

## 1 · Purpose
The few choices that shape the CRM for this shop: how "high value" is decided, how mail goes out and what it says, what
the shop records about consent, and who may do what.

## 2 · Who
**Owner** changes; co-assists see the page read-only with "Only the owner can change these." (the Bills inventory
pattern, `can_change:false`).

## 3 · Where it sits
CB CRM sidebar **Settings**. The app's Settings page links here for "Customers & suppliers".

## 4 · What it shows (sections)
1. **Segments** — High value: top **n %** of customers by 12-month bill value (default 10), at least **m** bills
   (default 3). Inactive after **d** days (default 90). Regular from **k** bills (default 3). Preview: "With these,
   24 customers are high value." (server count).
2. **Mail** — Sent as (shop name, editable) · Replies go to (the shop's e-mail, verified by a code) · Signature ·
   Templates (list: name · subject · body · Service / Marketing) · Daily limit (read-only, platform) · Status: "Mail is
   ready" / "Mail isn't set up" with **Set up**. Own domain (phase 3): "Send from your own domain" + **Start**.
3. **Consent** — the notice text shown when the shop records consent ("We'll message you about your orders…"), the
   grievance contact (DPDP), and the default for new parties: Service messages allowed · Marketing not allowed until
   they agree.
4. **Follow-ups** — default assignee (me / the person who logs it) · remind me on the due day (on/off).
5. **Who may** — Export · Import · Merge: owner only (fixed, shown as a fact, not a control) · co-assists may add
   parties (on/off) · co-assists may mail (on/off).
6. **Numbers** — party number format (read-only: from the shop's document numbering, `packs().partyNo`) · **Number all
   parties** (existing `numberAll`, only when some are unnumbered — shows how many).

## 5 · What it does
`GET /api/crm/settings` · `PUT /api/crm/settings {segments?, mail?, consent?, followups?, roles?}` (new) → 403 not the
owner · 400 a value out of range (server says which). Templates: `POST/PUT/DELETE /api/crm/settings/templates/:id`.
Reply-to verification: `POST /api/crm/settings/mail/verify` (sends a code via the existing OTP e-mail,
`notify.sendOtpEmail`).

## 6 · States
- **Defaults never changed:** everything shows the defaults; nothing is amber.
- **Mail not set up:** the Mail section's status line is amber with **Set up** (SYSTEM rule 2).
- **Reply-to not verified:** amber "Replies can't come to *x@y* until you confirm it." + **Send code**.
- **Co-assist:** all controls disabled + one line "Only the owner can change these."
- **Saving / error:** "Couldn't save. Your change is kept here — try again." + **Try again**.
- **Not on ChitBridge parties / one-sided:** not applicable to this screen (settings are the shop's), stated nowhere.

## 7 · Phone
Sections stacked, one card each; templates as a list opening a sheet. `scrollWidth === 390`.

## 8 · Words on screen
"Settings" · "High value" · "Inactive after" · "Sent as" · "Replies go to" · "Signature" · "Templates" · "Service" ·
"Marketing" · "Mail is ready" · "Mail isn't set up" · "Only the owner can change these." · "Number all parties".

## 9 · Data it reads
`GET /api/crm/settings` → `{ segments:{ high_value_pct, high_value_min_bills, inactive_days, regular_min_bills,
preview_counts }, mail:{ from_name, reply_to, reply_to_verified, signature, templates:[{id,name,subject,body,purpose}],
daily_cap, ready }, consent:{ notice, grievance_contact, defaults }, followups:{…}, roles:{…}, numbering:{ unnumbered } ,
can_change }`.

## 10 · Must NOT
- Show or accept the provider key or any secret.
- Let the segment thresholds be computed or previewed in the page (server preview).
- Offer per-co-assist permissions beyond the listed on/off (no second permission system — hats stay in lib/access.js).

## For the designer
**Standard:** SYSTEM.md; the Bills folder inventory (on/off list with a read-only state) and the app's Settings cards.
**Design:** the six sections as cards; number inputs with their preview line; the template editor sheet; the mail
status line and its fix; the read-only co-assist view.
