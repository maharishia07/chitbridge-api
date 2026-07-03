# Chit & Bridge — Helpdesk-as-a-Service: State-of-Work & Architecture Briefing

**Purpose:** a cold-start briefing — everything needed to resume this thread fresh, or hand to another reviewer for a
critique. Status is marked honestly per item: **PROVEN** (built + verified live) · **PARTIAL** · **DESIGNED** (specced,
not built) · **OPEN** (not yet designed). Critique is explicitly invited (section 8).

---

## 0. What Chit & Bridge is (for a cold reader)
A B2B platform where businesses ("entities") exchange **sealed, shared records ("chits")** — an auditable mailbox for
deals. Core primitives:
- **Entity** — a tenant (a business). Isolation + customization boundary.
- **Schema** — the *configurable fields* a record/item carries (fixed engine, your fields). `entity_schemas` + `schema_fields`.
- **Catalogue** — an entity's standing items (products, etc.), schema-conforming JSON (`catalogue_items.item_data`).
- **Chit** — a two-copy shared record: sender's **Order** ↔ receiver's **Task**, each with its own status. No connection required to address one.
- **Message** — conversation on a chit. (There is no separate "reply" primitive; messages are the conversation.)
- **Co-assist (actor)** — a human (and, planned, non-human: `connector`/`iot`/`ai_agent`/`process_rule`) acting *for* an entity, carrying a **hat** (role: view/act/audit/mis/manager).
- **Governance** — a **protected root** + a **versioned constitution** that mints/stamps entities, with **version-freeze** (sent chits stay frozen at their minted version) + **provenance** + Class-A/B/C conformance.

Stack: static SPA (Vercel) + Node/Express API (Railway) + Postgres (Supabase). Loosely coupled: REST/JSON, stateless
HS256 JWT, config-driven base URL. (Assessed: the web↔API seam is genuinely decoupled.)

## 1. The thesis being proven
**The platform's own primitives are general enough to model and govern any service — including the platform's own.**
A "helpdesk" is not a bespoke feature; it's those primitives arranged, and the "admin panel" is just the **business
layer** (a schema-driven detail page). So **"helpdesk" is a BLUEPRINT** — mint any number for anyone. Proving it proves
the platform is self-describing + self-governing. Showcase: *our own AI assistant runs as a governed tenant of our own
platform, and the same recipe is what we sell.*

## 2. What is PROVEN — the concrete `GOV-01-Help` instance, live end-to-end
Built the platform's own help desk as a real tenant and ran the full loop on the deployed product:
- **DB-backed assistant.** The assistant's knowledge is a table (`assist_qa`), served **context-filtered** via public
  `GET /api/assist/questions?context=<screen>` (works pre-auth). The frontend fetches per screen; **nothing static in
  the client** (the old in-code libraries were removed). *(Verified: 52 seeded rows serving.)*
- **Knowledge = the catalogue of a sealed, governed Help entity.** `GOV-01-Help` is a **sealed** entity with a Q&A
  **schema** (`entity_schemas`='Assistant Q&A', custom, `schema_fields` question/answer/context/topics/fit/media) and
  its Q&A as **`catalogue_items`**. A DB **trigger projects catalogue → `assist_qa`** — **catalogue is the source of
  truth; `assist_qa` is the served projection.** *(Verified: editing a catalogue item changed the live assistant with
  no redeploy.)*
- **The learning loop, fully dogfooded:** user asks the assistant → no library answer → **"Send to the help desk"**
  composes a real **query chit** (asker's Order ↔ `GOV-01-Help`'s Task) → the help desk **operates it with the real
  product**: opens it in Task, and the **chit detail page is the "assistance page"** (a helpdesk-only **Answer &
  publish** action) → posting the answer **(a)** writes a **message on the chit** (asker sees the reply) **and (b)
  publishes** the Q&A to the catalogue → the projection **serves it publicly** → close the chit (audit). *(Verified live
  end-to-end.)*
- **Blueprint:** `create_helpdesk(name,email)` + `is_helpdesk(entity)` SQL functions mint/detect help desks
  (sealed entity + Q&A schema + fields, idempotent). Business-layer gates generalised to *"is a helpdesk"* (a
  `whoami` check), **backward-compatible** — the platform can now mint N help desks.

Governance foundation (protected root + versioned constitution + version-freeze + Class-A/B/C exceptions) is
pre-existing, real code — not a stub.

## 3. The CAPABILITY STACK (architecture — the map to prove against)
**Two stacks — do not confuse (canon fix, reviewer 2026-07-04):** what follows is the **capability stack**
(architecture). It is DISTINCT from the **governance cascade** (config inheritance: Constitution → Jurisdiction →
Vertical → Standards → Content → Connectors → User preference). Both previously said "L3" for different things —
**always name which stack.** The L1–L7 below are **capability-stack** layers.

