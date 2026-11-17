/**
 * tests/crm-timeline-hidden.test.cjs - CRM-206 (web follow-up of api RAIL-146h, #744): a cost-blind reader's party timeline sends a chit `value`
 * null + cost_hidden and a ledger `amount_minor` null + cost_hidden, and the party read `dues.cost_hidden`. The page says "hidden" there,
 * leaves a hidden figure out of the unbilled sum, and an owner / cost-allowed reader's answer paints exactly as before.
 * Payload shapes are the api's own stand-ins (tests/rail146h-timeline-cost-blind.test.cjs). Run: node tests/crm-timeline-hidden.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const NL = String.fromCharCode(10);
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8').replace(/\r\n/g, NL);
const crm = read('cap-crm.js'), rec = read('cap-crm-record.js') + NL + read('cap-crm-timeline.js'); /* the record's timeline part moved to cap-crm-timeline.js (17 Nov split) */
/* just the named functions, cut out of the page's own files - no second copy of the logic lives in this test */
const fn = (src, name) => {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name + ' not found');
  const first = src.slice(i, src.indexOf(NL, i));
  return first.split('{').length === first.split('}').length ? first : src.slice(i, src.indexOf(NL + '}' + NL, i) + 2);
};
globalThis.tx = (s) => s; globalThis.esc = (s) => String(s);
globalThis.bkMoney = (m, c) => (c === 'INR' ? '\u20b9' : c + ' ') + (m / 100).toLocaleString('en-IN');
globalThis.bkToMinor = (v) => Math.round(v * 100); globalThis.bkDate = (d) => d;
globalThis.cbIsRawId = () => false; globalThis.CRM_KIND = {}; globalThis.CRM_CHANNEL = {}; globalThis.CRMR = { p: null, added: '' };
globalThis.CRM = { ledger: true, currency: 'INR' };
globalThis.crmRolesList = (r) => r; globalThis.crmRealEmail = (v) => v; globalThis.crmPlural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
globalThis.crmDocWord = () => 'Bill'; globalThis.crmWhen = (s) => s; globalThis.crmDocDay = (s) => s; globalThis.crmLocalISO = (d) => d.toISOString().slice(0, 10);
globalThis.crmNoDate = (s) => s; globalThis.crmEntryWhat = globalThis.crmEntryState = () => '';
eval(
  [fn(crm, 'crmNothingDueCell'), fn(crm, 'crmDueCell'), fn(crm, 'crmUnbilledSaid'), fn(crm, 'crmUnbilledMoney'), fn(crm, 'crmDueListCell'), fn(rec, 'crmDueChip'), fn(crm, 'crmPartyFrom'), fn(rec, 'crmBillFacts'), fn(rec, 'crmEntryFrom'), fn(rec, 'crmMarkHidden'), fn(rec, 'crmLedgerLine'), fn(rec, 'crmWhenCell'), fn(rec, 'crmTlCols')].join(NL) +
    NL + 'globalThis.dueCell = crmDueCell; globalThis.partyFrom = crmPartyFrom; globalThis.facts = crmBillFacts; globalThis.unbilledMoney = crmUnbilledMoney; globalThis.chip = crmDueChip; globalThis.listCell = crmDueListCell; globalThis.entry = crmEntryFrom; globalThis.cols = crmTlCols;'
);
const amountCell = (e) => cols().filter((c) => c.key === 'amount')[0].cell(e);
const order = (o) => Object.assign({ kind: 'chit', at: '2026-11-01T10:00:00Z', chit_id: 'c1', purpose: 'order', title: 'Order', currency: 'INR', direction: 'out' }, o);

