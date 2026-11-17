# Tasks & Orders as a frame — `tasks.html?embed=1`

TO1-UI (2026-10-12). The standalone app (`public/tasks.html`, screens in `public/app/cap-tasks.js`) draws the same list and sheet
with no frame when it is opened with `?embed=1`, so another page can hold it in a dialog. The host opens it with the one helper every
embed uses, `CBEmbed.open` (`public/app/embed-host.js`) — nothing here is new to Tasks & Orders except the event names.

## Opening it

```js
CBEmbed.open({ app: 'tasks', view: 'orders_in', title: 'Orders',
  session:   function () { return token; },        // the host's own signed-in person (the till) — handed over postMessage, never stored
  api:       function () { return apiBase; },      // where that token is good (default: the host's CloudHost.api)
  onMessage: function (m) { /* see the events */ },
  onClose:   function () {} });
```

The frame's address is `/tasks.html?embed=1&view=<folder>[&open=<chit_id>]`:

| query | values | what it does |
|---|---|---|
| `view` | `orders_in` · `orders_out` · `tasks` · `done` | the folder shown first (the engine's tabs, `CBWorkflow.tabs`); the frame draws a folder chooser in its top bar |
| `open` | a chit id | opens that row's sheet over the list straight away |
| `api` | an https origin | the API to read (a host that answers the session handshake may send it there instead) |

Sign-in: the frame asks its parent `{ cb: 'tasks', event: 'need-session' }`; the host answers `{ cb: 'host', event: 'session', token, api }`
to that iframe only (CBEmbed does this). A host that does not answer within 2.5 s: the browser's own saved session, as any page.

## What the host hears

Every message is `window.parent.postMessage({ cb: 'tasks', event, ...fields }, location.origin)` — same origin only.

| event | when | fields |
|---|---|---|
| `need-session` | at load, before anything is read | — |
| `open` | a row's sheet was opened (and read fresh) | `chit_id` · `kind` (`order_in` · `order_out` · `task`) · `stage` · `word` |
| `moved` | a status step went through (accept · reject · complete · cancel · reopen), OR a line's state changed (done · reopened), OR a delivery was recorded on a line | `chit_id` · `kind` · `stage` · `word` · `status` (the rail status) · `action?` (the step) · `line_id?` · `state?` (`open` · `done`) · `delivered?` (the quantity recorded) |
| `assigned` | the whole task, or one line, changed hands | `chit_id` · `kind` · `stage` · `word` · `status` · `line_id` (`null` for the whole task) · `assignee` (`{ id, name }` or `null` = taken off) |
| `bill` | **Bill it** was pressed on an order in (TO1b, REQUIREMENT §4: Accept → Bill it → Delivered) — the frame bills nothing; the host that holds the bill path (the till: `orderToBill`) closes the frame and puts the order on its bill | `chit_id` · `kind` · `stage` · `word` · `party` |
| `close` | the person closed the frame (the ✕ of the dialog is the host's; this is sent by the screen when it ends itself) | — |

`stage` · `word` · `status` are the SERVER's answer after the write (GET /api/work/:id read again) — the host paints them, it never
derives them. A host that keeps its own list of open orders (the till's 🛒 pill) re-reads on `moved` / `assigned`.

## Where it is embedded

- the till (`chitbridge-api tools/tally-connector/till.html`, vendored to `public/till.html`): the **Online orders** dialog carries
  **All orders & tasks**, which opens this frame on `orders_in` with the counter's signed-in person; on `moved` / `assigned` the till
  re-reads its open orders when the dialog closes (`tasksOpen()`); on `bill` it closes the frame and puts that order on the bill through
  its ONE path (`orderToBill` — the shopper's prices, Delivery / Pickup as ordered, normal series and tax; `tasksBill()`).

## What the frame does not do

- no sidebar, no shell header, no kural band (`CBFrame` is not mounted);
- no second status path: every step is `PUT /api/chits/:id/status` (moveStatus); a line's state and holder is `POST /api/chits/:id/assign-lines`;
  a delivery is `POST /api/chits/:id/deliver-lines`; the whole task's holder is `PUT /api/actors/assign/:id`;
- it never decides what is allowed: the sheet paints `actions.<step>.ok / say` from `GET /api/work/:id`, greyed with the sentence when refused.
