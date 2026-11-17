'use strict';
/**
 * policy-reachable.cjs — EVERY POLICY FLAG THE API READS CAN BE SET BY SOMEBODY.
 *
 * ── ⚠️⚠️ THE BUG THIS GENERALISES ─────────────────────────────────────────────────────────────────────────────
 *
 * Found 2026-09-12: `tol_weight_bp`, `tol_count_units` and `tol_rate_bp` had been live since 8 September.
 * `routes/till.js` read all three on every receipt and every reconciliation — and NOTHING in the product could
 * change them. Every shop on the platform was running the defaults, and none of them had ever been asked.
 *
 * ⭐ A POLICY NOBODY CAN SEE IS A POLICY NOBODY AGREED TO. That is worse than a missing feature: the number is
 * real, it decides whether a short delivery is a dispute, and it is invisible at both ends — the shopkeeper
 * cannot find it and nothing reports that it was never chosen.
 *
 * ⚠️ THE FAILURE MODE IS SILENCE, WHICH IS WHY IT NEEDS A GUARD RATHER THAN A HABIT. Adding a flag is one line in
 * lib/policy.js; wiring a control is a different repo. Nothing connected the two, exactly like the CORS header
 * list that took the whole app down in August (chitbridge-api/tests/cors-headers.test.cjs, same shape, same fix).
 *
 * ── ⭐ WHAT COUNTS AS REACHABLE ───────────────────────────────────────────────────────────────────────────────
 *
 * The flag's key appearing anywhere in the web app: the POLICY_FLAGS card in cap-admin.js, a screen of its own
 * (units and languages have one in cap-catsetup.js), or a connector screen. This is deliberately generous — it
 * asks "could a person get at this at all", not "is it on the card I expect".
 *
 * ⚠️ AND A FLAG MAY BE DELIBERATELY UNREACHABLE, but it has to SAY so here, with a reason. A list of exceptions
 * somebody wrote is a decision; an empty result is an assumption.
 *
 * Run: node e2e/policy-reachable.cjs
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
/* QA-154: CB_API_REPO names the api checkout (ci.yml's .side/chitbridge-api); when it is set the api MUST be there (a skip would be a green no-op) */
const POLICY = path.join(process.env.CB_API_REPO ? path.resolve(process.env.CB_API_REPO) : path.join(__dirname, '..', '..', 'chitbridge-api'), 'lib', 'policy.js');

/**
 * ⚠️ Each entry is a REASON, not a silencer. When one of these grows a screen, delete its line — and if a line
 * here ever stops being true, the flag is a bug wearing an exception.
 */
const DELIBERATELY_UNREACHABLE = {
  match_tolerance_pct:
    'declared but NOT ENFORCED — lib/policy.js says so in its own note: nothing reads it, the matching engine '
    + 'does not exist yet. A control for a number that changes nothing would be worse than none.',
  retention_floor_days:
    'the retention FLOOR is a platform rule, not an entity choice — it is the minimum an entity may not go below, '
    + 'so a control here would offer to relax something that cannot be relaxed.',
  stream_owner:
    'written by the connector handshake, never typed: a stream is CLAIMED by whichever connector carries it, and '
    + 'Settings › Integrations shows the claim rather than offering to edit it.',
};

let pass = 0;
const fails = [];

if (!fs.existsSync(POLICY)) {
  console.log('\n── policy flags reachable ──\n  skipped: ../chitbridge-api not checked out\n');
  process.exit(process.env.CB_API_REPO ? 1 : 0);
}

/** every flag key the API declares — read from the source, so a new flag is caught the day it lands */
const src = fs.readFileSync(POLICY, 'utf8');
const block = src.slice(src.indexOf('const FLAGS'), src.indexOf('function defaults'));
const keys = [...new Set([...block.matchAll(/^\s{2}([a-z_][a-z0-9_]*):\s*\{/gm)].map((m) => m[1]))];

if (keys.length < 15) {
  console.error('  x only found ' + keys.length + ' flags — the FLAGS block has changed shape, and this guard is '
    + 'now measuring the wrong thing. Fix the reader before trusting the result.');
  process.exit(1);
}

/** everything a person can reach in the browser. ⚠️ public/engine is EXCLUDED: it is generated from the API. */
let web = '';
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'engine') walk(p); }
    else if (/\.(js|html)$/.test(f)) web += fs.readFileSync(p, 'utf8');
  }
})(WEB);

console.log('\n── every policy flag the API reads can be set by somebody ──');
console.log('  ' + keys.length + ' flag(s) declared in lib/policy.js');

/* ⭐ T2-POLICY (2026-10-14): the Business rules card's rows are DEFINED in lib/policy.js (`const CARD`, sent as schema[key].ui) and the
   card paints whatever the server sends — so a flag with a CARD row is reachable without its key appearing in this repo. */
const cardAt = src.indexOf('const CARD');
const cardKeys = cardAt < 0 ? [] : [...src.slice(cardAt, src.indexOf('};', cardAt)).matchAll(/^\s{2}([a-z_][a-z0-9_]*):\s*\{/gm)].map((m) => m[1]);
const cardPainted = cardKeys.length && /polDefs\(\)/.test(web) && /\.ui\b/.test(web);
console.log('  ' + cardKeys.length + ' of them on the Business rules card (lib/policy.js CARD → schema[key].ui)' + (cardPainted ? '' : ' — but the web does not paint it'));
const unreachable = [];
const noControl = [];
for (const k of keys) {
  if (web.indexOf(k) >= 0) { pass++; continue; }
  if (cardPainted && cardKeys.indexOf(k) >= 0) { pass++; continue; }
  if (DELIBERATELY_UNREACHABLE[k]) { pass++; unreachable.push(k); continue; }
  noControl.push(k);
}
/* QA-154: a flag with no control is a finding; the known ones are in e2e/scanner-known.json and only a NEW one fails */
const RK = require('./lib/known-findings.cjs').ratchet('policy-reachable', noControl.map((k) => ({ key: k, show: k })), { owner: 'settings' });
console.log(RK.line);
RK.fresh.forEach((i) => fails.push(String.fromCharCode(96) + i.show + String.fromCharCode(96) + ' is read by the API and appears NOWHERE in the web app (NEW) — nobody can set it, and nothing '
  + 'says it was never chosen. Give it a control, or add it to DELIBERATELY_UNREACHABLE with the reason.'));
pass += noControl.length - RK.fresh.length;


/* ⚠️ an exception for a flag that no longer exists is a note about nothing, and it hides the next one */
for (const k of Object.keys(DELIBERATELY_UNREACHABLE)) {
  if (keys.indexOf(k) < 0) {
    fails.push('`' + k + '` is listed as deliberately unreachable and is not a flag any more — delete the line.');
  } else pass++;
}

if (unreachable.length) {
  console.log('  ' + unreachable.length + ' deliberately without a control, each with a reason:');
  unreachable.forEach((k) => console.log('     · ' + k + ' — ' + DELIBERATELY_UNREACHABLE[k].split('—')[0].trim()));
}

fails.forEach((f) => console.error('  x ' + f));
if (!fails.length) console.log('  OK — ' + pass + ' check(s): every flag is reachable, or says why not\n');
process.exit(fails.length ? 1 : 0);
