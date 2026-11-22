/* till-kit-signin-halves.test.cjs — the two halves of the one sign-in window (signin-more-ways.js, signin-session.js) travel in the till kit:
 * the shop PC serves them at /app/, the kit update refreshes them, the vendor script copies them byte for byte from the web master, and they still work with no network.
 * Static plus two tiny calls; no server, no database.
 * CARD      18-identity-sign-in-and-access/sign-in
 * OWNER     cb-counter
 * RISK      security
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const API = path.join(__dirname, '..'), kit = path.join(API, 'tools', 'tally-connector');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const HALVES = ['tools/tally-connector/signin-more-ways.js', 'tools/tally-connector/signin-session.js'];
const prog = read(path.join(kit, 'till.js'));
const vendor = read(path.join(API, 'scripts', 'vendor-till.cjs'));
const kitNames = (read(path.join(API, 'routes', 'integrations.js')).match(/const KIT_NAMES = \[([^\]]*)\]/) || [])[1] || '';
let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };

for (const rel of HALVES) {
  const name = path.basename(rel);
  ok(fs.existsSync(path.join(API, rel)), 'the till kit carries ' + name + ' (a walk of the shop PC serves it)');
  ok(prog.includes("'/app/" + name + "': ['" + name + "'"), 'till.js serves /app/' + name + ' offline, so the sign-in window opens with no network');
  ok(new RegExp('live: \\[[^\\]]*\'' + name.replace('.', '\\.') + '\'').test(prog), 'the kit update refreshes ' + name + ' (sync from the web master)');
  ok(kitNames.includes("'" + name + "'"), 'the kit zip carries ' + name + ' for every country bill: IN, AU and AE shops');
  ok(vendor.includes("path.join(WEB, 'app', '" + name + "'), path.join(API, 'tools', 'tally-connector', '" + name + "'), 'copy'"), 'scripts/vendor-till.cjs vendors ' + name + ' as a byte copy of the web master');
  ok(vendor.includes("'/app/" + name + "'"), 'the service worker shelves ' + name + ' so an offline start still has it');
}

/* the vendored copy is byte-equal to the web master when the web checkout is beside this one (CI has it; a lone checkout skips) */
const webApp = path.join(process.env.CB_WEB_DIR || path.join(API, '..', 'chitbridge-web'), 'public', 'app');
if (fs.existsSync(webApp)) {
  for (const rel of HALVES) ok(read(path.join(webApp, path.basename(rel))) === read(path.join(API, rel)), path.basename(rel) + ' is a byte copy of the web master (vendored)');
}

/* each half loads on its own against the engine and does its one job */
globalThis.CBSignin = { who() {} };
const session = require(path.join(API, HALVES[1]));
const claims = session.claims('x.' + Buffer.from(JSON.stringify({ role: 'owner', jti: 'j1' })).toString('base64url') + '.y');
ok(claims.role === 'owner' && claims.jti === 'j1', 'the session half reads a token claim offline (no call to the server)');
ok(JSON.stringify(session.claims('not-a-token')) === '{}', 'the session half reads a broken token as no claims, never a throw');
const provider = require(path.join(API, HALVES[0]));
ok(provider.isKey('google') && !provider.isKey('nobody'), 'the provider half offers a known provider and refuses an unknown key');
console.log('till-kit-signin-halves ok · ' + checks + ' checks');
