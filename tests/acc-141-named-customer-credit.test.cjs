#!/usr/bin/env node
/**
 * acc-141-named-customer-credit.test.cjs — ACC-141 (proof 2026-11-14): a customer added BY NAME (not on ChitBridge) is an ordinary party and receives a credit.
 * @type regression
 * OWNS      the proof that lib/local-identity.addCustomer mints the named customer (a `~shop.cus-0001` identity + a customer_list row, on_rail false), that books-store.parties reads that
 *           row back as a customer party (party_id, customer true, supplier false, on_rail false), and that a till credit note refunded "On credit" to that party posts a return that
 *           Cr debtors on HIS party_id (no special case for a minted id).
 *           tests/customer-by-name.test.cjs covers POST /customers only; this is the leg after it.
 * CALLED BY scripts/guards.cjs · CI. No database: stand-in identities/customer_list, the in-memory books twin and the books engines (CB_ENGINES_DIR, else the sibling checkout).
 * FLOW      addCustomer(h, shop, { name }) -> books-store.parties -> credit note (On credit INR 118, 18%) -> books-hooks.postChit -> twin ledger lines
 *
 * THE HAND CASE (IN shop, INR): credit note taxable 100.00 + CGST 9.00 + SGST 9.00 = 118.00, refunded On credit (no money leaves the till).
 *   Dr sales returns 10000 + Dr CGST 900 + Dr SGST 900 = 11800 minor ; Cr debtors 11800 minor on the named customer ; the entry balances 11800 = 11800.
 * Run: node tests/acc-141-named-customer-credit.test.cjs
 */
'use strict';
const path = require('path');
const { API, ok, done, mock } = require('./lib/cat-proof-kit.cjs');

const SHOP = '11111111-1111-4111-8111-141141141141';
const ids = [{ identity_id: SHOP, bridge_id: 'B-SHOP', display_name: 'Acme Traders', user_id: 'acmetraders' }];
const lists = [];
const fold = (n) => String(n).trim().replace(/\s+/g, ' ').toLowerCase();
const rows = (sql, p) => {
  if (/^SELECT pg_advisory_xact_lock\(/.test(sql) || /^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) /.test(sql)) return [];
  if (/^SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(sql)) return ids.filter((i) => i.identity_id === p[0]);
  if (/FROM identities WHERE parent_entity_id = \$1 AND user_id LIKE/.test(sql)) return ids.filter((i) => i.parent_entity_id === p[0] && i.user_id.startsWith(p[1].replace('%', '')) && fold(i.display_name) === p[2]);
  if (/^SELECT user_id FROM identities WHERE user_id LIKE/.test(sql)) return ids.filter((i) => i.user_id.startsWith(p[0].replace('%', ''))).slice(0, 1);
  if (/^INSERT INTO identities/.test(sql)) { const r = { identity_id: '22222222-2222-4222-8222-' + String(100 + ids.length).padStart(12, '0'), bridge_id: p[0], display_name: p[1], user_id: p[2], parent_entity_id: p[3] }; ids.push(r); return [r]; }
  if (/^SELECT i\.identity_id, i\.display_name, i\.user_id FROM customer_list cl JOIN identities i/.test(sql)) return [];
  if (/^UPDATE (customer|supplier)_list SET hidden_at = NULL/.test(sql)) return [];
  if (/^INSERT INTO customer_list/.test(sql)) { lists.push({ o: p[0], c: p[1] }); return [{ customer_list_id: 'CL' + lists.length }]; }
  throw new Error('unexpected SQL: ' + sql.slice(0, 90));
};
const standIn = { query: async (sql, p) => ({ rows: rows(String(sql).replace(/\s+/g, ' ').trim(), p || []) }) };
mock('db/index.js', { query: standIn.query, withEntity: async (o, fn) => fn(standIn), trySavepoint: async (db, fn, fb) => { try { return await fn(); } catch (_) { return fb; } } });

