# SEC1 critique — the tester code is Athi's secret (written before any code)

(a) Assumptions, checked: · lib/dev-otp.js is "the door" — TRUE for ISSUING (lib/dev-otp.js:54 fixedOtp), but a fixed code works by being
STORED as identities.otp_code; the one VERIFY is lib/otp.js:41 verifyOtp (signin.js → identity-auth.js:260, catalogue.js:904/960/1301,
connectors.js:492). So the tester code must live on the VERIFY side — never issued, stored or e-mailed (issuing it would mail Athi's secret
to every real user). · a second door exists: lib/otp.js:26 generateOTP reads DEV_OTP raw — folded into dev-otp. · prod NODE_ENV=" development"
is unsealed (dev-otp.js:38) → fixed codes live on Railway today — TRUE. · rate limiter: server.js:230 authLimiter 30 / 15 min / IP on the
sign-in doors + verifyOtp's 5 wrong tries per account (lib/otp.js:5) — TRUE, both cap tester-code guessing. · "≥ 8 chars" vs the boxes:
FALSE today — api validators cap the code at exactly 6 (signin.js:384, catalogue.js:887/942/1287, connectors.js:479) and the web sign-in box
has maxlength 6 (web public/app/signin-ui.js:378; shop.html checks length!==6). Must widen or no tester can type the code.
(b) Conflicts: one door — the rule sits in dev-otp (testerCodeOk) and verifyOtp asks it; no second compare. Sealed envs: the tester code is
NOT blocked by sealing (Athi wants it on the live api; unset = off) — stated in HOSTING.md. The echo (dev_otp in a body) becomes local-only too.
(c) Simpler: none found — widening verifyOtp reaches every door in one place.
(d) Risks: · LANDING: the moment this deploys, Railway refuses the fixed codes — Athi sets TESTER_CODE in Railway FIRST, then merge.
· real (non-tester) people on Railway get a random code; with OTP_EMAIL_ENABLED off they never receive it (same as any sealed env) —
the employee first code is still shown to the admin who created them (actors.js login_instruction, unchanged). · the guard scope: the
literal codes stay in local-stack tools (scripts/, tests/, tools/sim-load, e2e local stacks) which only run against a local DB; the guard
covers what ships (lib · routes · middleware · db · server.js · public · docs except LOCAL-STACK docs · .env.example). · unit tests
that read fixedOtp() now set a local DATABASE_URL. · twin: web e2e reads E2E_TESTER_CODE; land api + web together. No migration (b412–414 unused).
(e) VERDICT: BUILD WITH CHANGES — verify-side tester code (not issued); widen the 6-char validators/boxes to 6–64; guard scoped to shipped files.
