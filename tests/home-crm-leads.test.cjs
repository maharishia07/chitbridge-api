/* E-F-05: the Home CRM card counts customers WITHOUT leads (crm.isLead, the one rule): 4 customers + 3 leads = "4 customers". No db. */
'use strict';
const path = require('path'), assert = require('assert');
const API = path.join(__dirname, '..');
const crm = require(API + '/lib/crm');
const cust = (id, n) => ({ id, roles: { customer: true }, customer: { txn_count: n } });
const lead = (id) => ({ id, lead: true, roles: { customer: true }, customer: { txn_count: 0 } });
const parties = [cust(1, 3), cust(2, 1), cust(3, 9), cust(4, 2), lead(5), lead(6), lead(7), { id: 8, roles: { supplier: true } }];
const real = crm.rows, realAssemble = crm.assemble;
crm.rows = async () => []; crm.assemble = () => ({ parties });
const { BUILD } = require(API + '/lib/home-facts');
BUILD.crm({ entity: 'e1' }).then((r) => {
  crm.rows = real; crm.assemble = realAssemble;
  assert.strictEqual(r.figures.customers, 4, 'leads are not customers');
  assert.strictEqual(r.figures.suppliers, 1);
  assert.ok(/^4 customers/.test(r.lines[0].text), r.lines[0].text);
  console.log('home-crm-leads ok · 3 checks');
}).catch((e) => { console.error(e); process.exit(1); });