(async () => {
  /* 1 - the named customer is minted, as an ordinary party row */
  const li = require(path.join(API, 'lib', 'local-identity'));
  const made = await li.addCustomer(standIn, SHOP, { name: 'Ravi Kumar', via: 'manual', number: false });
  const CUST = made.local && made.local.identity_id;
  ok('addCustomer mints "Ravi Kumar" as ~acmetraders.cus-0001 on the shop customer list', !!CUST && made.local.user_id === '~acmetraders.cus-0001' && lists.length === 1 && lists[0].o === SHOP && lists[0].c === CUST, JSON.stringify(made));

  /* 2 - books-store.parties reads him back (the real function, the join's row stood in) */
  const realStore = require(path.join(API, 'lib', 'books-store'));
  let askedSql = '';
  const dbParties = { query: async (sql) => { askedSql = sql; return { rows: [{ party_id: CUST, display_name: 'Ravi Kumar', user_id: made.local.user_id, gstn: null, on_rail: false, c_no: null, s_no: null, c_nick: null, s_nick: null, legal_name: null, customer: true, supplier: false, c_days: null, s_days: null, c_limit: null, s_limit: null, state_code: null }] }; } };
  const parties = await realStore.parties(dbParties, SHOP, [CUST]);
  ok('books-store.parties: one customer party with his own party_id, customer true, supplier false, on_rail false', parties.length === 1 && parties[0].party_id === CUST && parties[0].customer === true && parties[0].supplier === false && parties[0].on_rail === false && parties[0].name === 'Ravi Kumar', JSON.stringify(parties));
  ok('the party read starts from the shop customer_list and asks the one on-rail question (never a ~ party)', /FROM customer_list WHERE owner_entity_id = \$1/.test(askedSql.replace(/\s+/g, ' ')) && /NOT LIKE '~%'/.test(askedSql), askedSql.slice(0, 200));

  /* 3 - the credit lands on his party in the books */
  const H = require('./support/books-harness.cjs');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP the posting leg: ' + X.src.why); done(); return; }
  const K = require(path.join(API, 'lib', 'books-hooks'));
  const TC = require(path.join(API, 'lib', 'tax-copy'));
  const invIn = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 118 } };
  const now = { chit_id: 'n1', purpose: 'credit_note', currency_code: 'INR', created_at: '2026-10-17T05:00:00Z',
    business_json: { till: { id: 'C1' }, bill_no: 'CN-1', refund: { parts: [{ how: 'On credit', amount: 118 }] }, customer: { name: 'Ravi Kumar', identity_id: CUST } } };
  TC.copyOf = async () => now; TC.entryFor = async () => ({ sells: true, invoice: invIn });
  X.T.identities.push({ identity_id: SHOP, display_name: 'Shop', country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} });
  X.T.parties.push({ owner: SHOP, party_id: CUST, name: 'Ravi Kumar', customer: true });
  await X.store.saveSetting(X.db, SHOP, { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' });
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-10-17' }); K.forget(SHOP);
  const r = await K.postChit(SHOP, 'n1', {});
  const e = X.T.entries.find((x) => x.entity_id === SHOP && x.source_ref === 'chit:n1');
  const lines = e ? X.T.lines.filter((l) => l.entry_id === e.entry_id).map((l) => { const a = X.T.accounts.find((y) => y.account_id === l.account_id); return [a && (a.role || a.code), Number(l.dr_minor || 0), Number(l.cr_minor || 0), l.party_id || null]; }) : [];
  const dr = lines.reduce((t, l) => t + l[1], 0), cr = lines.reduce((t, l) => t + l[2], 0);
  ok('the credit note posts (not queued)', !!e && !r.queued, JSON.stringify([r, X.T.outbox.map((o) => o.why)]));
  ok('Dr 11800 (returns 10000 + CGST 900 + SGST 900) = Cr 11800 minor', dr === 11800 && cr === 11800, JSON.stringify(lines));
  ok('the one credit line is debtors 11800 on the NAMED customer party_id', JSON.stringify(lines.filter((l) => l[2]).map((l) => [l[0], l[2], l[3]])) === JSON.stringify([['debtors', 11800, CUST]]), JSON.stringify(lines));
  done();
})().catch((x) => { console.error(x); process.exit(1); });
