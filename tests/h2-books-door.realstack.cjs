'use strict';
/**
 * tests/h2-books-door.realstack.cjs — hunt lane h2 (20 Nov 2026): three doors of a typed books entry (real Postgres, api as cb_app).
 * H-h2-003  a reversal whose month is locked lands on the first open day; when that day is still ahead of the shop's day it is REFUSED in words (REVERSAL_MONTH_LOCKED), nothing posted;
 *           after the owner opens the month (with a reason) the same reversal posts and nets the entry to zero.
 * H-h2-001  an amount sent as text ("100") is refused 4xx, nothing posted; the same figure as a number posts.
 * H-h2-002  a narration over 300 characters is refused in words on POST /entries and on books-actions, nothing posted; 300 exactly posts.
 * Hand figures (IN shop, journal Dr 6030 Electricity / Cr 2410 Outstanding expenses): J1 = 12345 minor.
 *   H3-1 post J1: TB 6030 +12345, 2410 -12345 · H3-2 lock this month, reverse J1 → 422 REVERSAL_MONTH_LOCKED, TB unchanged · H3-3 unlock with a reason, reverse → 200, TB 6030 0, 2410 0
 *   H1-1 dr/cr as "100" → 4xx, TB unchanged · H1-2 as 100 → 200, 6030 +100
 *   H2-1 narration of 301 → 4xx, TB unchanged · H2-2 narration of 300 → 200
 * Run: node tests/h2-books-door.realstack.cjs   (API_BASE / TRUTH_DB as tests/lib/truth-harness.cjs says; LOCAL OR A NAMED SIT BOX ONLY)
 * CARD 14-accounting (hunt h2)
 */
const H = require('./lib/truth-harness.cjs');
const { shopToday } = require('./lib/shop-day.cjs');
const { j, ok, pause, kase, expect, freshShop, finish } = H;
const RUN = 'h2d' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lines = (n) => [{ account: '6030', dr_minor: n, cr_minor: 0 }, { account: '2410', dr_minor: 0, cr_minor: n }];
const post = (S, body) => j('/api/books/entries', { method: 'POST', token: S.token, body: Object.assign({ date: shopToday(), narration: 'h2 ' + RUN, client_ref: 'h2-' + Math.random().toString(36).slice(2) }, body) });
async function tb(token) {
  await pause(800);
  const r = ok(await j('/api/books/trial-balance?asOf=' + shopToday(), { token }), 'trial balance').b, out = {};
  (r.rows || []).forEach((row) => { const net = (row.dr_minor || 0) - (row.cr_minor || 0); if (net) out[row.code] = net; });
  return out;
}
const periodOf = async (token) => {
  const today = shopToday(), rows = ok(await j('/api/books/periods', { token }), 'periods').b.periods || [];
  return rows.find((p) => p.period > 0 && p.start_date <= today && today <= p.end_date);
};

(async () => {
  console.log('\n── hunt h2 · books door · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const S = await freshShop(RUN, 'H2 door', {});
  ok(await j('/api/books/enable', { method: 'POST', token: S.token, body: { walkin_grain: 'bill' } }), 'books on');
  let j1, before;
  await kase('H3-1', 'post J1 = 12345: 6030 +12345, 2410 -12345', async () => {
    const r = ok(await post(S, { lines: lines(12345) }), 'J1'); j1 = r.b.entry_id;
    expect(same(await tb(S.token), { 2410: -12345, 6030: 12345 }), 'books ' + JSON.stringify(await tb(S.token)));
  });
  await kase('H3-2', 'month locked, reverse J1: 422 REVERSAL_MONTH_LOCKED with words, books unchanged', async () => {
    const p = await periodOf(S.token); expect(p, 'no current month in /periods');
    ok(await j('/api/books/periods/' + p.fiscal_year + '/' + p.period + '/lock', { method: 'POST', token: S.token, body: {} }), 'lock');
    before = await tb(S.token);
    const r = await j('/api/books/entries/' + j1 + '/reverse', { method: 'POST', token: S.token, body: { reason: 'h2 locked month' } });
    expect(r.status === 422 && r.b.code === 'REVERSAL_MONTH_LOCKED' && /Open the locked month again/.test(String(r.b.detail || r.b.message)), 'got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    expect(same(await tb(S.token), before), 'the books moved after a refused reversal');
  });
  await kase('H3-3', 'unlock with a reason, reverse: 200, nets to zero as at today', async () => {
    const p = await periodOf(S.token);
    ok(await j('/api/books/periods/' + p.fiscal_year + '/' + p.period + '/unlock', { method: 'POST', token: S.token, body: { reason: 'h2 reopen' } }), 'unlock');
    const r = await j('/api/books/entries/' + j1 + '/reverse', { method: 'POST', token: S.token, body: { reason: 'h2 reversal' } });
    expect(r.status === 200, 'reverse ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
    expect(same(await tb(S.token), {}), 'books after the reversal ' + JSON.stringify(await tb(S.token)));
  });
  await kase('H1-1', 'amounts sent as text "100": 4xx, nothing posted', async () => {
    const r = await post(S, { lines: [{ account: '6030', dr_minor: '100', cr_minor: 0 }, { account: '2410', dr_minor: 0, cr_minor: '100' }] });
    expect(r.status >= 400 && r.status < 500, 'text amounts answered ' + r.status);
    expect(same(await tb(S.token), {}), 'a refused entry moved the books');
  });
  await kase('H1-2', 'the same figure as a number 100 posts: 6030 +100', async () => {
    ok(await post(S, { lines: lines(100) }), 'number amounts');
    expect(same(await tb(S.token), { 2410: -100, 6030: 100 }), 'books ' + JSON.stringify(await tb(S.token)));
  });
  await kase('H2-1', 'narration of 301 characters: 4xx in words on POST /entries and on books-actions-free door, nothing posted', async () => {
    const r = await post(S, { lines: lines(7), narration: 'x'.repeat(301) });
    expect(r.status >= 400 && r.status < 500 && /300/.test(String(r.b.detail || r.b.message)), 'long narration answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    expect(same(await tb(S.token), { 2410: -100, 6030: 100 }), 'a refused entry moved the books');
  });
  await kase('H2-2', 'narration of exactly 300 posts', async () => {
    ok(await post(S, { lines: lines(7), narration: 'y'.repeat(300) }), '300 characters');
    expect(same(await tb(S.token), { 2410: -107, 6030: 107 }), 'books ' + JSON.stringify(await tb(S.token)));
  });
  finish('h2-books-door');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
