# Counter health — spec

Replaces the diagnostics page that currently lists rows like *Paired key · NO — nothing can be sent* / *Rows tried 10 · Rows sent 0*.

Designs: `png/HealthWide.png`, `png/HealthDetail.png`, `png/HealthPhone.png`.
Source: `source/Health*.dc.html` — reference only, never ship.

---

## 1. What is wrong with the page today

| Today | Why it hurts |
|---|---|
| Twelve rows of equal weight | The one sentence that matters — *this counter was never paired* — is a row among twelve. |
| No verdict | The shopkeeper has to work out from the rows whether this is serious. It is. |
| No action | It states a broken state and offers no way to fix it. There is no Pair button on the page that says pairing is missing. |
| Numbers contradict each other | *Bills stored 0*, *Queued to send 0*, then *Rows tried 10, Rows sent 0*, then "still has 10 to send". All true, none reconciled. |
| Jargon | "Paired key", "rows", "local database", "What the shop said", "Full speed". |
| The support code is decoration | Small grey text, top-right, no label, no copy, no way to send anything with it. |
| No time anchors | "7s ago" with no clock time, no history, no idea whether this has been failing for minutes or days. |
| "Line / Full speed" dropdown | Unexplained control on a page about failure. |

**Rule for the rebuild: a diagnostics page answers three questions, in this order — is something wrong, is anything lost, what do I do now.** Numbers come after that, not before.

---

## 2. The page (`HealthWide`)

**Header** — "Counter health", then *Counter 1 · Mayur Bhavan · checked 7 seconds ago*, with **Check again** and Close.

**The verdict banner**, danger tint, one sentence in display type:

> **Nothing can reach the shop from this counter**
> This counter has never been paired with a shop, so the shop turns away everything it sends. **Nothing is lost** — 10 things are waiting here and will go the moment it is paired. Selling and printing keep working meanwhile.

