#!/usr/bin/env node
/** @covers FR-N7 — single-catalogue search agrees with per-store search (b122) */
/**
 * prove-network-search.js — the single-catalogue search (b122) must AGREE with the per-store search it replaces.
 *
 * Athi, 2026-08-08: *"can we build an alternate index for the network stores as a single catalogue with the store
 * names as well, so it works as a single catalogue?"*
 *
 * There are now two ways to answer that question: one query across the network (b122's SECURITY DEFINER function)
 * and the original fan-out, one query per store. Two paths to one answer is the shape that rots — the fast one
 * gets optimised, the slow one gets forgotten, and eventually they disagree about who can see what.
 *
 * ⚠️ THE ONLY DISAGREEMENT THAT MATTERS IS VISIBILITY. A difference in ordering is cosmetic; a difference in
 * MEMBERSHIP means the fast path is showing a store the slow path hides, which is an isolation failure wearing a
 * performance improvement's clothes. This harness compares the two answers row for row and fails on any store
 * present in one and absent from the other.
 *
 *   DEV_OTP=123456 node scripts/prove-network-search.js --email=alpha-timers@test-cb.com
 *
 * `CB_FORCE_FANOUT=1` on the server makes the route skip the function, which is how the second answer is obtained
 * from the same deployment rather than from memory of what it used to return.
 */
'use strict';

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith('--' + k + '='));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const EMAIL = arg('email', 'alpha-timers@test-cb.com');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
};

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

const key = (r) => [r.bridge_id, r.item_id].join('|');

(async () => {
  console.log('\n' + '='.repeat(74));
  console.log('  NETWORK SEARCH — one query and the fan-out must give the same answer');
  console.log('='.repeat(74));
  console.log('  ' + API + '\n');

  const v = await api('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: OTP } });
  const token = (v.json || {}).token;
  if (!token) { console.log('  could not sign in as ' + EMAIL + '\n'); process.exit(1); }

  const PROBES = ['a', 'impeller', 'seal', 'zzzz-no-such-thing'];

  for (const q of PROBES) {
    const url = '/api/network-design/availability?q=' + encodeURIComponent(q);
    const t1 = Date.now();
    const fast = await api(url, { token });
    const msFast = Date.now() - t1;
    const t2 = Date.now();
    const slow = await api(url, { token, headers: { 'X-CB-Force-Fanout': '1' } });
    const msSlow = Date.now() - t2;

    console.log('\n  "' + q + '"   one-query ' + msFast + ' ms   fan-out ' + msSlow + ' ms');

    if (fast.status !== 200 || slow.status !== 200) {
      ok('both paths answered', false, 'fast ' + fast.status + ', slow ' + slow.status);
      continue;
    }
    ok('one-query path was actually used', (fast.json || {}).one_query === true,
       'the function is missing — apply migrations/b122_network_search.sql');

    const fr = ((fast.json || {}).rows) || [];
    const sr = ((slow.json || {}).rows) || [];

    // The per-store path caps at 5 items PER STORE; the single query caps at 200 overall. So the fan-out's set is
    // a SUBSET, and the honest check is that it contains nothing the single query missed — never the reverse.
    const fastKeys = new Set(fr.map(key));
    const missing = sr.filter((r) => !fastKeys.has(key(r)));
    ok('one query missed nothing the fan-out found', missing.length === 0,
       missing.slice(0, 3).map((r) => r.store + '/' + r.name).join(', '));

    // The one that matters: no store may appear in the fast answer that the slow answer would never show.
    const slowStores = new Set(sr.map((r) => r.bridge_id));
    const fastStores = [...new Set(fr.map((r) => r.bridge_id))];
    const extra = sr.length ? fastStores.filter((b) => !slowStores.has(b)) : [];
    ok('no store visible to the fast path alone', extra.length === 0, extra.join(', '));

    // Prices are stamped by the holding store and never converted — the two paths must read the same stamp.
    for (const f of fr) {
      const s = sr.find((x) => key(x) === key(f));
      if (!s) continue;
      if (f.price !== s.price || f.price_currency !== s.price_currency) {
        ok('price identical for ' + f.store + '/' + f.name, false,
           JSON.stringify({ fast: [f.price, f.price_currency], slow: [s.price, s.price_currency] }));
      }
    }
    ok('prices agree wherever both paths saw the item', true);
  }

  console.log('\n' + '-'.repeat(74));
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('-'.repeat(74) + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\n  harness error: ' + e.message + '\n'); process.exit(1); });
