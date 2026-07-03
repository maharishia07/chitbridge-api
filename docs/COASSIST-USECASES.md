# Co-assist (Actor) module — Use-case library

The **living catalogue** of what the co-assist (actor) module does. One row = one use case: trigger →
rule → pre/process/post → **bindings touched** → notification → owner (AUTO = system, DECISION = admin).
Keep this TRUE as the module grows (other actor types, leave, shift rotation, wage/salary…). Pair with
`COASSIST-REGRESSION.md` — every change re-runs those cases.

## Data model (source of truth)
- **`identities`** (identity_type='actor', parent_entity_id=entity): `display_name`, `actor_key` (User ID — unique
  within entity; login = `key@entity`), `actor_role`, `actor_type` (human/iot_device/connector/ai_agent/process_rule),
  `hat` (view_only/act/audit/mis/manager — **assignable = act,manager**), `break_status`
  (active/short_break/leave/deactivated/removed), `pin_hash`, `pin_set_at`, `otp_code`, `otp_expires_at`,
  `delegate_actor_id` (**leave-cover**), `last_assigned_at`, `current_task_count`, `max_tasks`, `return_date`.
- **`entity_actor_settings`**: `assignment_model`, `default_max_tasks`, `auto_assign_mode`, `default_assignee_actor_id`.
- Actor bindings that must be kept consistent: `chit_status.assigned_to_actor_id` (tasks),
  `identities.delegate_actor_id` (cover, both directions), `entity_actor_settings.default_assignee_actor_id`,
  `chit_disputes.dispute_handler_actor_id`. **Audit (never cleared):** `chit_header.created_by_actor_id`,
  `state_log.action_by_identity_id`.

## Lifecycle & identity
| # | Use case | Rule / pre → process → post | Bindings | Notify | Owner |
|---|----------|-----------------------------|----------|--------|-------|
| U1 | **Create co-assist** | `POST /actors` — Display name + User ID (lowercase a-z0-9, min 4, unique) + hat. → inserts actor `break_status='active'`, generates OTP. | otp_code set | invite dialog shows **User ID + one-time code** (admin relays) | DECISION |
| U2 | **First-time login** | actor enters `key@entity` + OTP → `POST /actors/login` (no pin_hash → OTP path) → JWT + `requires_pin_setup` → `POST /set-pin`. | pin_hash set, otp cleared | — | actor |
| U3 | **Returning login** | pin_hash set → login demands **PIN** (OTP is useless once a PIN exists). 5 wrong → lock. | pin_attempts / pin_locked_at | — | actor |
| U4 | **Re-invite** | only meaningful **pre-PIN** (lost the code). `POST /:id/otp` → new OTP. Does NOT clear PIN. | otp_code | invite dialog | DECISION |
| U5 | **Reset PIN** | for a **forgotten/locked PIN**. `DELETE /:id/pin` → clears pin_hash **AND** issues a fresh OTP (else the actor is locked out). | pin_hash cleared, otp_code set | invite dialog | DECISION |
| U6 | **Edit profile** | `PATCH /:id` — name/role/hat/max_tasks/phone. Delegate saved via `PUT /:id/delegate`. Surgical row+detail refresh, cursor stays. | hat / delegate | toast + voice | DECISION |

## Leave-cover (delegate)
| # | Use case | Rule | Bindings | Notify | Owner |
|---|----------|------|----------|--------|-------|
| U7 | **Set leave-cover** | `PUT /:id/delegate` — delegate must be Act/Manager of the entity, not self. **Buddy pairs (A↔B) ALLOWED** (loop-check relaxed; integrity via auto-assign runtime cycle-guard + concurrency check). | delegate_actor_id | (passive — reverse "Covers for" on their profile; active notify = backlog) | DECISION |
| U8 | **Cover visibility** | View shows **Covered by** (their delegate) + **Covers for** (reverse); list rows show both lines + 🛡 count. People shown by **name + User ID** (names collide). | — | — | AUTO |

## Shift / availability
| # | Use case | Rule | Bindings | Notify | Owner |
|---|----------|------|----------|--------|-------|
| U9 | **Actor Duty/Break** | actor top-bar toggle → `PUT /break` (self-only) `short_break`/`end_break`; persists (survives refresh) + entity roster shows it. | break_status | toast | actor |
| U10 | **Concurrency check** | going off is **blocked** if (a) you're covering someone who's away, or (b) your own cover is away — can't both be off (buddy safety). | — | red toast | AUTO |
| U11 | *Entity set-shift* | **BACKLOG** — actor self-managed is the model. Removed the broken `acShift` (hit self-only /break). |||

## Deactivate / reactivate / remove
| # | Use case | Rule / process | Bindings CLEANED | Notify | Owner |
|---|----------|----------------|------------------|--------|-------|
| U12 | **Deactivate** | `PUT /:id/status` action=deactivate (+task_action pool/actor if load>0). Login blocked. **Full binding cleanup** (atomic). | tasks→routed · own delegate→null · inbound cover→null · default_assignee→null (if them) · dispute_handler→null (best-effort). **Audit kept.** | **result dialog** lists every binding cleaned + voice | DECISION |
| U13 | **Reactivate** | action=reactivate → break_status active + fresh OTP. **Cover/assignee links are NOT auto-restored** (re-set manually). | otp_code | invite dialog | DECISION |
| U14 | **Remove permanently** | action=remove + confirm=REMOVE. Same cleanup as deactivate; irreversible. | (as U12) | result dialog | DECISION |

## Auto-assign integration (D1/D2) — see `ACTOR-SETTINGS-BEHAVIOUR.md`
| # | Use case | Rule |
|---|----------|------|
| U15 | **Assignability gate** | only **Act/Manager** hats are assignable (bulk/single/route/deactivation-reassign all enforce it). |
| U16 | **Auto-assign on receipt** | modes off / default_assignee / least_loaded (tie = least-recently-assigned; overflow→default; on-leave→delegate chain, cycle-guarded). |

## Roster UI
| # | Use case | Rule |
|---|----------|------|
| U17 | **Tabs** | Active (status='active', incl. on-break) / Inactive (deactivated/removed) / All. Tab change re-renders tabs+rows together (no stale highlight). Roster fetches `status=all`; client filters. |
| U18 | **Row scan** | ● shift dot · name · hat · ⏳ invite (no PIN) · load/max · role · login · shift · returns-date · cover lines. |

## Growth roadmap (this module WILL extend — keep the catalogue + tests in step)
- **Actor types** beyond human: iot_device/connector/ai_agent/process_rule — need device-ID validation + their own auth (not OTP→PIN). [backlog]
- **Leave module**: on-leave for N days (return_date + task routing), leave calendar (actor profile + entity page). [backlog]
- **Shift rotation**, **wage/salary calculation** — new sub-capabilities under the same module.
- **Modularity**: co-assist screen is currently EAGER (in the inline Core). Target = a lazy **`cap-workforce`** capability (see `COASSIST-REGRESSION.md` §Modularity) so these features load on demand. Shared helpers (`mapApiActor`, `hatLabel`, `hatAssignable`, `HAT_LABEL`, `acType`) stay in Core (assign pickers use them).
