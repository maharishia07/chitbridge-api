# Ledgers — redesign (CB Accounts › Reports › Ledgers · 2026-10-03)

Built against the frozen look: `docs/design/list-standard/index.html` + `SYSTEM.md` §2–3a. Open `index.html` in a browser.
> **Built 2026-10-03** (branch `cloud/ledgers-redesign`): see `BUILD-NOTES.md` for what was built, the API fields it lacks, and where the build differs.
> The purple "PROTOTYPE ONLY" strip that used to sit at the top of this prototype (states · themes · kural) was deleted — it was never to be built.
The real theme control is the avatar (all 16 themes, text size, weight, motion, fonts — unchanged from the standard).

## Files
| File | What it is |
|---|---|
| `index.html` | The page: title row across the top, then two panes — the ledger tree, and the list (tools + column header + rows). |
| `styles.css` | The standard's CSS **unchanged** (top half), then only what this page adds (marked `LEDGERS PAGE — NEW`). Tokens only. |
| `app.js` | `LEDGER_LIST()` = the CBList declaration for the selected ledger · the CBList shell and CBAvatar copied from the standard (in the product these are the shared mounts, not copies) · the ledger tree (new). |
| `data.js` | Sample data for Chola Auto Care, FY 2026-27 to 2 Oct, **shaped like the API**: every opening, closing, running balance, month/day total and the parties check is given. The page adds up nothing. |
| `shots/` | 72 screenshots: 11 states × laptop 1366×768 / phone 390×844 × Cream, Dark, Terminal, plus state 12, the kural meaning below (1080) and taking turns (phone). |

## The baseline, and what we add
Tally shows Ledger Vouchers as a report you reach through Display › Account Books, with Dr/Cr columns and the closing at the foot.
Zoho Books keeps the Chart of Accounts and an account's transactions on separate screens. ERPNext's General Ledger is a filter-first
report, with the account tree on another page. Vyapar gets closest for a shopkeeper: parties on the left, the chosen party's
entries on the right.
**We add:** Vyapar's two panes for *every* ledger (bands → groups → ledgers → parties), the CBList for the entries, one figures line
with the parties check in it, Dr/Cr everywhere, and on a phone the tree and the ledger as two pages (list → detail → back).

