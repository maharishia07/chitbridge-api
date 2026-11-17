#!/usr/bin/env node
/**
 * e2e/walk-crm-lead-import.cjs - CB CRM L3, WALKED: the call desk's first list, imported from a CSV (Leads tab › Import).
 * Black box: it presses what an owner presses - Import, pick the file, confirm the columns, read the Check step, Import, read the outcome, Done -
 * and reads what the screen says. The plan (will add · will merge · will skip + why) is the SERVER's answer (POST /api/crm/leads/import { dry }),
 * so the stand-in answers it the way chitbridge-api does for this fixture; the page paints it and computes nothing.
 * The fixture (e2e/fixtures/leads-import.csv) has duplicates (a phone twice, a name twice), bad phones, a missing name, quoted cells with commas and
 * a newline, a lead the shop has, a customer the shop has, and a manual party that becomes a lead (merge).
 * A FIXTURE shop: the site is served from this checkout, the API is a stand-in answering inside the page (state in memory); nothing reaches
 * localhost:3000 or the live site, nothing is written anywhere.
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-crm-lead-import.cjs      headless, fast
 *   node e2e/walk-crm-lead-import.cjs --show                           watch it
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-crm-lead-import-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');
const fs = require('fs'), path = require('path'), os = require('os');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const crmApi = require('./lib/crm-api.cjs');   /* the one GET /parties envelope (listPage: total · page · limit) */
const J = C.json;
const FIX = path.join(__dirname, 'fixtures', 'leads-import.csv');
const WAIT = 'Lead stages arrive after the next update.';
const CAP = 'Import up to 500 leads at a time. Split the file.';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const claims = (c) => b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(TD.nowMs() / 1000) + 3600 }, c)) + '.x';
const VIEWER = JSON.stringify({ token: claims({ identity_id: 'act-2', identity_type: 'actor', parent_entity_id: 'ent-walk', display_name: 'Vel', hat: 'view_only' }), role: 'actor', name: 'Vel', entity: 'Fixture Shop' });

/* ── the stand-in: the shop's parties, and the api's own rule for this fixture (normalise by the one helper's digits · dedupe · merge / skip) ── */
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const phoneOf = (raw) => { const p = String(raw || '').replace(/[^0-9+]/g, ''); return digits(p).length >= 8 ? p : null; };
const P = (n) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
const S = { calls: [], bodies: [], leadsOff: false, n: 10,
  existing: [{ party_id: P(2), name: 'Lead Lata', phone: '+919840000002', kind: 'lead' }, { party_id: P(1), name: 'Regular Raj', phone: '+919840000001', kind: 'customer' },
    { party_id: P(3), name: 'Mani Traders', phone: '9840044444', kind: 'manual' }] };
