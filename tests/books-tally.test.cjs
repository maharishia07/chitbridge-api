/**
 * books-tally.test.cjs — THE PACK'S TALLY FILES COME FROM THE ONE TALLY WRITER (critic review M7).
 *
 * lib/books-tally.js maps journal entries onto tools/tally-connector/adapters/tally.js's builders. Proves: it writes no
 * Tally XML of its own · the adapter's Receipt is byte-for-byte what it was before the builder was made general · each
 * entry becomes one voucher of the right type, debits negative / credits positive (Tally's rule), balanced · a party
 * line's bill references add up to the line · every ledger and party a voucher names has a master · a Journal that
 * touches cash is listed for review, never hidden.
 * Run: node tests/books-tally.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'lib', 'books-tally.js'));
const A = require(path.join(ROOT, 'tools', 'tally-connector', 'adapters', 'tally.js'));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const dec = (m) => { const s = String(Math.abs(m)).padStart(3, '0'); return (m < 0 ? '-' : '') + s.slice(0, -2) + '.' + s.slice(-2); };

console.log('\n══ THE PACK\'S TALLY FILES — through the connector\'s adapter ══\n');

const src = fs.readFileSync(path.join(ROOT, 'lib', 'books-tally.js'), 'utf8');
ok('lib/books-tally.js writes no Tally XML of its own (no <VOUCHER, <LEDGER, <ENVELOPE literal)', !/<VOUCHER|<LEDGER[ >]|<ENVELOPE|<ALLLEDGERENTRIES/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
ok('…and takes its builders from the adapter', /adapters', 'tally\.js'\)\)\.builders/.test(src) && typeof A.builders.accountingVoucherBody === 'function');
const pack = fs.readFileSync(path.join(ROOT, 'lib', 'books-pack.js'), 'utf8');
ok('lib/books-pack.js drops the engine\'s tally.xml when the adapter built the files, and records tally_xml_status', /f\.name !== 'tally\.xml'/.test(pack) && /tally_xml_status: tally\.status/.test(pack) && /status: 'unverified'/.test(pack));

/* the Receipt the connector sends today, frozen — the generic builder must not have changed a byte of it */
const RECEIPT = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>\n'
  + '<STATICVARIABLES><SVCURRENTCOMPANY>Acme &amp; Co</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">\n'
  + '<VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>20260920</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>\n'
  + '<REFERENCE>CB-abcdef12</REFERENCE><NARRATION>ChitBridge payment UPI UTR1 for order abcdef12-3456 from Ravi &amp; Sons</NARRATION>\n'
  + '<PARTYLEDGERNAME>Ravi &lt;Stores&gt;</PARTYLEDGERNAME>\n'
  + '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Ravi &lt;Stores&gt;</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>600</AMOUNT>\n'
  + '<BILLALLOCATIONS.LIST><NAME>CB-abcdef12</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>600</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>\n'
  + '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Bank</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-600</AMOUNT></ALLLEDGERENTRIES.LIST>\n'
  + '</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>';
const got = A.builders.receiptXML({ chit_id: 'abcdef12-3456', at: '2026-09-20T10:00:00Z', method: 'upi', ref: 'UTR1', amount: 600, buyer: 'Ravi & Sons' }, { partyLedger: 'Ravi <Stores>', company: 'Acme & Co' });
ok('the adapter\'s Receipt voucher is byte-for-byte what the connector sent before', got === RECEIPT, got);

const CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333', CHIT = 'c0000000-0000-4000-8000-00000000000a';
const accounts = [['1300', 'Customers (Sundry Debtors)', 'Sundry Debtors', 'debtors'], ['1400', 'Cash', 'Cash-in-Hand', 'cash'], ['1510', 'UPI collections', 'Bank Accounts', 'upi'],
  ['2100', 'Suppliers (Sundry Creditors)', 'Sundry Creditors', 'creditors'], ['2200', 'Output CGST', 'Duties & Taxes', 'output_cgst'], ['2201', 'Output SGST', 'Duties & Taxes', 'output_sgst'],
  ['4000', 'Sales', 'Sales Accounts', 'sales'], ['5000', 'Purchases', 'Purchase Accounts', 'purchases'], ['6010', 'Rent', 'Indirect Expenses', 'rent'], ['6850', 'Bad debts written off', 'Indirect Expenses', 'bad_debts'],
  ['3000', 'Capital', 'Capital Account', 'capital']].map(([code, name, tally_group, role]) => ({ code, name, tally_group, role, is_group: false }));
