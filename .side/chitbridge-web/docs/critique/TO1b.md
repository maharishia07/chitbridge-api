# Critique · TO1b — Tasks & Orders (public/tasks.html + app/cap-tasks.js) against docs/design/tasks-orders/REQUIREMENT.md

**VERDICT: BUILD WITH CHANGES** — close the screen gaps below; Ready · Drafts · the sound · the Home "stuck" fact stay open (why beside each).

## (a) What the brief assumes, checked
- Tabs Orders in · out · Tasks · Done exist — TRUE (CBWorkflow.tabs, tasks.html:119). Drafts / ＋ New — FALSE: api VIEWS has no drafts (api lib/work-rows.js:38, `draft:false` at :47); Compose lives only in app.html (`compose()`, app.html:6190, no hash door).
- A row carries channel · fulfilment · address · asked-for time · remark · total — TRUE on the wire (work-rows.js:154-156) but the screen paints none of address / fulfilment / asked-for / remark in the list, and no address in the sheet (cap-tasks.js:119-130, 202-210); `billed` / `despatched` (:158) are read and never painted.
- Accept → Bill it → Ready → Delivered — PARTLY FALSE: the engine's stages are new · accepted · delivered · closed (app/workflow.js, engines `workflow`); no Ready; no "Bill it" step on the screen; the till bills an order only from its own 🛒 list (till.html `orderToBill` :26879), never from the frame.
- The till shows the same queue — TRUE in part: 🛒 pill + "Online orders" dialog read GET /api/till/tasks (till.html:26790), the frame reads GET /api/work/list — two reads of one queue; "All orders & tasks" opens the frame (:26845).
- "No journal for New/Accepted" — TRUE for the screen (it posts nothing; every step is PUT /chits/:id/status). The server's hook on accepted (api routes/chits.js:3452 → books-hooks.postChit) posts a bill I RECEIVED only (buyerGate, books-hooks.js:536); an order has no frozen invoice (tax-copy.js:159) — UNKNOWN that no path posts an order; not this round's file.
- Home box with `new orders · tasks for you · stuck` — PARTLY: manifest `tasks` → GET /api/work/facts gives new orders + tasks for you (work-rows.js:237-239); no stuck figure; the shell draws two lines (shell.js:424). "1 stuck" already sits on Home as the rail chip (GET /api/facts/rail).
- The bell row opens THAT order here — FALSE: tasks.html defines neither openChitSheet nor openChit, so rail-bell.js:198 sends the press to crm.html; from Home the same.
- Stuck rows show the reason — FALSE on this screen; the server's stuck + why exist (GET /api/facts/rail/chits, home-facts.js:265-288) and nothing here reads them.
- 390 px — TRUE (walk-tasks T15, scrollWidth 390); layout = the standard page skeleton (sidebar folders + main), not a new look.

## (b) Conflicts · (c) simpler way
- One queue, one unit (§5): the fix is the frame telling its host `bill` and the till billing through its ONE path (`orderToBill`), not a second bill path in the frame. The till's dialog list stays (it feeds Despatch for a stock-holding shop); the designer's strip is a drawing, not built here.
- Stuck = the server's test (lib/measure via rail/chits), never a date compared on the page (SYSTEM §3 rule 12). One extra read per Orders folder load; its `why` is the sentence; the clearing button is the next step already on the sheet.
- "Delivered / Handed over" replaces "Complete" on an order in (the brief's words; the task keeps Done, the order out "Received"); copy stays ≤ 3 words.

## (d) Risks
- Twin landing: api (till master + its registry row for the `bill` event — none, it is postMessage) lands first, web (vendored till.html + screen) second; the web PR carries the vendored copy, api tests/till-vendor checks it.
- rail/chits is capped at 5,000 copies → `truncated: true` → no stuck marks, never a wrong one. The contract fixture lacks /api/facts/rail/chits: the walk's stand-in answer is unchecked by M43 (logged, not failed).
- Engines serial: a Ready stage is a `workflow` engine change (STAGES + STEP_TO) — described in the report, not built.