const leads = () => S.existing.filter((e) => e.kind === 'lead');
function plan(rows) {
  const seenP = new Map(), seenN = new Map();
  const out = rows.map((r, i) => {
    const row = { row: i + 1, name: String(r.name || '').trim(), phone: null, outcome: 'add', why: null, party_id: null };
    const raw = String(r.phone || '').trim(), skip = (why) => { row.outcome = 'skip'; row.why = why; return row; };
    if (!row.name) return skip('No name');
    if (raw && !phoneOf(raw)) return skip('Phone does not look right');
    row.phone = raw ? phoneOf(raw) : null;
    const d = row.phone ? digits(row.phone) : null, k = row.name.toLowerCase();
    if (d && seenP.has(d)) return skip('Same phone as row ' + seenP.get(d));
    if (seenN.has(k)) return skip('Same name as row ' + seenN.get(k));
    if (d) seenP.set(d, row.row); seenN.set(k, row.row);
    const e = S.existing.find((x) => (d && digits(x.phone) === d) || x.name.toLowerCase() === k);
    if (!e) return row;
    row.party_id = e.party_id;
    if (e.kind === 'customer') return skip('Already a customer');
    if (e.kind === 'lead') return skip('Already a lead');
    row.outcome = 'merge'; return row;
  });
  return out;
}
function answer(rows, dry) {
  const p = plan(rows);
  if (!dry) p.forEach((r) => {
    if (r.outcome === 'add') { r.party_id = P(++S.n); S.existing.push({ party_id: r.party_id, name: r.name, phone: r.phone, kind: 'lead' }); }
    if (r.outcome === 'merge') { const e = S.existing.find((x) => x.party_id === r.party_id); if (e) e.kind = 'lead'; }
  });
  return { dry: !!dry, added: p.filter((r) => r.outcome === 'add').length, merged: p.filter((r) => r.outcome === 'merge').length,
    skipped: p.filter((r) => r.outcome === 'skip').map((r) => ({ row: r.row, name: r.name, phone: r.phone, why: r.why })), rows: p };
}
const leadRow = (e) => ({ party_id: e.party_id, display_name: e.name, user_id: '~walk.cus-' + e.party_id.slice(-4), bridge_id: null, email: null, phone: null, otp_contact: e.phone || null, gstn: null, status: 'active',
  city: null, kind: 'local', on_chitbridge: false, may_trade: { ok: false, why: 'local' }, roles: { customer: true, supplier: false }, party_no: 'P-0' + e.party_id.slice(-3), last_activity: null,
  customer: { list_id: 'cl-' + e.party_id, segment: 'new', segment_override: null, txn_count: 0, last_txn_at: null, groups: [], customer_type: 'entity', added_via: 'lead' },
  lead: { stage: 'lead', since: '2026-10-12T09:00:00.000Z' }, legal_name: null, nickname: null, state_code: null, tax_ids: [], terms: { customer: { credit_days: null, credit_limit_minor: null } }, dues: null,
  gstin: { value: null, source: null, theirs: null, differs: false }, name: e.name });
async function route(r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  S.calls.push(m + ' ' + p + u.search);
  let body = null; try { body = q.postDataJSON(); } catch (_) {}
  if (m !== 'GET') S.bodies.push({ m, p, body });
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
  if (p === '/api/crm/followups' && m === 'GET') return J(r, 200, Object.assign(crmApi.followups([]), { may: crmApi.mayOf(r) }));   /* the one envelope (total · page · limit · shop_day), as the contract holds it; may = THIS login's */
  if (p === '/api/crm/parties' && m === 'GET') {
    const L = u.searchParams.get('view') === 'leads' ? (S.leadsOff ? [] : leads().map(leadRow)) : [];
    return J(r, 200, crmApi.listPage(L, { leads_migrated: !S.leadsOff }));
  }
  if (p === '/api/crm/leads/import' && m === 'POST') {
    if (S.leadsOff) return J(r, 503, { code: 'LEADS_NOT_MIGRATED', error: WAIT, message: WAIT });
    const rows = (body && body.rows) || [];
    if (!rows.length) return J(r, 400, { code: 'NO_ROWS', error: 'Nothing to import.', message: 'Nothing to import.' });
    if (rows.length > 500) return J(r, 400, { code: 'TOO_MANY', error: CAP, message: CAP });
    return J(r, body.dry ? 200 : 201, answer(rows, !!body.dry));
  }
  return J(r, 404, { error: 'not found' });
}