## The brief's seven findings — answered
1. **"Expense · Expense C2/26-27/0007."** The Details cell is the kind and the bill, once: `Expense C2/26-27/0007 11:44`. The
   entry number moved to ⚙ (a CA's field). The opened entry lists only facts no visible column already shows.
2. **The closing three times.** One line in the title row: `Opening ₹12,000.00 Cr · Closing ₹2,58,201.80 Cr · ✓ parties agree`.
   When they differ there is no green text. Instead an amber chip appears, `⚠ ₹500.00 Cr with no party · Show it ›`, which filters
   to the entry that has no party (rule 2). When opening = closing it reads `Balance ₹x Cr`, once. The open ledger shows no figure
   in the tree because the title row beside it already does.
3. **Minus signs.** Gone everywhere. Every amount is `₹x Dr` or `₹x Cr`: rows, balances, month rows, tree and title. Zero is `—`
   in the tree and `₹0.00` in the title.
4. **The opened entry cut off.** It opens in place under its row as the standard's journal block (`Code · Ledger | Debit | Credit`).
   The ledger you are in is bold. One flexible column means the list never scrolls sideways (checked at 1366 and 390 in every
   state). On a phone the block sits under the card, and the figures take only the room they need.
5. **The party repeated.** On a party's ledger the Party column does not exist. The party is dropped from the journal lines and
   from the facts line. It appears once, in the title.
6. **Date boxes + Show.** Replaced by the standard period chip (Today · This month · This FY · Custom; it applies on pick). On a
   phone the chip shows the preset's name (`This FY ▾`) to save a line, and the dates are its accessible label.
7. **The left tree.** The bands are People · Things you hold · Income and expenses · Your capital, then groups, ledgers and
   parties.
   - One line per node in the shopkeeper's words ("Paid ahead to suppliers", "Kept profit"). Codes stay out unless you type one
     ("6010" finds Rent).
   - A long name wraps; it is never clipped. Parties also use a short display name (see change 1 below).
   - Amounts sit in one fixed column, so they line up. Group rows show a count in the same column.
   - Selection is a 3 px bar and a light tint, not a filled block.
   - "Find a ledger or party" filters as you type and highlights the match. A ✓ beside a party means it agreed its figures last
     month end.
   - Keyboard: ↑ ↓ move, → opens or steps in, ← closes or steps out, Enter opens, Home and End jump. There is one tab stop.
   - The pane can be dragged or resized with ← →, and folds to a `☰ Ledgers` button. Width, folds and choice are remembered.
   - **Phone:** the tree is page one (`Ledger`, with the period chip and avatar); tapping a ledger or party opens page two, and
     `‹` comes back. There is no squeezed side panel.

The monthly agreement ("coming") is drawn already. On a party's ledger, a green line `✓ Agreed up to 31 Aug 2026` sits between
the last agreed entry and the next one.

## The kural footer — a proposed decision (DEC-?), for Athi
The look is frozen, so adding the kural is a decision, not a build choice. It is built phone first and breaks no frozen rule:
it sits **outside the head**, so the head is still 19% / 27%. It uses tokens only, there is one per screen, it never sits beside
a warning, and the shopkeeper can put it away.

**Where:** one band at the foot of every page, every size, full width, in thumb reach on a phone. The rows fill what is left
above it ("only the rows scroll" is unchanged). It is never in the head, beside a notice, inside an opened entry, or in a dialog.

**How the meaning appears — by the space there is**
| Width | Verse and meaning |
|---|---|
| Wide laptop (> 1100 px of page) | Side by side, centred: the Tamil verse, a hairline, the English meaning |
| Narrow laptop / tablet (641–1100) | The meaning sits **below** the verse, centred |
| Phone (≤ 640) | They **take turns** in the same place every 7 s; a tap switches. With Less motion (the avatar, or the device setting) it changes only on tap. Both lines share one grid cell, so the band never jumps. |

Tamil first: the verse leads and the meaning is quieter. English first: the meaning leads and the verse is quieter. The Tamil
verse always shows (in the phone's turn-taking it is one of the two). In the product this follows the app language in Settings;
the purple strip only fakes it.

**Which kural** (the API gives `ledger.kural`; the page does not choose). The phone's tree page carries the page's own (120).
| Ledgers | Kural | Why it fits |
|---|---|---|
| People (customers, suppliers, their parties) · Stock & advances | 120 வாணிகம் செய்வார்க்கு… | deal with others' interests as your own |
| Cash & bank | 520 நாடோறும் நாடுக… | check every day |
| GST, TDS | 733 பொறையொருங்கு… | pay dues fully and willingly |
| Suspense | 436 தன்குற்றம் நீக்கி… | fix your own errors first |
| Income and expenses | 754 அறனீனும் இன்பமும்… | honest profit |
| Your capital | 385 இயற்றலும் ஈட்டலும்… | earn, gather, protect, share |
Candidates not yet wired in: Bank and Bank (reconcile) → 118 (the even scale); UPI and card settlements → 690 (the faithful
envoy); Loans / cash flow → 215 (the village tank).

**How it looks**
- A palm leaf in tokens only: the theme's `--panel` with `--hair` fibre lines, a `--line` top edge, the Valluvar seal in
  `--muted`. It is right in all 16 themes.
- It is never amber (amber means "needs a hand"), never blue (blue is a link), and has no italic.
- The verse is in Noto Serif Tamil (a font to add to the standard). A line breaks only at its middle, with a hanging indent;
  the browser never breaks a couplet at random.
- ✕ hides it until tomorrow. It comes back as one small `குறள் 120 ›` line. The owner's off switch belongs in Settings, in the
  app, not in the avatar, because the avatar menu is frozen.

**What we tried first, and why the footer won:** the right of the title row looks fine on a wide laptop, but at 1366 it fits only
on quiet ledgers, and on a phone never. The foot of the tree pane worked on a laptop only. The footer is the one place that is
the same on a phone and a laptop.

**To decide:** (1) a kural on CB list pages at all; (2) the footer as its one place, on every page; (3) adding Noto Serif Tamil
to the fonts. If yes, it goes into SYSTEM.md beside §3a as `CBKural`, one mount like `CBAvatar`, and every page gets it the
same way.

## The list (a CBList declaration)
- **Default columns:** control account = Date · Party · Details, plus Amount; any other ledger = Date · Details · Balance, plus
  Amount.
- **Kept in ⚙:** Balance (on control accounts), Entry no., Tender, Counter, Rung by.
- **Grouping:** Month · Day · None, oldest first by default (a ledger reads down with its running balance; the ▲▼ on Date reverses it, and ▲ is then true). Each month and day
  row shows its count and its Dr/Cr totals from the data. While a search or filter is on, a group row shows only "n shown",
  because the page will not total a subset itself.
- **Everything else is the standard's:** ⇣/⇡, ▤ grid / ☰ lines, adjustable columns (drag, arrows, double-click resets), ⬇ CSV,
  the count, filters as one popover with removable chips, and the empty / no match / could not load states.

## Checks run on this build (the SYSTEM.md §4 harness, in Playwright, against the sample data)
- **No sideways scroll:** `document.scrollWidth` = 1366 / 390 and no overflow in the list or tree, in all 54 shots.
- **Head:**
  - Laptop: 19% everywhere (14% on an empty period). Limit 20%.
  - Phone: 13% on the tree page, 27–29% on a ledger, 32% only when a failing notice earns its row (Customers). Limit 30%.
  - The kural footer changes none of these, because it is outside the head.
  - For comparison, the standard's own Day book measures 39% on a phone in the same harness.
- **Contrast:** WCAG AA on every visible text/background pair, in Cream, Dark and Terminal (control account and an opened entry),
  kural included.
- **Copy:** "accounting" and "books of account" are absent; there is no `alert()`. Every warning carries its fix.
- **Syntax:** `node --check app.js` passes.
- **Fonts:** the screenshots use the real Bricolage Grotesque, IBM Plex Sans, Plex Mono and Noto Serif Tamil, loaded locally for
  the harness.

## What the API must give (the page paints, it never computes)
- **Per ledger:** code · official name · **short name** · nature · band · group · whether it is a control account and its parties.
- **Per ledger and party, per period:** opening, closing (`[paise, "Dr"|"Cr"]`), entry count, month totals and day totals.
- **Per entry:** date · time · entry no. · kind · bill · tender · counter · rung by · party · journal lines · gist. For each
  ledger and party it touches: the amount and the **running balance after it**.
- **Per ledger:** `kural` (its number), and the verses used: Tamil lines + English meaning.
- **Per control account, per period:** the parties check — `agree`, or `differ` with the amount and the number of entries that
  have no party.
- **Per party:** `agreedTo` (the last month end both sides agreed).

## Anything else I'd change
1. **Narrow laptops (1024–1200):** no sideways scroll (checked at 1080), but the tools row wraps, so the head is 22–27% there.
   Below ~1200 I'd open with the tree folded (`☰ Ledgers`) and let one tap bring it back.
2. **A short display name on every party and ledger** (≤ 24 letters, set once in Parties). It is what fixes the four-line wrap
   for good. The full legal name stays on bills and in CB CRM.
3. **Block an entry on a control account without a party**, at ＋ Entry. Today's "₹500.00 Cr with no party" comes from a cash
   receipt with no name taken. The To-do home should carry the same check ("1 receipt has no party › Fix").
4. **Turn the agreement line into a habit:** at month end, a To-do row "3 suppliers not agreed for September › Send statements",
   and a party's ✓ in the tree when it is done.
5. **Statement from the party's ledger:** an action in the opened-entry bar and the ⬇ menu that sends the period's statement on
   WhatsApp. It is the natural next step after "agree".
6. **Remember the last ledger per person**, so the page opens where they left it. It already does on one device; it needs to
   follow the person.
7. **Day book and Ledgers share the same shell:** Day book = all entries, Ledgers = the entries touching one ledger. The same
   opened-entry block, so a shopkeeper learns it once.
