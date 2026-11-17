# Standards — made simple (Index › Standards · 2026-10-03)

Built against the frozen look: `docs/design/list-standard/index.html` + `SYSTEM.md` §2–3a + DESIGNER-MEMORY.md. Open
`index.html`. The purple strip is **PROTOTYPE ONLY — DO NOT BUILD**: it jumps to each state and switches Cream / Dark /
Terminal. The real theme control is the avatar.

## Files
| File | What it is |
|---|---|
| `index.html` | The index page with the Standards door (`?jump=9`), and the Standards page: title row, then the matrix pane beside the list. |
| `styles.css` | The standard's CSS **unchanged** (top), then this page's additions (marked `STANDARDS PAGE — NEW`), then the proposed kural footer, the same as Ledgers. Tokens only. |
| `app.js` | `STANDARDS_LIST()` = the CBList declaration · the CBList shell and CBAvatar from the standard · the matrix · the two sheets · the door. |
| `data.js` | DERIVED (STDREG1, 14 Oct 2026): builds `STD_PAGE` from the register itself (`public/app/cap-standards.js`, loaded by `index.html`); it holds no rows. The fields this design proposed are register fields now. |
| `shots/` | 60 screenshots: 10 states × laptop 1366×768 / phone 390×844 × Cream, Dark, Terminal. |

## The baseline, and what we add
- **Trust centres** (Stripe, Atlassian, Zoho) list their certifications as logos with a status. They are good for a buyer
  scanning, but say nothing about what is missing, and nothing to a shopkeeper.
- **ERP compliance pages** (Tally, ERPNext) state statute support in prose.
- **A CA's working papers** cite the act, section and rule.

**We add three things.** The plain-words line comes first. The CA's reference (the act and section, or the ISO number) sits
beside it. The honest status sits on every row, and every Partly and Planned row says **what is missing in the row itself**,
not one tap away. Then there is one matrix that answers "how much of this is real?" at a glance, for any slicing.

## The arrangement — why a list with a matrix beside it
**The list (a CBList).** It is searchable, sortable and groupable, and it shows three columns, as the standard allows.

| Column | For | Example |
|---|---|---|
| **What it does for you** | the shop | "Input credit claimed only when your supplier has filed", with **Missing: Matching built; its screen comes next** under it |
| **Reference** | the buyer / CA | `CGST Act s.16(2)(aa) + GSTR-2B` · **LAW** |
| **Applies in** | going global | India · Global · India and global |
| *(the amount slot)* **Status** | both | ● In force · ◐ Partly · ○ Planned. Symbol, word and colour together, never colour alone. |

- **Kept in ⚙:** Area · Where in the app · Clause or example.
- **Group by:** Area · Country · Kind · None.
- **Filters:** Status · Area · Kind · Applies in.
- **Search** covers every field, including what is missing and the equivalent abroad.

**The matrix (a second pane, as the tree is on Ledgers).** The rows are chosen with **Count by: Area · Country · Kind**, and
the columns are In force · Partly · Planned. This one control answers each of these questions:
- global vs local → Country
- law vs standard vs practice → Kind
- which part of my business → Area

A cell **is** the list's filter: tap "Money & GST × Partly" and the list shows those 3 rows, with one chip that clears it. A
row heading filters the row, and a column heading filters the status. A cell with nothing in it shows "—" and does nothing.
The **All** row carries the totals (33 · 16 · 12). They are said once, so the title row says only "checked 3 Oct 2026"
(rule 3).

**Kind** separates what a shopkeeper **must** do from what we chose:
- **Law:** you must.
- **Standard:** agreed worldwide.
- **Practice:** the common way.

**Applies in** is a list of country codes per row (ISO 3166: `IN`, plus `GLOBAL`). When the UAE arrives, its rows get `AE` and
the matrix gains a row. Nothing else changes. The opened row's **Elsewhere** line already gives the equivalent abroad where
there is one (IAS 2, IAS 16, ISA 505, GDPR, PEPPOL), so a buyer from outside India can read an Indian law in their own terms.

