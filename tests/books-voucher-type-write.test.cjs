/* books-voucher-type-write — since b279 ran (Athi, 2026-10-03), every new journal_entry row carries its voucher TYPE beside its series,
   so a MANUAL entry (series MJ) keeps its own kind: a manual Payment reads Payment, not Journal. Old rows stay NULL (derived from the series). */
const S = require('../lib/books-store');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
function stub() { const calls = []; return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ entry_id: 'e1', created_at: new Date() }] }; } }; }
const head = (x) => Object.assign({ entry_no: 'MJ/2026-27/000001', series: 'MJ', posting_date: '2026-10-03', fiscal_year: '2026-27', period: 7,
  event_type: 'payment_made', currency: 'INR', total_minor: 50000, created_by: 'u1' }, x);
(async () => {
  let db = stub(); await S.insertEntry(db, 'ent1', head({ voucher_type: 'Payment' }));
  const c = db.calls[0];
  ok(/\bvoucher_type\b/.test(c.sql), 'the INSERT names voucher_type');
  ok(c.params[c.params.length - 1] === 'Payment', 'a manual (MJ) payment is stored as Payment, not Journal');
  ok(c.params.includes('MJ'), 'its series stays MJ');
  db = stub(); await S.insertEntry(db, 'ent1', head({ voucher_type: undefined, series: 'SV', entry_no: 'SV/2026-27/000001' }));
  ok(db.calls[0].params[db.calls[0].params.length - 1] === null, 'no type given → NULL (the reader derives it from the series)');
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
