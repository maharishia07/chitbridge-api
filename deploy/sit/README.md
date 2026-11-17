# SIT: two self-hosted installations

`sit-in.ondcpro.com` (India pack, INR) and `sit-au.ondcpro.com` (Australia pack, AUD), each on its own Oracle Always Free VM
(Ubuntu 24.04, arm64, 2 OCPU / 12 GB). One stack per VM: Postgres 16, the api, the web, Caddy (automatic HTTPS), and a small gate (`ask.cjs`) for
storefront certificates. It is `deploy/compose.yml` plus `deploy/sit/docker-compose.yml`; nothing is copied.

## Steps, in order (Athi)

**1. GoDaddy DNS** (ondcpro.com, DNS, Add; TTL 600 on each; use each VM's public IP from Oracle)

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `sit-in` | public IP of the India VM | 600 |
| A | `*.sit-in` | same IP | 600 |
| A | `sit-au` | public IP of the Australia VM | 600 |
| A | `*.sit-au` | same IP | 600 |

**2. Oracle security list** (each VM's subnet, Security List, Ingress Rules; source `0.0.0.0/0`, TCP): ports **22**, **80**, **443**.
Optional: UDP 443 (HTTP/3). Do not open anything else: Postgres, the api and the web are not published on the machine at all.

**3. On each VM** (SSH in as `ubuntu`). While the repos are private, make a read-only GitHub token (fine-grained, "Contents: read" on `chitbridge-api`
and `chitbridge-web`), then:

```sh
export GIT_TOKEN=<the token>
mkdir -p ~/sit && cd ~/sit
git -c "http.https://github.com/.extraheader=Authorization: Basic $(printf 'x-access-token:%s' "$GIT_TOKEN" | base64 -w0)" \
  clone --branch plat/sit-deploy-kit https://github.com/maharishia07/chitbridge-api.git
export API_REF=plat/sit-deploy-kit        # until the PR is merged; then drop it (main)
sh chitbridge-api/deploy/sit/up.sh in     # on the India VM;  `au` on the Australia VM
```

First run installs Docker, opens 80/443 in the VM's own firewall, writes `deploy/sit/.env` with generated secrets, builds, migrates the empty
database, writes this installation's row (country pack), starts the stack and prints the health of web and api and the commit each runs.
Re-run the same command any time to update; it only changes what changed. It seeds nothing: the first shop is made by registering.

**4. Check** after DNS has spread (a few minutes at TTL 600): open `https://sit-in.ondcpro.com`. The first request makes Caddy fetch the certificate (a few seconds).
`https://sit-in.ondcpro.com/health` must answer. If `up.sh` said "does not answer yet", it is DNS or step 2; Caddy keeps retrying by itself.

**5. Australia only, the long-distance feel:** `sh chitbridge-api/deploy/sit/netem.sh on` adds about 150 ms and 1% loss to everything the VM sends
(Mumbai to Sydney); `off` removes it; `status` shows it. A reboot also clears it. SSH will feel it too.

## Two installations talking: CTP

`up.sh` gives each installation its own Ed25519 key (`CTP_PRIVATE_KEY` in `deploy/sit/.env`, made on first run, never printed) and sets the `ctp_endpoint` of its own
`installation` row, so `https://<host>/.well-known/ctp.json` answers with an endpoint, a public key and `can_sign: true`. To let the two talk, name each as the
other's peer, on BOTH VMs, then run `up.sh` again (the host names are the ones in `SIT_HOST`):

```sh
SIT_PEERS=sit-au=129-225-90-80.sslip.io sh chitbridge-api/deploy/sit/up.sh in     # on the India VM
SIT_PEERS=sit-in=129-225-85-65.sslip.io sh chitbridge-api/deploy/sit/up.sh au     # on the Australia VM
```

A peer is an `installation` row marked remote (`hosted_locally=false`, a domain, an endpoint). Its public key is never copied: the receiving door reads it from the
sender's own manifest on every check (cached 15 minutes, a failed read too, so restart the api after fixing a key). Population: only `live` crosses.
What the kit does NOT do: it cannot make a shop on one side addressable from the other. A recipient must be a local `identities` row, and nothing in the product
creates one for a business that lives elsewhere yet (`lib/ctpaddress.js resolveAddress` has no caller), so a send across needs that row made by hand (see the SIT report).

## Sign-in tonight

The daily tester code. `up.sh` prints it on the first run. It is `<fixed part><yymmdd>` where the fixed part is `TESTER_CODE` in `deploy/sit/.env` and `yymmdd`
is today in India (in) or Sydney (au), for example `3fa91c07261024`. Yesterday's code also works until 06:00. Register or sign in with a name that matches
`TESTER_NAMES` (default `*@test.chitbridge` or `qa-*`; edit `.env`, run `up.sh` again). The screen may say "we couldn't send your code": that is the placeholder
mail key; type the tester code. Remove `TESTER_CODE`, `TESTER_NAMES` and `TESTER_CODE_TZ` before any real user.

**E-mailed code later.** The api sends mail only through Resend (no SMTP code; `docs/28-platform-and-operations/CLOUD-DEPENDENCY.md` row 1). Set in `.env`:
`RESEND_API_KEY` (real key), `FROM_EMAIL` (a sender on a domain verified at Resend), keep `OTP_EMAIL_ENABLED=true`. If you want your own SMTP server, run a
Resend-compatible relay and set `RESEND_BASE_URL` to it. `SMTP_HOST/PORT/USER/PASS` are not read by the api today. Then run `up.sh` again.

## Storefronts and a shop's own domain

`https://<shop>.sit-in.ondcpro.com` gets a certificate on its first visit (no wildcard certificate: GoDaddy's DNS API is not usable here). Caddy asks `ask.cjs`
first; it says yes only for the host itself, ONE label under it that is a handle the api has a live storefront for, or a name listed in `ASK_CUSTOM_HOSTS`.
A shop's own domain (its CNAME to `sit-in.ondcpro.com`) goes through the same path: add the name to `ASK_CUSTOM_HOSTS` by hand, then `up.sh`. The api has no record of
which domain belongs to which shop and the web does not open a storefront from the Host name yet, so today the certificate and the app work, the shop's own front page does not
(`CLOUD-DEPENDENCY.md` row 2). Let's Encrypt allows 50 certificates a week per registered domain; `ask.cjs` caches and caps itself so made-up names cannot burn it.

## Where things are

| | |
|---|---|
| `.env` (secrets, mode 600, never committed) | `deploy/sit/.env`; the api's copy without the owner password is `.api.env` |
| logs | `cd deploy/sit && docker compose -p chitbridge -f ../compose.yml -f docker-compose.yml --env-file .env logs -f api` |
| database | named volume `chitbridge_cbdata`; the owner password is in `.env`; `deploy/backup.sh` is the existing backup |
| certificates | named volume `chitbridge_caddydata` (back it up or Let's Encrypt reissues) |
| not proven here | the compose file was read, not run (`docker compose config` and Docker builds do not run on the build laptop). First `up.sh` is the proof |
