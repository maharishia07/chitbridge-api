# e2e/proof — browser proofs that run on GitHub, not on a SIT box

Decision: docs DECISIONS `db6257c1` (Athi, 11 Nov). Workflow: `.github/workflows/proof.yml` (on demand). Stack step shared with `walks.yml`: `.github/actions/lay-api`.

| pack | file | what it proves |
|---|---|---|
| `a11y` | `a11y.cjs` | axe-core serious + critical on the 19 customer pages (`pages.json`), after opening every tab / summary / expander |
| `keyboard` | `keyboard.cjs` | tab order, focus ring, skip link, trap, arrows, popups (Esc, focus return, Enter, empty save, dirty Esc) |
| `walks` | `run.cjs` | the six fixture shards of `e2e/run-shard.cjs`, one after another |
| `walk-x.cjs` | `run.cjs` | one e2e walk / till file by name |

Measure only: every write to the app is aborted and counted (`guard.cjs`, proof `guard.test.cjs`). Local stack only (`lib.cjs` refuses another host); sign-in is the stack's DEV_OTP.
The 19-page list lives once, in `pages.json`.

```
gh workflow run proof.yml -R maharishia07/chitbridge-web -f packs=a11y,keyboard
gh workflow run proof.yml -R maharishia07/chitbridge-web -f web_ref=<branch> -f api_ref=<branch> -f packs=a11y -f widths=1366
```

On a laptop with a local stack (`node e2e/lib/stack-local.cjs up`, shop loaded by api `tools/sim-load.cjs`):
`node e2e/proof/run.cjs --packs a11y,keyboard --widths 1366,390 --out out/proof [--only crm,till] [--strict]`.
A finding (serious/critical, a trap, Esc not closing) is a FAIL row in `summary.md` and `junit-proof.xml` and a `::warning`; the job turns red only when a pack could not run, a page errored or a walk failed (`--strict` makes findings red too).

**On a SIT box (sit-au, the proofs box) against its own deployed stack** (QA, 11 Nov; same packs, same runner, read-only by the same write guard): add
`--base https://staging.<ip>.sslip.io --api https://staging.<ip>.sslip.io --remote-ok staging.<ip>.sslip.io --server sit-au --as cbt-au-retail [--users ~/.cb-sit-users.json]`.
Sign-in is a SIT test user's tester code (the users file is read, never printed, and its `host` for that server must equal the host being driven). The host check is a positive allowlist (`remote-hosts.json`: sit-au only; sit-in, the gate box, is never on it) plus a denylist (gate box dashed or dotted, chitbridge.com, railway.app, supabase.co); both are `remoteHostDecision` in `guard.cjs`, proven by `remote-host.test.cjs` (enrolled in ci.yml). To add a box, add its `staging.<dashed-ip>.sslip.io` to `remote-hosts.json` in a reviewed PR.
**Never upload `out/proof` from a SIT run as a PR or CI artifact**: its screenshots show the signed-in app on real SIT data. `proof.yml` uploads only its own localhost run; a box run keeps its result JSON and copies only that back.
