/**
 * tests/conf-cache.test.cjs — the platform-config cache, and the one rule it must never break.
 *
 * ⭐⭐ CACHING CONFIG IS EASY; NOT CACHING A FAILURE IS THE PART THAT BITES. `readConstitution()` and
 * `loadActiveConstitution()` both turn an unreachable database into a fallback — null, or a 503. If the memo
 * stored that, one blink of the network would hold the fallback for a FULL MINUTE after the database came
 * back, on every entity at once. And the fallback is not neutral: a missing governance envelope PERMITS ANY
 * CURRENCY (lib/govresolve.js currencyRefusal), so a cached failure would not narrow the answer, it would
 * silently widen it. That is test 3, and it is the reason this file exists.
 *
 * ⚠️ RED-PROOFED: delete the `if (hit ...) return hit.value` line and test 1 fails; move the `cache.set`
 * above the `await fn()` and test 3 fails. Neither can pass by accident.
 */
const cc = require('C:/dev/chitbridge-api/lib/confcache');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n-- a resolved value is remembered --');
  cc.invalidate();
  let calls = 0;
  const read = () => { calls++; return Promise.resolve({ version: 'v' + calls }); };
  const a = await cc.memo('k1', read);
  const b = await cc.memo('k1', read);
  t('the source is asked once, not twice', calls === 1, calls + ' call(s)');
  t('both callers get the same answer', a.version === 'v1' && b.version === 'v1', a.version + ' / ' + b.version);
  t('and literally the same object', a === b);

  console.log('\n-- null is an ANSWER, not a miss --');
  cc.invalidate();
  let nCalls = 0;
  const readNull = () => { nCalls++; return Promise.resolve(null); };
  await cc.memo('k2', readNull);
  await cc.memo('k2', readNull);
  /* ⚠️ `constitution` legitimately has no row for a key that was never minted. Treating null as a miss would
     re-ask on every request for exactly the entities that resolve slowest. */
  t('a cached null is not re-read', nCalls === 1, nCalls + ' call(s)');

  console.log('\n-- ⭐⭐ A FAILURE IS NEVER CACHED --');
  cc.invalidate();
  let fCalls = 0, threw = 0;
  const readBoom = () => { fCalls++; return Promise.reject(new Error('ECONNRESET')); };
  for (let i = 0; i < 3; i++) { try { await cc.memo('k3', readBoom); } catch (_) { threw++; } }
  t('the error reaches the caller every time', threw === 3, threw + ' throw(s)');
  t('the source is asked again after a failure', fCalls === 3, fCalls + ' call(s)');
  t('nothing was written to the cache', cc.size() === 0, cc.size() + ' entr(ies)');
  /* And the recovery: the very next call after the database comes back must succeed, not serve a held failure. */
  const ok = await cc.memo('k3', () => Promise.resolve({ version: 'back' }));
  t('the call after recovery gets the real value', ok.version === 'back', ok.version);

  console.log('\n-- ⚠️ SIXTY SECONDS, NOT FOREVER (migrations are run by hand against a live server) --');
  cc.invalidate();
  let tCalls = 0;
  const readT = () => { tCalls++; return Promise.resolve(tCalls); };
  t('the default TTL is a minute', cc.TTL_MS === 60000, String(cc.TTL_MS));
  await cc.memo('k4', readT, 40);
  await cc.memo('k4', readT, 40);
  t('inside the window it is held', tCalls === 1, tCalls + ' call(s)');
  await sleep(60);
  const after = await cc.memo('k4', readT, 40);
  t('past the window it is asked again', tCalls === 2 && after === 2, tCalls + ' call(s)');


  console.log('\n-- ⭐⭐ A GUARD MAY REFUSE THE CACHE --');
  cc.invalidate();
  let gCalls = 0, envelope = 'wide';
  const readEnv = () => { gCalls++; return Promise.resolve(envelope); };
  await cc.memo('k7', readEnv);                       // read path warms it
  t('the read path is served from cache', (await cc.memo('k7', readEnv)) === 'wide' && gCalls === 1,
    gCalls + ' call(s)');
  envelope = 'tightened';                             // a migration ran
  /* ⚠️ THE DIRECTION IS WHAT MAKES THIS MATTER. The stale envelope is the WIDER one, so a guard reading it
     would ACCEPT a currency the constitution had just forbidden — and record the order. */
  t('fresh sees the tightening immediately', (await cc.memo('k7', readEnv, null, true)) === 'tightened',
    String(gCalls) + ' call(s)');
  t('and a fresh read leaves the cache warm, not empty',
    (await cc.memo('k7', readEnv)) === 'tightened' && gCalls === 2, gCalls + ' call(s)');
  console.log('\n-- invalidate --');
  cc.invalidate();
  let iCalls = 0;
  const readI = () => { iCalls++; return Promise.resolve(iCalls); };
  await cc.memo('k5', readI); await cc.memo('k6', readI);
  cc.invalidate('k5');
  await cc.memo('k5', readI); await cc.memo('k6', readI);
  t('one key drops without disturbing the other', iCalls === 3, iCalls + ' call(s)');
  cc.invalidate();
  t('no argument clears everything', cc.size() === 0, cc.size() + ' entr(ies)');

  console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
  process.exit(fail ? 1 : 0);
})();
