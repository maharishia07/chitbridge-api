/**
 * repeat-supply-status.test.cjs — REPEAT-500: the repeat store's chit() read no longer names h.current_status (chit_header has no such
 * column; chit_status holds it), and the status comes from the one reader, lib/select.rows. Stub db and stub reader, no database.
 * Run: node tests/repeat-supply-status.test.cjs
 */
'use strict';
const R = require('../lib/repeat-supply');
const select = require('../lib/select');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name); } };
const ME = '11111111-1111-4111-8111-111111111111', CHIT = '22222222-2222-4222-8222-222222222222';

(async () => {
  const sqls = [];
  const h = { query: async (text) => { sqls.push(text); return { rows: [{ chit_id: CHIT, direction: 'received', purpose: 'subscription', line_items: [] }] }; } };
  const asked = [];
  const realRows = select.rows;
  select.rows = async (entity, sel) => { asked.push([entity, sel]); return [{ direction: 'sent', current_status: 'sent' }, { direction: 'received', current_status: 'accepted' }]; };
  try {
    const got = await R.sqlStore.chit(h, ME, CHIT);
    ok('the header read does not name h.current_status', sqls.length === 1 && !/current_status/.test(sqls[0]));
    ok('the status comes from the reader, for my entity and this chit', asked.length === 1 && asked[0][0] === ME && asked[0][1].chit_id === CHIT);
    ok('the copy of the header\'s own direction is the one read', got.status === 'accepted');
    select.rows = async () => [];
    ok('no copy found answers a null status, not an error', (await R.sqlStore.chit(h, ME, CHIT)).status === null);
  } finally { select.rows = realRows; }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
