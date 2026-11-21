'use strict';
/**
 * tests/samecount-consent.test.cjs - SAMECOUNT A-F-58: "has anyone agreed to offers" is ONE count (lib/consent-counts).
 * The Home Marketing card and Marketing's "why a result is 0" must answer from it: with 1 party agreed, Home says 1 and Marketing never says "nobody agreed".
 * Offline. Run: node tests/samecount-consent.test.cjs
 * CARD 12-marketing/README
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let agreed = 1, sql = [];
const handle = { query: async (text) => { sql.push(text); return /party_contact_pref/.test(text) ? { rows: [{ agreed, said_no: 0 }] } : { rows: [] }; } };
const refused = { party_id: 'p1', status: 'refused', reason: 'No consent for offers', send_ref: 'S1', created_at: new Date().toISOString(), party_name: 'O Brien' };
stub('db', { query: async () => ({ rows: [] }), withEntity: async (o, fn) => fn({ query: async (text) => (/party_contact_pref/.test(text) ? handle.query(text) : { rows: [refused] }) }), readBatch: async () => [] });
stub('lib/schema', { hasColumn: async () => true, hasTable: async () => true });
stub('lib/policy', { get: async () => ({}) });
stub('lib/select', { rows: async () => [] });
const Home = require('../lib/home-facts.js'), R = require('../lib/marketing-results.js'), C = require('../lib/consent-counts.js');

(async () => {
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };
  await t('the one count reads standing rows (the customer\'s own no outranks a staff yes), as Groups does', async () => {
    await C.agreedCounts(handle, 'e1');
    assert(/standing|source/.test(sql[0]) && /to_jsonb/.test(sql[0]));
  });
  await t('1 agreed: Home says 1 agreed and Marketing does NOT say nobody agreed', async () => {
    const home = await Home.BUILD.marketing({ entity: 'e1', actor: 'e1' }), came = await R.cameBack('e1', {});
    assert.strictEqual(home.figures.agreed, 1);
    assert.notStrictEqual(came.why.code, 'NO_CONSENT');
  });
  await t('0 agreed: Home says nobody and Marketing says NO_CONSENT (same count, both ways)', async () => {
    agreed = 0;
    const home = await Home.BUILD.marketing({ entity: 'e1', actor: 'e1' }), came = await R.cameBack('e1', {});
    assert.strictEqual(home.figures.agreed, 0);
    assert.strictEqual(came.why.code, 'NO_CONSENT');
  });
  console.log('\n' + n + ' checks passed');
})().catch((e) => { console.log('  FAIL ' + e.message); process.exit(1); });
