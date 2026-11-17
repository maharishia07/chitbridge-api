# Phone till: never lose the person or the bill (Athi's phone test, 2026-10-04)

Athi tested `public/till.html` on an Android phone (Chrome), signed in as a shop, and rang two cash bills. Three things went wrong. This task fixes all three. **It is not a redesign.** The icon-only phone face is a separate designer job, so don't restyle the screen. Fix behaviour and words only.

## 1 · Back must never leave the till (backlog T66)
**Seen:** select a product, then press the phone's own Back button. The browser leaves the till page. There is also no on-screen Back on the sheets.

**Want:**
- Every step that opens over the selling screen pushes one history entry. This covers the product sheet, the bill, pay, the receipt, Today's bills and maintenance. The system Back (`popstate`) then closes **that step only**.
- A visible **‹ Back** on each of those sheets does the same thing.
- If a bill has lines on it and Back would leave the page, a confirm step asks first: "Leave the counter? The bill in hand stays on this device."
- The page never unloads on Back while a bill is open.

## 2 · After paying, the receipt is shareable and findable (backlog T67)
**Seen:** after Pay, the bill appeared with no print or share option. Pay then went grey, and the receipt couldn't be found again. It was in fact under Today's bills › view.

**Want:**
- **On the receipt:** a **Share** action using `navigator.share` with the bill as text plus its link. If that isn't available, offer WhatsApp (`https://wa.me/?text=…`), SMS (`sms:?body=…`) and Copy.
- **Print** shows only when a printer is configured, as on the PC.
- **After the receipt closes:** the main screen shows **"Last bill C1/26-27/00xx · ₹…  ›"**, which reopens it. This is the same view Today's bills › view opens; use that, not a copy.
- **Never a grey Pay with no reason.** When the bill is empty, the bill area says "Paid — start the next bill" and names the last bill number.

## 3 · Today's bills, in plain words (backlog T69)
- **The hour group** "20:00 · 2 bills ₹460" becomes "8 pm – 9 pm · 2 bills · ₹460". Use the shop's locale time format.
- **"All 2 bill(s) have reached the shop"** becomes "Both bills reached the shop" for 2, "The bill reached the shop" for 1, and "All N bills reached the shop" for more. Never "(s)".
- **The buttons** "Day close sheet" and "Close" become "Close the day" and "✕".

## Rules (read before coding)
- **One file owns the till:** `public/till.html`. Reuse its own functions: `flash`, `sure`, the Today view, the receipt view. No second receipt view, and no new global if an existing one serves.
- **The counter gates must still pass.** In the API repo, `tests/counter-gates.test.cjs` fails if anything other than `becomeShop()` writes the key; don't touch key handling.
- **Words follow the copy budget:** short, plain, no jargon. A symbol plus a word, never colour alone.
- **Give this change a new `CB_BUILD` letter.** The last used was `2026-10-03p`; use the next free letter and keep the previous notes.

## Proof (all must exit 0)
- Extend `e2e/phone-signin.cjs`, or add `e2e/phone-till.cjs` in the same pattern (stand-in API inside the page, 390×844 phone, taps):
  1. Pick a product, then `page.goBack()`. Still on `till.html`, the product sheet is closed, and the bill keeps its line.
  2. Pay cash. The receipt shows a **Share** control. Close it. **"Last bill …"** is on the main screen and reopens the same bill.
  3. Today's bills shows "8 pm – 9 pm …"-style hour labels and no "(s)".
- `node e2e/phone-signin.cjs` must still say `✓ all good`.
- Screenshots go to `e2e/shots/phone-till-*.png`.

## Do not touch
`chitbridge-api`, migrations, `tools/`, CB Accounts / CRM pages, the sign-in/enrol code (`usign*`, `becomeShop`, `enrolBrowser`), or the selling-screen layout (T68/T70 are for the designer).

Open a PR to `main` titled **"Phone till: never lose the person or the bill"**, and list in it what was proven.
