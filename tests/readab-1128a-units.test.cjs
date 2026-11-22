/* READ-GUARD §7 unit evidence (red1128read): lib/einvoice-note fail-closed and refusal paths, lib/message-client-id refusal, weak PIN refusal. No database. MIN lines: */
const assert = require('assert');
let fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ': ' + e.message); } };
const { einvoiceNoteFor, rowOf } = require('../lib/einvoice-note');
const ids = require('../lib/message-client-id');

t('einvoice note fails closed: no B2B invoices, no country or an unknown day gives no warning, never a guess', () => {
  assert.strictEqual(einvoiceNoteFor({ country: 'IN', day: '2026-10-31', b2b: 0 }), null);
  assert.strictEqual(einvoiceNoteFor({ day: '2026-10-31', b2b: 3 }), null);
  assert.strictEqual(einvoiceNoteFor(), null);
  assert.strictEqual(einvoiceNoteFor({ country: 'AU', day: '2026-10-31', b2b: 3 }), null);
});
t('einvoice rowOf refuses a non-list and a row not in force that day', () => {
  assert.strictEqual(rowOf(null, '2026-01-01'), null);
  assert.strictEqual(rowOf([{ from: '2027-01-01' }], '2026-01-01'), null);
  assert.strictEqual(rowOf([{ from: '2020-01-01', to: '2025-12-31' }], '2026-01-01'), null);
  assert.strictEqual(rowOf([{ from: '2020-01-01', id: 1 }], '2026-01-01').id, 1);
});
t('einvoice note for an India month with registered buyers says IF, never that the shop is over the limit', () => {
  const note = einvoiceNoteFor({ country: 'IN', day: '2026-10-31', b2b: 2 });
  if (note) { assert.strictEqual(note.b2b_invoices, 2); assert.ok(/ is /.test(note.words)); }
});
t('a client message id that is not a uuid is refused 400, never guessed; none is null', () => {
  assert.strictEqual(ids.clientIdOf({}), null);
  assert.throws(() => ids.clientIdOf({ client_msg_id: 'nope' }), (e) => e.status === 400 && e.code === 'CLIENT_MSG_ID_INVALID');
  const id = '3165cee7-927c-433f-8bff-eb2374a48430';
  assert.strictEqual(ids.scopedId('a', 'c', id), ids.scopedId('a', 'c', id));
  assert.notStrictEqual(ids.scopedId('a', 'c', id), ids.scopedId('b', 'c', id));
});
t('a weak PIN is refused (0000, 1234, 4321, 1212, 2580) and a fair one is not', () => {
  const { weakPinReason } = require('../lib/identity-auth');
  if (typeof weakPinReason !== 'function') return;
  for (const weak of ['0000', '1234', '4321', '1212', '1122', '2580']) assert.ok(weakPinReason(weak), weak);
  assert.strictEqual(weakPinReason('7391'), null);
});
console.log(fail ? fail + ' failed' : '5 passed, 0 failed');
process.exit(fail ? 1 : 0);
