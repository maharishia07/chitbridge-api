/**
 * tools/seed/seed-e-trouble.cjs — Seed E (W6): gives the clients named in seed-e.cjs TROUBLE their trouble, ADD ONLY, through the api's own door (POST /api/books/entries, a typed journal, as the client's owner).
 * OWNS      the journals of each trouble kind. The WHO is seed-e.cjs TROUBLE; the box flow is `sh seed-e.sh trouble [i...]`. Nothing is deleted or edited; a re-run posts nothing (client_ref).
 * CALLED BY tools/seed/seed-e.sh trouble
 * Run:  API=http://seede-api:3991 SEED_MAIL_DOMAIN=test.chitbridge TESTER_CODE=... node tools/seed/seed-e-trouble.cjs [i ...]   (every client when none named)
 * Hand figures (the client's own books: sales Jul 11980 · Aug 13065 · Sep 14150 · Oct 15545, profit Sep 4478 · Oct 5105, cash 90528.20 + bank 11300.00 (opening cash 5000 + bank 8000, mis-history-seede.json), all AUD):
 *   sales_down  extra E cash takings in Jul, Aug, Sep: Oct vs the mean of the 3 months before = (15545 - (13065 + E)) / (13065 + E) → E 7000 -22.5 % · E 9000 -29.5 %.
 *   loss        a one-off cost in Sep and Oct: profit Sep 4478 - 6000 = -1522 · Oct 5105 - 6500 = -1395 → 2 months running.
 *   late_debtors a 5000 credit sale dated 10 Jul, unpaid: over 60 days share = 5000 / (5000 + what else is owed) ≥ 85 % (help from 50).
 *   cash_low    drawings of 90000 (cash) and 11000 (bank): 828.20 left against the bills due inside 30 days (the creditors, 18568) → the cash runs out in days.
 */
'use strict';
const { TROUBLE } = require('./seed-e.cjs');
const API = process.env.API || 'http://127.0.0.1:3991';
const handle = (i) => 'seedeh' + String(i).padStart(3, '0');
const code = () => String(process.env.TESTER_CODE || '').replace('{yymmdd}', new Date().toISOString().slice(2, 10).replace(/-/g, ''));
async function call(path, token, body) {
  const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, b: await r.json().catch(() => ({})) };
}
const minor = (dollars) => Math.round(dollars * 100);
/** the journals of one trouble: [{ date, narration, lines }] (codes: 1400 cash · 1500 bank · 1300 debtors · 3100 drawings · 4000 sales · 6010 rent) */
function journalsOf(t, customer) {
  const note = 'demo: ';
  if (t.kind === 'sales_down') return ['2026-07-20', '2026-08-20', '2026-09-20'].map((date) => ({ date, narration: note + 'extra takings', lines: [{ code: '1400', dr_minor: minor(t.extra) }, { code: '4000', cr_minor: minor(t.extra) }] }));
  if (t.kind === 'loss') return [['2026-09-28', t.sep], ['2026-10-28', t.oct]].map(([date, amount]) => ({ date, narration: note + 'one-off repair bill', lines: [{ code: '6010', dr_minor: minor(amount) }, { code: '1400', cr_minor: minor(amount) }] }));
  if (t.kind === 'late_debtors') return [{ date: '2026-07-10', narration: note + 'credit sale, not paid', lines: [{ code: '1300', dr_minor: minor(t.credit_sale), party: customer }, { code: '4000', cr_minor: minor(t.credit_sale) }] }];
  if (t.kind === 'cash_low') return [{ date: '2026-10-29', narration: note + 'owner drawings', lines: [{ code: '3100', dr_minor: minor(101000) }, { code: '1400', cr_minor: minor(90000) }, { code: '1500', cr_minor: minor(11000) }] }];
  return [];
}
async function main() {
  const wanted = process.argv.slice(2).map(Number).filter(Boolean), list = wanted.length ? wanted : Object.keys(TROUBLE).map(Number);
  for (const i of list) {
    const t = TROUBLE[i];
    if (!t) { console.log(i + ': no trouble planned, skipped'); continue; }
    const email = handle(i) + '@' + (process.env.SEED_MAIL_DOMAIN || 'test.chitbridge');
    const v = await fetch(API + '/api/entities/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, otp: code() }) }).then((r) => r.json());
    if (!v.token) throw new Error(i + ' sign-in refused');
    let customer;
    if (t.kind === 'late_debtors') {
      const dues = await call('/api/books/dues?side=receivable', v.token);
      customer = ((dues.b.parties || dues.b.rows || dues.b.items || [])[0] || {}).party_id || ((dues.b.parties || dues.b.rows || [])[0] || {}).id;
      if (!customer) throw new Error(i + ' no customer found: ' + JSON.stringify(dues.b).slice(0, 300));
    }
    for (const j of journalsOf(t, customer)) {
      const r = await call('/api/books/entries', v.token, { date: j.date, narration: j.narration, lines: j.lines, client_ref: 'seede-trouble-' + t.kind + '-' + j.date });
      console.log(i + ' ' + t.kind + ' ' + j.date + ' -> ' + r.status + ' ' + (r.status < 300 ? (r.b.duplicate ? 'duplicate' : r.b.entry_no) : JSON.stringify(r.b).slice(0, 200)));
    }
  }
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { journalsOf };
