#!/usr/bin/env node
/**
 * e2e/walk-finance-money.cjs - CB FINANCE · CHEQUES + RETURNS, WALKED (round T3-P1-MONEY: finance.html#/cheques + app/cap-finance-cheques.js ·
 * finance.html#/returns + app/cap-finance-returns.js). Black box: it reads the two tabs the way an owner does.
 *   Cheques: the cheques in hand, grouped received / written; each post-dated one's state in the SERVER's words (deposit today · overdue · post-dated);
 *   the steps the server offers (Deposited · Cleared · Bounced) pressed and sent; Remind me = a CRM follow-up due on the cheque's date; the owner's
 *   switch (on/off · days ahead) saved as a shop term; a non-owner sees Save greyed WITH the sentence; the three refusals (denied · broken · off).
 *   Returns: COUNTRY-FIRST - an Indian shop downloads gstr1-YYYY-MM.json / gstr3b-YYYY-MM.json for the month chosen (a real browser download, the server's
 *   JSON); an AU shop is told BAS is prepared in CB Accounts, an AE shop its VAT return; no country → Settings › Country; a pack with no return says so.
 * Every figure is the SERVER's - the stand-in answers fixed rows and the page must paint exactly those; the walk counts every write.
 * A FIXTURE shop ("Fixture Shop" / CBWALK0001): the site is served from this checkout, the API is a stand-in answering inside the page. Every /api/books and
 * /api/crm answer is held to the API contract (e2e/fixtures/web-api.contract.json, M43). Rule 13: both tabs in Cream and Dark at 1366 and 390 px.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-finance-money.cjs          headless, the stand-in
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-finance-money.cjs --real   the real api as a child on the loader's Postgres (e2e/lib/real-api.cjs): the
 *                                                                             tabs are opened on the loaded shop and must paint their own words (no fixture rows)
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-finance-money-NN.png.
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const { rule13 } = require('./lib/rule13.cjs');
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const REAL = process.argv.includes('--real');

/* ONE CLOCK (F3b): the browser's clock and the stand-in's day are the same injected instant, in the shop's zone */
const ZONE = 'Asia/Kolkata';
const NOW = new Date(process.env.WALK_NOW || '2026-10-12T16:00:00+05:30');
if (isNaN(NOW)) { console.log('WALK_NOW is not a date: ' + process.env.WALK_NOW); process.exit(2); }
const DAY_MS = 86400000;
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayN = (n) => ymd.format(new Date(NOW.getTime() + n * DAY_MS));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DMY = (s) => Number(s.slice(8, 10)) + ' ' + MON[Number(s.slice(5, 7)) - 1] + ' ' + s.slice(0, 4);
/* the month before day 0, as YYYY-MM and as the page words it (Sep 2026) */
const lastMonth = () => { const y = Number(dayN(0).slice(0, 4)), m = Number(dayN(0).slice(5, 7)) - 1; const mm = m < 1 ? 12 : m, yy = m < 1 ? y - 1 : y; return { v: yy + '-' + String(mm).padStart(2, '0'), label: MON[mm - 1] + ' ' + yy }; };
const MALA = 'pa', KUMAR = 'pb', RAVI = 'pc', SRI = 'pd';
const UUIDS = { p1: '10000000-0000-4000-8000-000000000001', p2: '10000000-0000-4000-8000-000000000002', p3: '10000000-0000-4000-8000-000000000003', p4: '10000000-0000-4000-8000-000000000004', p5: '10000000-0000-4000-8000-000000000005' };

