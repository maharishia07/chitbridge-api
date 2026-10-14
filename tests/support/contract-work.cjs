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
    keep('GET', '/:chit_id', await S.get('/api/work/' + S.U(5)));   /* a closed order: reopen is the step that is OPEN (no why/say), the others refused */
    keep('GET', '/:chit_id', await S.get('/api/work/' + S.U(6)));
    /* TO1-UI: a view-only login — EVERY action refused with its sentence, the assign / deliver / amend ones too (the page greys each with `say`) */
    S.as({ level: 'viewer' });
    keep('GET', '/list', await S.get('/api/work/list?view=orders_in'));
    keep('GET', '/:chit_id', await S.get('/api/work/' + S.U(1)));
    S.as({});
    /* RAIL-LAB-SRV1: the Home rail card — may_sample is the server's may/why: a live shop refused with why + say, a lab (test) shop { ok: true }
       (both fired, so `why` / `say` are optional in the example and a client sees each shape) */
    const rail = (r) => { const k = 'GET /api/facts/rail'; got[k] = got[k] || { status: r.status, bodies: [] }; got[k].bodies.push(r.body); return r; };
    S.D.population = 'live'; rail(await S.get('/api/facts/rail'));
    S.D.population = 'test'; rail(await S.get('/api/facts/rail'));
    S.D.population = undefined;
  } finally { S.stop(); }
  return got;
}
module.exports = { captureWork };
