# Paste this to the CLI

```
Rebuild the "Why is a bill stuck?" panel.

Read every file in design-handoff/stuck-bill/ first — README-STUCK-BILL.md,
stuck-bill-spec.md, and png/StuckBill.png — before writing any code.

OLD SCREEN
  Title asks "Why is a bill stuck?" and then does not answer it.
  A key-value dump of 15 rows, 180 words.
  The actual answer — "The shop refused this counter's key (401) … pair this counter
  again" — is row fourteen, set in the same type as "Rows tried: 1".
  "↻ Try now" is the biggest button and cannot work: the key was refused 13 seconds ago.
  A 36-character database id, an HTTP status code, and four rows saying things are fine.
  Forty words explaining "set aside", printed before anyone presses it.
  Never says what the stuck bill is worth.

NEW SCREEN — in this order, 44 words
  1. VERDICT, as the headline, with an icon:
     "The shop does not accept this counter's key"
     "Pair it again and the bill goes. Nothing is lost."
  2. THE FIX as the primary button: [ Pair this counter again ]
     Try now stays visible, greyed: "will fail again until it is paired"
  3. THREE NUMBERS, large, mono:  1 bill waiting · ₹40 held here · 2m oldest
  4. ONE GREEN LINE: "Selling, printing and taking money are not affected."
  5. FOLDED ROWS:
       What was tried          13s ago · 1 row · 0 sent
       The bill                C1/26264/0001 · ₹40 · 2:14 pm
       Show technical detail   support code CB-7K2
  Footer: "today · on this counter" and Close · Esc. Day close leaves this panel.

DIRECTIVES
  1. The verdict is the headline. If the screen knows the cause, the cause is first.
  2. One cause, one button, and the button is the fix — never a retry that cannot work.
  3. An action that will fail stays visible and says why. Do not hide it.
  4. Everything that is fine collapses into one green line. Only a failing thing earns a row.
  5. Large numbers a shopkeeper cares about: how many, how much, how old. Not "rows tried".
  6. No ids, no HTTP codes, no field names on first view — all behind the support code.
  7. A button's explanation belongs on its confirm, never standing above it.
  8. Red only for a stopped sale or work at risk. Here, only "no space" earns it.
  9. Under 50 words on first view. Count them and tell me the number.

DO THIS FIRST, BEFORE ANY CODE
  Show me every cause this panel can currently detect and what it renders for each.
  Then show me the verdict table Counter health already uses. I want ONE table serving
  both screens — propose the merge, adding `key refused` and `clock wrong`, and wait
  for my approval.

THEN
  Rebuild per spec §2, move set-aside's explanation onto its confirm, run the
  acceptance checks in §8, and show me the panel for all six verdicts plus the
  first-view word count.
```

---

**What is in this folder**

| File | What it is |
|---|---|
| `INSTRUCTION.md` | this — the paste-ready prompt |
| `README-STUCK-BILL.md` | the read order and the five changes in order of value |
| `stuck-bill-spec.md` | the full spec: screen order, verdict table, wording, data, acceptance checks |
| `png/StuckBill.png` | **the design.** Today's panel with its nine problems, the rebuilt panel, the verdict table, and every word that was cut |
| `source/StuckBill.dc.html` | exact colours, sizes and copy. Reference only — never ship it |

The counter-health verdict table the instruction refers to is in the full package
(`A-screens/03-counter-health/counter-health-spec.md` §5). If the CLI does not have that,
give it the counter-health folder too, or let it propose the merged table from scratch.