const parties = [{ party_id: CUST, name: 'Ravi', legal_name: 'Ravi Stores & Co', gstin: '33ABCDE1234F1Z5', state_code: '33', customer: true },
  { party_id: SUPP, name: 'Kumar Traders', supplier: true, state_code: '33' }];
const L = (code, dr, cr, party_id) => ({ code, dr_minor: dr, cr_minor: cr, party_id: party_id || null });
const entries = [
  { entry_id: 'e1', entry_no: 'JV/2026-27/000001', posting_date: '2026-09-05', event_type: 'sale_bill', narration: null, lines: [L('1300', 100000, 0, CUST), L('1400', 18000, 0), L('4000', 0, 100000), L('2200', 0, 9000), L('2201', 0, 9000)] },
  { entry_id: 'e2', entry_no: 'JV/2026-27/000002', posting_date: '2026-09-06', event_type: 'purchase_bill', lines: [L('5000', 50000, 0), L('2100', 0, 50000, SUPP)] },
  { entry_id: 'e3', entry_no: 'JV/2026-27/000003', posting_date: '2026-09-20', event_type: 'payment_received', lines: [L('1510', 60000, 0), L('1300', 0, 60000, CUST)] },
  { entry_id: 'e4', entry_no: 'JV/2026-27/000004', posting_date: '2026-09-21', event_type: 'expense', lines: [L('6010', 500000, 0), L('1400', 0, 500000)] },
  { entry_id: 'e5', entry_no: 'JV/2026-27/000005', posting_date: '2026-09-22', event_type: 'walkin_day', lines: [L('1400', 11800, 0), L('4000', 0, 10000), L('2200', 0, 900), L('2201', 0, 900)] },
  { entry_id: 'e6', entry_no: 'JV/2026-27/000006', posting_date: '2026-09-23', event_type: 'write_off', lines: [L('6850', 5000, 0), L('1300', 0, 5000, CUST)] },
  { entry_id: 'e7', entry_no: 'JV/2026-27/000007', posting_date: '2026-09-24', event_type: 'manual', narration: 'Owner brought in cash', lines: [L('1400', 100000, 0), L('3000', 0, 100000)] },
];
const items = [
  { entry_id: 'e1', party: CUST, ref: CHIT, against_ref: CHIT, ref_kind: 'bill', amount_minor: 100000 },
  { entry_id: 'e2', party: SUPP, ref: 'PB-9', against_ref: 'PB-9', ref_kind: 'bill', amount_minor: 50000 },
  { entry_id: 'e3', party: CUST, ref: 'pay:1', against_ref: 'pay:1', ref_kind: 'advance', amount_minor: -60000 },
  { entry_id: null, party: CUST, ref: 'pay:1', against_ref: CHIT, ref_kind: 'allocation', amount_minor: -60000 },
  { entry_id: 'e6', party: CUST, ref: 'wo:1', against_ref: 'wo:1', ref_kind: 'on_account', amount_minor: -5000 },
  { entry_id: 'e6', party: CUST, ref: 'wo:1', against_ref: CHIT, ref_kind: 'allocation', amount_minor: -5000 },
  { entry_id: 'e6', party: CUST, ref: 'wo:1', against_ref: 'wo:1', ref_kind: 'allocation', amount_minor: 5000 },
];
const r = T.build({ entries, accounts, parties, items, bill_nos: { [CHIT]: 'C1-0042' }, dec });
const V = r.files.find((f) => f.name === 'tally-vouchers.xml').data, M = r.files.find((f) => f.name === 'tally-masters.xml').data;
const vouchers = V.split('<VOUCHER ').slice(1);

ok('one voucher per journal entry (7), status "adapter"', vouchers.length === 7 && r.summary.status === 'adapter' && r.summary.vouchers === 7);
ok('typed by what happened: Sales ×2, Purchase, Receipt, Payment, Journal ×2', JSON.stringify(r.summary.by_type) === JSON.stringify({ Sales: 2, Purchase: 1, Receipt: 1, Payment: 1, Journal: 2 }), JSON.stringify(r.summary.by_type));
const amounts = (v) => Array.from(v.matchAll(/<ALLLEDGERENTRIES\.LIST><LEDGERNAME>[^<]*<\/LEDGERNAME><ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>(?:<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>)?<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)).map((m) => [m[1], Number(m[2])]);
ok('every voucher balances (its amounts sum to zero) and a debit is Yes/negative, a credit No/positive',
  vouchers.every((v) => { const a = amounts(v); return a.length >= 2 && Math.abs(a.reduce((t, x) => t + x[1], 0)) < 1e-9 && a.every(([d, n]) => (d === 'Yes') === (n < 0)); }));