Beside it, the single action that fixes it: **Pair this counter**, with what it costs underneath (*about a minute · needs the owner's PIN*). The verdict always says whether work is at risk; "nothing is lost" is the most important sentence on the page when it is true.

**Four checks**, one line each, colour-coded: *Which shop · not chosen yet* · *Pairing · not paired* · *Internet · online, 240 ms* · *This device · saving fine, 412 MB free*. These four, in this order, cover every reason a counter cannot sync.

**Waiting here to be sent** — the queue broken down by kind, with counts and the age of the oldest: price changes 4, sold-out marks 3, new customers 2, day close 1, bills 0. This is what reconciles the contradiction: **the 10 are not bills.** A line says so in words. Two buttons: *Try sending now*, *See every item*.

**The last try** — three numbers (10 tried · 0 accepted · 14 tries so far), then what the shop actually answered, translated: **"I do not know this counter."** with the raw code under it in mono (`401 unknown_counter_key · attempt 14 · next try in 26 s`).

**What to do — in this order**, three numbered steps: pair it; watch the 10 go; if it is still red, read out the code or send the report.

**Footer** — the support code at 30 px with a label (**READ THIS OUT TO SUPPORT**), **Copy**, the version line, and three buttons: *Show technical detail*, *Save the report*, **Send the report to support**.

---

## 3. Technical detail (`HealthDetail`)

Behind one button, never in front of the shopkeeper. For support:

- **This counter** — counter id, shop id, paired key, endpoint, app build, OS and browser, database version, space used and free, **clock skew against the shop** (a common cause of refusals).
- **What is in the local database** — per store: rows, waiting, oldest waiting. `bills 0/0`, `price_changes 412/4`, and so on, with the footnote that the plain page adds "waiting" up into one number.
- **The last five tries** — time, rows in → accepted, result code, round-trip ms.
- **The answer, word for word** — the raw JSON in a dark block with Copy.
- **Checked just now** — internet, shop answers, certificate validity, writes to this device, shop chosen, paired key.
- **Retry schedule** — the backoff drawn as bars (5 s doubling to a 2-minute ceiling) with one line saying it never gives up and never floods the shop.
- **Copy all as text** and **Send to support** at the top.

Privacy line, stated on the page: the report carries this page, the last 200 log lines and the counts — **no prices, customer names, phone numbers or bill contents.**

---

## 4. Phone (`HealthPhone`)

Same order, one column: verdict + Pair button, four checks as a 2 × 2 grid, the queue, the last try, the support code with Copy, then a sticky footer with *Try sending now* · *Detail* · **Send the report to support**.

---

## 5. Verdicts — one per cause, each with its own action

| Cause | Verdict line | Action |
|---|---|---|
| Never paired | Nothing can reach the shop from this counter | **Pair this counter** |
| Shop not chosen | This counter does not know which shop it belongs to | **Choose the shop** |
| Key rejected / revoked | The shop no longer accepts this counter's key | **Pair again** |
| No internet | The shop cannot be reached from here | **Check the internet** + "everything is saved here" |
| Shop is down | The shop is not answering right now | **Try again** + "we keep trying by ourselves" |
| Clock too far out | This counter's clock is 14 minutes out, so the shop refuses its bills | **Fix the clock** |
| Storage full | This counter is nearly out of space | **Free up space** — the only case where work *is* at risk; say so plainly |
| Version too old | The shop needs a newer version of this app | **Update** |
| All fine, queue draining | Everything is being sent — 12 left, going now | none; green |
| All fine, nothing waiting | Everything has reached the shop | none; green, and the page is boring on purpose |

Every verdict states whether anything is lost. Only "storage full" and "database damaged" ever say work is at risk, and they say exactly which items.

---

## 6. Behaviour

1. **The page refreshes itself** every 5 seconds while open; the "checked N ago" is live. **Check again** forces a probe now.
2. **Try sending now** resets the backoff to 5 s and shows the attempt happening, with its result on the same page.
3. When the cause is fixed, the page goes green **while the shopkeeper is looking at it**, and the waiting number counts down. That moment is the whole point of the page.
4. The support code is derived from the cause plus the counter id, so the same problem gives the same code every time. It is shown at 30 px, is selectable, and **Copy** copies the code plus the version line.
5. Reachable from: the sync pill on the sell screen, the counter hub, and any "could not send" message. Every one of those deep-links here, never to a generic settings page.
6. Works with no network — the whole page is local; only the probes need the network and they say so when they fail.
7. Nothing on this page changes data. No destructive action lives here except **Pair**, which asks for the owner's PIN.
8. Five states like every screen: loading (skeleton, never an empty page), error (the health check itself failed — say so), offline, no permission (staff see the verdict and the code, not the technical detail), and the healthy state.

---

## 7. Data

```json
{
  "verdict": { "code": "never_paired", "severity": "blocked | warning | ok", "dataAtRisk": false },
  "checks": {
    "shop": { "ok": false, "value": null },
    "paired": { "ok": false, "value": null },
    "network": { "ok": true, "rttMs": 240 },
    "storage": { "ok": true, "freeMb": 412, "writable": true },
    "clockSkewSec": 3
  },
  "queue": [ { "store": "price_changes", "rows": 412, "pending": 4, "oldestAt": "2026-09-18T09:12:00+05:30" } ],
  "lastAttempt": {
    "at": "2026-09-20T15:41:52+05:30", "tried": 10, "accepted": 0,
    "status": 401, "error": "unknown_counter_key", "requestId": "req_8f2c41a9",
    "attemptNo": 14, "nextAt": "2026-09-20T15:43:52+05:30"
  },
  "supportCode": "T1O-080",
  "build": { "app": "2.4.1", "build": 1180, "db": 37, "device": "Windows 11 / Edge 141" }
}
```

- `verdict.code` picks the banner, the action button and the support code from one table — never assembled in the view.
- `dataAtRisk` is what decides whether the banner says "nothing is lost". Default it to `false` only when the queue is provably on disk.
- Waiting counts come from `sync_state = 'pending'` per store; the headline number is their sum, and the breakdown is always shown beside it.

---

## 8. Acceptance checks

1. With no pairing, the page leads with the verdict and a working **Pair this counter** button; the raw row list appears nowhere on the first screen.
2. The headline waiting number always equals the sum of the breakdown; bills at 0 with a non-zero headline is explained in words.
3. Pairing the counter turns the page green within one refresh, and the waiting number falls to 0 without a reload.
4. Every verdict in §5 renders with its own line, action and support code.
5. The support code is identical for the same cause on any counter of the same shop, and **Copy** puts code + version on the clipboard.
6. **Send the report** contains no prices, names, phone numbers or bill contents — checked by a test that scans the payload.
7. With the network off, the page still opens, states the offline cause, and says nothing is lost.
8. A member of staff without settings permission sees the verdict, the queue and the code, and no technical detail or Pair button.

---

## 9. The fuller screen — what else the built page gets wrong

The version with the action row and the tabs adds four more problems. Design: `png/HealthActions.png`.

### 9.1 Six buttons of equal weight

Today: *Get my bills moving · Tell ChitBridge · Copy the report · Save it as a file · What is being kept · Check sent bills really arrived* — all the same size, all outlined, three of them about the report, and **the actual fix is not among them**.

Three ranks instead:

| Rank | What | Looks like |
|---|---|---|
| The fix | One button, from the verdict table (`Pair this counter`, `Choose the shop`, `Fix the clock` …) | green, full width |
| Checks — safe to press | `Try sending now` · `Check the shop's copy` | outline, side by side |
| The report | one split button: **Send the report ▾** → Send to ChitBridge · Copy as text · Save as a file · Show technical detail | dark, with a menu |

`What is being kept` becomes a link inside the technical view ("what this counter keeps, and for how long"). **`Day close sheet` leaves this page** — different job, reached from the day's own screen.

No emoji on buttons; one icon set, stroke icons only.

### 9.2 The two tabs must say whose numbers they are

*Today · on this device* and *Earlier · from ChitBridge* become **What is on this counter** and **What the shop has**.

- **On this counter** — the local database. Always readable, no network needed. Every figure on the page comes from here unless it says otherwise.
- **What the shop has** — the shop's record, fetched live. Needs pairing and a line. When it cannot be fetched the tab shows **can't ask** with the reason; it never renders blanks that look like zeroes.

### 9.3 "Check sent bills really arrived" deserves a real view

A reconcile table, today by default:

| Today | Here | The shop | |
|---|---|---|---|
| Bills | 96 | 93 | **3 missing** |
| Money taken | ₹18,420 | ₹17,905 | **₹515 out** |
| Price changes | 4 | 4 | match |
| Sold-out marks | 3 | 3 | match |

Under it, in plain words: *3 bills are here that the shop has never seen. They are safe on this counter.* — with one button, **Send those 3**. A mismatch is never left as a number the shopkeeper must interpret.

### 9.4 "Line · Full speed" → **Sending speed**, and it moves

A chart icon, the word "Line" and a dropdown in the middle of a failure page explain nothing. Rename and explain:

| Option | What it does |
|---|---|
| **Full speed** (default) | Sends as soon as anything is ready |
| **Gentle — for a weak line** | One at a time, a few seconds apart; slower but it gets through |
| **Paused** | Stops sending until someone says otherwise. The page stays amber the whole time and names who paused it and when. It turns itself back on at day close |

It lives in the technical view, not on the first screen — it is a knob for a bad line, not an answer to a failure.

### 9.5 Two more copy rules

1. **The title follows the verdict.** "Why is a bill stuck?" is wrong when no bill is stuck; with no pairing it reads **"Why can nothing be sent?"**. One title per cause, from the same table as the banner.
2. **Never report silence as approval.** *Rows tried 0 · Rows sent 0 · What the shop said: nothing refused it* reads as good news on a red page. When zero rows were attempted, say why zero — no key, nothing waiting, or paused: **"Nothing was sent, so there was nothing to refuse."**

### 9.6 Extra acceptance checks

9. Exactly one green button is on the page, and it fixes the stated cause.
10. The report actions live behind one control; no more than four buttons are visible at once.
11. The page title, the banner and the support code all come from the same `verdict.code`.
12. With no pairing, the "What the shop has" tab is disabled with a reason, and no figure on that side renders as 0.
13. A reconcile mismatch offers a one-tap action to send exactly the missing items.
14. Pausing sending keeps the page amber and names who paused it; day close clears the pause.
