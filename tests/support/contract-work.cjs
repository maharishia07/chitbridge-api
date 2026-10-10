/**
 * tests/support/contract-work.cjs — the /api/work routes the Tasks & Orders page reads, called through the REAL router over the work stub
 * (tests/support/work-stub.cjs), each answer kept under "METHOD /api/work/<route pattern>". Used by tests/web-api-contract.test.cjs, which holds each
 * answer to docs/contracts/web-api.json. Several views / chits are fired so every optional key (a line held by someone, an online order's address…)
 * is seen with and without a value.
 */
'use strict';
const S = require('./work-stub.cjs');

async function captureWork() {
  const got = {};
  /** an answer under its route pattern; the same status MERGES into one example, another status gets its own entry ("#404") */
  const keep = (m, key, r) => { let k = m + ' /api/work' + key; if (got[k] && got[k].status !== r.status) k += ' #' + r.status; got[k] = got[k] || { status: r.status, bodies: [] }; got[k].bodies.push(r.body); return r; };
  S.seed(); S.as({});
  await S.start();
  try {
    for (const v of ['orders_in', 'orders_out', 'tasks', 'done']) keep('GET', '/list', await S.get('/api/work/list?view=' + v));
    keep('GET', '/facts', await S.get('/api/work/facts'));
    for (const n of [1, 2, 3]) keep('GET', '/:chit_id', await S.get('/api/work/' + S.U(n)));
    keep('GET', '/:chit_id', await S.get('/api/work/' + S.U(6)));
  } finally { S.stop(); }
  return got;
}
module.exports = { captureWork };
