# CB Settings · set up your business — designer handoff (prototype, 2026-10-16)

The brief is `REQUIREMENT.md` in this folder. The decisions behind it are R1–R57 in
`C:/dev/docs/29-qa-test-tooling-ux-locale-and-design-system/WALK-REG-2026-10-16.md`. **This is a clickable prototype, not product code.**
Open `index.html` in a browser. It needs no server and works offline, except for the Google fonts.

The purple strip at the top is **PROTOTYPE ONLY — DO NOT BUILD**. It switches:
- Country: IN ₹ · AU A$ · AE AED
- State: First visit · Half done · All done · Wrong tax number
- Theme: Cream · Dark · Terminal

The URL can do the same, for example `?c=AU&s=wrong&t=dark&pop=map&paper=A4#/business`.

## Files
| File | What it is |
|---|---|
| `index.html` | The frame: the CB Settings sidebar, the header bar, the screen, and a popup layer |
| `styles.css` | Part 1 is CB Finance's own token block, **copied unchanged** from `public/finance.html`. Part 2 is the avatar's `data-tokens="list"` theme mapping. Part 3 is Finance's sidebar, bar, buttons and chips. Part 4 is what this family adds (rows, cards, tables, bill, popups). Tokens only. |
| `app.js` | Screens, the one-row component, popups and adjustable columns. It paints and computes nothing. |
| `data.js` | Three country packs, three sample shops, the four states, the Policy rows, and the Dark and Terminal themes (copied from `engine/screen.js`). Every bill figure is given. |
| `png/` | 74 screenshots (list below) |

## The look: CB Accounts / CB Finance, exactly (Athi, 16 Oct: "follow the same theme as Accounts, Finance etc")
- **Shared with Finance:** 232 px sidebar (`--side`), 56 px brand row, teal `--accent #1f5f5b` with its 3 px active bar, the shell bar (mark · business ▾ · app chip · screen chip · 🔔 · ⌂ Home · avatar), `.act`/`.tag` buttons and chips, and 14 px cards on `--surface`.
- **Typography:** Source Serif 4 for headings, IBM Plex Sans for text, IBM Plex Mono for figures. The list grid has an uppercase header and zebra rows.
- **Phone:** the skeleton's 64 px icon rail below 760 px.
- **Themes:** a chosen theme is applied the way the app applies it: the theme's variables go inline, plus `data-themed` and Finance's own `:root[data-themed]` re-pointing.
- **Where SYSTEM.md and the shipped Finance/Accounts differ, I followed Finance:**
  - Headings use **Source Serif 4**, not Bricolage. SHELL-ONE says "no serif", but `finance.html` and `accounts.html` still use it.
  - Primary buttons and the active state use the teal **`--accent`**, not `--green`.
  - `--blue` is `#2468BD`, not `#2F74C9`. This is Finance's own AA fix.
  - Cards sit on `--surface #fffdf8`, not `#FFFFFF`.
  - The **kural footer is not drawn.** It is the shared `CBKural` mount, and Settings will get it with the frame.
  - The sample bill is paper, so it stays black on white in every theme, as `bill-print.html` does.

## Screens
1. **Start here (the six questions, first visit).** This is the sidebar's first item until all six are answered; the badge shows how many are left.
   - The questions: Country 🔒 · Kind of business · Nature + what you supply · Tax number or "Not registered" · Business name + logo · Address (📍 map popup).
   - Header: the dots and "n of 6".
   - When all six are done: "✓ Ready to bill · Open the counter ›".
   - The **Set for you** fold is a table of Setting · Now · From. "From" is "India pack" or "Tea shop / café". This is R42's "6 inputs → 7 layers", shown instead of explained.
