# The network builder, inside Network > Design (REQUIREMENT for the designer, 19 Oct 2026)

**Status:** requirement only (round NET2). Do not build. **Pass mark:** `docs/design/SYSTEM.md`. **Map:** `C:/dev/docs/design/NAV-MAP.md` §5 item 8, §6 item 50-51, §7 row "Network".
**Door audit:** `docs/design/INDEX-NOT-APP.md` row "Network > Open the builder" (build NET2, M; guard `e2e/index-not-app.cjs`; its ALLOW row is struck in the same change as the build).
**Owner:** cb-network. Code today: `public/app/network-app.js` (the Design tab: tree read-only + "Check this design" + the "Open the builder" door at line ~144) · `public/app/cap-network.js` (the builder: tree, capabilities, apply) · `public/network.html`.

## Why
"Open the builder" leaves ChitBridge for the workshop (`/app.html#/network`). A shopkeeper who draws a network must stay in Network, with Home one tap away.

## Who
An owner (the top node) designing how branches, depots and partner businesses connect. Rare, careful work, at a desk more than on a phone, but it must still open at 390 px and say what it needs.

## What the builder is (kept; do not redesign the model, draw it clearly)
A DRAFT tree under your own entity. Nothing is created while you design. Two kinds of node: **Own** (a branch or unit; at Build it becomes a real entity with a login you hold) and **Partner** (an outside business; at Build it becomes a handshake, no key). Each node has a purpose line and "what it holds", as ticks: Catalogue · Storefront · Co-assists · Transact · Trade-ready · Dispute, plus Global and How fast. Ticks marked `soon` in `NET_CAPS` (Territory, Stock and policy, Price policy) are shown greyed with "Not yet", never hidden (show action). Ticking Catalogue opens its spec (pick a common catalogue, fields, method, item limit); Storefront opens its exposure (public or protected).
Build is a DRY RUN until Phase B wires the real mint. The draft saves per entity (`PUT /api/network-design`, read `GET /api/network-design`).

## WAYS IN
Network > Design (section gets its hash `#/design`, NAV-MAP item 51) > "Edit the design" (the replaced "Open the builder"). Home > Running (or Trade) > Network > Design = 3 taps. An empty "No design yet" state offers "Start the design".
## WAYS OUT
Header ⌂ Home and the switcher. "Back to the design" from the builder to the read view (same page, no new tab). "Check this design" runs in both views. Network > My network and Offers stay in the left menu. A node's Catalogue opens Catalogue (link); a Partner node opens its member view. Never `app.html`. The Network Lab (a separate, sample-only page, `network-design.html`) is linked as "Try it with sample data" and not mixed in.

## Fields (real API; reuse, no new shape)
Draft: `GET /api/network-design` returns `draft.nodes[]` = `key` · `name` · `parent_key` · `root` · `owned` (false = Partner) · the held capabilities. Also `GET /api/network-design/stores` (the listed stores) and `may_design{ok, why}` from `GET /api/network-offers`. Check: `POST /api/network-design/validate` returns `ok` · `says` · `breaks[{name, reason}]` · `notes[]`. The server decides who may design and what would break; the page paints.
Reuse before naming anything: `node C:/dev/seams.cjs network` and `capabilit`.

## Sample (label "Sample"; no contract fixture exists for the design routes, so use the Network Lab's data)
Network "alpha-timers" (the Lab's hard-coded name) with 4 stores: top node "Alpha Timers" (Own) > "Chennai branch" (Own, Catalogue + Storefront ticked) > "Salem depot" (Own, Catalogue) and "Kovai Dealer" (Partner, Transact). Check result: ok, says "All 4 connect"; one break sample: "Kovai Dealer: no catalogue to receive". Ask cb-network for a contract fixture of `GET /api/network-design` when it is wired.

## Layout to design
Two panes: the tree on the left (a node per row, indented, Own/Partner tag; add child, rename, remove), the selected node's settings on the right (purpose, holds, the open spec). Phone: the tree is a list; tapping a node opens its settings as the next pane with a back arrow (more panes, not denser). A fixed bottom bar: "Check this design" (always) and "Build" (greyed with its sentence while the dry run is the only mode).

## Actions per state (show action, enable by role)
No design yet (Start) · draft saved (Edit, Check, Build) · checking (spinner on the button) · broken (each break is a row with the node's name, the reason in words, and a "Go to it" button) · all fine ("All 4 connect", Build enabled) · login may not design (every control greyed with the server's `why`, the read view still shows) · built (later).

## States
Loading · could not read ("Couldn't read your network" + Try again, as today) · saving ("Saved" line; no silent failure) · offline (the draft is kept on the device and says so) · a big tree (40 nodes: the list scrolls, the bar stays) · a partner node whose catalogue is private.

## Rules for the design
Copy for the shopkeeper: no "mint", "handshake", "entity", "capability" words on screen (say "branch", "partner", "what it does"). No alert(). Headers frozen. Light, dark, AA, 390 px with no sideways scroll.

## Open questions for Athi
1. Is Build (the real creation of branches and logins) in this round or a later one? The design shows it greyed until you say. 2. Do partners see the tree at all, or only their own node?

## Not in scope
The mint wiring (Phase B). Territory and price policy (placements only). The Network Lab's content.