Each answers a distinct question; status is honest.

| # | Layer | What it holds | Status |
|---|-------|---------------|--------|
| **L1** | **Foundation — Trust, Governance & Jurisdiction** | protected root, constitution, version-freeze, provenance, transactional integrity; **data isolation, GDPR/residency, audit**; **locale (language/timezone/currency/geo/legal)** | governance/provenance/version-freeze **PROVEN**; isolation **APP-LEVEL** (DB row-level = **DESIGNED**, blocked on a DB role); GDPR-residency + locale = **STUB/OPEN** |
| **L2** | **Tenant — Entity scope** | a service = an entity minted from a blueprint; the isolation + customization boundary; governed tighten-only overrides | **PROVEN** |
| **L3** | **Domain — Schema · Catalogue · Knowledge + Rules** | data shape, offerings, Q&A **+ business logic/rules** (qty = area ÷ coverage; price = weight × rate) | data **PROVEN**; **rules-as-config = OPEN** (biggest domain gap) |
| **L4** | **Capabilities — composable building blocks** | intake/chit, task/workflow, roles/hats, messaging, dispute…; switch on only what a service needs | **PARTIAL** (lazy capabilities exist; per-service *selection* not formalised) |
| **L5** | **Intelligence — AI agents** | AI as a co-assist (draft/answer/visualise); **shared model across tenants, grounded ONLY on each tenant's isolated data** | **HOOK only** (`ai_agent` type + `/api/assist` LLM proxy stub with a "ground only on this caller's data" rule); shared+protected = **DESIGNED** |
| **L6** | **Delivery — Channels & Experience** | message, public catalogue, **embeddable widget/plugin**, call-center; **white-label UX** ("powered by Chit & Bridge", per-locale) | message/catalogue/projection **PROVEN**; widget + white-label + call-center = **OPEN** |
| **L7** | **Operate — Feedback & Monetization** | learning loop (gap → review → publish); plans, entitlements, **metering, billing** | feedback loop **PROVEN**; plans/quotas exist in the constitution; metering + billing = **OPEN** |

**Reviewer notes (2026-07-04), folded in:**
- **L5 may not be its own layer** — AI is a co-assist *actor type* (`ai_agent`); consider folding "Intelligence" into
  L4 (Capabilities/actors) rather than a standalone layer.
- **RLS (inside L1) is now the #1 priority and the FLOOR under L5** — do NOT wire shared-AI onto tenant data until RLS
  is green; it makes cross-tenant leakage *structurally impossible* (RLS-scoped retrieval), not a prompt-level promise. See §6–§7.
- **Mint path unified** — `create_helpdesk`/`is_helpdesk` are now thin wrappers over `create_from_blueprint` + a
  blueprint **registry** + `is_instance_of` (one mint path, N blueprints).

## 4. The through-line (the design principle)
The business layer *always exists*; customization always lives there. The move that makes it a platform (not bespoke
work per customer): **every layer's variable part is entity-scoped CONFIGURATION** — schema, rules, capability
selection, AI config, brand/locale — with the **blueprint as defaults** and **governed, tighten-only overrides** per
entity. "Drawing the customization into the entity's scope" = the governance-override model. Same mechanism that makes
the schema work, applied to every layer.

## 5. Spine (confident) vs Frontier (next)
- **Spine — PROVEN, confident:** L1 governance · L2 tenant/blueprint · L3 data · L7 feedback-loop.
- **Frontier — designed/open:** L1 real isolation (RLS) + jurisdiction/GDPR · L3 rules-as-config · L4 capability
  composition · L5 AI (shared + protected) · L6 embeddable widget + white-label · L7 metering/billing.

## 6. Hard open questions (the ones that decide the outcome)
1. **Isolation & GDPR (L1).** Isolation is app-enforced today; DB **row-level security (RLS)** is designed but blocked
   on a DB role. Load-bearing for GDPR + shared-AI. *Is app-level acceptable pre-customer, or is RLS a prerequisite?*
2. **Rules-as-config (L3).** *Can domain logic be declared as configuration per entity, not code?* What's the minimal
   rules model covering painter / jeweller / gallery without becoming a programming language?
3. **Shared AI, isolated data (L5).** One model, many tenants, grounded only on each tenant's isolated governed data.
   *Is "grounding + isolation invariant" sufficient, or do we need per-tenant isolation / data-minimisation / redaction?
   How do we prove no cross-tenant leakage?*
4. **Delivery (L6).** Embeddable widget + **per-helpdesk serving scoping** (known gap: all desks currently share one
   served pool) + white-label. *What's the auth model for an embedded, possibly anonymous customer widget?*
5. **Monetization (L7).** *Metering unit* — per query? per published answer? per seat? per AI call? — and plan structure.
6. **Composition (L4).** How does a service declare which capabilities it uses, and is that itself governed config?