/* the blind reader: a chit value null + cost_hidden -> "hidden", never 0 and never a dash */
const blind = entry(order({ value: null, cost_hidden: true }), 0);
assert.strictEqual(blind.amount_minor, undefined, 'a hidden value carries no figure');
assert(/>hidden</.test(amountCell(blind)) && /crm-amt-hidden-/.test(amountCell(blind)), 'the Amount column says hidden: ' + amountCell(blind));
const ledBlind = entry({ kind: 'ledger', at: '2026-11-01T10:00:00Z', ledger_kind: 'bill', ref: 'B-1', amount_minor: null, currency: 'INR', cost_hidden: true }, 1);
assert(/>hidden</.test(amountCell(ledBlind)), 'a hidden ledger amount says hidden too');
/* the sum: 1000.00 shown + one hidden order -> the figure and "some hidden"; all hidden -> "hidden"; hidden is not added as 0 */
const shown = entry(order({ chit_id: 'c2', value: 1000 }), 2);
let f = facts([shown, blind]);
assert.deepStrictEqual([f.unbilled.n, f.unbilled.minor, f.unbilled.hidden], [2, 100000, 1], 'the hidden order is counted, its money left out of the sum');
assert.strictEqual(unbilledMoney(f.unbilled), '\u20b91,000 \u00b7 some hidden');
f = facts([blind, entry(order({ chit_id: 'c3', value: null, cost_hidden: true }), 3)]);
assert.strictEqual(unbilledMoney(f.unbilled), 'hidden', 'all hidden: the word, not a made-up zero');
/* the owner / cost-allowed reader: the same bytes as before - the figure, no "hidden" anywhere */
f = facts([shown]);
assert.strictEqual(unbilledMoney(f.unbilled), '\u20b91,000'); assert.strictEqual(f.unbilled.hidden, 0);
assert(!/hidden/.test(amountCell(shown)) && /\u20b91,000/.test(amountCell(shown)), 'owner: the figure');
assert(/>\u2014</.test(amountCell(entry(order({ chit_id: 'c4', value: null }), 4))), 'a null value WITHOUT cost_hidden is still a dash (a note has no amount)');
/* the party list: dues.cost_hidden -> "hidden" in the Dues cell; a plain null balance is still a dash; the owner's figure unchanged */
const row = (dues) => partyFrom({ party_id: 'pid-1', dues, may_trade: { ok: true } });
assert(/>hidden</.test(dueCell(row({ balance_minor: null, oldest_due: null, cost_hidden: true }))) && /party-due-hidden-pid-1/.test(dueCell(row({ balance_minor: null, cost_hidden: true }))), 'blind: Dues says hidden');
assert(/>\u2014</.test(dueCell(row({ balance_minor: null }))), 'no figure and not hidden: a dash');
assert(/you'll get/.test(dueCell(row({ balance_minor: 100000 }))), 'owner: the figure and its word');
/* the chip (record header) and the list cell are the same ONE painter: all hidden -> "hidden" never 0; some hidden -> the figure + "some hidden" */
const allHidden = facts([blind, entry(order({ chit_id: 'c5', value: null, cost_hidden: true }), 5)]);
let h = chip({ party_id: 'pid-1', balance_minor: 0, billFacts: allHidden });
assert(/2 orders not billed yet hidden/.test(h) && !/₹0/.test(h), 'chip, all hidden: ' + h);
h = chip({ party_id: 'pid-1', balance_minor: 0, billFacts: facts([shown, blind]) });
assert(/₹1,000 · some hidden/.test(h), 'chip, some hidden: ' + h);
h = listCell({ party_id: 'pid-1', balance_minor: 0, unbilled: { n: 2, minor: null, currency: 'INR', cost_hidden: true } });
assert(/2 orders not billed yet hidden/.test(h) && !/₹0/.test(h), 'list cell, the SERVER shape for a blind reader (api rail146e): ' + h);
h = listCell({ party_id: 'pid-1', balance_minor: 0, unbilled: { n: 0, minor: 0, currency: null } });
assert(/Settled/.test(h) && !/hidden/.test(h), 'a true zero still says Settled: ' + h);
h = listCell({ party_id: 'pid-1', balance_minor: 0, unbilled: { n: 2, minor: null, currency: null } });
assert(/2 orders not billed yet<\/span>/.test(h) && !/hidden/.test(h), 'two currencies (no flag): the count alone, as before: ' + h);
h = listCell({ party_id: 'pid-1', balance_minor: 0, unbilled: { n: 2, minor: 100000, hidden: 1, currency: 'INR' } });
assert(/₹1,000 · some hidden/.test(h), 'list cell, some hidden: ' + h);
/* the OWNER's unpriced order (value null, NO cost_hidden) is not "hidden": it adds 0 exactly as before, in the sum, the chip and the cell */
const unpriced = entry(order({ chit_id: 'c6', value: null }), 6);
f = facts([unpriced]);
assert.deepStrictEqual([f.unbilled.n, f.unbilled.minor, f.unbilled.hidden], [1, 0, 0], 'unpriced, no flag: counted, adds 0, not hidden');
h = chip({ party_id: 'pid-1', balance_minor: 0, billFacts: f });
assert(/1 order not billed yet ₹0/.test(h) && !/hidden/.test(h), 'owner chip unchanged: ' + h);
assert(/₹1,000/.test(chip({ party_id: 'pid-1', balance_minor: 0, billFacts: facts([shown]) })) && !/hidden/.test(chip({ party_id: 'pid-1', balance_minor: 0, billFacts: facts([shown]) })), 'owner chip with a price unchanged');
assert(!/hidden/.test(listCell({ party_id: 'pid-1', balance_minor: 0, unbilled: { n: 1, minor: 42000, currency: 'INR' } })), 'owner list cell unchanged (the server sends no hidden)');
console.log('crm-timeline-hidden: all ok');
