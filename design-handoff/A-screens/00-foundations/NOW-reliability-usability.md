# NOW: reliability and usability as the core

Everything else is in `BACKLOG.md`. This is the only work in flight. Two promises, in this order:

> **Reliability:** a bill is never lost, a total is never wrong, and the counter never stops selling.
> **Usability:** a new cashier bills their first order without being taught, on any device, in their own language.

If a proposed change does not serve one of those two, it waits.

---

## Part 1 · Reliability

### R1. A bill can never be lost
- Save the working bill to local storage **after every change** (line added, qty changed, tender picked), not on a timer.
- On start-up, if an unfinished bill exists: "You had a bill open with 3 items — continue or clear?" Never silently discard.
- Parked bills and the sold-out list survive a reload, a crash, a power cut and a browser update.
- The day's bills are kept locally until the server has acknowledged each one, then kept for the retention period from the pack.

**Test:** kill the tab/app at 20 random points during a bill; after restart the bill is intact every time.

### R2. Offline is a normal state, not an error
- Every action the spec marks offline-capable works with the network off: billing, printing, park, day totals, sold-out, sign-in (cached PIN hash).
- Queue with a visible count and three states per bill: **saved here · sent · confirmed**.
- Retry with backoff (2s → 4s → … → 5 min), forever, resuming after restart.
- Every write carries an **idempotency key**; the server dedupes; a retry can never double a bill.
- Bill numbers are minted locally per counter and series, so being offline never changes a number.
- "Why is a bill stuck?" shows the real reason in plain words and a single action: retry now.

**Test:** airplane mode for 2 hours of billing, 40 bills, then reconnect: 40 bills arrive, none duplicated, numbers unchanged.

### R3. Money is always right
- One money module: integer minor units, no floats; rounding rules from the pack; tax computed once and stored with the line.
- Totals recomputed from lines on every render; if a stored total and the computed total ever differ, the bill is flagged, not printed.
- Golden tests, including your reference basket: 5 × ₹64 + 5 × ₹163 + 5 × ₹352 = ₹2,895.00, saved ₹144.75, **total ₹2,750.25**.
- Price changed mid-bill: the line keeps the price it was added at, and a quiet note says the catalogue moved.
- Clock skew: the counter uses server time for sequencing (`/time` at start-up plus drift correction), so a wrong device clock cannot misdate bills.

**Test:** property tests on 10,000 random baskets against a reference implementation; zero mismatches.

### R4. The device fights back
- **Storage full:** detect the quota before it bites, warn at 80%, free old confirmed bills first, never fail a save silently.
- **Corrupt cache:** a start-up self-check repairs or rebuilds the local catalogue and tells the user in one line.
- **Safe mode:** if the app crashes twice in a row, start in a minimal sell screen (no photos, no animation) that can still bill and sync.
- **Update safety:** a new version never reloads mid-bill; it waits for an idle counter, or asks. A bad update can be rolled back from the hub.
- **Battery:** at 15%, "finish this bill, everything is saved"; at 5%, park automatically.
- **Printer gone:** fall back to the browser print dialog or the QR receipt, and keep selling. Printer state is a chip, not a modal.

**Test:** run with storage filled to 95%, with a corrupted cache entry, and with the printer unplugged mid-print; the counter keeps selling in all three.

### R5. Nothing dangerous happens by accident
- Void, refund, clear, close counter, clear-and-reload: each confirms, each records who and why (reason list from the pack).
- Sign-in (PIN) before anything that moves money or closes the day. Locking the screen never loses the open bill.
- A single **health pill** in the header: green when online, sent, printer ready; amber/red with the reason, tapping through to Alerts.

### R6. We can see what went wrong
- A local diagnostics log (ring buffer, ~500 events, no customer data) with an "export for support" button in the hub.
- Crash reports with the last 20 actions, batched with the next sync.
- Four numbers reported per counter per day: bills, queue max depth, sync failures, crashes.

