> # ⚠️ RETIRED 2026-08-21 — DO NOT ACT ON THIS DOCUMENT
> 
> **It describes a `panel-*.js` split that never happened.** The app was modularised as ~20 lazily-loaded
> `cap-*.js` capabilities instead (see `MODULES.md` beside this file). None of `panel-task.js`,
> `panel-compose.js`, `panel-disputes.js`, `panel-relations.js` or `panel-admin.js` was ever written.
> 
> ⚠️ It sat in the code directory saying **"in progress"** for weeks, which is the worst place for a plan that
> was abandoned: the first thing someone reads next to the source describes an architecture that is not there.
> 
> Kept because the *reasoning* still holds and still governs the real design — one client, one response
> envelope, classic scripts so inline `onclick` keeps working, no framework, no build step. That part came
> true; only the file names did not.
> 
> ---

# Task Panel — app.html module split (in progress)

`app.html` is the **canonical frontend** going forward. To keep it from becoming one
unmaintainable file, it is being split into modules that all share **one client + one
response envelope**. Classic scripts (shared global scope) so the existing inline
`onclick="…"` handlers keep working — no framework, no build step.

## Done
- **`core.js`** (module 1) — the shared client: `fill()`, `unwrap()` (the `{ok,data,error}`
  envelope), `api()` (auth header + `401`→re-auth / `422`→validation / `500`→generic).
  Loaded by `app.html` before its main script. **Every panel calls `api()`; no panel does its
  own fetch or per-feature unwrap.**

## Plan (extract incrementally, verifying each step — never break the live app)
- `core.js`            — client + envelope (✅ done)
- `helpers.js`         — generic render helpers (`esc/opt/scr/scrErr/val`) + mappers (`mapApiChit/Msg/Actor`)
- `panel-task.js`      — inbox / chit detail / messages / assign / advance
- `panel-compose.js`   — compose chit + add actor
- `panel-disputes.js`  — disputes queue + resolve
- `panel-relations.js` — network / suppliers / catalogue
- `panel-admin.js`     — profile / settings / MIS / co-assists
- `app.html`           — markup + `<script src>` loads, in order, ending with the boot/route call

## Rule for new features
**one EP row + one mapper + one panel module** — nothing else. New panels land in this clean
pattern (shared client, single envelope) from the start.
