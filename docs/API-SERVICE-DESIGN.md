# Chit & Bridge — "API as a service" design (machine-auth + OpenAPI)

**Status:** DESIGN ONLY — backlog, **prioritised** (top of the platform-enablement queue). No build yet.
**Why:** the web↔API seam is already loosely coupled (REST/JSON, stateless JWT, config-driven base URL). What's
missing to let *other systems* connect on their own is a productization layer, not a re-architecture. This spec
covers the two highest-leverage pieces: **machine-to-machine auth** and a **formal OpenAPI contract**. Webhooks,
per-key metering and `/v1/` versioning are noted as the next layer.

---

## 1. Machine-to-machine auth (the #1 blocker)

Today every token is minted from a **human** flow — entity OTP or actor PIN (`routes/entities`, `routes/actors`).
There is no way for a *system* to authenticate. Design:

### 1.1 Credential model — API keys + OAuth2 client-credentials
- A **service credential** belongs to an **entity** and maps to a non-human **actor** (`actor_type` ∈
  `connector | ai_agent | process_rule | iot_device` — the domain already models these). This reuses entity
  isolation + the actor scope model; a service acts FOR the entity exactly like a human co-assist.
- Issue a **client_id + client_secret** pair (secret shown once, stored hashed — bcrypt/argon2, same as PINs).
- Auth flow = **OAuth2 client-credentials**: `POST /oauth/token` with `client_id`+`client_secret` (or HTTP Basic)
  → short-lived **access JWT** (same HS256 verifier as `middleware/auth.js`, so downstream routes are unchanged).
  - JWT carries `identity_type:'<actor_type>'`, `parent_entity_id`, and a new **`scopes`** claim.
  - Keep TTL short (e.g. 15 min); the client re-mints. No refresh token needed for pure M2M.
- Alternative simple tier for low-trust internal callers: a **static API key** header (`X-API-Key`) that the auth
  middleware exchanges for the same request identity. Offer BOTH; OAuth for partners, API key for quick internal.

### 1.2 Scopes (least privilege)
- Coarse, resource-verb scopes: `chits:read`, `chits:write`, `actors:read`, `disputes:write`, `catalogue:read`, …
- Enforced by a tiny `requireScope('chits:write')` middleware layered AFTER `auth`. A missing scope → **403**
  (distinct from 401 no-token). Human tokens get a default full scope set for their hat; service tokens get only
  what the credential was granted.

### 1.3 Key lifecycle & admin
- New table `service_credentials` (id, entity_id, actor_id, client_id, secret_hash, scopes[], label, created_by,
  last_used_at, revoked_at). Never store the raw secret.
- Admin surface (later, a `cap-admin` feature): create/label/rotate/revoke keys, see `last_used_at`. Rotation =
  issue new secret, grace-overlap the old, then revoke.
- Guardrails: rate-limit `/oauth/token` (reuse `authLimiter` pattern); log every mint with `req.id`; a revoked or
  deactivated backing actor fails exactly like today's actor-revocation check (`middleware/auth.js:37`).

### 1.4 Isolation
- A service token is entity-scoped like any actor → the existing entity-isolation invariant covers it. When **B1
  RLS** lands ([[project-b1-rls-thread]]) it protects service callers for free (same `parent_entity_id`).

---

## 2. OpenAPI contract (self-serve integration)

Today the contract is tribal — the client's `EP` map with `ok:"✓/?/◐"` confidence flags. A third party can't
integrate without reading our source.

### 2.1 Author `openapi.yaml` (OpenAPI 3.1)
- One spec describing every `/api/*` route: params, request/response schemas, auth (bearer + client-credentials +
  API-key security schemes), error shapes. Source of truth in-repo (`docs/openapi.yaml`).
- Serve it: `GET /openapi.json` + a **Swagger UI / Redoc** page at `/docs` (dev/uat; gate or omit on prod-public).
- Keep it honest and IN STEP with code (same discipline as the capability specs) — a route change updates the spec
  in the same PR. Consider `express-openapi-validator` so the spec also **validates requests** (spec drift becomes
  a test failure, not a surprise).

### 2.2 Uniform response envelope (prerequisite for a clean spec)
- The client `unwrap()` (`core.js:11`) tolerates a real `{ok,data,error}` envelope AND ~6 legacy shapes
  (`{chits}`, `{entity}`, `{token}`, `{messages}`…). For a public contract, converge on ONE envelope:
  `{ ok:true, data:… }` / `{ ok:false, error:{ code, message } }`.
- Migration is low-risk because `unwrap()` already understands the target envelope — flip routes to it
  incrementally (via `lib/respond.js`), the client keeps working, then delete the legacy branches last.

### 2.3 Versioning
- Introduce `/api/v1/*` (alias current `/api/*` → `v1` to avoid a breaking cutover). New/breaking work lands under
  the next version. Document the deprecation policy in the spec.

---

## 3. Next layer (after the two above) — noted, not specced here
- **Webhooks / events** so consumers subscribe instead of poll (ties to the notification-system-as-a-whole
  backlog — same event source: `state_log`). Signed payloads (`standardwebhooks` is already in node_modules).
- **Per-key metering / quotas** (rate-limit by credential, not just IP) → usage + billing.
- **Developer portal** (self-serve key issue + docs) once partners exist.

## 4. Suggested build order (when promoted from backlog)
1. `service_credentials` table + `POST /oauth/token` + `X-API-Key` path in `middleware/auth.js` (M2M auth).
2. `requireScope` middleware + seed scope sets.
3. Converge the response envelope via `lib/respond.js` (incremental).
4. `openapi.yaml` + `/docs` (Swagger/Redoc) + request validation.
5. `/api/v1` alias.
6. Admin key-management feature in `cap-admin`.
7. Webhooks + metering (next layer).

**Effort estimate:** steps 1–2 are the real unlock (a few focused days); 3–5 are mechanical but touch every route
(do incrementally, test-after each, like the capability sweep). Nothing here changes the current web client.
