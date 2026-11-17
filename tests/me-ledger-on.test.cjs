/**
 * tests/me-ledger-on.test.cjs — GET /entities/me answers `entity.ledger_on` (boolean): the ONE boot answer to "is the Ledger on for this shop?".
 * The first screen (app · crm · accounts) used to ask GET /books/health, which is 404 LEDGER_OFF by design for a shop with none → a red failed
 * request in the console. PROVES: on → true · off → false · no row → false · the books read failing → false (never a guess that it is on).
 */
const API = require('path').join(__dirname, '..').split(require('path').sep).join('/');
let setting = { enabled: true },
  boom = false;
require.cache[require.resolve(API + '/db')] = {
  exports: {
    query: async (sql) => {
      if (/information_schema/.test(sql)) return { rows: [{ a: 1 }] };
      if (/FROM identities WHERE identity_id/.test(sql)) return { rows: [{ identity_id: 'e1', capabilities: [] }] };
      return { rows: [] };
    },
    withEntity: async (id, fn) => fn({ query: async () => ({ rows: [] }) }),
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) })
  }
};
require.cache[require.resolve(API + '/lib/books')] = { exports: { ledgerOnBatch: async () => { if (boom) throw new Error('boom'); return !!(setting && setting.enabled); } } };
const express = require('express'), app = express();
app.use(express.json());
require.cache[require.resolve(API + '/middleware/auth')] = {
  exports: Object.assign((q, r, n) => { q.identity = { identity_id: 'e1', identity_type: 'entity' }; n(); }, { entityOf: (q) => q.identity.identity_id })
};
app.use('/api/entities', require(API + '/routes/entities'));
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? (pass++, console.log('  \u2713 ' + n)) : (fail++, console.error('  \u2717 ' + n + (x ? '   ' + x : ''))); };
const srv = app.listen(45874, async () => {
  const get = () => new Promise((ok) => require('http').get({ host: '127.0.0.1', port: 45874, path: '/api/entities/me' }, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => ok(JSON.parse(d)));
  }));
  let b = await get();
  t('ledger on → true', b.entity.ledger_on === true, JSON.stringify(b.entity.ledger_on));
  setting = { enabled: false }; b = await get();
  t('ledger off → false', b.entity.ledger_on === false);
  setting = null; b = await get();
  t('no books table → false', b.entity.ledger_on === false);
  boom = true; b = await get();
  t('the read fails → ledger_on is left out (unknown, never reported on), the profile still arrives', b.entity.ledger_on !== true && !!b.entity.identity_id);
  console.log('\n  == ' + pass + ' passed, ' + fail + ' failed ==\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
