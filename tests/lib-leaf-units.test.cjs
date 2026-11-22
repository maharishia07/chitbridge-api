/**
 * lib-leaf-units.test.cjs — the small pure rules, one case per rule, with their refusal paths and fail-closed answers. Offline, no database.
 * Modules: lib/consent-standing.js · lib/supply-kind.js · lib/books-other-side.js · lib/books-statement-notes.js
 * Run: node tests/lib-leaf-units.test.cjs
 * CARD 11-crm-and-marketing/privacy-consent
 */
'use strict';
const Consent = require('../lib/consent-standing');
const SupplyKind = require('../lib/supply-kind');
const OtherSide = require('../lib/books-other-side');
const StatementNotes = require('../lib/books-statement-notes');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const refusalOf = (fn) => { try { fn(); return null; } catch (err) { return err; } };

// ---- consent-standing: the customer's own withdrawal outranks a later staff yes
const row = (allowed, source, extra) => Object.assign({ allowed, source, channel: 'whatsapp', purpose: 'marketing' }, extra || {});
ok('a customer yes stands', Consent.standing([row(true, 'self')]).length === 1);
ok('a staff yes stands when no customer answer exists', Consent.standing([row(true, 'staff')]).length === 1);
ok('a staff yes after the customer withdrew does NOT stand (the customer no stays)', (() => {
  const kept = Consent.standing([row(true, 'staff'), row(false, 'self')]);
  return kept.length === 1 && kept[0].allowed === false;
})());
ok('the customer own new yes lifts the withdrawal', Consent.standing([row(true, 'self'), row(false, 'self')]).length === 2);
ok('a staff no always stands (the safe direction)', Consent.standing([row(false, 'staff'), row(true, 'self')]).length === 2);
ok('a withdrawal on another channel does not hide a staff yes here', Consent.standing([row(true, 'staff'), row(false, 'self', { channel: 'sms' })]).length === 2);
ok('a STOP reply counts as the customer source', Consent.isCustomerSource('reply') === true && Consent.isCustomerSource('staff') === false);
ok('no rows is no rows (closed, never invented)', Consent.standing(null).length === 0 && Consent.standing([]).length === 0);
ok('the SQL form reads a table without a source column as staff, so nothing is hidden', /COALESCE\(to_jsonb\(p\)->>'source', 'staff'\)/.test(Consent.standingSql('p')));
ok('refusal: a staff yes to offers with no source or note is refused in words', (() => {
  const err = refusalOf(() => Consent.requireStaffEvidence({ allowed: true, purpose: 'marketing' }, (words) => new Error(words)));
  return !!err && /source: staff/.test(err.message);
})());
ok('refusal: a staff yes with a one-character note is still refused', !!refusalOf(() => Consent.requireStaffEvidence({ allowed: true, purpose: 'marketing', source: 'staff', note: 'x' }, (words) => new Error(words))));
ok('a staff yes with evidence passes, and a no needs none', refusalOf(() => Consent.requireStaffEvidence({ allowed: true, purpose: 'marketing', source: 'staff', note: 'said yes at the counter' }, (words) => new Error(words))) === null && refusalOf(() => Consent.requireStaffEvidence({ allowed: false, purpose: 'marketing' }, (words) => new Error(words))) === null);