**Opening a row** gives, as label : value, never sideways:
- Covers
- Kind
- Clause or example (with the register's own explanation)
- What is missing, in full
- Elsewhere
- In the app
- Why it matters
- Source: *in the register*, or *New: adopted 2–3 Oct 2026, not yet in the register*

It has two buttons: **Open in the app ›** (`stdGoto`) and **Copy for a buyer or CA** (the standard, clause, status and what is
missing, ready to paste).

**Two sheets**, at the foot of the matrix, use the register's own words, rendered once:
- **Why follow standards:** what it buys · what it costs · what it has actually caught here.
- **One record, every standard:** the pepper chit. Planned fields are dimmed with the theme's muted ink, not with opacity, so
  the contrast check can measure them. They are shown, not hidden.

On a laptop these open as a side sheet; on a phone they fill the screen.

**Phone.** The matrix is page one and the list is page two (‹ back), the same as Ledgers. The cards read: plain words + missing ·
Reference · Applies in · status.

## The Standards door (for the index page)
One box carries a live fact (rule 11):
- `Standards ›`
- ● 33 in force · ◐ 16 partly · ○ 12 planned
- "The laws and standards we follow — and what is still missing."
- Checked 3 Oct 2026 · **Read me** (opens *Why follow standards*)

The whole box opens the matrix. **The index page itself was not in the pack**, so the RAIL box and the other boxes are dashed
placeholders. Drop `doorHTML()` and the `.door` styles into the decided layout. **Settings › Standards** keeps only what
edits; reading moves here.

## The content — what changed in the register
- **44 → 61 rows.** The 17 recent additions are in, with their stated statuses: 11 in force, 4 partly, 2 planned. **Totals: 33
  in force · 16 partly · 12 planned.**
- **No duplicate.** The WCAG contrast addition is the same standard as the existing WCAG 2.2 1.4.3/1.4.6 row, so it updates
  that row's note ("all 16 themes"). It does not add a second row.
- **In force, with a stated limit.** Three additions are In force with a stated limit, and the limit shows in the row as
  *Limit:*. Nothing was upgraded or downgraded:
  - Schedule III, company format only
  - AS 2, manual count
  - Reverse charge, engine first
- **Every Partly and Planned row has a short "Missing" line.** The build asserts it. The long `note` stays for the opened row.
- **Five new fields per row**, proposed for `cap-standards.js`:
  - `a` area (Selling · Buying · Money & GST · Books · People & privacy · Look & access · How we build)
  - `k` kind
  - `c` applies in
  - `p` the plain-words line
  - `m` the short missing line

  Optional fields: `limit` and `eq` (the equivalent abroad). The plain-words lines are mine. **Please check them**, especially
  the GST and Books rows, before they become the register's words.
- **Area placements that are judgement calls:**
  - PostgreSQL RLS → People & privacy ("another business can never read your records"), because to a shop it is privacy, not
    platform
  - HS codes → Selling (export)
  - e-invoice / e-way bill → Money & GST

## Checks run (Playwright harness, sample data)
- **No sideways scroll:** none at 390 or 1366 in any of the 60 shots, and none at 1080 (checked in Terminal, the widest font).
- **Head on laptop:** 19%.
  - With a matrix cell chosen, it is 19% in Cream and Dark, because the one chip fits on the tools line.
  - In **Terminal** it is 23%: the monospace font pushes the chip onto a second line.
- **Head on phone:** 7% on the matrix page, 23–26% on the list.
- **Contrast:** WCAG AA on every visible text/background pair, in all three themes: the list, an opened row, the record sheet
  and the door.
- **Copy:** no "accounting" or "books of account", no `alert()`. `node --check app.js` passes.
- **Fonts:** the screenshots use the real fonts, loaded locally.

## Anything else I'd change
1. **Put `checked` on every row.** The date a status was last verified, by whom, and how ("theme-contrast test", "Athi, by
   hand"). The page's single date would then become the oldest of them. A buyer trusts a dated claim more than an undated
   one.
2. **Make the status machine-read where it can be.** The WCAG row is already driven by a test. Let other rows point at their
   test (`e2e/…`) so In force cannot drift from the truth silently. A failing test would turn the row amber by itself.
3. **"Copy for a buyer or CA" → one PDF.** Export the filtered matrix and rows as a one-page statement ("Standards in force at
   Chola Auto Care, 3 Oct 2026"). It is the document a buyer's procurement team actually asks for.
4. **Go-global readiness as a matrix view.** With `c` in place, Count by Country for a target country (say, UAE) shows what
   carries over (Global rows), what has an equivalent (`eq`) and what needs local work: a gap list for market entry, for free.
5. **Terminal at 1366:** if Athi wants the 20% head there too with a cell chosen, let the group control collapse to one
   "Group ▾" menu on narrow tools rows. That is a change to the frozen tools row, so it is his call.
6. **Narrow laptops (1024–1200):** there is no sideways scroll, but the tools row wraps (head 24%). This is the same as Ledgers,
   and the same fix applies: open with the matrix folded below about 1200 px.
