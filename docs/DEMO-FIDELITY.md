# Demo fidelity — keep the demo a TRUSTWORTHY showcase (regress it every milestone)

The web demo (`web_demo` stage: `DEMO` / `STORE` / `demoApi()` in `chitbridge-web/public/app.html`) is a **trust
artifact** — we use it to *prove* our unique claims to prospects ("this is what's happening"): tenant isolation /
multitenancy, the two-copy shared record, on-record messaging, the AI assistant. So **every claim the demo makes
must be TRUE of shipped, enforced dev behaviour.** Aspirational features may appear ONLY if clearly badged
"preview / coming soon". A demo that shows un-built or wrong behaviour misleads a prospect and burns trust.

**Rule:** the demo regresses with dev. At **every big implementation / milestone**, run the checklist below and
update the demo blob + flows so it still mirrors reality. (Linked from `AMENDMENT-CHECKLIST.md`.)

## Per-milestone DEMO-REGRESSION checklist
1. **Segregation still holds** — demo makes **zero real API calls**: `web_demo` has `base:null, mock:true`, and
   `core.js` returns `demoApi()` *before* the only `fetch()`. (No new code path may call a real API in demo mode;
   the assistant's `askLLM` returns null in demo.)
2. **Feature parity** — every `demoApi` handler maps to a **built** dev endpoint. If a feature was gated/removed
   (e.g. network writes → 503), the demo must reflect that, not show it working.
3. **Data accuracy (no implied-but-unbuilt features)** — the static blob shows only **shipped + enforced**
   behaviour. Flag anything that implies a capability we don't enforce (e.g. per-actor `view-only/audit` caps,
   per-node network grants) → align it or badge it "preview".
4. **Cross-cutting claims must be demonstrable in the data:**
   - **Isolation / multitenancy:** never show one entity another's private data. To *prove* it, the demo needs a
     way to view the counterparty's perspective (see "perspective switch" gap below).
   - **Two-copy:** a sent chit and its received copy, with **independent** status.
   - **Message visibility:** `internal` = your side only; `external` = **both parties see it**. The demo must
     never show the counterparty's *internal* messages, and must show shared *external* ones to both sides.
   - **AI assistant:** answers come from the **current** `ASSIST_LIB`; honest / no-oversell; updated as features
     ship (e.g. the D3 co-assist scoping wording).
5. **New feature shipped this milestone** → add representative demo data for it, and (if we claim it) a way to
   *see* it happen.

## Claims ↔ built ↔ shown (living map — update each milestone)
| Claim in demo | Built + enforced in dev? | Demo shows it honestly? |
|---|---|---|
| Two-copy shared record (sent/received) | ✅ | ~ (single-entity store shows our copy; counterparty fan-out is "pending") |
| On-record messaging, internal/external scope | ✅ | ~ (shows our side; can't show the counterparty's view yet) |
| Disputes (raise/resolve, flag model) | ✅ | ✅ |
| Priority + typed messages | ✅ | ✅ |
| Suppliers / catalogue / schema-compose | ✅ | ✅ |
| Customer storefront order | ✅ (parked for go-live) | ✅ |
| Tenant isolation / multitenancy | ✅ (app-layer; RLS = B1 pending) | ✗ — single-entity demo can't *prove* it (needs perspective switch) |
| **Network (connect/approve/grants)** | ❌ dormant + writes gated (503); grants not enforced | ✗ OVERCLAIM — shows fully working |
| **Per-actor capabilities (view-only/audit)** | ❌ free-text role, not enforced (D1 pending) | ✗ OVERCLAIM — implies enforcement |
| AI assistant answers | ✅ library mode (real model dormant) | ✅ (D3 wording fixed) |

## Known gaps to work (current)
- **G-demo-1 — Network overclaim:** align the network demo to dev (writes "not available yet", drop per-node
  `cap` grants) **or** badge the whole network panel "preview / coming soon".
- **G-demo-2 — Actor-cap overclaim:** show co-assists with free-text role labels, no implied enforced scoping
  (matches the softened D3 claim); add the per-actor view-hat to the demo only when D1 ships.
- **G-demo-3 — Prove isolation/two-party visibility:** the demo is single-entity, so it can't *show* that B can't
  see A, or that the counterparty sees external (not internal) messages. Add a **"view as counterparty / switch
  perspective"** toggle backed by a second-entity blob — this is the highest-value demo upgrade for proving the
  security/multitenancy story. (Design needed.)

These are tracked in `CORE-STABILISATION-BACKLOG.md` (Track F) so they ride with the milestones.
