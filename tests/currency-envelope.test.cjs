/**
 * tests/currency-envelope.test.cjs — every write to identities.currency_code obeys the same envelope.
 *
 * ⚠️⚠️ THE GAP THIS CLOSES WAS FOUND BY TRACING A SINGLE ROW. The b179 dry run showed one production business
 * holding AED while the base constitution permitted only INR/USD/MXN/EUR — a value the platform's own API would
 * have refused. Tracing it turned up THREE writers of that column and only ONE check:
 *
 *   routes/entities.js       PATCH /profile          checked the envelope        ✓
 *   routes/network-design.js POST /build   (create)  wrote what the plan said    ✗
 *   routes/network-design.js POST /build   (update)  wrote what the plan said    ✗
 *   scripts/seed-2026-08-05  raw SQL, by hand        bypasses the API entirely   (how AED actually arrived)
 *
 * ⭐ THE FIX IS ONE ANSWERER, NOT THREE CHECKS — lib/govresolve.currencyRefusal. Three copies of a rule drift;
 * this route is proof, since it was written later and simply never grew the guard. This test exercises the
 * answerer directly AND through the profile route, because a shared function nobody calls is not a fix.
 */
const API = 'C:/dev/chitbridge-api';

let ENVELOPE = null;   // what the active constitution permits; null = no restriction
/* ⚠⚠ A FLAG, NOT A FUNCTION SWAP. lib/govresolve does `const { query } = require('../db')` — it captures the
   function at import. Reassigning db.query afterwards changes nothing it can see, so my first version of the
   'unreadable governance' case silently kept reading the working stub and reported a refusal as a failure of
   the code. Destructured imports cannot be monkey-patched; the stub has to own the behaviour. */
let THROWS = false;
require.cache[require.resolve(API + '/db')] = { exports: {
  query: async (sql) => {
    if (THROWS) throw new Error('governance unavailable');
    if (/FROM constitution/.test(sql)) {
      return { rows: [{ constitution_key: 'base', version: 'v2',
        governance: ENVELOPE ? { allowed: { currencies: ENVELOPE } } : { allowed: {} }, capabilities: [] }] };
    }
    return { rows: [] };
  },
  withEntity: async () => ({ rows: [] }),
  withTransaction: async () => ({ rows: [] }),
} };

const { currencyRefusal } = require(API + '/lib/govresolve');

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = String(got) === String(want);
  if (ok) { pass++; console.log('  \u2713 ' + name.padEnd(58) + got); }
  else { fail++; console.error('  \u2717 ' + name.padEnd(58) + got + '   EXPECTED ' + want); }
};

(async () => {
  console.log('\n\u2500\u2500 shape, which no envelope can excuse \u2500\u2500');
  ENVELOPE = null;
  /* ⚠️ AN UNBOUNDED LIST IS NOT AN UNVALIDATED ONE. currency_code is varchar(3), so 'zz9' fits the column,
     passes every layer, and then renders forever as the literal 'zz9' — Intl throws on it and money() falls
     back to printing the raw code. Lifting the cap made this the ONLY check standing. */
  t('lowercase is normalised, not refused', await currencyRefusal('e', 'sgd'), 'null');
  t('two letters refused',      (await currencyRefusal('e', 'SG')).code,      'CURRENCY_MALFORMED');
  t('four letters refused',     (await currencyRefusal('e', 'SGDX')).code,    'CURRENCY_MALFORMED');
  t('digits refused',           (await currencyRefusal('e', 'ZZ9')).code,     'CURRENCY_MALFORMED');
  t('empty refused',            (await currencyRefusal('e', '')).code,        'CURRENCY_MALFORMED');
  t('  \u2026and the message shows what was sent', /ZZ9/.test((await currencyRefusal('e','ZZ9')).message), 'true');

  console.log('\n\u2500\u2500 the envelope \u2500\u2500');
  t('with no restriction, any real code passes', await currencyRefusal('e', 'CNY'), 'null');
  ENVELOPE = ['INR', 'USD', 'MXN', 'EUR'];
  t('a restricting constitution refuses what it excludes', (await currencyRefusal('e','SGD')).code, 'CURRENCY_NOT_ALLOWED');
  t('  \u2026and names the permitted set',  (await currencyRefusal('e','SGD')).allowed.join(','), 'INR,USD,MXN,EUR');
  t('  \u2026while a permitted one passes',  await currencyRefusal('e', 'USD'), 'null');
  t('the AED row that started this WOULD have been refused', (await currencyRefusal('e','AED')).code, 'CURRENCY_NOT_ALLOWED');

  /**
   * ⚠️ GOVERNANCE UNREADABLE MUST NOT INVENT A RESTRICTION. If the constitution lookup throws, the honest
   * answer is "no envelope known", not "nothing is allowed" — a refusal caused by a failed read would block
   * legitimate trade for a reason nobody could see or fix.
   */
  console.log('\n\u2500\u2500 when governance cannot be read \u2500\u2500');
  THROWS = true;
  t('an unreadable constitution permits, it does not refuse', await currencyRefusal('e', 'SGD'), 'null');
  t('  …but a malformed code is still refused', (await currencyRefusal('e','zz9')).code, 'CURRENCY_MALFORMED');
  THROWS = false;
  /* ✓ and the switch really did something — the same call refuses again once the read works. */
  t('  …and the envelope is back once it can be read', (await currencyRefusal('e','SGD')).code, 'CURRENCY_NOT_ALLOWED');

  /**
   * ⭐⭐ AND THE POINT OF THE WHOLE EXERCISE: the network builder now asks the same question. Checked at the
   * SOURCE rather than by driving /build, which needs a whole tree, a plan and an operator — the assertion that
   * matters is that this route calls the shared answerer at all, since not calling it was the entire bug.
   */
  console.log('\n\u2500\u2500 every writer of the column asks \u2500\u2500');
  const fs = require('fs');
  const writers = [
    ['routes/entities.js',       'PATCH /profile'],
    ['routes/network-design.js', 'POST /build'],
  ];
  for (const [f, what] of writers) {
    const src = fs.readFileSync(API + '/' + f, 'utf8');
    const writes = /currency_code\s*=|currency_code,/.test(src);
    t(what + ' writes the column', writes, 'true');
    t('  \u2026and calls currencyRefusal', /currencyRefusal\s*\(/.test(src), 'true');
  }
  /* ⚠️ BOTH LOOPS, NOT ONE. The create path and the update path each write currency_code; guarding only the
     create would leave a store able to acquire a refused currency by MOVING. */
  const nd = fs.readFileSync(API + '/routes/network-design.js', 'utf8');
  t('network build guards BOTH create and update', (nd.match(/currencyRefusal\s*\(/g) || []).length, 2);
  /* ⚠️ AND IT RESOLVES THE ENTITY, NOT THE CALLER. A co-assist's own row carries no governance stamp, so
     currencyRefusal(me, …) would quietly fall back to `base` and skip the business's real constitution. */
  t('  \u2026against the entity, not the acting co-assist', /currencyRefusal\(auth\.entityOf\(req\)/.test(nd), 'true');

  console.log('\n  \u2550\u2550 ' + pass + ' passed \u00b7 ' + fail + ' failed \u2550\u2550\n');
  process.exit(fail ? 1 : 0);
})();