2. **Country.** One-row rows. 🔒 appears only on Country and Money (R14), and the ⓘ says "Fixed after your first sale". The rows that come from the pack carry a "from country" tag.
3. **Your business: seven cards**, in all four states. Each card shows a status chip: ✓ Done · *n* to fill · Not needed yet · ✕ Wrong · Off.
   - **Name & kind:** name*, logo upload, kind*, nature*, supply*, tagline.
   - **Contact & address:** address* (one line + mini map; ✎ opens the map popup), phone*, e-mail.
   - **Tax & registration:** registered?*, then the number*.
     - IN adds GST type with ⓘ, then State, PAN and Business structure, **derived from the GSTIN**. They show a dashed "from GSTIN" / "F in the PAN" tag and have no ✎ (one owner). A company (C) also gets a CIN row.
     - AU: structure, then ACN if it is a company.
     - AE: legal form + trade licence no.
     - Then Registered name*.
   - **Licences:** only those the kind of business needs, plus the optional ones.
   - **Bank & payments:** a summary only. ✎ opens **CB Finance › Bank accounts** as a popup (the "from" line says whose screen it is).
   - **Who signs:** name, role, and a signature you sign.
   - **Export:** one line, "Only if you sell abroad · Turn on". The IEC and port rows exist only after it is turned on (R21).
   - The "later" cards stay closed until they are needed, as one line each: "Asked at your first bill · Fill now".
   - **Wrong tax number:** a red line at the top, "✕ GSTIN is wrong · **Fix**" (rule 2). The row stays open in red with the reason in plain words. For IN that is "Letter 6 (X) is not a holder type — P person · C company · F firm" (R7); AU and AE get their own wording. The sidebar shows a red "!".
4. **Print setup.**
   - "Always on a tax invoice": numbered Logo → Business name → Address → tax id (+ State for IN). These have no ticks and no arrows. One "Your business ›" link.
   - "Your choice": phone · registered name · e-mail · tagline · footer, each with a tick and ↑↓. The tick and the print always agree. "Regd. name:" is printed with its label, and only when it differs from the business name (R25).
   - Paper: 58 mm · 80 mm · A5 · A4 · A3 · Letter. A slip uses the mono slip layout. A-sizes use the wide layout with an HSN/SAC column and per-line tax.
   - **⤢ Preview** shows the whole bill as an overlay with no inner scroll. **⎙ Print** prints only the bill.
   - The sample follows the country and the kind of business:
     - IN: CGST/SGST halves per line, ₹136.50
     - AU: inclusive, "Total includes GST A$1.55", Card
     - AE: VAT 5% on top, Cash, series `C1/2026/…`
5. **Counters (optional).** A table of Counter · Device that holds it · Seen. "⬇ Install counter" is the browser's install prompt (R53), next to "+ Add a counter". A first visit shows one line: "No counters yet".
6. **Connectors.**
   - **On your PCs comes first** (R35): ● Running · PC · seen 1 min ago. A stopped one is amber and carries its fix ("How to restart").
   - Then a table of Connector · Status · 📄 Guide ⬇ Download.
   - The order follows the country. AU starts Xero · MYOB · QuickBooks, all marked "Coming soon".
   - No keys anywhere (R52). On a first visit the PCs block renders nothing (rule 1).
7. **Policy (optional).** A table of Rule · Now · Who may change it, with an ⓘ "Where it acts: …" on each rule.
   - ✎ turns *Now* into a dropdown on the row, which saves itself with "✓ Saved".
   - The columns can be adjusted: drag the header edge.
   - Search sits above the table.
   - Tax registration links to Your business instead of being edited here.
   - The dead rows (trade cover, chit expiry, sell/receive) are gone (R36/R37).
8. **Plan & usage.** A table of Limit · Allowed · Used. Usage is "US$0.00", with ⓘ "Billed in US dollars" (R41).
9. **Account.**
   - You: name, User ID 🔒 with ⓘ, e-mail, phone.
   - Then **Signed in on**: Device · Last seen, with **Sign out** on every row and "Sign out everywhere else" (R2/R43).
   - No keys and no vault.

## The rules every row follows (R10c, R17, R29, R48, R49)
- **Not answered:** the control sits inline (dropdown, chips or a box).
- **Answered:** the value + ✎ at the row's right end. ✕ puts it back as it was.
- **Saving:** each row saves itself (on change, Enter or **Save**) and shows "✓ Saved" for 2 s. There is no page Save.
- **Required vs optional:** a required row is label + `*`. An optional row is "(optional)" in its label, or in the page heading. An empty optional row is "— · + Add", not an open box.
- **Details** sit behind ⓘ only. No explanation lines.
- **Validation:** a tax number is checked when you leave the box (R49). A wrong one stays on its row in red, with the reason.
- **One owner per field:** the six questions and the seven cards write the **same** keys. Print setup only shows them. Bank belongs to Finance.