// ---- supply-kind: a kind the pack does not define is refused, never posted to plain sales
ok('kindsOf: AU defines its kinds, in the pack order', SupplyKind.kindsOf('AU').includes('taxable'));
ok('kindsOf: a country with no table defines none (never another country\'s)', SupplyKind.kindsOf('ZZ').length === 0 /* red1128: IN has kinds since tax01 */);
ok('namedIn reads a line kind and a _cb kind, spelled as the engine spells it', (() => {
  const named = SupplyKind.namedIn({ ItemList: [{ supply_kind: ' GST-Free ' }], _cb: { kinds: [{ kind: 'Zero-Rated', line: 0 }] } });
  return named.length === 2 && named[0].key === 'gst_free' && named[1].key === 'zero_rated' && named[1].line === 1;
})());
ok('no invoice, or no kind named, is no refusal', SupplyKind.refusalOf({ country: 'AU', business_json: {} }) === null && SupplyKind.refusalOf({ country: 'AU', business_json: { invoice: { ItemList: [{ name: 'x' }] } } }) === null);
ok('a kind the pack defines is accepted', SupplyKind.refusalOf({ country: 'AU', business_json: { invoice: { ItemList: [{ supply_kind: 'taxable' }] } } }) === null);
ok('refusal: an unknown kind is refused with the code, the line and the kinds that exist', (() => {
  const refused = SupplyKind.refusalOf({ country: 'AU', business_json: { invoice: { ItemList: [{ supply_kind: 'taxable' }, { supply_kind: 'bogus' }] } } });
  return refused && refused.code === SupplyKind.CODE && refused.line === 2 && refused.kind === 'bogus' && refused.kinds.includes('taxable') && /not a supply kind/.test(refused.why);
})());
ok('refusal (fail closed): a country whose pack names no kinds refuses any kind named', (() => {
  const refused = SupplyKind.refusalOf({ country: 'ZZ', business_json: { invoice: { ItemList: [{ supply_kind: 'taxable' }] } } });
  return refused && refused.kinds.length === 0 && /name no supply kinds/.test(refused.why);
})());

// ---- books-other-side: the ledger on the other side of a line
const lines = [{ line_no: 1, dr_minor: 1000, cr_minor: 0, code: '1100', name: 'Bank', role: 'bank' }, { line_no: 2, dr_minor: 0, cr_minor: 900, code: '4000', name: 'Sales', role: 'sales' }, { line_no: 3, dr_minor: 0, cr_minor: 100, code: '2200', name: 'GST', role: 'gst_collected', tax: true }];
const taxRoles = OtherSide.taxRolesOf({ taxLedgers: { gst: { output: 'gst_collected', input: 'gst_paid' } } });
ok('taxRolesOf collects every tax role of the pack, and none for a pack with none', taxRoles.has('gst_paid') && taxRoles.has('gst_collected') && OtherSide.taxRolesOf(null).size === 0);
ok('otherOf names the one other ledger, the tax line left out', JSON.stringify(OtherSide.otherOf(lines, lines[0], taxRoles)) === JSON.stringify({ code: '4000', name: 'Sales' }));
ok('otherOf says Split when several ledgers are on the other side', OtherSide.otherOf(lines.slice(0, 2).concat([Object.assign({}, lines[1], { line_no: 4, code: '4100' })]), lines[0], taxRoles).name === OtherSide.SPLIT);
ok('otherOf is null for a one-sided entry (an opening)', OtherSide.otherOf([lines[0]], lines[0], taxRoles) === null);
ok('partyNameOf is the first named party, else null (never a guess)', OtherSide.partyNameOf([{}, { party_name: 'Ravi' }]) === 'Ravi' && OtherSide.partyNameOf([{}]) === null && OtherSide.partyNameOf(null) === null);

// ---- books-statement-notes
ok('totalOf sums integer minor units with the sign kept', StatementNotes.totalOf([{ amount_minor: 500 }, { amount_minor: -200 }], 'INR') === 300);
ok('totalOf of nothing is zero', StatementNotes.totalOf([], 'INR') === 0);
const notes = StatementNotes.netOfByRole([{ output: 'gst_collected', input: 'gst_paid', payableRole: 'gst_payable' }], [{ code: 2200, name: 'GST collected', role: 'gst_collected' }, { code: 1500, name: 'GST paid', role: 'gst_paid' }]);
ok('netOfByRole finds the output then the input ledger a netted line stands for', notes.gst_payable && notes.gst_payable.length === 2 && notes.gst_payable[0].code === '2200');
ok('refusal: a head whose ledgers the chart does not hold names no note (never a half pair)', Object.keys(StatementNotes.netOfByRole([{ output: 'gst_collected', input: 'gst_paid', payableRole: 'gst_payable' }], [{ code: 2200, name: 'x', role: 'gst_collected' }])).length === 0);
ok('withNetOf marks only the netted rows and leaves every other row untouched', (() => {
  const out = StatementNotes.withNetOf([{ role: 'gst_payable' }, { role: 'sales' }], notes);
  return out[0].net_of.length === 2 && !('net_of' in out[1]);
})());
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
