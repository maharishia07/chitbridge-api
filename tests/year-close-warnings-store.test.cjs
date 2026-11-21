'use strict';
/* closeWarnings reads the waiting actions with the ENTITY id as the store ($1 of the queue read), never an object (S41 real-stack log: "invalid input syntax for type uuid"). */
const assert = require('assert');
const { closeWarnings } = require('../lib/books-year-reopen');
const ENTITY = '11111111-2222-3333-4444-555555555555';
(async () => {
  const seen = [];
  const handle = { query: async (sql, params) => { seen.push(params); if (/count\(\*\)/.test(sql)) return { rows: [{ n: 2 }] }; return { rows: [] }; } };
  const out = await closeWarnings(handle, ENTITY, 'FY2026-27', { range: { start: '2026-04-01', end: '2027-03-31' }, chart: [], cur: 'INR' });
  const reads = seen.filter((p) => Array.isArray(p) && p.length >= 6);
  assert.ok(reads.length >= 1, 'the queue was read');
  assert.ok(reads.every((p) => p[0] === ENTITY), 'every queue read carries the entity uuid as $1: ' + JSON.stringify(reads[0]));
  assert.ok(out.some((w) => w.name === 'actions_waiting' && w.count === 2), 'the waiting actions are named in the warnings: ' + JSON.stringify(out));
  console.log('ok year close warnings read the queue with the entity id');
})().catch((e) => { console.error(e); process.exit(1); });
