# Critique · SIT-DEPLOY-KIT (plat/sit-deploy-kit, 2026-10-24) — written before any code
**(a) The brief assumes, checked**
- A Dockerfile for api and for web exist and are arm64-clean: TRUE (Dockerfile node:22-alpine; web nginxinc/nginx-unprivileged:1.27-alpine, both multi-arch). No native module (Node 22 pin, PR 365).
- A compose stack already exists: TRUE (deploy/compose.yml: db, migrate job, api, web, cb_app role). So: WIDEN it with an override file, never copy it.
- A migration runner and a no-seed path exist: TRUE (tools/migrate.cjs, baseline + ledger; the compose `migrate` job also sets cb_app's password). Nothing new written.
- Web finds the api separately: TRUE (public/config.js window.CB_API, written from CB_API_BASE by deploy/40-cb-api-base.sh). Same-origin is possible by pointing it at the web's own host.
- Country pack is a switch: PARTLY. It is the installation row's `country` (lib/country-setup.js:480 INSTALLATION_KEY; deploy/spin-lib.sh spin_installation is the existing INSERT). Reused as SQL, not a new script.
- Storefront subdomains and a shop's own domain: FALSE — neither api nor web routes by Host (grep subdomain/hostname: nothing). Caddy can only issue the certificate and serve the same app; a shop's own domain has no table behind it.
- Daily tester code: TRUE (lib/dev-otp.js TESTER_CODE with {yymmdd}, TESTER_NAMES must list names; a bare `*` is refused off a local stack). Mail: Resend SDK only, no SMTP code.
**(b) Conflicts**: none with DECISIONS rules. Sealed NODE_ENV=staging is kept (RLS, db-role check, no DEV_OTP) — SIT must behave like production.
**(c) Simpler way**: none; an override file on deploy/compose.yml is the least new surface.
**(d) Risks**: `ask` has no endpoint in the api (a new route would touch the api register and round-trip budget — another area), so a 40-line stand-in sits in deploy/sit/ask.cjs and reads the existing public GET /api/catalogue/:handle. CORS rejects an Origin it does not know: Caddy removes Origin on the api route (same-origin only). Oracle Ubuntu images ship iptables REJECT rules for 80/443: up.sh opens them. Private repos need a read token on the VM. `docker compose config` cannot run here — YAML checked by reading.
**(e) VERDICT: BUILD WITH CHANGES** — override file instead of a second stack; ask.cjs instead of a new api route; same-origin Caddy instead of a separate api host.
