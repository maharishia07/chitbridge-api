# CB CRM — designer handoff: the first five screens

**Status:** design for Athi to judge by eye. **No app code** — nothing under `public/`, `e2e/` or the API changes.
Briefs: `../REQUIREMENT-{home,record,timeline,compose-mail,followups}.md` ("For the designer"). Pass mark:
`docs/design/SYSTEM.md`. Shape: as `docs/design/ledgers-page/` — plain HTML/CSS/JS, no build step, no dependencies.

## Open it
Open `index.html` in a browser (or serve the folder statically). The **Handoff · states** button (bottom right — not
part of the product) jumps to every state below. Every figure is sample data, and the page says so beside the title.

| File | What it is |
|---|---|
| `index.html` | the page: CB Accounts shell (sidebar · pinned header · content) |
| `styles.css` | CB Accounts' tokens as shipped (`public/accounts.html`) + the Task table's classes re-dressed on them |
| `data.js` | sample data in the API's shapes (`GET /api/crm/parties` …) with the real field names |
| `app.js` | painting + hash routes; each block names the app function the build wires instead |
| `shots.cjs` | screenshots + layout/contrast checks (Playwright, file://, never the live site) |
| `png/` | `{home,record,timeline,compose,followups}-{laptop,phone}.png` + `png/states/` (one pair per state, 94 files) |

## Screens and their states

Hash routes; `?role=editor|viewer` and `?ledger=off` work on every route. Each state has a screenshot pair in
`png/states/<name>-{laptop,phone}.png`.

### 1 · CRM home — `#/parties` (`png/home-*.png`)
| State | Hash | Shot |
|---|---|---|
| Default (owner) | `#/parties` | `home` |
| Group rows (Task's group sum) | `#/parties?group=rail` (also `role`, `seg`) | `home-grouped` |
| Select mode + bulk bar | `#/parties?select=1` | `home-select` |
| Empty | `?state=empty` | `home-empty` |
| Loading | `?state=loading` | `home-loading` |
| Error | `?state=error` | `home-error` |
| Migration not run | `?state=migration` (owner) · `&role=editor` (others) | `home-migration` |
| Ledger off — no Dues column, no dues alert | `?ledger=off` | `home-ledger-off` |
| Test shop | `?state=testshop` | — |
| Viewer — find and open only | `?role=viewer` | `home-viewer` |
| Add party — three result kinds | `#/parties/add?q=ravi` | `home-add` |
| No match | type in search | — |

| Element | Field (`GET /api/crm/parties`) |
|---|---|
| Alert line: follow-ups late · late dues · duplicate | `alerts.followups_overdue` · `alerts.dues_overdue` · `alerts.duplicates` — the Follow-ups badge shows the same number |
| Party cell | `display_name` (server applies nickname-wins) · `party_no` · unread dot `unread` |
| Role chips | `roles[]` → Customer · Supplier (both when both — one row) |
| ChitBridge chip | `on_chitbridge` / `kind` / `why_not` → On ChitBridge · Local · Account inactive · Test space · Walk-in |
| Dues | `balance_minor` · `currency` · `oldest_due` — `partyDueChipHTML` look (↓ they owe you, amber · ↑ you owe them, blue) |
| Next follow-up | `next_followup_at` (amber "Late" when `next_followup_late`) |
| Other columns (chooser) | `last_at` · `segment`, `groups[]` · `phone`, `email` · `tax_ids[]` · `city` |
| Search | `display_name` `nickname` `legal_name` `party_no` `user_id` (on ChitBridge only) `phone` `email` `tax_ids[].value` `groups` |
| Filters | ChitBridge chips (counts) · Role · Segment · Dues · Follow-up · Sort (Name · Last activity · Dues · Newest) · Group |
| Count | "13 parties of 13" (list-ctl's count) |
| Phone card | name + `party_no`, role + ChitBridge chips, one fact: late dues › next follow-up › last activity (walk-in: points) |

### 2 · Party record — `#/party/<party_no>` (`png/record-*.png`)
| State | Hash | Shot |
|---|---|---|
| On ChitBridge, both roles, Next with 3 items | `#/party/P-0002` | `record` |
| Local (one-sided) supplier, mail bounced | `#/party/P-0003` | `record-local` |
| GSTIN differs · late follow-up · linked party | `#/party/P-0001` | `record-gstin-late` |
| Account inactive | `#/party/P-0011` | `record-inactive` |
| E-mail preference off (Mail disabled with why) | `#/party/P-0005` | `record-pref-off` |
| Walk-in (primary: Add to my parties) | `#/party/walkin-9876500021` | `record-walkin` |
| No phone or e-mail · no history | `#/party/P-0013` | `record-no-contact` |
| Merged — opens the keeper once | `#/party/P-0008` | `record-merged` |
| More menu open | `#/party/P-0002?menu=more` | `record-more` |
| Loading · Error | `?state=loading` · `?state=error` | `record-loading` · `record-error` |
| Viewer — every action hidden | `?role=viewer` | `record-viewer` |
| Ledger off | `?ledger=off` | `record-ledger-off` |
| Edit sheet — tax-ID list (widened `partyEditOpen`) | `#/party/P-0003/edit` | `record-edit` |
| Edit — duplicate GSTIN (409 `DUPLICATE_PARTY`) | `#/party/P-0004/edit?estate=dup` | `record-edit-dup` |
| Log sheet (F4) | `#/party/P-0003/log` | `record-log` |

Order top to bottom: header → **identity block** → **Next** → actions → sections (Timeline · Who & contact · Tax & terms ·
Customer · Supplier · Ledger · History of changes). Open by default: Timeline, Who & contact, and the role section when
there is one role. Closed sections still show one fact on their head line.

| Element | Field (`GET /api/crm/parties/:party_id`) |
|---|---|
| Header | `display_name` · `legal_name` (only if different) · chips as on home · dues chip · `segment` |
| Identity block | `party_no` · `user_id` · `bridge_id` (shown as "ChitBridge ID"; **never for a minted party** — "none — kept by you") · verdict from `on_chitbridge`/`why_not` with **Link to ChitBridge** (owner) / **Invite** |
| Next | `followups[]` (late / today) · `unread` · `dues_overdue` + `oldest_due` · `gstn_profile` vs `tax_ids` GSTIN · `mail_bounced` · no `contacts` |
| Actions | Message (on ChitBridge) › Call (has phone) › Mail › Add phone or e-mail; Log · Follow-up · Edit · More. Mail is disabled with its reason when `prefs[email].allowed === false` or no e-mail. Phone: primary + Log + More pinned at the bottom |
| Timeline head | `timeline_head` (5) + "See all n" from `counts.all` |
| Who & contact | `contacts.phones[]` · `contacts.emails[]` (bounced one marked) · `contacts.address` · `prefs[]` → Allowed / Not allowed / **Not recorded** (three answers) |
| Tax & terms | `tax_ids[]` · `state_code` + `supply_type` words · `customer.credit_days`/`credit_limit_minor` and `supplier.…` **per role** |
| Customer | `customer.txn_count` · `last_bill_at` · `since` · `added_via` · `segment` · `groups` · `points.balance`/`programme` |
| Supplier | `supplier.category` · `preferred` · `supply_kind` · `catalogue` · `notes` (pinned) · availability: "can't tell — not built yet" |
| Ledger | `partyBooksHTML` + `partyStatementLoad` unchanged (the sample shows bill rows only); off → "Dues show when CB Accounts is on" + Switch on |
| History of changes (owner) | `changes[]` (`books_change_log`) with **Undo** on link/merge rows |

### 3 · Timeline — `#/party/<no>/timeline` (`png/timeline-*.png`)
| State | Hash | Shot |
|---|---|---|
| On ChitBridge — ten kinds, day dividers, "Show 50 more" | `#/party/P-0002/timeline` | `timeline` |
| Local — empty filter chips not drawn | `#/party/P-0003/timeline` | `timeline-local` |
| Linked divider | `#/party/P-0001/timeline` | `timeline-linked` |
| A message arrives (SSE) — at top, unread, "New" | `?state=arrive` | `timeline-arrive` |
| Empty | `#/party/P-0013/timeline` | `timeline-empty` |
| Loading · Error | `?state=loading` · `?state=error` | `timeline-loading` · `timeline-error` |

**One entry grammar for every kind:** mark (icon in a tinted square, kind named for screen readers) · one line · `by` ·
time · chip on the right (state, amount). "Theirs" (the other party wrote it) = a blue ↙ before their name and a blue
left rule; unread = dot + bold line; internal = a grey "internal" tag. A long call/note line ends "… Show all" and
expands in place (`gsToggle` pattern). Fields: `entries[].{id, kind, at, by, line, state, chit_id, thread.{unread,count},
amount_minor, currency, mail_id, followup_id, interaction_id}` · `counts.*` · `next_before`.

### 4 · Compose mail — `#/party/<no>/mail?step=to|write|review` (`png/compose-*.png`)
| State | Hash | Shot |
|---|---|---|
| Write (template, placeholders, format bar, signature, attachments, "From this party") | `#/party/P-0003/mail` | `compose` |
| To (To · Cc, Bcc) | `?step=to` | `compose-to` |
| Review + When presets (Now · Tomorrow 9am · Monday 9am write into the field) | `?step=review` | `compose-review` |
| On ChitBridge hint + Message instead | `#/party/P-0002/mail` | `compose-on-chitbridge` |
| Mail not set up (owner / others) | `?mstate=notsetup` (`&role=editor`) | `compose-not-set-up` |
| No e-mail | `#/party/P-0013/mail?step=to&mstate=noemail` | `compose-no-email` |
| Preference off — recipient struck with the reason | `#/party/P-0005/mail?step=to` | `compose-pref-off` |
| Marketing template without consent | `?mstate=marketing` | `compose-marketing` |
| Sending · Failed · Daily cap · Offline | `?step=review&mstate=sending|failed|cap` · `?mstate=offline` | `compose-sending` … |

It is **the one compose** (`compose(prefill)`, kind `mail`): same modal frame, same minimise button (the compose pill),
same recipient chips, same `CBSteps` rail, attach-ui for "Attach". Fields: `settings.mail.{from_name, reply_to,
signature, templates[].{template_id,name,purpose,subject,body}, daily_cap}` · the record's `contacts.emails`, `prefs`,
`mail_bounced` · `docs[]` (`doc_ref` — referenced by id, never re-uploaded). Placeholders stay as chips in the page;
the server fills them at send.

### 5 · Follow-ups — `#/followups` (`png/followups-*.png`)
| State | Hash | Shot |
|---|---|---|
| Owner (Everyone), Late · Today · This week open, Later folded with names | `#/followups` | `followups` |
| Co-assist (Mine) | `?role=editor` | `followups-mine` |
| Add sheet — party, what, presets → date, who | `#/followups/add` | `followups-add` |
| Nothing due today (one line) | `?state=alldone` | `followups-nothing-today` |
| Empty · Loading · Error | `?state=empty|loading|error` | `followups-empty` … |
| Assignee left → "Unassigned" + Assign; party removed → greyed + Delete | in the default data | `followups` |

Columns (three): **Due** · **What** (with who · source under it, and Done / Snooze) · **Party**. Peek adds Who · Source ·
Created. Fields: `followups[].{followup_id, party_id, party_no, party_name, what, due_at, late, assignee_user_id,
assignee_name, source, done_at, created_at}`.

## Reuse points (CLAUDE.md rules 1 and 5)
Searched `docs/SEAMS.md`-named functions in `public/app.html`, `app/list-ctl.js`, `app/cap-folders.js`,
`app/cap-books.js`, `app/step-flow.js`, `accounts.html`. Nothing here is a new look:

| Here | Reused from |
|---|---|
| Sidebar, pinned header, avatar, tokens, `.act`, `.chip`, `.card`, `.empty` | `public/accounts.html` (the ledgers-page handoff, as shipped) |
| Parties / follow-ups table | Task table: `listHeader` · `rowGrid` · `colTemplate` · column chooser (`.lhead`, `.lrow`, `.lcell`) |
| Search · filters · sort · count · lazy rows | `list-ctl.js` + `lazyWrap` ("↓ Show 50 more" · "n of m") |
| Hover peek | `rowPeekShow` (`#rowpeek`) |
| Group rows, record sections, note expand | `gsToggle` head line (cap-folders.js:333/414) |
| Dues chip · ledger block | `partyDueChipHTML` · `partyBooksHTML` · `partyStatementLoad` |
| Edit sheet | `partyEditOpen`, widened to a tax-ID list (schemes from `party-fields.js:26`) |
| Mail | `compose(prefill)` kind `mail`, `CBSteps` rail (`.cbst-rail`), compose pill, `ccRcptSearch` chips, attach-ui |
| A chit / bill / message entry opens | `openChitSheet(id)` |
| Narrow panes become cards | container query, as cb-design §6 asks |

**New (and why):** the identity block (BRIDGE.md asks the record to show party no · user id · ChitBridge ID · verdict
together; no screen does), the Next block (REQUIREMENT-record §4.2; nothing gathers due things per party), the timeline
entry line (one grammar for ten kinds, built on the Bills status-line order `code · label · by · at` with a kind mark and
an amount slot added). Each is an
arrangement of existing tokens and chips.

## Keys this design reads that the requirements' §9 did not name
For `docs/FIELDS.md` (rule 3) — each is **derived by the server**, read by these screens only:

| Key | Where | Derived from | Why the page can't |
|---|---|---|---|
| `dues_overdue` | list row | `oldest_due` + the party's credit days (the Dues engine) | "late" is a rule, not a paint |
| `next_followup_late` | list row | `party_followup.due_at` vs shop time zone | requirement-followups §10 forbids the browser clock |
| `supply_type` | list row | `tax-engine.supplyType(shop state, party state)` | rule 2 — the place-of-supply words |
| `bucket` (late · today · week · later) | follow-up row | `due_at` in shop time | same as `late` |
| `assignee_left`, `party_removed`, `on_chitbridge` | follow-up row | co-assist list · list membership · `mayTrade` | the follow-ups list is read alone |
| `theirs`, `direction`, `state.{word,tone}`, `fix` | timeline entry | author ≠ shop · interaction direction · `bill-steps` / mail status | the step word is the server's |
| `mail_bounced` | record | latest `party_mail.status = bounced` | — |

**One name to settle:** the task file says `one_sided.why`; REQUIREMENT-home §9 says `why_not`. The sample uses `why_not`
(values `local · inactive · shopper · other_population`, BRIDGE.md §2) so there is one key. A walk-in has `kind:'walk-in'`
and `why_not: null`.

## Open questions for Athi (visual choices the briefs left open)
1. **Role and ChitBridge chips inside the Party cell, not their own columns.** The brief lists Roles and ChitBridge as
   columns, but with three columns at most (rule 7) they would push Dues or Next off. Recommended: chips under the name,
   as shown.
2. **Display font.** SYSTEM.md names Bricolage Grotesque; CB Accounts as shipped uses Source Serif 4 for headings. This
   follows CB Accounts so the two pages match. One word changes it.
3. **Default columns.** Party · Dues · Next follow-up (Ledger off: Party · Last activity · Next follow-up).
4. **Local vs on ChitBridge, without a paragraph:** green solid chip + green verdict for on ChitBridge; dashed border on
   the chip *and* the identity block for local; dotted for walk-in. Enough difference, or should local be amber?
5. **Mail's Bcc** prefills the shop's own reply address (a copy for the shop's inbox). Keep or drop?
6. **Follow-ups "Done" on a laptop** sits under each line (as on phone). Alternative: Done only on hover.
7. **Record sections open by default:** Timeline, Who & contact, the role section for a one-role party; Tax & terms,
   Ledger and History closed with one fact on the head line.

## Checks (all pass — reproduce)
```
mkdir /tmp/pw && cd /tmp/pw && npm i @playwright/test@1.61.0
NODE_PATH=/tmp/pw/node_modules node docs/design/crm/handoff/shots.cjs
# behind a TLS-inspecting proxy, add NODE_EXTRA_CA_CERTS=<CA bundle> so the Google fonts load
```
For each of the 52 routes, laptop (1280) and phone (390): `document.scrollWidth === 390` on phone; no sideways scroll on
the laptop; no text under 11px; every text run at WCAG AA contrast (4.5:1, 3:1 large); every alert / amber / red banner
carries its fix button; no "accounting" / "books of account"; no page error. Then the screenshots were read by eye.
`node scripts/check-syntax.js` is unaffected (nothing under `public/` changed).

**Screenshot note:** the committed PNGs were reduced to a 256-colour palette after capture (Pillow, 18 MB → 6 MB). Shots are full-page, so a phone's pinned action bar and compose's sticky Send footer are drawn at
the end of the page, and a sheet covers the content pane — on a real phone the bar sits at the bottom of the screen
and the sheet covers the whole screen.

## For the build (note only)
`lib/istest` `mayTrade` / `mayTradeSql` (chitbridge-api PR #9) already decides on ChitBridge — reuse it, never a second
one; customer and supplier lists already return `on_rail`; a party is numbered when added (`feat/party-no-at-add`).
