# Crossing pack — trading across installations, replayed by script

The 25 Oct 2026 hand walk (`docs/walks/WALK-2026-10-25-IN-AU.md`: R1–R30 IN↔AU, G1–G4 Grundfos) as a pack. Same scenario ids as the walk, so a red row maps to a walk row.
Two sides: **headless** (this folder, Node, no browser) and **browser** (web repo `e2e/tests/crossing.spec.js`, Playwright). Both read ONE file: `topology.json`.

## Where it runs
On a laptop that holds the SIT ssh key (`~/.ssh/sit_oracle`, user `ubuntu`) and can reach the four SIT hosts (all `staging.*.sslip.io`). Nothing runs on CI (it needs the VMs).
It is listed in `toolset/packs.json` as area `crossing` (white = the offline self-test and the unit tests that already cover pieces; black = the headless runner and the Playwright spec, both `live`, so
`/pack crossing` lists them and runs only the offline part unless `--live`).

## What it does
1. Reads the **tester code at run time** over ssh (`sudo docker exec <project>-api-1 sh -c 'printf "%s\n%s" "$TESTER_CODE" "$TESTER_CODE_TZ"'`), expands `{yymmdd}` / `{yyyymmdd}` in `TESTER_CODE_TZ`
   (default **Asia/Kolkata** — what the api does in `lib/dev-otp.js testerCodesNow`, not UTC) and keeps it in memory. It is never written, logged, printed, or put in a URL; errors are redacted.
2. Signs each shop in through the app's own door (`POST /api/signin/ask` then `/verify`, `mode: login`). **Hard guard**: it refuses any host that does not start with `staging.` or is not an installation in `topology.json`, before any request.
3. Drives the screen's own routes (supplier add/search/catalogue, `/api/chits/send`, `/amend`, `/proposals` + `/counter` `/accept` `/reject`, status, messages, disputes, void, attachments).
4. Verifies **both sides in the database**: read-only `psql` over ssh (`PGOPTIONS default_transaction_read_only=on`, one `SELECT`/`WITH` only, enforced in code): `chit_header` copies (`business_json.currency / deal_type / jurisdiction`,
   `summary_json.money`, md5 of the invoice and of the header money), `chit_status`, `chit_proposal` rounds, `ctp_event_out`, `chit_messages`, `chit_disputes`, `cb_attachment`, `entity_profile`, `supplier_list`.
5. Waits for the ctp-return cron (about a minute) by **polling** (`waits` in `topology.json`), stopping at the first yes — never a long fixed sleep.
6. Every run tags its chits `[CTPX <run id>]` and **deletes nothing**.

## Run it
```
node tests/crossing/run.cjs --multi                      every scenario (R0..R30, G1..G4)
node tests/crossing/run.cjs --single sit-grund           only scenarios whose shops all live on one installation (G1, G2, G3)
node tests/crossing/run.cjs --multi --only R16,G3        those ids; their prerequisites (R16 needs none; R21 needs R16 R17 R18 R20) run first and are marked "(prerequisite)"
node tests/crossing/run.cjs --multi --dry-run            print the plan; signs in nothing, opens no ssh
node tests/crossing/run.cjs --multi --allow-outage       also R8 (stops <project>-api-1 on the far installation for about a minute; starts it again in a finally)
   --cases                                                  print the test-library case rows (one per walk id); case-rows.json is that output, filed with: node toolset/test-library.cjs --add-cases tests/crossing/case-rows.json
   --topology <file>  --out <file>  --run-id <id>
```
Output: a pass/fail table, a JSON file (default `%TEMP%/crossing-<run id>.json`), exit code **0** nothing failed (SKIP and KNOWN do not fail) · **1** a scenario failed · **2** wrong command line · **3** a tester code could not be read.
Status words: PASS · FAIL · KNOWN (all hard checks pass and a documented open finding such as W19/W24 still fails — it says so loudly when it starts to pass) · SKIP (not in this mode / needs a flag / a prerequisite did not pass).
Browser: see web `e2e/README.md` "Crossing" (`CB_CROSSING=1 CB_API_DIR=<this checkout> npx playwright test --project=crossing [--headed]`). One Playwright invocation at a time.

