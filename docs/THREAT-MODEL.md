# Threat model — Chit & Bridge (one page)

Purpose: turn "find leaks by review luck" into "check against a known list." Pairs with the P0 isolation
invariant (`CB-SYNC.md`) and the stabilisation backlog (`CORE-STABILISATION-BACKLOG.md`). Update when the
architecture changes.

## Assets (what we protect)
| Asset | Why it matters |
|---|---|
| **Per-entity chit data** (chit_header/status/detail/state_log, prices, parties, history) | The product's #1 promise — one tenant must never see another's. |
| **`JWT_SECRET`** | Single key; forging it forges ANY entity's token. The crown jewel. |
| **Tokens** (entity 7-day, actor, customer) | A stolen token = that identity until expiry (entity tokens are not revocable today). |
| **OTPs** | Gate registration/login + the no-login customer order. |
| **Audit trail** (state_log) | Tamper-evidence; must stay truthful + scoped. |
| **Customer PII** (phone/email in `otp_contact`, orders) | External-facing; storefront surface. |

## Trust boundaries
Browser ⇄ API (HTTPS, JWT) · API ⇄ Postgres (parameterised SQL) · **Entity ⇄ Entity** (the P0 line) ·
Entity ⇄ its Actors (no per-actor scoping yet) · Public storefront ⇄ shop (no-login, OTP) · Demo ⇄ real API
(must never cross).

## Threat actors → what they attempt → mitigation → residual gap
| Actor | Attempts | Mitigation today | Residual gap → backlog |
|---|---|---|---|
| **Anonymous internet** | Hit endpoints without a token; brute OTP; abuse public storefront | `auth` on data routes; boot guard on `JWT_SECRET`/`DEV_OTP`; CORS allowlist; auth + catalogue rate limits; OTP attempt cap (F5); helmet | Per-IP limits are rotatable → **C4**; no CSP (helmet CSP off) → **F1** |
| **Authenticated business peer (Entity B)** | Read/modify Entity A's rows via IDs in URL/body; read A's catalogue | `entity_id` always from the verified JWT (never client input); row ownership filters; participation gate; `GET /:chit_id` 404s non-participants; F1/F3/F7 closed the known leaks | **Isolation is app-layer discipline, no DB backstop** → **B1 (RLS)**, **B2/B3**; only proven by review, not tests → **A2/A4**; network `:id` residual → Track-B bridge |
| **Insider / compromised co-assist** | See/act on chits beyond their remit within the entity | Actor confined to `parent_entity_id`; removed/deactivated actor loses access next request; actor OTP cap (F5); actor acts under entity context | **No per-actor scoping — a co-assist sees ALL the entity's chits** → **D1/D2** (claim already softened, D3) |
| **End-customer (no-login)** | Tamper order prices; brute customer OTP; read others' orders | Server-authoritative re-pricing (F6); per-customer my-orders isolation; collision-free `.cr` key (F2); catalogue rate limit; OTP cap | SMS delivery is a dormant stub → **G1**; public exposure (`gstn`/`address`) confirm → **G2** |
| **Key / token compromise** | Forge tokens with a leaked `JWT_SECRET`; reuse a stolen token | HS256 pinned; strong-secret boot guard; actor re-check per request | **No entity-token revocation/short TTL; no documented secret rotation** → **C1/C2** (the single point of failure) |
| **Infra / operator error** | Ship code ahead of schema; lose data; expose internals | `withTransaction` on critical writes; `safeErr` (now incl. cb_* routes, C3); request-id logging | No migration ledger → **E1**; `fp01` is a reconstruction → **E2**; backups on a laptop bundle → **E4**; one dev=staging → **E3** |
| **XSS / client (the ~250KB monolith)** | Inject script to steal a `localStorage` token | `esc()` sweep across render paths; demo isolated in `DEMO`/`demoApi()` | esc() completeness unproven; token in `localStorage` is XSS-reachable; CSP off → **F1**, pairs with **C1** |

## Top risks (do-first, by leverage)
1. **Isolation is one-trust-layer-deep + unproven against a DB** → Track **A** (prove) + **B** (RLS backstop).
2. **Auth is the single point of failure** (no revocation/rotation) → Track **C**.
3. **No within-entity least privilege** (co-assist sees all) → Track **D** (claim softened now, D3).

> **Standing rule:** any new endpoint/query that touches a tenant table MUST scope on `req.identity` (the verified
> JWT), never client input, and filter by `entity_id`. Treat any cross-entity leak as a drop-everything P0.
