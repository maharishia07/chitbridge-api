#!/usr/bin/env node
/* walk-r2-note-years.cjs — R2 (RC2 re-press, 17 Nov): a deep link that lands on the firm Day book with a record OUTSIDE the year the Day book opened on still opens that record's note / thread.
 * The firm seat opens a client on the year under review (FY 2025-26); a note on an entry of the running year (FY 2026-27) said "Nothing saved on this yet." although it exists.
 * Run on a SIT box against its api (never production): API=<loopback api> TESTER_CODE=<today's code, from the box env> OUT=<shots dir> CLIENT=<client entity id> node e2e/walk-r2-note-years.cjs
 * Writes are marked TEST-R2 and removed at the end. Presses, for a record in BOTH years: the bell row of a colleague's reply (&note=), and the Query link (&mark=&mday=). */
// CARD      14-accounting/ledger-accounts-day-book-entries-reverse
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('@playwright/test');
const L = require('./lib/live-harbour.cjs');
const CL = process.env.CLIENT, OUT = process.env.OUT || '.';
if (!CL) { console.log('SKIP: CLIENT (a client entity id) is not set'); process.exit(0); }
let pass = 0, fail = 0, shots = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const tok = async (h) => { try { fs.unlinkSync(path.join(OUT, 'token.json')); } catch (_) { /* no cache yet */ } return L.signIn(h); };
const call = async (t, m, p, body, extra) => { const r = await fetch(L.API + p, { method: m, headers: Object.assign({ 'content-type': 'application/json', authorization: 'Bearer ' + t }, extra || {}), body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => ({})) }; };
const FOR = { 'X-Books-For': CL };
const YEARS = [{ fy: '2026-27', from: '2026-07-01', to: '2027-06-30' }, { fy: '2025-26', from: '2025-07-01', to: '2026-06-30' }];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const aud = await tok('seedeaud'), acct = await tok('seedeacct');
  const made = [], marks = [];
  try {
    /* one entry in each year, a firm note by aud, a reply by the colleague */
    const pick = {};
    for (const y of YEARS) { const d = await call(aud, 'GET', '/api/books/daybook?from=' + y.from + '&to=' + y.to + '&limit=20', null, FOR); pick[y.fy] = (d.b.entries || [])[6]; ok(!!pick[y.fy], 'an entry exists in FY ' + y.fy + ': ' + (pick[y.fy] && pick[y.fy].entry_no)); }
    for (const y of YEARS) {
      const e = pick[y.fy]; if (!e) continue;
      const add = await call(aud, 'POST', '/api/flags', { kind: 'note', visibility: 'org', subject_kind: 'posting', subject_entity: CL, items: [{ id: e.entry_id, label: e.entry_no }], note: 'TEST-R2 firm note ' + y.fy });
      const flag = ((add.b.flags || add.b.items || [add.b.flag || add.b]).filter(Boolean)[0]) || {}; const fid = flag.flag_id || flag.id;
      ok(add.s < 300 && !!fid, 'aud wrote the firm note on ' + e.entry_no + ' (' + add.s + ')');
      if (fid) made.push(fid);
      if (fid) { const rep = await call(acct, 'POST', '/api/flags/' + fid + '/messages', { message_text: 'TEST-R2 reply ' + y.fy }); ok(rep.s < 300, 'the colleague replied (' + rep.s + ')'); }
      const q = await call(aud, 'POST', '/api/marks', { adopter: 'acc.audit', subject_id: e.entry_id, kind: 'query', note: 'TEST-R2 query ' + y.fy }, FOR);
      ok(q.s < 300, 'aud raised a Query on ' + e.entry_no + ' (' + q.s + ')'); if (q.s < 300) marks.push(e.entry_id);
    }
    const b = await chromium.launch(), { base } = await L.serve();
    for (const y of YEARS) {
      const e = pick[y.fy]; if (!e) continue;
      /* A · the bell row of the reply, pressed (the real path) */
      const { ctx, page: p } = await L.open(b, base, aud, { width: 1366, height: 768 }, 'Seed E Auditor demo', '/network.html', '[data-testid="bell-btn"]');
      await p.waitForSelector('[data-testid="bell-btn"]', { timeout: 30000 }); await p.click('[data-testid="bell-btn"]');
      const row = p.locator('[data-testid="bell-row"][data-note-id="' + e.entry_id + '"]').first();
      try { await row.waitFor({ timeout: 15000 }); } catch (_) { /* counted below */ }
      ok(await row.count() === 1, 'FY ' + y.fy + ': the bell holds the reply row on ' + e.entry_no);
      if (await row.count()) {
        await row.click();
        await p.waitForSelector('dialog.fl-sheet[open], dialog.fl-sheet', { timeout: 25000 }).catch(() => {});
        await p.waitForTimeout(1500);
        const sheet = flat(await p.locator('dialog.fl-sheet').first().innerText().catch(() => ''));
        ok(/TEST-R2 firm note/.test(sheet) && !/Nothing saved on this yet/.test(sheet), 'FY ' + y.fy + ': the bell press opens the note sheet with the note (' + sheet.slice(0, 80) + ')');
        ok(/TEST-R2 reply/.test(sheet), 'FY ' + y.fy + ': the sheet carries the colleague\'s reply');
        if (shots < 6 && process.env.SHOT) { await p.screenshot({ path: path.join(OUT, 'r2-note-' + y.fy + '.png') }); shots++; }
      }
      await ctx.close();
      /* B · the Query link of the bell (&mark= &mday=) opens its thread for an entry of either year */
      const c2 = await L.open(b, base, aud, { width: 1366, height: 768 }, 'Seed E Auditor demo', '/network.html?open=' + CL + '&view=daybook&mark=' + encodeURIComponent(e.entry_id) + '&mday=' + e.posting_date.slice(0, 10), '[data-testid^="bv-row-"]');
      await c2.page.waitForTimeout(6000);
      const body = flat(await c2.page.locator('dialog[open]').first().innerText().catch(() => ''));
      ok(/TEST-R2 query/.test(body), 'FY ' + y.fy + ': the Query link opens the thread with its words (' + body.slice(0, 70) + ')');
      await c2.ctx.close();
    }
    /* C · R4: the firm Day book opens in the book's own order (day, then number), not with the after-period-end entries of June above July */
    const c3 = await L.open(b, base, aud, { width: 1366, height: 768 }, 'Seed E Auditor demo', '/network.html?open=' + CL + '&view=daybook', '[data-testid^="bv-row-"]');
    await c3.page.waitForTimeout(2500);
    const order = await c3.page.$$eval('[data-testid^="bv-row-"]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
    const days = order.map((r) => (r.match(/\d{1,2} [A-Z][a-z]+ 20\d\d/) || [''])[0]).filter(Boolean);
    ok(order.length > 3 && !/June 2026/.test(days[0]) && /2025/.test(days[0]), 'R4: the Day book opens on the first day of the year, not June 2026 (' + days.slice(0, 3).join(' | ') + ')');
    if (process.env.SHOT) await c3.page.screenshot({ path: path.join(OUT, 'r4-daybook-order.png') });
    await c3.ctx.close();
    await b.close();
  } finally {
    for (const id of made) await call(aud, 'POST', '/api/flags/' + id + '/remove', {});
    for (const id of marks) await call(aud, 'POST', '/api/marks', { adopter: 'acc.audit', subject_id: id, kind: 'removed', note: 'TEST-R2 cleanup' }, FOR);
  }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(2); });
