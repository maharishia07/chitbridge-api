'use strict';
/**
 * tests/parallel-run.test.cjs — THE PARALLEL-RUN COMPARE (PR1): their Tally / Xero period beside ours, line by line, each difference with WHY.
 * Pure over fixture files (tests/fixtures/parallel-run — a Tally ledger collection and report exports for an Indian shop; Xero CSVs for an Australian one),
 * then THROUGH THE REAL ROUTES over the in-memory books (tests/support/books-harness.cjs, the sibling engines): load a snapshot, compare, the auditor's .csv.
 *   · equal ✅ · different (a bill on the rail they keyed later; a rounding rule; an entry only theirs) · a mapping gap · only ours
 *   · their party ledgers pooled under the group ours keeps on one control ledger · a snapshot part is never replaced (409) · who may (owner · auditor · not a viewer)
 * No database, no network.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

let pass = 0, fail = 0;
const ta = async (name, fn) => { try { await fn(); console.log('  PASS  ' + name); pass++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n        ')); fail++; } };
const FIX = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'parallel-run', f), 'utf8');

const H = require('./support/books-harness.cjs');
const SHOP = '11111111-1111-4111-8111-111111111111', AU_SHOP = 'aaaaaaaa-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Traders' };
const authStub = Object.assign((req, res, next) => { req.identity = Object.assign({}, WHO); next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const X = H.load({ auth: authStub });
if (!X.src.dir) { console.log('  SKIP  ' + X.src.why); process.exit(0); }
const PR = require('../lib/parallel-run');

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = null; try { j = JSON.parse(raw || '{}'); } catch (_) { j = raw; } done({ status: res.statusCode, body: j, type: res.headers['content-type'] }); }); });
  r.end(b);
});
const byName = (lines, n) => lines.find((l) => l.name === n || l.their_name === n);

(async () => {
  console.log('\nparallel-run · their files, read');
  await ta('a Tally ledger collection: Dr is negative, the PARENT kept as the group, a nil ledger dropped, &amp; read as &', () => {
    const rows = PR.tallyRows(FIX('tally-tb-ledgers.xml'), 'tb', 'INR');
    const ravi = rows.find((r) => r.name === 'Ravi Stores'), out = rows.find((r) => r.name === 'Output CGST');
    assert.deepStrictEqual([ravi.dr_minor, ravi.cr_minor, ravi.amount_minor, ravi.group], [118000, 0, 118000, 'Sundry Debtors']);
    assert.deepStrictEqual([out.dr_minor, out.cr_minor, out.group], [0, 9000, 'Duties & Taxes']);
    assert.ok(!rows.some((r) => r.name === 'Cash'), 'a nil balance is not a line');
    assert.strictEqual(rows.length, 10);
  });
  await ta('Tally report exports: a trial balance (DSPCLDRAMTA / DSPCLCRAMTA) and a P&L (BSMAINAMT — the sign says the side)', () => {
    const tb = PR.tallyRows(FIX('tally-tb-report.xml'), 'tb', 'INR');
    assert.deepStrictEqual(tb.map((r) => [r.name, r.dr_minor, r.cr_minor]), [['Sundry Debtors', 118000, 0], ['Sales Accounts', 0, 100000], ['Duties & Taxes', 0, 18000]]);
    const pl = PR.tallyRows(FIX('tally-pl-report.xml'), 'pl', 'INR');
    assert.deepStrictEqual(pl.map((r) => [r.name, r.side, r.amount_minor]), [['Sales Accounts', 'income', 100000], ['Purchase Accounts', 'expense', 50000], ['Indirect Expenses', 'expense', 200000]]);
    assert.throws(() => PR.tallyRows('<ENVELOPE></ENVELOPE>', 'tb', 'INR'), /No ledgers with a balance/);
    assert.throws(() => PR.tallyRows('<x/>', 'ret', 'INR'), /export it to Excel/);
  });
  await ta('a Xero P&L (headings on row 5): headings set the side, totals and Gross / Net Profit are not lines; the date column is picked by the person', () => {
    const b = { csv: FIX('xero-pl.csv'), header_row: 5 };
    const pre = PR.preflight(b, 'pl', 'AUD');
    assert.strictEqual(pre.format, 'table'); assert.deepStrictEqual(pre.headers, ['Account', '30 Sep 2026']); assert.deepStrictEqual(pre.missing, ['amount']);
    const r = PR.read(Object.assign(b, { decisions: [{ incoming: 'Account', field: 'account' }, { incoming: '30 Sep 2026', field: 'amount' }] }), 'pl', 'AUD');
    assert.deepStrictEqual(r.rows.map((x) => [x.name, x.side, x.amount_minor]), [['Sales', 'income', 10000], ['Purchases', 'expense', 50000], ['Bank Fees', 'expense', 1200]]);
  });
  await ta('a Xero trial balance: "Sales (200)" splits its code; "Debit - Year to date" is guessed; the Total row is not a line', () => {
    const b = { csv: FIX('xero-tb.csv'), header_row: 5 };
    const g = PR.preflight(b, 'tb', 'AUD'), f = Object.fromEntries(g.guess.map((x) => [x.incoming, x.field]));
    assert.deepStrictEqual([f.Account, f['Debit - Year to date'], f['Credit - Year to date']], ['account', 'debit', 'credit']);
    const r = PR.read(Object.assign(b, { decisions: g.guess.filter((x) => x.field).map((x) => ({ incoming: x.incoming, field: x.field })) }), 'tb', 'AUD');
    assert.deepStrictEqual(r.rows[0], { line: 2, name: 'Sales', code: '200', group: null, side: null, dr_minor: 0, cr_minor: 10000, amount_minor: -10000 });
    assert.ok(!r.rows.some((x) => /total/i.test(x.name)));
  });
  await ta('why, in words: rounding · a rail bill they keyed later · two entries · theirs more · unexplained', () => {
    const e = (no, amt, rail, ref) => ({ entry_id: no, entry_no: no, date: '2026-09-28', amount_minor: amt, rail, ref: ref || null });
    assert.strictEqual(PR.explain(40, [], 'INR').cause, 'rounding');
    const a = PR.explain(59000, [e('SV/1', 118000, true, 'B-1'), e('SV/2', 59000, true, 'B-2')], 'INR');
    assert.strictEqual(a.cause, 'rail_later'); assert.match(a.why, /bill B-2 of 2026-09-28/); assert.strictEqual(a.hit[0].entry_no, 'SV/2');
    assert.strictEqual(PR.explain(30000, [e('MJ/1', 10000, false), e('MJ/2', 20000, false)], 'INR').cause, 'only_ours_entry');
    assert.strictEqual(PR.explain(-200000, [e('SV/1', 1000, true)], 'INR').cause, 'only_theirs');
    assert.match(PR.explain(77700, [e('SV/1', 1000, true)], 'INR').why, /open our 1 entries/);
  });

  /* ── through the routes ── */
  const app = require('express')(); app.use(require('express').json()); app.use('/api/books', require('../routes/books'));
  const srv = app.listen(0), port = srv.address().port, q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const K = require('../lib/books-hooks'); let DAY = '2026-10-05'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  require('../lib/tax-copy').ledgerFor = async () => ({ bounds: { period: '092026' }, me: { Gstin: '33AAAAA0000A1Z5' },
    ledger: { output: { taxable: 1500, igst: 0, cgst: 135, sgst: 135, cess: 0 }, itc: { igst: 0, cgst: 45, sgst: 45, cess: 0 }, net: {} } });
  try {
    console.log('\nparallel-run · an Indian shop beside a Tally trial balance');
    await X.store.saveSetting(X.db, SHOP, { enabled: false });
    assert.strictEqual((await q('POST', '/enable', {})).status, 200);
    X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true }, { owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true });
    X.T.chits.push({ chit_id: 'c0000000-0000-4000-8000-00000000000a', entity_id: SHOP, business_json: { printed_as: 'B-1' } }, { chit_id: 'c0000000-0000-4000-8000-00000000000b', entity_id: SHOP, business_json: { printed_as: 'B-2' } });
    const post = async (ev) => { const r = await X.B.postEntry(X.db, SHOP, ev); if (!r.ok) throw new Error(JSON.stringify(r)); };
    await post({ type: 'sale_bill', date: '2026-09-05', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a', by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: {}, round_off: 0 });
    await post({ type: 'sale_bill', date: '2026-09-28', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:b', by_rate: [{ rate: 18, taxable: 500, cgst: 45, sgst: 45, igst: 0 }], paid: {}, round_off: 0 });
    await post({ type: 'purchase_bill', date: '2026-09-06', currency: 'INR', party: SUPP, source_ref: 'pur:K7', by_rate: [{ rate: 18, taxable: 500, cgst: 45, sgst: 45, igst: 0 }], paid: {}, round_off: 0 });

    let id;
    await ta('GET /compare: ready, the owner may load, no snapshots yet; the parts and sources are the server\'s', async () => {
      const r = await q('GET', '/compare');
      assert.strictEqual(r.status, 200); assert.strictEqual(r.body.ready, true); assert.deepStrictEqual(r.body.may.load, { may: true, why: null });
      assert.deepStrictEqual(r.body.snapshots, []); assert.deepStrictEqual(r.body.parts.map((p) => p.part), ['tb', 'pl', 'bs', 'ret']);
    });
    await ta('POST /compare/preflight: a Tally XML is read at once (no columns to pick); XML from Xero is refused in words', async () => {
      const r = await q('POST', '/compare/preflight', { part: 'tb', source: 'tally', xml: FIX('tally-tb-ledgers.xml') });
      assert.strictEqual(r.status, 200); assert.strictEqual(r.body.format, 'tally_xml'); assert.strictEqual(r.body.ready, true); assert.strictEqual(r.body.rows_total, 10);
      const x = await q('POST', '/compare/preflight', { part: 'tb', source: 'xero', xml: '<a/>' });
      assert.strictEqual(x.status, 400); assert.match(x.body.message, /Only a Tally export/);
    });
    await ta('POST /compare/snapshots: their trial balance kept as a snapshot (never posted — the day book is unchanged)', async () => {
      const before = X.T.entries.length;
      const r = await q('POST', '/compare/snapshots', { label: 'Tally H1', source: 'tally', part: 'tb', period_to: '2026-09-30', xml: FIX('tally-tb-ledgers.xml'), file_name: 'tb.xml' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body)); id = r.body.snapshot_id;
      assert.deepStrictEqual([r.body.part, r.body.rows, r.body.period_from, r.body.period_to, r.body.source], ['tb', 10, '2026-04-01', '2026-09-30', 'tally']);
      assert.strictEqual(X.T.entries.length, before, 'nothing posted');
      const again = await q('POST', '/compare/snapshots', { snapshot_id: id, part: 'tb', xml: FIX('tally-tb-ledgers.xml') });
      assert.strictEqual(again.status, 409); assert.match(again.body.message, /already has their trial balance/);
      const list = await q('GET', '/compare');
      assert.deepStrictEqual(list.body.snapshots.map((s) => [s.label, s.parts, s.lines]), [['Tally H1', ['tb'], 10]]);
    });
    await ta('more parts on the same snapshot: their P&L (Tally report) and their GSTR-3B (CSV) — the period is the snapshot\'s', async () => {
      const pl = await q('POST', '/compare/snapshots', { snapshot_id: id, part: 'pl', xml: FIX('tally-pl-report.xml') });
      assert.strictEqual(pl.status, 200, JSON.stringify(pl.body)); assert.strictEqual(pl.body.period_to, '2026-09-30');
      const pre = await q('POST', '/compare/preflight', { part: 'ret', source: 'tally', csv: FIX('tally-gstr3b.csv') });
      const dec = pre.body.guess.filter((g) => g.field).map((g) => ({ incoming: g.incoming, field: g.field }));
      assert.deepStrictEqual(dec.map((d) => d.field), ['box', 'amount']);
      const ret = await q('POST', '/compare/snapshots', { snapshot_id: id, part: 'ret', csv: FIX('tally-gstr3b.csv'), decisions: dec });
      assert.strictEqual(ret.status, 200, JSON.stringify(ret.body));
    });
    let C;
    await ta('GET /compare/:id — the trial balance: equal ✅, the rail bill they keyed later (named), party ledgers pooled, a mapping gap, theirs more', async () => {
      const r = await q('GET', '/compare/' + id); C = r.body;
      assert.strictEqual(r.status, 200, JSON.stringify(r.body).slice(0, 300));
      const tb = C.parts.tb.lines;
      assert.strictEqual(tb[0].total, true); assert.strictEqual(tb[0].status, 'different');
      assert.strictEqual(byName(tb, 'Purchases').status, 'equal');
      const sales = byName(tb, 'Sales');
      assert.deepStrictEqual([sales.status, sales.ours_minor, sales.theirs_minor, sales.diff_minor, sales.cause], ['different', -150000, -100000, -50000, 'rail_later']);
      assert.match(sales.why, /bill B-2 of 2026-09-28/); assert.strictEqual(sales.entries[0].ref, 'B-2'); assert.deepStrictEqual(sales.open, { code: '4000', from: '2026-04-01', to: '2026-09-30' });
      const deb = tb.find((l) => /^Sundry Debtors/.test(l.their_name || ''));
      assert.deepStrictEqual([deb.our_codes, deb.diff_minor, deb.cause], [['1300'], 59000, 'rail_later']);
      assert.strictEqual(tb.find((l) => /^Sundry Creditors/.test(l.their_name || '')).status, 'equal');
      const gap = byName(tb, 'Proprietor Funds'); assert.strictEqual(gap.status, 'gap'); assert.match(gap.why, /No ledger here matches "Proprietor Funds"/);
      const rent = tb.find((l) => /^Indirect Expenses/.test(l.their_name || '')); assert.strictEqual(rent.cause, 'only_theirs');
      assert.ok(tb.findIndex((l) => l.status === 'equal') > tb.findIndex((l) => l.status === 'gap'), 'differences first');
      assert.deepStrictEqual(C.parts.tb.counts, { equal: 4, different: 5, gap: 1, only_ours: 0 });
    });
    await ta('the P&L by Tally group: Sales Accounts different (the rail bill), Indirect Expenses theirs only; net profit compared first', async () => {
      const pl = C.parts.pl.lines;
      assert.deepStrictEqual([pl[0].name, pl[0].ours_minor, pl[0].theirs_minor], ['Net profit', 100000, -150000]);
      const s = byName(pl, 'Sales Accounts'); assert.deepStrictEqual([s.status, s.diff_minor, s.cause], ['different', 50000, 'rail_later']);
      assert.strictEqual(byName(pl, 'Purchase Accounts').status, 'equal');
    });
    await ta('the GSTR-3B from the rail, box by box: 3.1(a) taxable differs by the bill, ITC equal; the note says it is the rail\'s', async () => {
      const ret = C.parts.ret;
      assert.strictEqual(ret.error, null); assert.match(ret.note, /frozen invoices on the rail/);
      const t = ret.lines.find((l) => l.name.indexOf('3.1(a) Outward') === 0); assert.deepStrictEqual([t.status, t.diff_minor], ['different', 50000]);
      assert.strictEqual(ret.lines.find((l) => l.name.indexOf('4(C) CGST') === 0).status, 'equal');
    });
    await ta('the balance sheet from a Tally report: Sundry Debtors (an asset, Dr) different by the rail bill; the total assets compared first', async () => {
      const b = await q('POST', '/compare/snapshots', { snapshot_id: id, part: 'bs', xml: FIX('tally-bs-report.xml') });
      assert.strictEqual(b.status, 200, JSON.stringify(b.body));
      const bs = (await q('GET', '/compare/' + id)).body.parts.bs.lines;
      assert.strictEqual(bs[0].name, 'Total assets');
      const d = byName(bs, 'Sundry Debtors'); assert.deepStrictEqual([d.status, d.ours_minor, d.theirs_minor, d.cause], ['different', 177000, 118000, 'rail_later']);
    });
    await ta('effort (PR2\'s hook): the period\'s entries by how they came — structured (the rail) vs keyed', async () => {
      assert.deepStrictEqual([C.effort.entries, C.effort.structured, C.effort.keyed], [3, 2, 1]);
      assert.deepStrictEqual(C.effort.by_kind, { sale_bill: 2, purchase_bill: 1 });
    });
    await ta('GET /compare/:id/csv: the auditor\'s file — every line, with the why', async () => {
      const r = await call(port, 'GET', '/api/books/compare/' + id + '/csv');
      assert.strictEqual(r.status, 200); assert.match(r.type, /text\/csv/);
      assert.match(String(r.body), /^statement,status,line/); assert.match(String(r.body), /"Trial balance","different","Sales",.*"-1500.00","-500.00",.*bill B-2/);
    });
    await ta('who may: a viewer (not whole-entity) is refused with the sentence; the shop\'s auditor (whole entity, sees money) may', async () => {
      Object.assign(WHO, { identity_id: 'abababab-0000-4000-8000-000000000001', identity_type: 'actor', parent_entity_id: SHOP, whole_entity: false });
      const no = await q('GET', '/compare');
      assert.strictEqual(no.status, 403); assert.match(no.body.message, /owner or the shop's auditor/);
      const C0 = require('../lib/cost'), keep = C0.canRead; C0.canRead = async () => true; WHO.whole_entity = true;
      try { assert.strictEqual((await q('GET', '/compare/' + id)).status, 200); } finally { C0.canRead = keep; }
      Object.assign(WHO, { identity_id: SHOP, identity_type: 'entity', parent_entity_id: undefined, whole_entity: undefined });
    });
    await ta('before b309 runs: GET /compare says so (ready false, Load greyed with the sentence); a load answers 503 in words — never a 500', async () => {
      X.T.compareReady = false;
      try {
        const r = await q('GET', '/compare'); assert.strictEqual(r.body.ready, false); assert.deepStrictEqual(r.body.may.load, { may: false, why: r.body.why }); assert.match(r.body.why, /b309/);
        const w = await q('POST', '/compare/snapshots', { label: 'x', source: 'tally', part: 'tb', period_to: '2026-09-30', xml: FIX('tally-tb-ledgers.xml') });
        assert.strictEqual(w.status, 503); assert.match(w.body.message, /b309/);
      } finally { X.T.compareReady = true; }
    });

    console.log('\nparallel-run · an Australian shop beside Xero (TB · P&L · BAS)');
    Object.assign(WHO, { identity_id: AU_SHOP }); DAY = '2026-10-20';
    await X.store.saveSetting(X.db, AU_SHOP, { enabled: false, country: 'AU' });
    assert.strictEqual((await q('POST', '/enable', {})).status, 200);
    X.T.parties.push({ owner: AU_SHOP, party_id: SUPP, party_no: 'P-00001', name: 'Kumar Traders', supplier: true });
    const postAU = async (ev) => { const r = await X.B.postEntry(X.db, AU_SHOP, ev); if (!r.ok) throw new Error(JSON.stringify(r)); };
    await postAU({ type: 'walkin_day', ref: 'D1', date: '2026-07-01', currency: 'AUD', modes: { cash: 110 }, by_rate: [{ rate: 10, taxable: 100, gst: 10 }], round_off: 0, source_ref: 'walkin:C1:2026-07-01' });
    await postAU({ type: 'purchase_bill', ref: 'P1', date: '2026-09-06', currency: 'AUD', party: SUPP, by_rate: [{ rate: 10, taxable: 500, gst: 50 }], paid: {}, round_off: 0, source_ref: 'pur:P1' });
    let au;
    await ta('Xero TB + P&L + BAS loaded as one snapshot (the columns guessed, the date column picked)', async () => {
      const g = (await q('POST', '/compare/preflight', { part: 'tb', source: 'xero', csv: FIX('xero-tb.csv'), header_row: 5 })).body;
      const dec = g.guess.filter((x) => x.field).map((x) => ({ incoming: x.incoming, field: x.field }));
      const tb = await q('POST', '/compare/snapshots', { label: 'Xero Q1', source: 'xero', part: 'tb', period_from: '2026-07-01', period_to: '2026-09-30', csv: FIX('xero-tb.csv'), header_row: 5, decisions: dec });
      assert.strictEqual(tb.status, 200, JSON.stringify(tb.body)); au = tb.body.snapshot_id;
      const pl = await q('POST', '/compare/snapshots', { snapshot_id: au, part: 'pl', csv: FIX('xero-pl.csv'), header_row: 5, decisions: [{ incoming: 'Account', field: 'account' }, { incoming: '30 Sep 2026', field: 'amount' }] });
      assert.strictEqual(pl.status, 200, JSON.stringify(pl.body));
      const bas = await q('POST', '/compare/snapshots', { snapshot_id: au, part: 'ret', csv: FIX('xero-bas.csv'), decisions: [{ incoming: 'Box', field: 'box' }, { incoming: 'Amount', field: 'amount' }] });
      assert.strictEqual(bas.status, 200, JSON.stringify(bas.body));
    });
    await ta('the AU compare: Sales and Cash equal ✅; Xero\'s GST (net) vs our GST collected — theirs more; Bank Fees a mapping gap; GST paid only ours', async () => {
      const r = await q('GET', '/compare/' + au); assert.strictEqual(r.status, 200, JSON.stringify(r.body).slice(0, 300));
      const tb = r.body.parts.tb.lines;
      assert.strictEqual(byName(tb, 'Sales').status, 'equal'); assert.strictEqual(byName(tb, 'Cash on hand').status, 'equal');
      assert.strictEqual(byName(tb, 'Suppliers (Trade creditors)').status, 'equal');
      assert.strictEqual(byName(tb, 'GST collected').cause, 'only_theirs');
      assert.strictEqual(byName(tb, 'Bank Fees').status, 'gap');
      const paid = byName(tb, 'GST paid'); assert.strictEqual(paid.status, 'only_ours'); assert.match(paid.why, /Only in ours: 1 entry/);
      const pl = r.body.parts.pl.lines; assert.strictEqual(byName(pl, 'Sales').status, 'equal'); assert.strictEqual(byName(pl, 'Bank Fees').status, 'gap');
    });
    await ta('the BAS, box by box from our books: G1 and 1A equal, 1B different (ours counts GST paid)', async () => {
      const r = await q('GET', '/compare/' + au), ret = r.body.parts.ret;
      assert.strictEqual(ret.error, null, ret.error);
      const box = (c) => ret.lines.find((l) => l.name.indexOf(c + ' ') === 0);
      assert.strictEqual(box('G1').status, 'equal'); assert.strictEqual(box('1A').status, 'equal');
      assert.deepStrictEqual([box('1B').status, box('1B').diff_minor], ['different', 500]); assert.match(box('1B').why, /it counts GST paid/);
    });
  } finally { srv.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e); process.exit(1); });