ok('the sale: the party ledger by its legal name, debited 1000.00, a New Ref named by the bill number', /<LEDGERNAME>Ravi Stores &amp; Co<\/LEDGERNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes<\/ISPARTYLEDGER><AMOUNT>-1000\.00<\/AMOUNT>\n<BILLALLOCATIONS\.LIST><NAME>C1-0042<\/NAME><BILLTYPE>New Ref<\/BILLTYPE><AMOUNT>-1000\.00<\/AMOUNT>/.test(vouchers[0]), vouchers[0]);
ok('the purchase: the supplier credited against a New Ref', /<LEDGERNAME>Kumar Traders<\/LEDGERNAME><ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes<\/ISPARTYLEDGER><AMOUNT>500\.00<\/AMOUNT>\n<BILLALLOCATIONS\.LIST><NAME>PB-9<\/NAME><BILLTYPE>New Ref<\/BILLTYPE><AMOUNT>500\.00<\/AMOUNT>/.test(vouchers[1]), vouchers[1]);
ok('the receipt: On Account (it was matched later, outside any entry) — the later allocation is not invented here', /VCHTYPE="Receipt"/.test(vouchers[2]) && /<BILLTYPE>On Account<\/BILLTYPE><AMOUNT>600\.00<\/AMOUNT>/.test(vouchers[2]) && !/Agst Ref/.test(vouchers[2]), vouchers[2]);
ok('the write-off: a Journal, Agst Ref the bill it settles', /VCHTYPE="Journal"/.test(vouchers[5]) && /<NAME>C1-0042<\/NAME><BILLTYPE>Agst Ref<\/BILLTYPE><AMOUNT>50\.00<\/AMOUNT>/.test(vouchers[5]), vouchers[5]);
ok('every party line\'s bill references add up to its line', vouchers.every((v) => Array.from(v.matchAll(/<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER><AMOUNT>(-?[\d.]+)<\/AMOUNT>\n((?:<BILLALLOCATIONS\.LIST>.*?<\/BILLALLOCATIONS\.LIST>)+)/g))
  .every((m) => Math.abs(Array.from(m[2].matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)).reduce((t, x) => t + Number(x[1]), 0) - Number(m[1])) < 1e-9)));
ok('a Journal with a cash line (the manual entry) is LISTED for review, not hidden', r.summary.needs_review.length === 1 && r.summary.needs_review[0].entry_no === 'JV/2026-27/000007', JSON.stringify(r.summary.needs_review));
ok('the manifest summary says what is proven in TallyPrime and what is not', /Only the Receipt voucher/.test(r.summary.proven));
const named = new Set(Array.from(V.matchAll(/<LEDGERNAME>([^<]*)<\/LEDGERNAME>/g)).map((m) => m[1]));
const mastered = new Set(Array.from(M.matchAll(/<LEDGER NAME="([^"]*)"/g)).map((m) => m[1]));
ok('every ledger a voucher names has a master (' + named.size + ')', Array.from(named).every((n) => mastered.has(n)), Array.from(named).filter((n) => !mastered.has(n)).join(', '));
ok('the customer under Sundry Debtors with its GSTIN; the supplier under Sundry Creditors, unregistered', /<LEDGER NAME="Ravi Stores &amp; Co"[^]*?<PARENT>Sundry Debtors<\/PARENT><ISBILLWISEON>Yes<\/ISBILLWISEON>\n<PARTYGSTIN>33ABCDE1234F1Z5<\/PARTYGSTIN>/.test(M)
  && /<LEDGER NAME="Kumar Traders"[^]*?<PARENT>Sundry Creditors<\/PARENT><ISBILLWISEON>Yes<\/ISBILLWISEON>\n<GSTREGISTRATIONTYPE>Unregistered<\/GSTREGISTRATIONTYPE>/.test(M));
ok('a GST ledger carries its duty head; Sales sits under Sales Accounts', /<LEDGER NAME="Output CGST"[^]*?<PARENT>Duties &amp; Taxes<\/PARENT><TAXTYPE>GST<\/TAXTYPE><GSTDUTYHEAD>CGST<\/GSTDUTYHEAD>/.test(M) && /<LEDGER NAME="Sales"[^]*?<PARENT>Sales Accounts<\/PARENT>/.test(M));
let threw = null; try { T.build({ entries: [{ entry_id: 'x', entry_no: 'X', posting_date: '2026-09-01', event_type: 'manual', lines: [L('9999', 1, 0), L('4000', 0, 1)] }], accounts, parties, items: [], dec }); } catch (e) { threw = e; }
ok('a line on a ledger that is not in the chart is refused (the pack then falls back, and says unverified)', threw && /not in the chart/.test(threw.message));

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
