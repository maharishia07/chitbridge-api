# Marketing page: its own door (REQUIREMENT for the designer, 19 Oct 2026)

**Status:** requirement only (MKT-2). Do not build. **Pass mark:** `docs/design/SYSTEM.md`. **Map:** `C:/dev/docs/design/NAV-MAP.md` §5 item 1, §6 items 32-38, §7 row "CRM + Marketing".
**Seed and law gate:** `C:/dev/docs/12-marketing/MARKETING-SEED.md` (read it; this brief does not repeat it). **Owner:** cb-marketing. The party list stays CRM's.
**Motto of the rules:** one party list, never a second contact list; no consent, no send; "came back" counted from real sales; the advisor suggests, the owner decides.

## Why
Today the Home tile "Marketing" opens `crm.html#/groups`, a page whose crumb says "CRM" (D14). Marketing, CRM and Consent and privacy land in one page.
Athi, 18 Oct: "enhance the marketing box to the maximum possible".

## Who
The owner, or a staff member allowed to market. Not a marketer: someone who wants "bring my regulars back" in two taps.

## Tabs (the seed's five; one pane each, more panes not denser)
| Tab | Job | Reads |
|---|---|---|
| Leads | people not yet customers, by stage; add, move, import | existing `cap-crm-leads.js` (parties with `added_via='lead'`) |
| Groups | who gets an offer: the 4 segments (new, regular, high value, inactive) and named groups; each shows "can be messaged: n of m" | `GET /api/crm/segments` |
| Offers sent | what went out, to whom, which channel | `channel_outbound` (read only, MKT-3) |
| Who came back | for each send, how many bought afterwards, against a few held back | real sales (MKT-4); empty until built |
| Shop window | the shop's public look and link | `showcase-templates.js` (brief: `docs/design/online-shop/REQUIREMENT.md`) |
The page has the standard skeleton (left menu + full-width main). Phone: the five become the top-of-page switcher, one pane at a time.

## WAYS IN
Home > Selling > Marketing (the tile now opens THIS page, `/marketing.html#/groups` or the owner's file name; designer proposes the hash grammar, `#/leads`, `#/groups`, `#/sent`, `#/back`, `#/window`).
CRM > "Marketing ›" link. Offer Lab "Send an offer to this group" (MKT-5). A chit sheet or party card "Message" for one person stays in CRM.
## WAYS OUT
Header ⌂ Home. "CRM ›" to Parties and Calls. Group row > Send an offer (sheet over the page, not a new page). Offer Lab to make the offer. Consent and privacy > CRM Privacy (consent per channel and purpose, link not copy). Shop window > the live shop (new tab with the owner bar back, see online-shop brief). Max 3 taps from Home: Selling > Marketing > Groups.

## Fields (from the real API, `GET /api/crm/segments`)
Segment: `key` · `name` · `rule` (words, e.g. "fewer than 3 bills") · `count` · `offers` · `reach{may, not, refused_by[{code,n}]}`. Group: `key` ("group:Dealers") · `name` · `count` · `offers` · `reach`. Page: `channel` ("whatsapp") · `purpose` ("marketing") · `customers` · `may{group,send,delete}` each `{may, code, why}`.
Dry-run send, `POST /api/crm/segments/:key/send` with `dry`: `members` · `may` · `refused[{party_id,name,code,why}]` · `refused_by[{code,n}]` · `sent_n` · `failed_n` · `refused_n`. The refused code is what the page branches on, never the sentence.
Reuse names before inventing any: `node C:/dev/seams.cjs group|consent|offer` (all found; "campaign" and "broadcast" are new and need their dictionary entry).

## Sample (label "Sample"; from the contract fixtures)
Groups: "New", rule "fewer than 3 bills", 0 people, can be messaged 0 of 1 (no consent). "Dealers", 2 people, 1 offer, can be messaged 0 of 2: "No consent for offers on whatsapp. Ask them first." (fixture `refused[0].why`). Leads: empty with the sentence "No leads yet. Add one or bring a sheet." Offers sent and Who came back: "Starts when you send your first offer" (greyed tab, not hidden: show action).

## Actions per state (show every action; the server says may/why; a refused one is greyed WITH its sentence)
- Group row: Send an offer (may.send), Add or remove people (may.group), Delete group (may.delete). Not allowed: grey + `why`.
- Send sheet, step 1 audience and the count that may be messaged; step 2 the offer; step 3 the dry-run result "12 will get it, 3 can't: no consent" then Send. Nothing sends without the gate. The refused people are listed with the fix: "Ask them for consent".
- "Make an offer" is greyed with its sentence until MKT-5 (never silently dead, NAV-MAP item 37). No build words (b205, b306) on screen.

## States
Loading · empty (each tab says what it is for and its one next step) · consent not set up (the count shows "0 can be messaged" and a link to Privacy) · groups not available yet (plain words, not "one database step") · sent · partly refused · failed (what happened, what to do) · could not load (Try again) · no marketing permission (tabs shown, actions greyed with why).

## Rules for the design
Countries differ (consent words, quiet hours, opt-out text) and come from the country pack; never a typed-in national default. Text budget: tab names one word, buttons up to 3 words. Phone: the audience count and the Send button stay in a fixed bottom bar. Light, dark, AA, 390 px.

## Open questions for Athi
1. Page name and file (`marketing.html`) or a CRM section with its own door? 2. Is "Who came back" shown from day one as an empty tab, or hidden until the first send?

## Not in scope
The advisor that suggests campaigns (seed T2, a later brief). Sending costs money (SMS) and is out; WhatsApp through the one sender only.