## 7. Proposed next sequence (confidence-ordered)
Make-or-break: **(a) L1 real isolation (RLS)** and **(b) L3 rules-as-config** — nail those and the rest is assembly.
Then **L6 embeddable widget** (converges with the backlogged API-as-a-service: machine-auth + OpenAPI + per-helpdesk
key) and **L5 AI wiring** (LLM grounded on the DB catalogue; the deterministic matcher is only the floor). **L7
metering** last.

## 8. Explicit asks for a fresh reviewer (critique wanted)
- Does the **layer model** hold, or is a layer missing / mis-drawn?
- Is **"customization = entity-scoped governed config"** sound, or where does it break (rules? AI? branding?)?
- Is **app-level isolation acceptable pre-RLS**, or a red flag for real customers / GDPR?
- Is the **shared-AI-isolated-data** model defensible? What would you add to prove no leakage?
- What's the **biggest risk we're underweighting**?
- Do you agree with **isolation + rules first**, or a different order?

## 9. Platform foundation already built (what the helpdesk rests on)
The helpdesk thread sits on a substantial, **deployed** web-MVP foundation — all PROVEN/live unless noted. This is why
the spine is credible: the helpdesk reuses machinery that already works.
- **Mailbox core:** Task / Order / Drafts / Trash / Archive; read + single-step advance (now **bidirectional 3-state**);
  **Compose** (wide 2-column modal, recipient autocomplete, catalogue line items, attachments, delivery, live summary);
  **Disputes** (multi-party raise/resolve, filter + count, archive/delete guard while open, dispute-tagged messages);
  Suppliers / Catalogue / Network; Message centre; Notifications (derived from `state_log` — a proper channel is backlog).
- **Attachments:** platform-independent `StorageAdapter` (DB now; S3/Azure/GCS pluggable), participant-checked
  upload/stream, media pulled on demand.
- **Confirmed decisions (built + deployed):** **D2** actor **hats** (view/act/audit/mis/manager; assignability gate on
  every assign path); **D1** **auto-assign on receipt** (off / default-assignee / least-loaded; least-recently-assigned
  tie-break; overflow; on-leave → delegate chain, cycle-guarded); **D4** **disputes** (participants, filter+count,
  archive guard, dispute messages).
- **Co-assist (workforce) module:** full lifecycle — create→OTP→set-PIN→PIN login, re-invite/reset-PIN, hats,
  **leave-cover** (buddy pairs + concurrency check), duty/break shift, deactivate/reactivate/remove with **full binding
  cleanup**, roster. Has a use-case library + regression cases (`COASSIST-*.md`). *(This is the machinery L4/L5 reuse:
  co-assists + hats = the roles/workflow; `ai_agent` is a planned actor type here.)*
- **Capability modularisation:** `app.html` split into progressively-loaded capabilities — `core.js` + `helpers.js`
  (eager) + `ensureCap`/`CAP_OF` loader + lazy `cap-admin` / `cap-workforce` / `cap-help` / `cap-legend`. The **🔑
  Legend** is a live capability→feature map in-app.
- **Governance + schema engine:** protected root + versioned constitution + version-freeze + Class-A/B/C exceptions +
  entitlement **plans** (free/pro/enterprise quotas) + drift/reattest; **schema engine** (`entity_schemas`/
  `schema_fields`, arbitrary typed fields) + **catalogue** (`catalogue_items` JSON validated vs schema). *(L1 + the
  substrate for L2/L3.)*
- **Deploy/infra:** two loosely-coupled repos (web→Vercel, api→Railway, DB→Supabase); REST/JSON + stateless JWT;
  config-driven base URL (dev/uat/live).

## Appendix — repos / where things live
- **Web** (SPA, Vercel): `public/app.html` + `public/app/core.js|helpers.js|cap-*.js` (lazy capabilities). Assistant
  engine + gates in `app.html`; admin/KB screen in `cap-admin.js`.
- **API** (Node/Express, Railway): `routes/*.js` (chits, actors, entities, assist, governance, products/catalogue,
  schemas), `governance/` (mint/resolver/entitlements), `migrations/` (b42 assist_qa, b43 Help entity, b44 projection
  trigger, b45 rename, b46 blueprint functions).
- **DB** (Supabase/Postgres): entities in `identities`; `entity_schemas`/`schema_fields`; `catalogue_items`;
  `chit_header`/`chit_status`; `assist_qa`; `platform_root`/`platform_constitution` (governance).
- Design docs alongside this one: `ASSISTANT-GOVERNED-ENTITY-DESIGN.md`, `API-SERVICE-DESIGN.md`,
  `COASSIST-USECASES.md` / `COASSIST-REGRESSION.md`.