/** the cheques as the server lists them: three post-dated ones received (tomorrow · two days late · today), one deposited, one written by the shop */
function cheques(S) {
  const row = (id, pid, name, dir, no, bank, minor, date, status, next) => ({ payment_id: UUIDS[id], party_id: pid, party_no: 'P-' + pid, name, direction: dir, amount_minor: minor, currency: 'INR',
    reference: null, cheque_no: no, cheque_bank: bank, cheque_date: date, received_at: dayN(-3), status: S.steps[id] || status, next: S.steps[id] ? null : next });
  const rows = [
    row('p1', MALA, 'Mala Stores', 'in', '000777', 'SBI', 500000, dayN(1), 'received', ['deposited']),
    row('p2', KUMAR, 'Kumar Traders', 'in', '000778', 'HDFC', 120000, dayN(-2), 'received', ['deposited']),
    row('p3', RAVI, 'Ravi & Co', 'in', '000779', 'HDFC', 90000, dayN(0), 'received', ['deposited']),
    row('p4', SRI, 'Sri Traders', 'in', '000780', 'SBI', 90000, dayN(-9), 'deposited', ['cleared', 'bounced']),
    row('p5', SRI, 'Sri Traders', 'out', '110', 'SBI', 70000, dayN(0), 'received', ['deposited']),
  ];
  const pdc = S.remind.on ? [
    { payment_id: UUIDS.p2, cheque_no: '000778', cheque_date: dayN(-2), amount_minor: 120000, state: 'overdue_for_deposit' },
    { payment_id: UUIDS.p3, cheque_no: '000779', cheque_date: dayN(0), amount_minor: 90000, state: 'deposit_today' },
    { payment_id: UUIDS.p1, cheque_no: '000777', cheque_date: dayN(1), amount_minor: 500000, state: 'not_yet' },
  ].filter((x) => !S.steps[x.payment_id === UUIDS.p1 ? 'p1' : x.payment_id === UUIDS.p2 ? 'p2' : 'p3']) : [];
  return { currency: 'INR', asOf: dayN(0), cheques: rows, pdc_reminders: pdc,
    remind: { on: S.remind.on, lead_days: S.remind.lead_days, from: S.remind.from, may_set: S.owner, why_not: S.owner ? null : 'Only the owner may set the reminder.' } };
}
const gstr = (month, form) => ({ gstin: '33ABCDE1234F1Z5', fp: month.slice(5, 7) + month.slice(0, 4), form, version: 'GST3.0.4', b2b: [], b2cs: [], hsn: { data: [] } });

