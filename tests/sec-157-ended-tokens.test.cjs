/**
 * tests/sec-157-ended-tokens.test.cjs — SEC-157 follow-up (critic 12 Nov): the list of signed-out legacy tokens and its cache.
 *   · the list is pruned by each entry's OWN exp, never cut by count: 300 live sign-outs all stay refused (a count cut would bring the oldest back to life)
 *   · an entry past its exp is dropped on the next write
 *   · the per-process cache is bounded (ENDED_CACHE_MAX): a flood of random tokens cannot grow it without end, and a cut entry is simply re-read, never answered wrongly
 * lib/person-session.js with a stand-in shop row (policy_flags kept as JSON). Run: node tests/sec-157-ended-tokens.test.cjs · no network, no DB.
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

let FLAGS = {};
const q = async (sql) => (/FROM identities/i.test(String((sql && sql.text) || sql)) ? { rows: [{ policy_flags: JSON.parse(JSON.stringify(FLAGS)) }], rowCount: 1 } : { rows: [], rowCount: 0 });
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, withTransaction: async (fn) => fn({ query: q }) });
stub('lib/policy', { patchKey: async (db, shop, keys, value) => { FLAGS = Object.assign({}, FLAGS, { [keys[0]]: JSON.parse(JSON.stringify(value)) }); } });
const sessions = require(path.join(API, 'lib', 'person-session'));
const tx = async (fn) => fn({ query: q });
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

(async () => {
  const SHOP = 'shop1';
  for (let i = 0; i < 300; i++) await sessions.endLegacy(tx, SHOP, 'token-' + i, FUTURE);
  t('300 live sign-outs are ALL kept (pruned by exp, never cut by count)', (FLAGS.ended_tokens || []).length === 300, String((FLAGS.ended_tokens || []).length));
  t('the OLDEST one is still refused (a count cut would have brought it back)', (await sessions.legacyEnded(q, SHOP, 'token-0')) === true);
  t('a token never signed out is not refused', (await sessions.legacyEnded(q, SHOP, 'never-signed-out')) === false);
  FLAGS.ended_tokens.push({ h: 'f'.repeat(32), exp: Math.floor(Date.now() / 1000) - 10 });
  await sessions.endLegacy(tx, SHOP, 'token-new', FUTURE);
  t('an entry past its exp is dropped on the next write (301 live remain, the expired one gone)', FLAGS.ended_tokens.length === 301 && !FLAGS.ended_tokens.some((x) => x.h === 'f'.repeat(32)), String(FLAGS.ended_tokens.length));
  for (let i = 0; i < 2600; i++) await sessions.legacyEnded(q, SHOP, 'flood-' + i);
  t('a flood of random tokens leaves the cache bounded (≤ 2000)', sessions.endedCacheSize() <= 2000, String(sessions.endedCacheSize()));
  t('…and a token whose cache entry was cut is simply re-read: still refused when it was signed out', (await sessions.legacyEnded(q, SHOP, 'token-0')) === true);
  console.log(`\n${pass + fail} checks · ${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