W.run('crm-lead-import', async (w) => {
  const { page, ctx, base } = w;
  await ctx.route('**/api/**', (r) => route(C.wrap(r)));
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', s); } } catch (_) {} }, W.session('Walk Owner', 'Fixture Shop'));
  const T = (tid) => '[data-testid="' + tid + '"]';
  const text = async (sel) => { const el = await page.$(sel); return el ? (await el.textContent()).replace(/\s+/g, ' ').trim() : ''; };
  const whyOf = async () => text('[data-testid^="step-why-"]');
  /* a fresh document every time (the same URL with only a hash would not reload the page or re-read the session) */
  const open = async (hash) => { await page.goto('about:blank'); await page.goto(base + '/crm.html' + (hash || '#/leads')); await page.waitForSelector(T('crm-leads'), { timeout: 15000 }); await page.waitForTimeout(500); };

  await open();
  await w.step('I1', 'Leads tab -> the owner sees Import beside Add lead', async () => {
    const b = await page.$(T('crm-lead-import'));
    return { ok: !!b && !(await b.isDisabled()), saw: b ? 'Import: "' + (await b.textContent()).trim() + '"' : 'no Import button' };
  });
  await w.step('I2', 'Import -> the sheet opens on File; Next is greyed and says why', async () => {
    await page.click(T('crm-lead-import')); await page.waitForSelector(T('crm-import-sheet'));
    const next = await page.$(T('crm-import-next')), why = await whyOf();
    return { ok: !!next && (await next.isDisabled()) && why === 'Pick a CSV file first.', saw: 'Next disabled=' + (next ? await next.isDisabled() : '-') + ' · "' + why + '"' };
  });
  await w.step('I3', 'pick the CSV -> the file line says the name and 9 rows; Next opens', async () => {
    await page.setInputFiles(T('crm-import-file'), FIX); await page.waitForTimeout(300);
    const msg = await text(T('crm-import-filemsg')), next = await page.$(T('crm-import-next'));
    return { ok: /leads-import\.csv · 9 rows/.test(msg) && !(await next.isDisabled()), saw: msg };
  });
  await w.step('I4', 'Next -> Columns: every header is guessed (the person confirms, nothing is assumed silently)', async () => {
    await page.click(T('crm-import-next')); await page.waitForSelector(T('crm-import-map-name'));
    const got = {}; for (const k of ['name', 'phone', 'email', 'business', 'city', 'source', 'note']) got[k] = await page.$eval(T('crm-import-map-' + k), (s) => s.value);
    const want = { name: '0', phone: '1', email: '2', business: '3', city: '4', source: '5', note: '6' };
    return { ok: JSON.stringify(got) === JSON.stringify(want), saw: Object.keys(got).map((k) => k + '=' + got[k]).join(' ') };
  });
  await w.step('I5', 'Check -> the SERVER\'s plan painted: 2 to add · 1 to merge · 6 to skip, each skip with why; the dry run carried the mapped cells', async () => {
    await page.click(T('crm-import-next')); await page.waitForSelector(T('crm-import-counts'), { timeout: 10000 });
    const counts = await text(T('crm-import-counts'));
    const dry = S.bodies.find((b) => b.p === '/api/crm/leads/import' && b.body && b.body.dry);
    const r1 = dry && dry.body.rows[0], r7 = dry && dry.body.rows[6];
    const skipWhy = await page.$$eval(T('crm-import-preview') + ' [data-will="skip"]', (els) => els.length);
    const why4 = await text(T('crm-imp-prev-4')), why7 = await text(T('crm-imp-prev-7'));
    const okRows = !!r1 && r1.name === 'Ravi Jewellers' && r1.phone === '+91 98400 12321' && r1.business === 'Ravi & Co, Madurai' && /"gold"/.test(r1.note) && dry.body.rows.length === 9 && r7 && /line one\s+line two/i.test(r7.note);
    return { ok: counts === '2 leads to add · 1 to merge · 6 to skip' && skipWhy === 6 && /Same phone as row 1/.test(why4) && /Will merge/.test(why7) && okRows,
      saw: counts + ' · skips=' + skipWhy + ' · row4 "' + why4 + '" · row7 "' + why7 + '" · dry rows=' + (dry ? dry.body.rows.length : 0) };
  });
  let markImport = 0;
  await w.step('I6', 'Import -> the outcome where it happened: 2 added · 1 merged · 6 skipped, the skipped rows as a list with Download CSV', async () => {
    markImport = S.calls.length;
    await page.click(T('crm-import-go')); await page.waitForSelector(T('crm-import-outcome'), { timeout: 10000 });
    const a = await text(T('crm-import-added')), m = await text(T('crm-import-merged')), s = await text(T('crm-import-skipped'));
    const dl = await page.$(T('cbl-csv-crm-import-skipped')), rows = await page.$$eval('[data-testid^="crm-imp-skip-"]', (els) => els.length);
    const real = S.bodies.filter((b) => b.p === '/api/crm/leads/import' && b.body && !b.body.dry);
    return { ok: a === '2 added' && m === '1 merged' && s === '6 skipped' && !!dl && rows === 6 && real.length === 1 && real[0].body.rows.length === 9,
      saw: a + ' · ' + m + ' · ' + s + ' · download=' + !!dl + ' · skipped rows=' + rows + ' · writes=' + real.length };
  });
  await w.step('I7', 'Done -> the Leads list was read again after the import and shows the new and the merged leads', async () => {
    await page.click(T('crm-import-done')); await page.waitForTimeout(600);
    const names = await page.$$eval(T('crm-leads') + ' [data-testid^="crm-lead-P-"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    const has = (n) => names.some((t) => t.indexOf(n) >= 0);
    const reread = S.calls.slice(markImport).some((c) => /view=leads/.test(c));
    return { ok: has('Ravi Jewellers') && has('Kala Stores') && has('Mani Traders') && reread, saw: names.length + ' leads: ' + names.map((t) => t.slice(0, 18)).join(' | ') + ' · re-read=' + reread };
  });
  await w.step('I8', 'a 501-row file -> Next greyed with the one sentence; nothing is sent', async () => {
    const big = path.join(os.tmpdir(), 'walk-leads-501.csv');
    fs.writeFileSync(big, 'Name,Phone\n' + Array.from({ length: 501 }, (_, i) => 'Lead ' + i + ',98' + String(10000000 + i).slice(-8)).join('\n') + '\n');
    const sent = S.bodies.length;
    await page.click(T('crm-lead-import')); await page.waitForSelector(T('crm-import-file'));
    await page.setInputFiles(T('crm-import-file'), big); await page.waitForTimeout(300);
    const next = await page.$(T('crm-import-next')), why = await whyOf(), off = !!next && (await next.isDisabled());
    await page.click(T('crm-import-back'));
    return { ok: off && why === CAP && S.bodies.length === sent, saw: 'Next disabled=' + off + ' · "' + why + '" · sent=' + (S.bodies.length - sent) };
  });
  await w.step('I9', 'b297 not run -> Import is greyed WITH the sentence (the server would refuse too)', async () => {
    S.leadsOff = true; await open();
    const b = await page.$(T('crm-lead-import'));
    const off = !!b && (await b.isDisabled()), title = b ? await b.getAttribute('title') : '';
    S.leadsOff = false;
    return { ok: off && title === WAIT, saw: 'disabled=' + off + ' · title "' + title + '"' };
  });
  /* the show-action rule (FX-L2C, 13 Oct): a view-only login SEES Import and Add, greyed WITH the reason — never hidden */
  await w.step('I10', 'a view-only login -> Import and Add are shown greyed, each with the reason', async () => {
    await page.evaluate((s) => { localStorage.setItem('cb_sess', s); }, VIEWER); await open();
    const b = await page.$(T('crm-lead-import')), add = await page.$(T('crm-lead-add'));
    const st = async (el) => (el ? { off: await el.isDisabled(), why: (await el.getAttribute('title')) || (await el.innerText()) } : null);
    const bi = await st(b), ba = await st(add);
    await page.evaluate((s) => { localStorage.setItem('cb_sess', s); }, W.session('Walk Owner', 'Fixture Shop'));
    const ok = !!bi && !!ba && bi.off && ba.off && !!bi.why && !!ba.why;
    return { ok, saw: 'import=' + JSON.stringify(bi) + ' add=' + JSON.stringify(ba) };
  });
  await w.step('I11', '390 px -> the sheet and its Check list fit the phone (no sideways scroll)', async () => {
    await page.setViewportSize({ width: 390, height: 800 }); await open();
    await page.click(T('crm-lead-import')); await page.waitForSelector(T('crm-import-file'));
    await page.setInputFiles(T('crm-import-file'), FIX); await page.waitForTimeout(300);
    await page.click(T('crm-import-next')); await page.waitForSelector(T('crm-import-map-name'));
    await page.click(T('crm-import-next')); await page.waitForSelector(T('crm-import-counts'), { timeout: 10000 });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    return { ok: sw <= 390, saw: 'scrollWidth=' + sw };
  });
  await w.step('I12', 'every stand-in answer matched the API contract; no page error', async () => {
    const [okc, msg] = C.finish();
    return { ok: okc && w.errs.length === 0, saw: msg + (w.errs.length ? ' · page errors: ' + w.errs.join(' | ').slice(0, 200) : '') };
  });
});
