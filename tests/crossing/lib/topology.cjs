'use strict';
/**
 * tests/crossing/lib/topology.cjs — reads and checks THE topology file (tests/crossing/topology.json) and holds the one HOST GUARD.
 * OWNS      the topology's shape check · the staging-only host guard · "which installations does this scenario need" (single or multi mode)
 * CALLED BY tests/crossing/run.cjs · lib/client.cjs · lib/secret.cjs · lib/db.cjs · web e2e/lib/crossing.cjs (the browser spec) · tests/ctp-crossing-pack.test.cjs
 * FLOW      load → validate (every host starts with 'staging.', every pair names real shops, every binding names a real pair) → scenarios ask needs(id)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system / ctp crossing pack
 *
 * ⚠️ THE GUARD IS HARD, NOT POLITE: signing in is only ever done to a host that (a) starts with 'staging.' AND (b) is one of this file's installations.
 * Rule (a) alone would let 'staging.evil.example' through; rule (b) alone would let someone add a production host to the file. Both, in code, and a test for each.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'topology.json');
const STAGING = /^staging\./;

/** the host of a base URL or bare host, lower-cased; throws on anything that is not a plain https host (userinfo, ports, paths do not hide a host) */
function hostOf(urlOrHost) {
  const text = String(urlOrHost || '').trim();
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
  } catch (_) {
    throw new Error('crossing guard: "' + text + '" is not a host I can read');
  }
  if (parsed.username || parsed.password) throw new Error('crossing guard: a URL with a user name in it is refused: ' + parsed.hostname);
  return parsed.hostname.toLowerCase();
}

/** the guard: returns the host, or throws. `known` = the hosts of the topology's installations. */
function assertSignInHost(urlOrHost, known) {
  const host = hostOf(urlOrHost);
  if (!STAGING.test(host)) throw new Error('crossing guard: refusing to sign in to "' + host + '" - only hosts that start with "staging." are test hosts');
  if (/^http:\/\//i.test(String(urlOrHost))) throw new Error('crossing guard: refusing a plain http URL (' + host + '); test hosts are https');
  if (!known || !known.includes(host)) throw new Error('crossing guard: "' + host + '" is not an installation in tests/crossing/topology.json');
  return host;
}

function load(file) {
  const raw = JSON.parse(fs.readFileSync(file || FILE, 'utf8'));
  return validate(raw);
}

/** shape check; adds `hosts` (all installation hosts) and `base(key)`; throws with every problem named */
function validate(topo) {
  const problems = [];
  const inst = topo.installations || {};
  const shops = topo.shops || {};
  for (const [key, row] of Object.entries(inst)) {
    if (!STAGING.test(String(row.host || ''))) problems.push('installation ' + key + ': host must start with staging. (got ' + row.host + ')');
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(String(row.ip || ''))) problems.push('installation ' + key + ': ip is not an address');
    if (!/^[a-z][a-z0-9_-]*$/.test(String(row.project || ''))) problems.push('installation ' + key + ': compose project name looks wrong');
  }
  for (const [key, shop] of Object.entries(shops)) {
    if (!inst[shop.installation]) problems.push('shop ' + key + ': installation ' + shop.installation + ' is not listed');
    if (!shop.user_id) problems.push('shop ' + key + ': user_id missing');
  }
  for (const [name, pair] of Object.entries(topo.pairs || {})) {
    for (const role of ['buyer', 'seller']) if (!shops[pair[role]]) problems.push('pair ' + name + ': ' + role + ' ' + pair[role] + ' is not a shop');
  }
  for (const [id, pair] of Object.entries(topo.bindings || {})) if (!(topo.pairs || {})[pair]) problems.push('binding ' + id + ': pair ' + pair + ' does not exist');
  if (problems.length) throw new Error('topology.json: ' + problems.join('; '));
  const hosts = Object.values(inst).map((row) => row.host.toLowerCase());
  return Object.assign({}, topo, { hosts, base: (key) => 'https://' + inst[key].host });
}

/** the pair a scenario is bound to: { name, buyer: {key,...shop}, seller: {...} } */
function pairOf(topo, id) {
  const name = (topo.bindings || {})[id];
  if (!name) throw new Error('no binding for scenario ' + id + ' in topology.json');
  const pair = topo.pairs[name];
  const shop = (key) => Object.assign({ key }, topo.shops[key]);
  return { name, buyer: shop(pair.buyer), seller: shop(pair.seller) };
}

/** the installations a scenario touches = its pair's two shops (a scenario may add more: pass `extra` shop keys) */
function needs(topo, id, extra) {
  const pair = pairOf(topo, id);
  const keys = [pair.buyer, pair.seller].concat((extra || []).map((key) => Object.assign({ key }, topo.shops[key])));
  return [...new Set(keys.map((shop) => shop.installation))];
}

module.exports = { FILE, hostOf, assertSignInHost, load, validate, pairOf, needs };