W.run(REAL ? 'finance-money-real' : 'finance-money', async (w) => {
  const { page, ctx, base } = w;
  const S = { mode: 'ok', gstr: 'ok', owner: true, country: 'IN', remind: { on: true, lead_days: 7, from: null }, steps: {}, asked: [], writes: [], bodies: [] };
  let api = null;
  if (REAL) {
    api = await require('./lib/real-api.cjs').start({ origin: base });
    const token = await api.owner();
    await ctx.addInitScript((b, s) => { try { localStorage.setItem('cb_api_base', b); localStorage.setItem('cb_sess', s); } catch (_) {} }, api.base,
      JSON.stringify({ token, role: 'entity', name: 'Owner', entity: api.shop || 'simstores', bridgeId: 'CBSIM0001' }));
  } else {
    await ctx.route('**/api/**', async (r0) => {
      const r = C.wrap(r0);
      const q = r.request(), u = new URL(q.url()), p = u.pathname;
      if (q.method() !== 'GET' && !/^\/api\/events\/ticket$/.test(p)) { S.writes.push(q.method() + ' ' + p); try { S.bodies.push({ p, body: JSON.parse(q.postData() || 'null') }); } catch (_) { S.bodies.push({ p, body: null }); } }
      if (p === '/api/books/cheques') {
        S.asked.push(p + u.search);
        if (S.mode === 'denied') return J(r, 403, { error: 'Only the owner may see cheques.', message: 'Only the owner may see cheques.' });
        if (S.mode === 'off') return J(r, 404, { error: 'Not found' });
        if (S.mode === 'broken') return J(r, 500, { error: 'Failed', message: 'database timeout at 10.0.0.5' });
        return J(r, 200, cheques(S));
      }
      const step = /^\/api\/books\/cheques\/([^/]+)\/status$/.exec(p);
      if (step && q.method() === 'POST') { const b = JSON.parse(q.postData() || '{}'); const k = Object.keys(UUIDS).find((x) => UUIDS[x] === step[1]); if (k) S.steps[k] = b.status; return J(r, 200, { ok: true, status: b.status, items: 1 }); }
      if (p === '/api/books/terms' && q.method() === 'POST') {
        const b = JSON.parse(q.postData() || '{}');
        if (!S.owner) return J(r, 403, { error: 'Only the owner may set terms.', message: 'Only the owner may set terms.' });
        if (b.pdc_remind) S.remind = { on: b.pdc_remind.on !== false, lead_days: b.pdc_remind.lead_days == null ? 7 : b.pdc_remind.lead_days, from: 'shop' };
        return J(r, 200, { ok: true, terms: { pdc_remind: { on: S.remind.on, lead_days: S.remind.lead_days } } });
      }
      if (p === '/api/crm/followups' && q.method() === 'POST') {
        const b = JSON.parse(q.postData() || '{}');
        return J(r, 201, { followup: { followup_id: '00000000-0000-4000-8000-000000000009', party_id: b.party_id, party_no: 'P-' + b.party_id, party_name: 'Mala Stores', party_listed: true, what: b.what,
          due_at: b.due_at + 'T00:00:00.000Z', due_day: b.due_at, assignee_user_id: 'E1', assignee_name: 'Owner', source: b.source, done_at: null, created_at: NOW.toISOString(), late: false, today: false, bucket: 'later' } });
      }
      if (p === '/api/tax/gstr') {
        S.asked.push(p + u.search);
        if (S.gstr === 'broken') return J(r, 500, { error: 'Failed', message: 'database timeout at 10.0.0.5' });
        return J(r, 200, gstr(u.searchParams.get('month') || '', u.searchParams.get('form') || 'gstr1'));
      }
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR', country: S.country } });
      if (p === '/api/facts/rail') return J(r, 200, { suppliers: 1, customers: 3, in: 0, out: 0, stuck: 0 });
      return J(r, 404, { error: 'not found' });
    });
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
    await ctx.clock.setFixedTime(NOW);
  }
  console.log('clock: ' + NOW.toISOString() + ' = ' + dayN(0) + ' in ' + ZONE + (REAL ? ' · REAL api ' + api.base : ''));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const body = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const open = async (hash, until) => { await page.goto('about:blank'); await page.goto(base + '/finance.html#/' + hash); await page.waitForSelector(until || '[data-testid^="fq-row-"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(500); };
  const rows = () => page.locator('[data-testid^="fq-row-"]').count();
  const T = (id) => '[data-testid="' + id + '"]';

  try {
    if (REAL) {
      /* the real stack: no fixture rows — the tabs must paint their own words for the loaded shop, and write nothing on open */
      await w.step('X1', 'REAL · Finance -> Cheques paints the list (or the ledger-off card), the nav is current', async () => {
        await open('cheques', T('fq-list') + ', ' + T('fin-off') + ', ' + T('fin-denied')); await page.waitForTimeout(1500);
        const b = await body(), cur = await page.locator(T('fin-nav-cheques') + '[aria-current="page"]').count();
        return { ok: cur === 1 && (/Cheques/.test(b) || /ledger is off/.test(b)) && !/Could not read/.test(b), saw: 'nav current ' + cur + '; "' + b.slice(0, 120) + '"' };
      });
      await w.step('X2', 'REAL · Finance -> Returns paints the country\'s own card (GSTR for India · BAS / VAT return elsewhere · country not set)', async () => {
        await open('returns', '[data-testid^="fr-"]'); await page.waitForTimeout(1000);
        const card = await page.locator('[data-testid^="fr-"]').first().getAttribute('data-testid').catch(() => ''), b = await body();
        return { ok: /^fr-(gstr|elsewhere|nocountry|none)$/.test(card) && !/Could not read/.test(b), saw: card + ' "' + b.slice(0, 120) + '"' };
      });
      return;
    }

    /* ── CHEQUES ──────────────────────────────────────────────────────────────────────────────────────────────────── */
    await open('cheques');
    await w.step('Q1', 'Finance -> Cheques -> five cheques, grouped Received (4) and Written by you (1); the Cheques nav is current; on top "2 cheques to deposit"', async () => {
      const n = await rows(), cur = await page.locator(T('fin-nav-cheques') + '[aria-current="page"]').count(), gi = await txt(T('fq-group-in')), go = await txt(T('fq-group-out')), note = await txt(T('fq-pdc'));
      /* the group head is set in capitals by the list's own style: the words are held case-blind */
      return { ok: n === 5 && cur === 1 && /Received/i.test(gi) && /4 cheques/.test(gi) && /Written by you/i.test(go) && /1 cheque/.test(go) && note === '2 cheques to deposit', saw: n + ' rows; nav ' + cur + '; "' + gi + '" / "' + go + '"; notice "' + note + '"' };
    });
    await w.step('Q2', 'Cheques -> opened by READING only: /api/books/cheques asked, nothing written', async () => {
      return { ok: S.asked[0] === '/api/books/cheques' && S.writes.length === 0, saw: 'asked ' + S.asked.join(', ') + '; writes ' + S.writes.length };
    });
    await w.step('Q3', 'Cheques -> each reminder in the server\'s words: Kumar "Overdue for deposit", Ravi "Deposit today", Mala "Post-dated · tomorrow"; the deposited one and the written one carry none', async () => {
      const k = await txt(T('fq-due-' + UUIDS.p2)), r = await txt(T('fq-due-' + UUIDS.p3)), m = await txt(T('fq-due-' + UUIDS.p1)), d = await txt(T('fq-due-' + UUIDS.p4)), o = await txt(T('fq-due-' + UUIDS.p5));
      return { ok: /Overdue for deposit/.test(k) && /Deposit today/.test(r) && /Post-dated/.test(m) && m.indexOf(DMY(dayN(1))) >= 0 && /Remind me/.test(m) && d === '—' && /Written by you/.test(o),
        saw: 'Kumar "' + k + '"; Ravi "' + r + '"; Mala "' + m + '"; deposited "' + d + '"; written "' + o + '"' };
    });
    await w.step('Q4', 'Cheques -> the steps are the server\'s: a received cheque offers Deposited; the deposited one offers Cleared and Bounced', async () => {
      const a = await page.locator(T('chq-deposited-' + UUIDS.p1)).count(), b = await page.locator(T('chq-cleared-' + UUIDS.p4)).count(), c = await page.locator(T('chq-bounced-' + UUIDS.p4)).count(), x = await page.locator(T('chq-cleared-' + UUIDS.p1)).count();
      return { ok: a === 1 && b === 1 && c === 1 && x === 0, saw: 'Deposited on Mala ' + a + '; Cleared/Bounced on Sri ' + b + '/' + c + '; Cleared on Mala ' + x };
    });
    await w.step('Q5', 'Cheques -> Remind me on Mala\'s cheque -> ONE follow-up through CRM\'s route: the party, due on the cheque\'s date, naming cheque 000777 and ₹5,000; the cell says Reminder set', async () => {
      await page.click(T('fq-remind-' + UUIDS.p1)); await page.waitForTimeout(800);
      const fu = S.bodies.find((x) => x.p === '/api/crm/followups'), b = fu && fu.body, cell = await txt(T('fq-due-' + UUIDS.p1));
      return { ok: !!b && b.party_id === MALA && b.due_at === dayN(1) && b.source === 'dues' && /000777/.test(b.what) && /5,000/.test(b.what) && /Mala/.test(b.what) && /Reminder set/.test(cell) && S.writes.length === 1,
        saw: 'body ' + JSON.stringify(b) + '; cell "' + cell + '"; writes ' + S.writes.length };
    });
    await w.step('Q6', 'Cheques -> the switch chip reads "On · 7 days ahead"; the sheet saves off + 3 days as a SHOP TERM (POST /api/books/terms { pdc_remind }), the tab reads again and the chip says Off', async () => {
      const before = await txt(T('fq-remind'));
      await page.click(T('fq-switch')); await page.waitForSelector(T('fq-sheet'), { timeout: 6000 });
      const title = await txt(T('fq-sheet-title'));
      await page.uncheck(T('fq-on')); await page.fill(T('fq-days'), '3'); await page.click(T('fq-save')); await page.waitForTimeout(900);
      const t = S.bodies.find((x) => x.p === '/api/books/terms'), after = await txt(T('fq-remind')), note = await page.locator(T('fq-pdc')).count();
      return { ok: before === 'On · 7 days ahead' && title === 'Cheque reminders' && !!t && JSON.stringify(t.body) === '{"pdc_remind":{"on":false,"lead_days":3}}' && after === 'Off' && note === 0,
        saw: 'chip "' + before + '" → "' + after + '"; sheet "' + title + '"; body ' + JSON.stringify(t && t.body) + '; notice rows after ' + note };
    });
    await w.step('Q7', 'Cheques -> Deposited on Mala\'s cheque -> POST /cheques/:id/status { deposited }; the row then reads Deposited with Cleared · Bounced', async () => {
      S.remind = { on: true, lead_days: 7, from: 'shop' };
      await page.click(T('chq-deposited-' + UUIDS.p1)); await page.waitForTimeout(800);
      const st = S.bodies.find((x) => /\/cheques\/.*\/status$/.test(x.p)), cell = await txt(T('chq-steps-' + UUIDS.p1));
      return { ok: !!st && st.body.status === 'deposited' && /Deposited/.test(cell) && /Cleared/.test(cell) && /Bounced/.test(cell), saw: 'body ' + JSON.stringify(st && st.body) + '; cell "' + cell + '"' };
    });
    await w.step('Q8', 'Cheques -> filter "To deposit" -> only the two past or on their day stay', async () => {
      S.steps = {}; await open('cheques');
      const before = await rows();
      await page.click(T('cbl-filters-fin-cheques')); await page.waitForTimeout(300);
      const sel = page.locator('#cbl-f-fin-cheques-show'); let n = -1;
      if (await sel.count()) { await sel.selectOption('due'); await page.waitForTimeout(500); n = await rows(); await sel.selectOption('').catch(() => {}); }
      await page.keyboard.press('Escape').catch(() => {});
      return { ok: before === 5 && n === 2, saw: before + ' rows before, ' + n + ' after' };
    });
    await w.step('Q9', 'Cheques (not the owner) -> the switch sheet\'s Save is greyed WITH the server\'s sentence; the list still reads', async () => {
      S.owner = false; await open('cheques');
      await page.click(T('fq-switch')); await page.waitForSelector(T('fq-sheet'), { timeout: 6000 });
      const off = await page.locator(T('fq-save') + '[disabled]').count(), why = await txt(T('fq-why')), n = await rows();
      await page.keyboard.press('Escape').catch(() => {}); S.owner = true;
      return { ok: off === 1 && why === 'Only the owner may set the reminder.' && n === 5, saw: 'Save disabled ' + off + '; why "' + why + '"; rows ' + n };
    });
    await w.step('Q10', 'Cheques (the read fails) -> a plain sentence and Try again, never the raw server message', async () => {
      S.mode = 'broken'; await open('cheques', T('fq-list')); await page.waitForTimeout(700);
      const t = await body(); S.mode = 'ok';
      return { ok: /Could not read the cheques/.test(t) && /Try again/.test(t) && !/database timeout|10\.0\.0\.5/.test(t), saw: (/Could not read the cheques/.test(t) ? 'plain sentence' : 'NO plain sentence') + '; ' + (/10\.0\.0\.5/.test(t) ? 'RAW MESSAGE SHOWING' : 'no raw message') };
    });
    await w.step('Q11', 'the ledger is off (M212) -> "Your ledger is off" and the owner\'s switch, on the Cheques tab too', async () => {
      S.mode = 'off'; await open('cheques', T('fin-off'));
      const t = await txt(T('fin-off')), on = await page.locator(T('fin-turn-on')).isEnabled().catch(() => false); S.mode = 'ok';
      return { ok: /Your ledger is off/.test(t) && on, saw: '"' + t + '"; Turn on enabled ' + on };
    });
    await w.step('Q12', 'Cheques (this login may not see it) -> the server\'s sentence, greyed, and no list', async () => {
      S.mode = 'denied'; await open('cheques', T('fin-denied'));
      const why = await txt(T('fin-denied-why')), n = await rows(); S.mode = 'ok';
      return { ok: /Only the owner may see cheques/.test(why) && n === 0, saw: '"' + why + '"; ' + n + ' rows' };
    });
    await open('cheques');
    await rule13(w, 'Q13', 'the Cheques tab', 'screen');
    await open('cheques'); await page.click(T('fq-switch')); await page.waitForSelector(T('fq-sheet'), { timeout: 6000 });
    await rule13(w, 'Q14', 'the reminder sheet', 'fin_sheet');
    await page.keyboard.press('Escape').catch(() => {});

    /* ── RETURNS ──────────────────────────────────────────────────────────────────────────────────────────────────── */
    const LM = lastMonth();
    await w.step('R1', 'Finance -> Returns (an Indian shop) -> GSTR-1 and GSTR-3B, the month picker on last month with twelve months, two file buttons; nothing written', async () => {
      S.writes = []; await open('returns', T('fr-gstr'));
      const h = await txt(T('fr-gstr') + ' h2'), opts = await page.locator(T('fr-month') + ' option').count(), v = await page.locator(T('fr-month')).inputValue().catch(() => ''), label = await page.locator(T('fr-month') + ' option').first().innerText().catch(() => '');
      const b1 = await page.locator(T('fr-gstr1')).count(), b3 = await page.locator(T('fr-gstr3b')).count(), cur = await page.locator(T('fin-nav-returns') + '[aria-current="page"]').count();
      /* the month word is CBLocale's (en-IN says "Sept"): the first three letters and the year are what is held */
      const lbl = label.trim(), lblOk = lbl.slice(0, 3) === LM.label.slice(0, 3) && lbl.slice(-4) === LM.label.slice(-4);
      return { ok: h === 'GSTR-1 and GSTR-3B' && opts === 12 && v === LM.v && lblOk && b1 === 1 && b3 === 1 && cur === 1 && S.writes.length === 0,
        saw: '"' + h + '"; ' + opts + ' months, first ' + v + ' "' + label.trim() + '" (want ' + LM.v + ' ' + LM.label + '); buttons ' + b1 + '/' + b3 + '; nav ' + cur + '; writes ' + S.writes.length };
    });
    await w.step('R2', 'Returns -> GSTR-1 file -> the page asked /api/tax/gstr?month=' + LM.v + '&form=gstr1 and the browser SAVED gstr1-' + LM.v + '.json (the server\'s JSON, nothing added); said beside the button', async () => {
      S.asked = [];
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click(T('fr-gstr1'))]);
      await page.waitForTimeout(500);
      const name = dl ? dl.suggestedFilename() : 'NO DOWNLOAD', out = await txt(T('fr-out'));
      let json = null; try { const p = dl && await dl.path(); json = p ? JSON.parse(require('fs').readFileSync(p, 'utf8')) : null; } catch (_) { json = null; }
      return { ok: name === 'gstr1-' + LM.v + '.json' && S.asked.some((a) => a === '/api/tax/gstr?month=' + LM.v + '&form=gstr1') && !!json && json.form === 'gstr1' && json.fp === LM.v.slice(5, 7) + LM.v.slice(0, 4) && /Saved as gstr1-/.test(out),
        saw: 'file ' + name + '; asked ' + S.asked.join(', ') + '; fp ' + (json && json.fp) + '; "' + out + '"' };
    });
    await w.step('R3', 'Returns -> another month, GSTR-3B file -> the month chosen reaches the server and names the file', async () => {
      S.asked = [];
      const third = await page.locator(T('fr-month') + ' option').nth(2).getAttribute('value');
      await page.selectOption(T('fr-month'), third);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click(T('fr-gstr3b'))]);
      const name = dl ? dl.suggestedFilename() : 'NO DOWNLOAD';
      return { ok: name === 'gstr3b-' + third + '.json' && S.asked.some((a) => a === '/api/tax/gstr?month=' + third + '&form=gstr3b'), saw: 'file ' + name + '; asked ' + S.asked.join(', ') };
    });
    await w.step('R4', 'Returns (the server cannot build it) -> "Could not build the file", never the raw message; the button is back', async () => {
      S.gstr = 'broken'; await page.click(T('fr-gstr1')); await page.waitForTimeout(800);
      const out = await txt(T('fr-out')), b = await body(), en = await page.locator(T('fr-gstr1')).isEnabled().catch(() => false); S.gstr = 'ok';
      return { ok: /Could not build the file/.test(out) && !/10\.0\.0\.5|database timeout/.test(b) && en, saw: '"' + out + '"; raw ' + (/10\.0\.0\.5/.test(b) ? 'SHOWING' : 'no') + '; button enabled ' + en };
    });
    await w.step('R5', 'Returns (an Australian shop) -> which return applies: BAS, prepared in Accounts; no download button here', async () => {
      S.country = 'AU'; await open('returns', T('fr-elsewhere'));
      const h = await txt(T('fr-which')), p = await txt(T('fr-elsewhere') + ' p'), link = await page.locator(T('fr-accounts')).getAttribute('href').catch(() => ''), b1 = await page.locator(T('fr-gstr1')).count();
      return { ok: h === 'BAS' && /Business activity statement/.test(p) && /prepared in Accounts/.test(p) && link === '/accounts.html#gstclose' && b1 === 0, saw: '"' + h + '" · "' + p + '" · link ' + link + '; gstr buttons ' + b1 };
    });
    await w.step('R6', 'Returns (a UAE shop) -> VAT return, prepared in Accounts', async () => {
      S.country = 'AE'; await open('returns', T('fr-elsewhere'));
      const h = await txt(T('fr-which')), p = await txt(T('fr-elsewhere') + ' p');
      return { ok: h === 'VAT return' && /VAT201/.test(p), saw: '"' + h + '" · "' + p + '"' };
    });
    await w.step('R7', 'Returns (no country yet) -> "Country not set" and the door to Settings › Country, nothing else', async () => {
      S.country = null; await open('returns', T('fr-nocountry'));
      const link = await page.locator(T('fr-country')).getAttribute('href').catch(() => ''), t = await txt(T('fr-nocountry'));
      return { ok: link === '/settings.html#/country' && /Country not set/.test(t), saw: 'link ' + link + '; "' + t + '"' };
    });
    await w.step('R8', 'Returns (a country with no pack) -> says no return is built for it, no guess', async () => {
      S.country = 'ZZ'; await open('returns', T('fr-none'));
      const t = await txt(T('fr-none-why')); S.country = 'IN';
      return { ok: /Nothing is built for ZZ yet/.test(t), saw: '"' + t + '"' };
    });
    await open('returns', T('fr-gstr'));
    await rule13(w, 'R9', 'the Returns tab', 'screen');
    await w.step('M43', 'the stand-in answered every /api/books and /api/crm call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
  } finally {
    if (api) await api.stop().catch(() => {});
  }
  if (w.errs.length) await w.step('E0', 'no page errors while walking', async () => ({ ok: false, saw: w.errs.slice(0, 2).join(' | ') }));
});