## Literature followed (the baseline), and what we add
- **Zoho Books, organisation profile:**
  - What we keep: one profile page (name, logo, industry, address, GSTIN, fiscal year), and GST settings with registration type.
  - What we add: the fields broken into seven small cards that are asked at the moment they are needed, and PAN, state and structure derived from the GSTIN rather than typed.
- **Tally Prime, company creation + F11 / GST details:**
  - What we keep: the field list (name, mailing name, address parts, state, PIN, FY start, books from, GSTIN, registration type).
  - What we add: no one long form, no Yes/No feature switches, and the state shown from the GSTIN.
- **Vyapar, business profile:**
  - What we keep: business type and business category as two pickers, the logo and signature on the same profile, and bill themes with a live preview.
  - What we add: the paper size and the kind of business redraw the sample, and Preview/Print test it on your own printer.
- **Shopify, store details:**
  - What we keep: an address with search and suggestions, and the legal name kept apart from the store name.
  - What we add: a map pin with country-shaped parts, and one condensed line on the page.
- **Things we add that none of them do:**
  - The "Set for you" table showing where each default came from.
  - Live connectors at the top.
  - Policy rules that say where they act.
  - Three countries from one screen.

## Anything else I'd change
1. **The sidebar is too long for a day-one owner.** Group it as Setup (Start, Country, Your business, Print), Running (Counters, Connectors), and Admin (Policy, Plan & usage, Account), with small group labels like CB Accounts' groups.
2. **The ✎ in a Policy cell sits just after the value, not at the far right.** In a table, the right end of the *row* is the ⓘ column. Owner to confirm.
3. **Address parts:** the country pack must declare them, including which are required. AE's Makani is optional here.
4. **Licence numbers have no validation in this mock.** FSSAI (14 digits) and Udyam (`UDYAM-XX-00-0000000`) should be checked on blur like the GSTIN.
5. **Composition (IN):** the sample should switch to **BILL OF SUPPLY** with no tax lines. It is not drawn here.
6. **Opening hours and website** (in R22's baseline) are not on a card yet. They would go in Contact & address as optional rows.

## For the build: the PROTOTYPE stand-ins and the new fields
- **Stand-ins for the engine:**
  - `checkTax()` in `app.js` stands in for the pack validators.
  - `derivedIN()` stands in for `engine/profilemap.js` (`panOfGstin`, and the state from the code).
  - The page must call the engine, not copy these.
- **Screen ids:** SET001–008 copy today's chips where I saw them; **SET010 (Start here) is new**.
- **New fields** (FIELDS.md first: look before you add): kind of business (Vertical), nature of business (multi), structure, CIN/ACN/trade licence, licence numbers, signature, address parts + lat/long, and the print choice order. `exportOn` gates the export rows.

## Screenshots (`png/`, 74, every one checked: `document.scrollWidth` = viewport width and the screen has no sideways scroll)
- **The nine main screens**, each at laptop 1366×768 in Cream, Dark and Terminal, at phone 390 in Cream (full height), and at laptop in Cream full height (`-full`):
  - `01-start` (first visit) · `02-country` · `03-business` (half done) · `04-print` · `05-counters` · `06-connectors` · `07-policy` · `08-plan` · `09-account`
- **Your business states:** `03-business-{first,all,wrong}-{laptop,phone}-cream`, plus `03-business-wrong-laptop-{dark,terminal}`
- **Start here:** `01-start-all-laptop-cream` (with Set for you open) · `01-start-half-phone-cream`
- **Australia and the UAE:** `10-{AU,AE}-{start-all,business-half,print-all,connectors-all}-laptop-cream` · `10-{AU,AE}-business-wrong-phone-cream`
- **Popups:** `11-pop-{map,bank,preview}-{laptop,phone}-cream` · `11-pop-bank-laptop-dark`
- **A4 bill:** `04-print-A4-{laptop,phone}-cream`
