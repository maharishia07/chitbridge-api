# Observability & runaway-safety (design)

Design for: catching the *unknown* (generic guards + traceability), and a switchable
information/warning/critical message system with a defined destination. To settle before going hard to prod.

## 1. Looping / runaway risk catalogue
### Inside the app
| Risk | Status |
|---|---|
| **Assignment delegation cycle** (A→B→C→A) | No live gap (direct set); guard mandatory when auto-routing ships — see checklist. |
| **Network tree cycle** | Guarded (ltree `parent <@ child`, 409). |
| Auto-refresh / re-render thrash (web) | Bounded by 20s interval + `api()` in-flight + double-fire lock. |
| Chit state-machine loop (Hold↔Active) | User-driven, no auto-transition. |
| **Future automation / event echo** (action → notification → automation → action) | Not built; needs origin-tag + idempotency before any automation lands. |
| Unbounded recursion | None today (tree walks are SQL/ltree, not recursion). |

### Outside the app
| Risk | Status |
|---|---|
| Client retry storm / DoS | Rate limits: global (500/15m) + auth (30/15m). |
| **Unbounded query payloads** (reads with no/large LIMIT) | Gap — add a hard max page size cap. |
| **Connector / IoT echo loop** (external system re-triggers a chit) | Future — needs idempotency keys + origin tag + circuit breaker. |
| Deep/expensive tree queries | Bounded by tree depth; consider a depth cap. |
| Runaway DB query | Gap — set a DB `statement_timeout`. |

## 2. Generic guards (defense-in-depth)
- **Loop/hop cap + visited-set** on ANY chain-follow (assignment routing, network forward) — reject on revisit.
- **Idempotency keys** on mutations (`Idempotency-Key` header → dedupe) — kills duplicate/echo.
- **Max query LIMIT** (cap `?limit=` to e.g. 100) + **DB `statement_timeout`** (kill runaway queries).
- **Circuit breaker** for outbound/external calls (open after N failures) — when connectors land.
- **Rate limits** (have; add a per-entity tier later).
- **Web**: `api()` double-fire lock + in-flight indicator (built).

## 3. Severity model — switchable (BUILT: `lib/logger.js`)
Levels **debug · info · warn · error · critical**, one structured JSON line each. **Switch with `LOG_LEVEL`**
(prod=`info`, debug session=`debug`, quiet=`warn`). Adopt incrementally (replace scattered `console.*`).
- **INFO** — normal events (request, state change). **WARN** — recoverable/should-look (overloaded actor,
  weak secret, rate hit). **ERROR** — a request failed (via `safeErr`/global handler). **CRITICAL** — system
  integrity / must-page (boot abort, **tenant-isolation breach**, repeated failure, runaway guard tripped).

## 4. Traceability (BUILT: request id)
- Every request gets `req.id` (incoming `X-Request-Id` or minted), echoed in the response header, logged with
  each line → correlate a user report to its server logs.
- Domain audit already in **`state_log`** (who did what to a chit). System/error logging is separate (this).
- **Frontend** (design): a `window.onerror` / unhandledrejection beacon → `POST /api/client-error` → same
  pipeline, so client crashes are traceable too.

## 5. Where it lands (sinks)
- **All levels → stdout → Railway log aggregation** (today; greppable JSON).
- **CRITICAL → `log.onCritical(fn)` sink** (hook is built; wire the `fn` later) → persist to an **`error_log` /
  `system_events` table** (queryable, durable) **and** push an **alert** (email/Slack/webhook). The P0
  isolation-invariant breach is CRITICAL → must alert.
- **Frontend** → INFO/WARN/CRITICAL map to toast / amber toast / persistent banner (extend `MSG`), plus the
  beacon for the durable trail.

## 6. Phased plan (held; build in order)
1. **Now (this slice):** `lib/logger.js` + request-id + wired into request log / `safeErr` / global handler / boot. ✅
2. **Next:** replace remaining `console.*` with `log`; add max-LIMIT cap + DB `statement_timeout`.
3. **Then:** `error_log` table + `log.onCritical` sink + alert channel; frontend `/api/client-error` beacon + `MSG` warn/critical tiers.
4. **With connectors:** circuit breaker + idempotency keys + origin tags (echo-loop guard).

Cross-refs: `AMENDMENT-CHECKLIST.md` (loop-cap / leveled-log / LIMIT-cap checks), `TECH-HARDENING-BACKLOG.md`.
