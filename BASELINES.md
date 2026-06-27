# Baselines

Known-good, restorable points, grouped by feature so you can return to the right one quickly.
Each baseline is a git **tag**. To look at one without changing anything: `git checkout <tag>`.
To restore a branch to it: `git reset --hard <tag>` then `git push --force-with-lease` (dev only — coordinate first).

## chitbridge-api

| Baseline | Commit | Date | Features included | Notes |
|---|---|---|---|---|
| `baseline-0-pre-consolidation` | `75f653c` | 2026-06-27 | Pre-consolidation live state — cb_chit loop still mounted, original `/send` | Rollback before the consolidation work |
| `baseline-1-compose-fanout` | `5249f20` | 2026-06-27 | cb_chit chit-loop **retired**; Compose **To/CC/For fan-out** on `chit_header.role`; `fp01` + `user_id` + `role` migrations | **Verified live** on dev (smoke: `fan_out{to,cc,for}`, To=pending / CC=delivered) |
| `baseline-2-priority` | `9e7efe2` | 2026-06-27 | fp01 priority endpoints: internal `PUT /:id/priority` (urgent→action msg) + customer `PUT /:id/priority-flag` (cross-edge write-once, action-msg trail) | `feat/priority` merged |
| `baseline-3-user-id` | `e0d67f8` | 2026-06-27 | external `user_id` (ATH-114): `GET /me` returns it · `PATCH /profile` sets it (409 case-insensitive unique) · `GET /lookup?user_id=` resolves | `feat/user-id` merged |
| `baseline-4-chit-actions` | `c50d283` | 2026-06-27 | `/sent` · `/rollup` (counterparty\|state) · `/archive`+`/unarchive` · `/void` (sender terminal, cross-edge) · `/assign-bulk` · `/api/notifications` (derived) | `feat/chit-actions` merged; needs `archived_at` migration |
| `baseline-5-compose-fix` | `cb7bdd8` | 2026-06-27 | compose `/send` works without `purpose` (defaults `order`; accepts panel `subject`/`schema_values`) | `feat/compose-fix` merged; verified live |

## chitbridge-web

| Baseline | Commit | Date | Features included | Notes |
|---|---|---|---|---|
| `baseline-0-web-pre-fanout-panel` | `e6d52e7` | 2026-06-27 | Older task panel (no To/CC/For) | Rollback before the fan-out panel |
| `baseline-1-web-fanout-panel` | `593c843` | 2026-06-27 | Fan-out task panel (To/CC/For) at `/app.html`, `STAGE=dev` → live API | Test URL: https://chitbridge-web.vercel.app/app.html |
| `baseline-2-web-auto-refresh` | `bbe87eb` | 2026-06-27 | auto-refresh active list every 20s (skips while typing/reading/composing/modal/hidden) | `feat/auto-refresh` merged |

## Convention going forward
- Feature work happens on `feat/<feature>` branches.
- Merge to `main` only when verified; then tag `baseline-N-<feature>` and add a row here.
- Keep api and web baselines at the same `N` when they ship together, so a restore picks a coherent pair.
