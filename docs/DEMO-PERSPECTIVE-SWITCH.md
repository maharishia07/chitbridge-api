# G-demo-3 — "View as counterparty" perspective switch (DESIGN)

**Goal:** make the demo **prove**, not just claim, our three hardest-to-show guarantees — **tenant isolation /
multitenancy**, the **two-copy shared record**, and **internal vs external message visibility** — by letting the
viewer flip the demo to the *counterparty's* perspective and *see* what each side can and cannot see.

Today the demo is single-entity (you only ever see Raghavan Timber's side), so it can only *assert* these. This
turns "trust us" into "watch it." Demo-only (`web_demo`); does not touch dev. Status: design for approval.

## The idea in one line
A **"Viewing as ▾"** switcher (Raghavan Timber ⇄ Saravana Traders). The same shared deal appears on both sides as
its two copies; each side's **private** data does not cross. Flip back and forth → the audience literally sees
isolation happen.

## What it proves (the demo script)
1. **Isolation / multitenancy:** As **Saravana Traders** you see the shared PO and *your own* other deals — but
   **none of Raghavan's private chits** (e.g. the walk-in counter sale, the Madurai service request). Flip to
   Raghavan → those reappear for them, and Saravana's privates vanish. *"Neither side ever saw the other's books."*
2. **Two-copy shared record:** the shared PO is an **Order** on Raghavan's side and a **Task** on Saravana's side,
   each with its **own independent status** (Raghavan: *delivered*; Saravana: *pending* → accept → *accepted*,
   while Raghavan's copy is unchanged). *"One deal, two copies, independent state."*
3. **Message visibility:** an **external** message ("Dispatching today by 4pm") shows on **both** sides; an
   **internal** message ("Stock checked — Priya") shows **only** on Raghavan's side and is **absent** when viewing
   as Saravana. *"External both parties see; internal stays yours."*

## Data model (demo blob)
Restructure the demo store from one flat entity to **per-entity blobs** + a current perspective:
```
DEMO.entities = {
  rt: { entity:{…Raghavan…}, chits:[…], actors:[…], catalogue:[…], … },   // private to rt
  st: { entity:{…Saravana…}, chits:[…], actors:[…], … }                    // private to st
}
DEMO.shared = [                                       // deals that exist on BOTH sides as two copies
  { deal_id:"D-4471", a:"rt", b:"st",
    copies: { rt:{ direction:"sent",     status:"delivered", … },
              st:{ direction:"received", status:"pending",   … } },
    messages:[ {scope:"external", owner:"rt", body:"Dispatching today…"},   // shows to BOTH
               {scope:"internal", owner:"rt", body:"Stock checked — Priya"} // shows to rt ONLY
             ],
    items:[…] }
]
STORE.perspective = "rt";                              // current viewer; toggled by the switcher
```
Rules the resolver enforces (mirrors dev):
- A chit list for perspective `P` = `entities[P].chits` (private) **+** the `shared` deals where `P ∈ {a,b}`,
  rendered as `copies[P]` (its own direction + status).
- Messages on a shared deal for viewer `P` = `messages.filter(m => m.scope==='external' || m.owner===P)`.
- `entities[other]` data is **never** reachable from perspective `P` (the resolver only reads `P`'s slice).

## UI
- A **"Viewing as ▾"** dropdown in the demo top bar (next to the demo/live ribbon), **only when `CFG.MODE==='demo'`**.
- Switching calls `setPerspective(id)` → updates `STORE.perspective` → re-renders the current screen.
- A one-line explainer under it: *"Switch perspective to see isolation in action — the other party can't see your
  private chits; external messages cross, internal don't."*

## Implementation outline (phased; demo-only, held on `feat/panel-fixes`)
1. **Phase 1 — isolation proof (smallest, biggest payoff):** add the `st` blob + the perspective switcher; route
   `demoApi` chit reads through the resolver so each side shows only its own chits + the shared deal. (Proves #1.)
2. **Phase 2 — two-copy:** give the shared deal `copies` with independent status; advancing status as Saravana
   doesn't change Raghavan's copy. (Proves #2.)
3. **Phase 3 — message scoping:** internal/external cross-visibility per the rule above. (Proves #3.)
Each phase: `node --check` the inline JS; verify the switch in a browser; keep `demoApi` the only mutation path.

## Scope / non-goals / risks
- **Demo only** — no dev/API change; the `st` blob is static mock; segregation (no real API call) preserved.
- Keep it **small**: one shared deal + ~2 private chits per side is enough to make every point; don't rebuild the
  whole catalogue for `st`.
- **Risk:** `demoApi` currently reads a flat `STORE.chits`; routing it through a per-perspective resolver is a
  contained but real refactor of the demo data layer — do it phased, behind the existing demo path, and regress
  the demo checklist (`DEMO-FIDELITY.md`) after each phase.

## Why this is the headline demo upgrade
Isolation/multitenancy is our #1 claim and the hardest to *show*. This makes it a live, on-stage proof — the same
thing the `isolation-suite.sh` (A4) asserts in tests, but visible to a prospect in the demo. High trust-per-minute.
