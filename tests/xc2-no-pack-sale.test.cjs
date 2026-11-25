#!/usr/bin/env node
// @type: unit
/**
 * tests/xc2-no-pack-sale.test.cjs — XC2-1119 (Athi 19 Nov, DECISIONS "A shop with no pack may sell"): a shop whose country has NO PACK may sell. The sale is NOT taxed by us: it is
 * accepted, carries money null (never a figure we did not work out), `tax_checked:false` and the one no-pack sentence; only what needs the rules (a return, books) stays refused.
 * OWNS      UC-CC-004 (the setup answer carries tax_checked + notice) · UC-CC-020 (the send is not a 422) · UC-CC-093 (no door words a missing pack but lib/no-pack-words).
 * CALLED BY scripts/guards.cjs.   Offline: the database and the address book are stubs.   CARD  15-tax-and-country-packs/no-pack-words
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = (p) => path.join(__dirname, '..', p);
const NZ = 'a1111111-1111-4111-8111-111111111111', AU = 'a2222222-2222-4222-8222-222222222222';
const COUNTRY = { [NZ]: 'NZ', [AU]: 'AU' };
const q = async (sql, p) => {
  const s = String(sql).replace(/\s+/g, ' ');
  const rows = /^SELECT identity_id, gstn, display_name, policy_flags, country, address, timezone FROM identities WHERE identity_id = ANY/.test(s) ? p[0].filter((id) => COUNTRY[id]).map((id) => ({ identity_id: id, gstn: '123456789', display_name: 'x', policy_flags: {}, country: COUNTRY[id] })) : [];
  return { rows, rowCount: rows.length };
};
const dbId = require.resolve(root('db/index.js'));
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { query: q, pool: { query: q }, withEntity: async (i, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), onEntity: async (i, fn) => fn({ query: q }), queryAs: q } };
const bookId = require.resolve(root('lib/ctpaddress.js'));
require.cache[bookId] = { id: bookId, filename: bookId, loaded: true, exports: { remoteInstallations: async () => new Map(), resolve: async () => ({ local: true }), resolveAll: async () => new Map(), peerByKey: async () => ({}), invalidate() {} } };
const sc = require(root('lib/schema')); sc.hasTable = async () => false; sc.hasColumn = async () => false;
const noPack = require(root('lib/no-pack-words'));
const chits = require(root('routes/chits'));
let n = 0;
const ok = async (what, fn) => { await fn(); n++; console.log('  ok  ' + what); };
const res = () => ({ locals: {}, statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, set() { return this; }, json(b) { this.body = b; return this; } });
const stateOf = (who) => ({ sellerId: who, sender_id: who, purpose: 'invoice', business_json: {}, currency_code: 'NZD', toIds: [], orderLike: false, is_draft: false, line_items: [{ particulars: 'Flat white', quantity: 2, price: 5, gst_rate: 10 }], receiverDetails: [] });

(async () => {
  await ok('UC-CC-020: a NZ shop (no pack) sells: sendMoney does not refuse, money is null, the notice and tax_checked:false are carried', async () => {
    const st = stateOf(NZ), r = res();
    const answered = await chits.sendMoney(st, { body: {}, id: 'r1' }, r);
    assert.ok(!answered && r.statusCode === null, 'no refusal, got ' + JSON.stringify(r.body));
    assert.strictEqual(st.moneyBlock, null); assert.strictEqual(st.originInvoice, null);
    assert.strictEqual(st.noPackSale.tax_checked, false);
    assert.ok(st.noPackSale.notice.startsWith(noPack.packMissing('NZ')), st.noPackSale.notice);
    assert.ok(st.noPackSale.notice.endsWith(noPack.stillWorks()));
  });
  await ok('a shop WITH a pack is taxed as before (no notice)', async () => {
    const st = stateOf(AU); st.currency_code = 'AUD';
    await chits.sendMoney(st, { body: {}, id: 'r2' }, res());
    assert.strictEqual(st.noPackSale, undefined); assert.ok(st.moneyBlock, 'the AU sale carries its engine money');
  });
  await ok('UC-CC-020: only the no-pack refusal turns into a sale; any other error is still an error', () => {
    assert.strictEqual(noPack.saleOf(new Error('boom')), null);
    assert.strictEqual(noPack.saleOf(Object.assign(new Error('x'), { refused: true, status: 422, code: 'NO_COUNTRY' })), null);
    assert.strictEqual(noPack.saleOf(noPack.refusal('NZ')).tax_checked, false);
  });
  await ok('UC-CC-020: the send answer carries tax_checked and notice', () => {
    const src = require('../tools/chits-files.cjs').read(root('.'));
    assert.match(src, /sendState\.noPackSale/);
    assert.ok(src.includes('...noPackAnswerOf(sendState)'));
  });
  await ok('UC-CC-004: the setup read and save answers carry tax_checked + the sentence for NZ (and nothing for AU)', () => {
    assert.deepStrictEqual(Object.keys(noPack.noticeOf('NZ')), ['tax_checked', 'notice']);
    assert.strictEqual(noPack.noticeOf('NZ').tax_checked, false);
    assert.ok(noPack.noticeOf('nz').notice.startsWith(noPack.packMissing('NZ')));
    assert.deepStrictEqual(noPack.noticeOf('AU'), { tax_checked: true, notice: null });
    const gov = fs.readFileSync(root('routes/governance.js'), 'utf8');
    assert.strictEqual((gov.match(/tax_checked: (setup|out)\.tax_checked, notice: (setup|out)\.notice/g) || []).length, 2, 'both the GET and the PUT answer carry them');
  });
  await ok('UC-CC-004: the profile itself carries them (the one reader)', () => {
    const src = fs.readFileSync(root('lib/country-setup.js'), 'utf8');
    assert.ok(src.includes("require('./no-pack-words').noticeOf(held.country)")); /* batch 1126 read: profile() was split into named helpers; the one reader is called with held.country */
  });
  await ok('UC-CC-093: the pack-status words every door reads are the one sentence (packStatusOf), never the engine words', () => {
    const st = require(root('lib/country-setup')).packStatusOf('NZ');
    assert.strictEqual(st.code, 'NO_COUNTRY_PACK'); assert.strictEqual(st.why, noPack.packMissing('NZ'));
    assert.ok(!/does not keep books|rail still work/.test(st.why));
  });
  await ok('UC-CC-093: no api door words a missing pack itself: the engine sentence appears only in the two adopted engine copies', () => {
    const hits = [];
    const walk = (d) => fs.readdirSync(root(d), { withFileTypes: true }).forEach((e) => {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) return /^(node_modules|tests|docs)$/.test(e.name) ? null : walk(rel);
      if (!/\.(js|cjs)$/.test(e.name) || /^lib\/(regulation|tax-engine\.browser)\.js$/.test(rel)) return null;
      if (/does not keep books for|rail still work; books arrive/.test(fs.readFileSync(root(rel), 'utf8'))) hits.push(rel);
    });
    ['lib', 'routes', 'tools', 'scripts'].filter((d) => fs.existsSync(root(d))).forEach(walk);
    assert.deepStrictEqual(hits, []);
  });
  await ok('UC-CC-093: a raw regulation.status(...) is read by nobody but the three named doors', () => {
    const hits = [];
    ['lib', 'routes'].forEach((d) => fs.readdirSync(root(d)).filter((f) => /\.js$/.test(f) && !/^(regulation|tax-engine\.browser)\.js$/.test(f)).forEach((f) => {
      fs.readFileSync(root(d + '/' + f), 'utf8').split('\n').forEach((line, i) => { if (/regulation\)?\.status\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) hits.push(d + '/' + f + ':' + (i + 1)); });
    }));
    const allowed = ['lib/country-setup.js', 'lib/till-summary.js', 'routes/tax.js']; /* packStatusOf · NO_COUNTRY (no country, not no pack) · the tax route: its words go through tax-contract countryWords */
    assert.deepStrictEqual(hits.filter((h) => !allowed.some((a) => h.startsWith(a + ':'))), []);
  });
  console.log('\n' + n + ' checks passed');
  process.exit(0);
})().catch((e) => { console.error((e && e.stack) || e); process.exit(1); });
