'use strict';
/**
 * mint-ctp-refusal.test.cjs — RAIL-129: when another installation refuses its copy, or a draft would cross, lib/mint.deliver throws a
 * REFUSAL (refused, 409, a named code, words a person can read) that lib/knownerr answers as one, never the generic 500 "Send failed".
 * Runs the real deliver() with the address book, the envelope and the transport stubbed (no database, no network). Also pins:
 * the far end's own `why` never reaches the sentence (Q19), and nothing local is written once a remote copy is refused (all or none, R25).
 * CARD 01-rail-core-the-chit/send-mint-a-chit
 * Run: node tests/mint-ctp-refusal.test.cjs
 */
const path = require('path');
const LIB = path.join(__dirname, '..', 'lib');
let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); }
  else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};
const stub = (name, exports) => { const id = require.resolve(path.join(LIB, name)); require.cache[id] = { id, filename: id, loaded: true, exports }; };

const REMOTE = 'e2000000-0000-4000-8000-000000000002';
const HOSTILE_WHY = '<img src=x onerror=alert(1)> refused';
let delivered = 0;
stub('ctpaddress', { resolveAll: async (ids) => new Map(ids.map((id) => [String(id), { local: false, endpoint: 'https://far.example/ctp', installation_key: 'far-1', bridge_id: 'B-FAR' }])) });
stub('ctpenvelope', { build: () => ({ sealed: true }) });
stub('ctptransport', { send: async () => ({ accepted: false, status: 403, why: HOSTILE_WHY }) });
const db = require('../db');
db.withEntity = async () => { delivered++; return { rows: [] }; }; /* any local write would land here */
/* sit/run6 (RAIL-98): the recipient's bridge id and name are read from its identities row before the envelope is built (a read, never a write) */
db.query = async (sql) => (/FROM identities WHERE identity_id = $1/.test(String(sql)) ? { rows: [{ bridge_id: 'B-FAR', display_name: 'Far Traders' }] } : { rows: [] });
const mint = require('../lib/mint');
const { known } = require('../lib/knownerr');

const thrown = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

(async () => {
  console.log('\n══ A REFUSED CROSSING IS A REFUSAL, NOT A FAULT (RAIL-129) ══\n');

  const e = await thrown(() => mint.deliver('e1000000-0000-4000-8000-000000000001', 'c1', [{ entity_id: REMOTE }], {}));
  ok('a refused remote copy throws', !!e);
  ok('…named CTP_REFUSED, refused, 409', e && e.code === 'CTP_REFUSED' && e.refused === true && e.status === 409, e && JSON.stringify({ code: e.code, refused: e.refused, status: e.status }));
  ok('…the sentence says nothing was written', e && /Nothing was written\./.test(e.message), e && e.message);
  ok('…and never echoes the far end\'s own words (Q19)', e && !e.message.includes('onerror') && !e.message.includes('far-1'), e && e.message);
  ok('nothing local was written (all or none)', delivered === 0, 'withEntity calls: ' + delivered);
  const k = e && known(e);
  ok('lib/knownerr answers it 409 with its code and words', k && k.status === 409 && k.body.code === 'CTP_REFUSED' && k.body.error === 'Not delivered', JSON.stringify(k));

  const d = await thrown(() => mint.deliver('e1000000-0000-4000-8000-000000000001', 'c2', [{ entity_id: REMOTE }], { is_draft: true }));
  ok('a draft with a copy on another installation throws CTP_DRAFT, refused, 409', d && d.code === 'CTP_DRAFT' && d.refused === true && d.status === 409, d && JSON.stringify({ code: d.code, status: d.status }));
  const kd = d && known(d);
  ok('…and knownerr answers it 409 "Draft stays here"', kd && kd.status === 409 && kd.body.code === 'CTP_DRAFT' && kd.body.error === 'Draft stays here', JSON.stringify(kd));
  ok('…still nothing written', delivered === 0, 'withEntity calls: ' + delivered);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