## Offline self-test
`node tests/ctp-crossing-pack.test.cjs` (enrolled in `scripts/guards.cjs`): topology parse, every scenario bound, the staging-only guard (including a sign-in that must make NO request), the tester-code expansion checked against the api's own
`testerCodeOk`, the Secret never printing, the read-only SQL guard, the dry-run plan reaching for nothing (fetch and spawn are tripwires), selection and prerequisites, md5/digest/minor-unit/poll helpers, pass/fail/KNOWN/exit rules, no tester code in any file.

## Scenarios
| ids | what | headless | browser |
|---|---|---|---|
| R0 | setup: add the seller by address, send a tagged general chit across | yes | |
| R1 R2 R3 R4 | status crosses · internal note stays home · external message intact (₹ é —) · reply | yes | R1 repaint = fixme W14 |
| R5 R6 R7 | dispute raised / message / resolved, same ids both sides | yes | |
| R8 | far side down, two messages in order (opt-in `--allow-outage`) | yes | unconfirmed mark = fixme W18 |
| R9 | attachment byte-identical (sha256) | yes | |
| R10 R11 | cancel request / confirm | yes | |
| R12 | variant: another installation's search hides a shop that does not sell outside | yes | G4b |
| R13 | export opt-in state matches the topology | yes | Settings Save → confirm (cancelled) |
| R14 | remote catalogue in the seller's currency | yes | catalogue + cart bar |
| R15 | variant: `SUPPLIER_SELLS_ONLY_HERE` for a home-only shop | yes | the sentence on screen |
| R16 | order: quotation, jurisdiction, seller currency from the start, no invoice | yes | Review wording + request body states the currency; first-send confirm = fixme |
| R17–R22 | rounds 2–5 (seller prices; buyer counter is text, money null; stale accept refused; accept byte-identical; terms) | yes | rounds screen + step tracker = fixme W25 |
| R23–R25 | reverse direction: seller state, add by address (no duplicate), catalogue in INR | yes | |
| R26 | an api client that states no currency (KNOWN W24) | yes | |
| R27 R28 R29 R30 | order in INR · rounds with an Indian seller · reject · status | yes | |
| G1 G2 G3 | same installation: HUF supplier, domestic order stays domestic, RFQ by choice (amend → request round, domestic amend stays direct) | yes | G2 catalogue + cart in HUF; RFQ switch = fixme |
| G4 | AUD buyer ↔ DKK exporter: search, catalogue, quotation + jurisdiction, pro-forma crosses, accept identical | yes | G4b search, G4c catalogue/cart |

## Add an installation (or a shop, or another pair)
1. `topology.json` → `installations`: key, `host` (must start `staging.`), `ip`, compose `project`. Add `"db_key"` only if the installation's key in the database differs from the file key (the search `where=` and `jurisdiction.*_installation` use the database key).
2. `shops`: `user_id`, `bridge_id`, `currency`, `installation`, `exporter`, optional `fixture.item_match` (a regex for the catalogue item to order).
3. `pairs`: `{ buyer, seller }` shop keys; `bindings`: which pair each scenario id drives. Re-pointing `R16` at another pair is a one-line change; nothing else names a host.
4. `node tests/crossing/run.cjs --multi --dry-run` shows the plan; `node tests/ctp-crossing-pack.test.cjs` proves the file still validates.

## Findings the pack recorded while it was built (no product code was changed)
- The brief said the tester code expands in UTC when `TESTER_CODE_TZ` is unset; the api uses **Asia/Kolkata** (`lib/dev-otp.js:243`). The pack follows the api (and the test checks it against `testerCodeOk`).
- `POST /api/relationships/suppliers` answers without `supplier_entity_id` (`routes/relationships.js:221-236`); the pack reads the id back from `GET /suppliers` (`supplier_entity_id`, `supplier_list_id`).
- The walk's R12 (window-shopping before the opt-in) and R15 (Chennai refused while domestic) cannot be replayed: both shops are exporters now and the pack never switches a setting back. They run as **variants** on the one public non-exporter shop (`qa-grund-sup-hu`).
- R26: with no `business_json.currency` stated, an order to a remote seller is filed in the SENDER's money (`routes/chits.js sellerMoney`, test `send-seller-currency.test.cjs`); only the screen's statement prevents W24. Recorded as KNOWN W24, not fixed.
- Scenarios that create products (R23, G1b, G4a in the walk) are state checks here (the product must exist, public, in the seller's currency); the pack does not create catalogue data.
