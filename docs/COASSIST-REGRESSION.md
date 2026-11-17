# Co-assist (Actor) module — Regression test cases

Run this whenever the co-assist module changes. IDs map to `COASSIST-USECASES.md` (U#). ✅ = pass, ✍️ = record.
Two layers: **manual smoke** (fast, UI) and **API assertions** (curl/script, deterministic). Keep both GREEN.

## Setup
- Web: `<vercel>/app.html` (stage=dev → `chitbridge-api-production.up.railway.app`). Hard-refresh after deploys.
- Fresh entity + 3-4 clean actors (old actors created before the login fixes are inconsistent — recreate).
- Deploy note: web is multi-file — `core.js` + `helpers.js` + `cap-admin.js` must ship with `app.html`.
- Migrations applied: `b39` (hat) → `b40` (auto-assign) → `b41` (disputes). `GET /actors` selects `hat/delegate/last_assigned/pin_set_at/otp_code`, so these are hard prerequisites.

## A. Identity / login lifecycle
| ID | Steps | Expected |
|----|-------|----------|
| R-U1 | + New → Display name `Anitha`, User ID `anitha1`, hat Act → Create | invite dialog shows `anitha1@<entity>` + a 4-digit code; row shows `⏳ invite`; **cursor lands on the new actor** (scrolled into view) |
| R-U2 | Sign out → login `anitha1@<entity>` + the code → set a 4-digit PIN | login OK; topbar shows **display name** (not `anitha1`); Profile is the **actor** profile (Name/Login/Role/Works-for/Status + Change PIN) |
| R-U3 | Sign out → login with **PIN** | OK. Wrong PIN 5× → locked message. Login-state on the entity side flips to **✓ Active — PIN set** |
| R-U4 | (pre-PIN actor) detail → **Re-invite** | dialog with a fresh code; button is Re-invite **only while pinSet=false** |
| R-U5 | (PIN-set actor) detail → **Reset PIN** | dialog with fresh code; button is Reset-PIN **only while pinSet=true**; next login demands the OTP then a new PIN |
| R-U6 | Edit → change hat + delegate → Save | "updated ✓"; **only that row + detail refresh** (no full-list reload); cursor stays on them |

## B. Leave-cover + concurrency
| ID | Steps | Expected |
|----|-------|----------|
| R-U7a | Edit Anitha → leave-cover = Priya → Save | Anitha View: **Covered by Priya `priya1`**; Priya View: **Covers for Anitha `anitha1`**; Priya row shows 🛡 covers 1 |
| R-U7b | Edit Priya → leave-cover = Anitha (buddy pair) | **Allowed** (no loop error) |
| R-U10 | Anitha on Break → Priya tries Break | Priya blocked, **red toast**: "Your leave-cover Anitha is also away…" (and the reverse: covering someone away blocks too) |
| R-U8 | two `priya`s (`priya1`,`priya2`) both as covers | shown distinctly by **User ID**, never ambiguous by name |

## C. Deactivate / reactivate / remove (the binding cleanup — critical)
| ID | Steps | Expected |
|----|-------|----------|
| R-U12a | Assign Anitha some tasks, make her a cover + default-assignee → **Deactivate** | in-app confirm (not browser). Result dialog **lists**: N tasks routed · own cover cleared · was cover for M — links removed · was default assignee — cleared. Voice announces it |
| R-U12b | after deactivate: query the DB / re-open others | Anitha's `delegate_actor_id`=null; nobody's `delegate_actor_id`=Anitha; `default_assignee_actor_id`≠Anitha; her tasks reassigned; **`created_by_actor_id` / `state_log` unchanged** |
| R-U17a | Active tab now | Anitha **not** in Active (she's deactivated); she IS in Inactive/All. Deactivate does NOT leave inactive under Active |
| R-U13 | Deactivated actor → **Reactivate** | fresh code dialog; cover/assignee **not** auto-restored |
| R-U14 | **Remove permanently** | confirm=REMOVE required; same cleanup; row shows `removed`, only in Inactive/All |

## D. Roster UI / rendering (the "froze" class of bugs)
| ID | Steps | Expected |
|----|-------|----------|
| R-U17b | click **Inactive / All / Active** tabs | **blue highlight moves** each click; rows match the selected tab (the old bug: highlight stayed on Active while rows showed all) |
| R-nav | on Co-assists, click Task/Order/etc. | menu highlight moves + screen changes (not stuck) |
| R-U18 | scan rows | dot colour = shift; hat chip; ⏳ invite iff no PIN; load/max; cover lines with name+id |
| R-msg | trigger any error (e.g. cover conflict) | toast is **above** footer/assistant, **red** for errors / amber for warnings; wraps cleanly |

## E. Auto-assign gate (D1/D2)
| ID | Steps | Expected |
|----|-------|----------|
| R-U15 | Task → Assign; set an actor to View-only/Audit/MIS | that actor is **greyed "not assignable (hat)"** in the picker and **drops from** the Settings default-assignee dropdown |
| R-U16 | Settings → auto-assign least_loaded; send a chit to the entity | lands on the least-loaded assignable actor; if all full → default assignee; on-leave → their delegate |

## API assertion sketch (extend `scripts/test-dev.js` / a new `scripts/coassist-suite.*`)
```
# each returns the documented shape; assert on it
POST /actors {display_name,actor_key,hat}            -> 201 {actor.identity_id, otp, login_format}
POST /actors/login {username, otp}                   -> {token, requires_pin_setup:true}
POST /actors/set-pin {pin,confirm_pin}               -> {message}
POST /actors/login {username, pin}                   -> {token, actor.break_status}
PUT  /actors/:id/delegate {delegate_actor_id}        -> {actor.delegate_actor_id}   # buddy pair allowed
PUT  /actors/break {break_type:'short_break'}        -> 400 Cover conflict when cover is away
PUT  /actors/:id/status {action:'deactivate',task_action:'pool'} -> {tasks_routed, covers_removed, was_default_assignee, disputes_cleared, had_cover}
GET  /actors?status=all                              -> includes deactivated; break_status correct
# negative: assign to non-Act/Manager hat -> 400; delegate to self -> 400; delegate to non-Act/Manager -> 400
```

## Modularity / delayed-loading (DONE — co-assist is now lazy)
- **Now:** `core.js` + `helpers.js` (eager) + capability loader (`ensureCap`/`CAP_OF`). Lazy caps: `cap-admin.js` (MIS/Profile/Settings), **`cap-workforce.js` (co-assists)**, **`cap-help.js` (help/assistant content)**.
- **`cap-workforce.js` (functionality)** — `CAP_OF.coassists='workforce'`. Moved: coassistsScreen, acVisible/acRowHTML/acRowsHTML/paintAcList/paintAcDetail, selectActor/setAcMode/setAcFlt/acDetailHTML, acReinvite/acResetPin/acStatus/saveActor, loadCoassists. **Kept in Core** (shared / inline / small leaves): `mapApiActor`, `hatLabel`/`hatAssignable`/`HAT_LABEL` (assign pickers), `acLbl`/`acType`/`acShc`/`acShLabel`/`acFlt`/`acDate`/`acLogin`, `addActorModal`/`submitActor`/`actorInviteModal`/`actorCleanupModal`/`confirmAsk`, `coId`/`acIdPrev`/`entBiz`/`defActorHandle` — the moved cap references them at runtime (Core is eager, loaded first).
- **`cap-help.js` (content, NOT functionality)** — help/assistant is not always called, so its libraries download only on first use. Moved: `CO_HELP`, `ASSIST_LIB` (seed), `COMPOSE_HELP`. `openHelp`/`openAssist` are now thin **gated stubs** (`ensureCap('help').then(_openHelpImpl/_openAssistImpl)`); the assist engine (helpBoxFromLib/buildAssistLib/matchLibrary/assistSuggest…) stays in Core and touches the arrays only post-gate. **Kept eager in Core:** `HELP_PACKS`/`menuAssist`/`ASSIST_PAGES`/`PURPOSE` (rendered INLINE in a few screens → can't be async). Further-split candidate: make inline `menuAssist` lazy too.
- **Verify lazy-loading (R-cap):** DevTools Network — `cap-workforce.js` fetched **on first open of Co-assists** (not before); `cap-help.js` fetched **on first "?" or 💬** (not before); both cached after. Core screens never trigger a cap fetch. Functionality is unchanged — only *when* it loads changed.

## Automation TODO
- Wire the API assertion sketch into a runnable `scripts/coassist-suite.*` (mirrors `isolation-suite`), green in CI.
- These cases are the contract — any new sub-feature (leave/shift/wage/new actor types) ADDS rows to `COASSIST-USECASES.md` and a matching R-U here before merge.