### Reliability SLOs (measured, not hoped)
| Metric | Target |
|---|---|
| Bills lost | **0** |
| Bills duplicated at the server | **0** |
| Crash-free sessions | ≥ 99.5% |
| Bill saved locally | < 50 ms |
| Sync success within 24 h of reconnect | 100% |
| Wrong totals in the golden + property suite | 0 |
| Recovery after force-kill | < 3 s to the same bill |

---

## Part 2 · Usability

### U1. Speed the cashier can feel
| Action | Target |
|---|---|
| Cold start to a usable sell screen (Android Go, 3G) | < 2.5 s |
| Key press → line in the bill | < 100 ms |
| Search keystroke → results | < 150 ms |
| Three items billed and paid, trained cashier | < 12 s |
| Menu/hub open | < 150 ms |

### U2. Trained by the screen, not by a manual
- Every screen states where you are and what to do next in plain words.
- One primary action per screen, always in the same place (bottom on phones, panel footer on terminals).
- The five states every screen must have: **loading · empty · error · offline · no permission** — each with a next step. This is part of "done".
- Errors say what happened, what it means for the bill, and the one thing to try: "The printer did not answer. The bill is saved. Print again, or send the QR."

### U3. Correcting a mistake is as fast as making one
- Change qty, remove a line, undo the last action, un-hide a sold-out key: each one tap or one key, no dialog.
- **Undo** for the last destructive action within 10 seconds (removed line, cleared bill).
- Wrong tender picked: switch without restarting the bill.

### U4. Any hand, any eye, any language
- Targets ≥ 44 px (48 px on phones), rows ≥ 56 px; left-hand mirror; text size and theme per device.
- Contrast ≥ 4.5:1 everywhere, checked in CI; state never shown by colour alone (the on/off switches learned this).
- Keyboard parity: every action reachable by key where a keyboard exists; visible focus ring; F-keys unchanged across layouts.
- Screen-reader labels on every control; the bill table readable row by row.
- All copy through one string file, ready for the local language, with numerals from the pack.

### U5. One shape, every device
- Mobile-first, per `mobile-first-instructions.md`: nothing dropped at a smaller size, order never changes, the layout follows the container.
- Same wording and same order on phone, tablet, terminal and handheld.

### U6. Honest interface
- Show the state of the world, not a guess: "prices as at 12:28", "everything has reached ChitBridge", "no GSTIN, so no GST is charged".
- No spinner without a sentence. No success message for something that only got queued — say "saved here, will send".

### Usability checks (each release)
- A cashier who has never seen the app bills three items and takes cash, unaided, in under a minute.
- The same task on a 5-inch phone, a tablet and the terminal, with no new instructions.
- 11 screen sizes render with no clipping and no horizontal scroll (the matrix in `mobile-first-instructions.md`).
- Contrast, focus order and labels pass automated checks in CI; zero criticals.
- All five states exist for every screen in `status.json`.

---

## Part 3 · How we work while this is the core

**Definition of done, per screen:** works offline where the spec says so · saves after every change · five states · plain-language errors · 44/56 px targets · contrast passes · keyboard parity · strings externalised · renders on all 11 sizes · a Playwright test and a screenshot in `png/` · `status.json` updated.

**Build order**
1. **R1–R3** (never lose a bill, offline as normal, money always right) — nothing else ships before these.
2. **R4–R6** plus the health pill and diagnostics.
3. **U1–U3** on the sell screen only, measured.
4. Sign-in with PIN (the part of C1 that reliability needs) and till open/close with cash count.
5. The **hub** (E6), because it is where reliability becomes visible to the cashier.
6. Then the devices from `BACKLOG.md` E3, one per pass.

**Weekly rhythm:** run the chaos suite (kill, offline, full storage, dead printer, bad clock), publish the seven reliability numbers and the five usability timings, and put both on the workstream board next to "designed / built".

**A change is rejected if** it adds a feature while any SLO is red, it introduces a state without loading/empty/error/offline/no-permission, or it makes the sell screen slower than U1.
