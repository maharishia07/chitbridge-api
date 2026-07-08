# Live regression harness

End-to-end harnesses that drive the **live API** and assert the desired result — the empirical way we caught the folder-RLS, proof-permission, draft-leak and dispute-scope bugs. This is the automated verification the SDLC map flagged as missing.

## Run
```
node scripts/regression.js       # cross-entity mailing model: send/CC, isolation, status, messages, disputes, attachments, delete-independence
node scripts/lifecycle-iot.js    # IoT connector lifecycle: create→device→rotate→heartbeat→exception→proof→auto-file→RLS→cockpit→delete
node scripts/actor-harness.js    # actor perspective: actors share entity data; drafts are author-private (list + detail)
node scripts/dispute-scope.js    # 3-party chit + targeted dispute: a chit party NOT in the dispute sees 0 dispute messages
node scripts/cancel-request.js   # sender void = request: own copy voided, recipient's copy untouched, flagged [cancel requested] message
```

Override the target with `CB_API=https://... node scripts/<name>.js` (defaults to production).

## How it authenticates
Dev-mode entity login: `POST /api/entities/register` returns a `dev_otp` for test entities → `POST /api/entities/verify` → JWT. Actor tests create actors under the entity and log in via `POST /api/actors/login`. **Only works against dev/test entities** — a real entity won't return a code.

Test entities used: **Alpha Timbers** (`71373522-…`), **Beta Traders** (`75c378a6-…`), plus a throwaway **gamma-reg@test.com** for non-participant isolation. These create disposable test chits/connectors.

## What "green" means
Each script prints `PASS n · FAIL m` and lists any issues. All should be 0 failures against a correctly-migrated DB (b48–b68 applied). A failure that's a *test* bug prints the actual status/body so it can be pinpointed (see the b67/b68 fixes for the pattern — `pg_get_functiondef` reveals a corrupted deployed function).

## The invariant they protect
Nothing is shared between entities: every entity holds its own per-copy of chits, messages, attachments, disputes; RLS-isolated; deletable independently. See migrations b63–b68.
