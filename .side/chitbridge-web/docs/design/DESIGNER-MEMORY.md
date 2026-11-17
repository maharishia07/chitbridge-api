# ChitBridge — what the designer always keeps in mind (paste into the designer's memory; updated 2026-10-03)

**Who:** a shopkeeper at a counter, often on a phone, often unable or unwilling to read a paragraph. A symbol, a digit or a colour
beats a sentence. Every screen says what happened · what it means · what to do, in the fewest words. Never "accounting" or "books
of account": it is the **Ledger**. Write for the shopkeeper, not the system (no ids, no codes unless a CA needs them).

**The look is FROZEN (2026-10-02).** Pass mark: `docs/design/list-standard/index.html` + `docs/design/SYSTEM.md` §2–3a.
- Tokens fixed (SYSTEM.md §2); Bricolage Grotesque for display, IBM Plex Sans for UI, IBM Plex Mono with tabular figures for every
  number. Must work in all 16 themes (Cream default, Dark, Terminal, High contrast …), so use tokens only, never raw colours.
- **Every list** = the one list control (CBList): a three-row head ≤ 20% of the window (title row with a period chip + notice chips ·
  one tools row: search, Filters ▾, grouping, ⇣/⇡, ▤ grid / ☰ lines, ⚙ columns, ⬇, count · the column header); adjustable columns;
  only the rows scroll; shows its top 3 columns, the rest chosen in ⚙.
- **One avatar** everywhere, the simple menu: no explanatory text; themes as dots; text size as four growing A's (92/100/115/132%);
  Normal/Bold; Less motion; five reading fonts shown in their own face. Settings only inside the app.
- **One detail page** for any record; only its bottom action bar differs per place.
- CB Accounts layout: the To-do home + six sidebar groups (`docs/design/cb-accounts-ia`).

**Interface rules (each has been broken before):**
1. Only a failing thing earns a row; all fine = one line.  2. Every warning carries the button that fixes it.
3. The same string never twice on one screen ("Expense · Expense" is a bug).  4. Never show a raw error message.
5. Truncation is a bug: shorten the words, never widen or clip; no sideways scroll; no mid-word breaks.
6. One value, one control.  7. Lists show three columns; the rest are kept, not deleted.
8. Phone first: 390 px, 16 px gutter, one card per row below 620 px.  9. More panes, not denser.
10. The page paints, it never computes money: every figure is read from the frozen bill / the API. Dr/Cr notation, never minus.

**Process:** start from how Tally / Zoho / Vyapar / ERPNext do it (the literature is the baseline), say what we add. Return the
handoff shape: index.html · styles.css · app.js · data.js · README.md, every state at 1366×768 and 390 px, in Cream, Dark and
Terminal, plus "anything else you'd change". Mark demo switches `PROTOTYPE ONLY — DO NOT BUILD`.
