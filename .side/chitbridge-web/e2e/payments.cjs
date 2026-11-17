/* payments.cjs — THE PAYMENT SCREENS, PROVED (SPEC-payments-2026-10-05 §7). Cases are added as the payment rows land: E9 (M25), E1–E3 · E10 · E11 (M27), E4 (M29), E5 · E7 (M30).
 * Pattern: crm.cjs + cb-accounts.cjs — Playwright, a stand-in API answering INSIDE the page; the static server takes a free port from the OS. Nothing here
 * reaches localhost:3000, port 7351 or the live site: every /api/** call is fulfilled by the stand-in, any other host is aborted and counted.
 *
 *  E9  Dr/Cr, never a minus (M25 · T59 · R30): every balance a shopkeeper reads on crm.html (the list chips, the record header, the ledger section) and on the
 *      Dues list of accounts.html is written in words ("you owe ₹X" / "they owe you ₹X" / "settled") or as Dr / Cr — and a "-" in front of a figure appears nowhere.
 *      Also: the record's Pay / Receive button (C16: at the top, beside Call) takes the primary look.
 *  E1  double pay: ₹3,720.12 settles all four bills; opening Pay again and typing the same amount shows the BAND (nothing owed · PY/2026-27/000001) and Record is
 *      dead; Cancel records nothing (the stand-in counts the POSTs); "Pay as advance" is ONE POST that carries `acknowledge`.
 *  E2  oldest first: the four bills are pre-filled in due order, each amount = the preview's apply_minor; editing one amount changes the line under the table.
 *  E3  part + advance: ₹2,000 → two bills and part of the third, no band; ₹5,000 → "₹1,279.88 stays with … as an advance"; the outcome words are exact and name the bills.
 *  E4  (M29) reverse from the row: the ledger statement's payment row → Reverse → asks the reason → ONE POST /entries/:id/reverse; the row repaints "reversed by MJ/… — reason"
 *      from the answer (no /daybook, no statement re-read); the toast says the bills reopened; a reversed row offers no second Reverse.
 *  E10 (M28) doors + Dues: Dues has To collect / To pay (total in words = the /dues balances), rows with age + due date + Receive/Pay (+ Remind on what is owed to you); the ledger's party view has Pay beside Statement;
 *      Remind = ONE message on the oldest open bill's line through CBThread (prefilled, editable; no new chit, nothing posted); "Not paid yet — remind me" is the same Remind; the 5,000 test run from the ledger. png/Dues.png
 *  E10 the door: the CRM record's Pay button opens the ONE popup (pay_amt), the URL does not change; the popup has no "Later" (the ledger/Dues doors are M28).
 *  E11 owner 2026-10-08 — W1 fires ONLY with an allocation: nothing owed + bills meant → the band; "Keep it as an advance" (no allocation) → no band, Record works,
 *      and the POST says allocate:'none' with no allocations. The trigger lives in payIntent() (cap-books.js), the one place to change.
 *  E5  (M30) advice OUT, on rail: the outcome panel mounts CBAdvice from the record's `advice` block (no second read); Send advice → ONE POST /api/chits/send with the
 *      server's body (client_ref advice:pay:<id>, kind payment_advice, the bills by chit_id) then ONE PATCH /payments/:id { advice_chit_id }; "Advice sent to Agro Mills ✓";
 *      Send greys with "already sent". A failed send → "Advice not sent — Send again", no PATCH, the button says Send again; the retry sends the SAME client_ref and lands.
 *      The statement row paints the state chip ("✉ advice sent · delivered") and an Advice button that mounts the unit (one GET /payments/:id/advice). The To-do
 *      `advices_to_send` row shows on the CB Accounts home with the server's words; its button opens Ledgers. A viewer sees Send greyed WITH the sentence.
 *  E7  (M30) advice OUT, off rail (party.on_rail false): Send is greyed with "Agro Mills is not on ChitBridge — share the advice instead."; Share = Copy · WhatsApp (wa.me)
 *      · E-mail (mailto:) carrying the words; Copy → ONE PATCH { advice_shared_at: true } → "↗ advice shared · <when>"; no chit is ever sent.
 * The stand-in answers /payments/preview and /payments the way M26 (chitbridge-api #57) does, held to e2e/fixtures/web-api.contract.json.
 * Screenshots: png/CRMLedger.png (the CRM record with its balance in words) · png/Pay.png (the one popup: bills, line, band) · png/PayOutcome.png (what happened, in words)
 */
'use strict';
/* 17 Nov (walkfix): ONE Receive per record (l16 CRM UX 2664a890, crm.cjs L16-2): a late-dues party shows it in the Next band as crm-next-pay, else in the action row as crm-act-pay - the same action, so the walk finds either */
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), PNG = path.join(ROOT, 'png');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), J = C.json;
const crmApi = require('./lib/crm-api.cjs'), books = require('./lib/books-api.cjs');
const FX = path.join(__dirname, 'fixtures', 'golden-parties.json');
const TODAY = new Date().toISOString().slice(0, 10);
const claims = (c) => { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)); };
const OWNER = { token: claims({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Athi', entity: 'Mayur Bhavan' };
/* the words a balance may be written in, and what a minus in front of a figure looks like */
const WORDS = /^(you owe|they owe you|settled)\b/i;
const CRMWORDS = /^(↑ ₹[\d,.]+ you'll give|↓ ₹[\d,.]+ you'll get|settled|nothing yet)\b/i;   /* CB CRM says a due the shopkeeper's way (2026-10-09): a symbol AND a word AND a colour */
const MINUS = /(^|[\s(>])[-−]\s?(₹|\d)/;
function standIn() {
  const fx = crmApi.resolve(JSON.parse(fs.readFileSync(FX, 'utf8')), Date.now());
  /* M30: the advice side of the books — on_rail decides send vs share; failSend = the chit rail refusing; rows = what each payment remembers */
  return { fx, calls: [], list: JSON.parse(JSON.stringify(fx.list)), pay: payBooks(), msgs: [], msgPosts: [], adv: { on_rail: true, failSend: false, sends: [], patches: [], rows: {} } };
}
/** the advice block of a payment the stand-in knows (recorded here, or named by a statement line) — as routes/books.js adviceFor answers it */
function adviceOf(S, pid) {
  const row = S.adv.rows[pid] || (S.adv.rows[pid] = { body: { party_id: 's1', direction: 'out', amount_minor: 112000, currency: 'INR', mode: 'cash' }, settled: [{ against_ref: 'bill-a', bill_no: 'KT-0007', amount_minor: 112000 }], entry_no: 'PY/2026-27/000001', state: 'none', chit_id: null, shared_at: null });
  return books.payAdvice(pid, row.body, NAME, { on_rail: S.adv.on_rail, state: row.state, chit_id: row.chit_id, shared_at: row.shared_at, entry_no: row.entry_no, settled: row.settled, may: S.adv.may || undefined });
}
const DUES = [
  { party_id: 'c1', party_no: 'P-00001', name: 'Ravi Stores', side: 'customer', balance_minor: 300000, oldest_due: '2026-08-01', disputed_minor: 0, buckets: { not_due: 0, lt_6m: 300000 }, follow_up: { not_due: 0, d0_30: 0, d31_60: 0, d61_90: 300000, d90_plus: 0, worst: 'd61_90', no_terms_minor: 0, terms: 'ok' } },
  { party_id: 's1', party_no: 'P-00003', name: 'Agro Mills', side: 'supplier', balance_minor: -150000, oldest_due: '2026-09-03', disputed_minor: 0, buckets: { not_due: -150000 } },
  { party_id: 's2', party_no: 'P-00004', name: 'Kavi Traders', side: 'supplier', balance_minor: -100000, oldest_due: '2026-09-04', disputed_minor: 0, buckets: { not_due: -100000 } }];
/* the supplier of the spec's worked example: four open bills, 1,120.00 · 560.00 · 1,050.00 · 990.12 = 3,720.12 */
const KT = () => ([['a', 'KT-0007', '2026-09-01', 112000], ['b', 'KT-0008', '2026-09-05', 56000], ['c', 'KT-0010', '2026-09-10', 105000], ['d', 'KT-0011', '2026-09-12', 99012]]
  .map((x) => ({ against_ref: 'bill-' + x[0], bill_no: x[1], due_date: x[2], open_minor: x[3], disputed: false })));
const NAME = 'Agro Mills';
/** the shop's payments so far (the stand-in's books): bills open, payments recorded, every POST that arrived */
function payBooks(o) { return Object.assign({ bills: KT(), done: [], posts: [], previews: [] }, o || {}); }
/** W3 / W4 read the shop's last 24 h — only the stand-in knows them */
function payExtras(S, body, prop) {
  const X = [];
  const same = S.pay.done.slice().reverse().find((d) => d.body.amount_minor === body.amount_minor && d.body.direction === body.direction);
  if (same) X.push({ code: 'same_again', entry_no: same.entry_no, payment_id: same.payment_id, words: 'The same ' + books.rs(same.body.amount_minor) + ' was paid to ' + NAME + ' today (' + same.entry_no + ').' });
  const last = S.pay.done.slice().reverse().find((d) => d.settled.length);
  if (last && S.pay.bills.length === 0 && prop.open_minor === 0) {
    const refs = last.settled.map((x) => x.bill_no);
    X.push({ code: 'just_settled', entry_no: last.entry_no, payment_id: last.payment_id, words: 'The last ' + refs.length + ' bills (' + refs.join(', ') + ') were settled by ' + last.entry_no + ' today.' });
  }
  return X;
}
async function payRoute(S, r, p, m) {
  const q = r.request(); let body = {}; try { body = JSON.parse(q.postData() || '{}'); } catch (_) {}
  if (p === '/api/books/payments/preview' && m === 'POST') {
    S.pay.previews.push(body);
    const prop = books.payProposal(S.pay.bills, body.amount_minor);
    await J(r, 200, books.payPreview(S.pay.bills, body, NAME, { extra: payExtras(S, body, prop), on_rail: S.adv.on_rail })); return true;
  }
  if (p === '/api/books/payments' && m === 'POST') {
    S.pay.posts.push(body);
    const prop = books.payProposal(S.pay.bills, body.amount_minor);
    const W = books.payWarnings(prop, body, NAME, { extra: payExtras(S, body, prop) }), ack = body.acknowledge || [];
    if (W.some((w) => ack.indexOf(w.code) < 0)) { await J(r, 409, books.alreadyPaid(W, body)); return true; }
    const n = S.pay.done.length + 1, entry_no = 'PY/2026-27/' + String(n).padStart(6, '0'), payment_id = 'pay' + n;
    const out = books.payRecorded(S.pay.bills, body, NAME, { payment_id, entry_no });
    const settled = (out.allocation && out.allocation.settled) || [];
    settled.forEach((a) => { const b = S.pay.bills.find((x) => x.against_ref === a.against_ref); b.open_minor -= a.amount_minor; });
    S.pay.bills = S.pay.bills.filter((b) => b.open_minor > 0);
    out.outcome.balance_minor = out.outcome.on_account_minor - S.pay.bills.reduce((t, b) => t + b.open_minor, 0);
    out.outcome.balance_words = books.rs(Math.abs(out.outcome.balance_minor));
    S.pay.done.push({ body, payment_id, entry_no, settled: out.outcome.settled });
    /* M30: the record answers the advice block too — the outcome panel mounts it without a second read */
    S.adv.rows[payment_id] = { body, settled: out.outcome.settled, entry_no, state: 'none', chit_id: null, shared_at: null };
    out.advice = adviceOf(S, payment_id);
    await J(r, 200, out); return true;
  }
  let x;
  if ((x = p.match(/^\/api\/books\/payments\/([^/]+)\/advice$/)) && m === 'GET') { S.adv.reads = (S.adv.reads || 0) + 1; await J(r, 200, Object.assign({ currency: 'INR' }, adviceOf(S, x[1]))); return true; }
  if ((x = p.match(/^\/api\/books\/payments\/([^/]+)$/)) && m === 'PATCH') {
    S.adv.patches.push({ id: x[1], body });
    const row = S.adv.rows[x[1]] || (adviceOf(S, x[1]), S.adv.rows[x[1]]);
    if (body.advice_chit_id) { if (row.chit_id && row.chit_id !== body.advice_chit_id) { await J(r, 409, { error: 'An advice is already recorded for this payment.', message: 'An advice is already recorded for this payment.', code: 'ADVICE_EXISTS', advice_chit_id: row.chit_id }); return true; } row.chit_id = body.advice_chit_id; row.state = 'sent'; }
    if (body.advice_shared_at) { row.shared_at = row.shared_at || new Date().toISOString(); if (!row.chit_id) row.state = 'shared'; }
    await J(r, 200, books.payPatched(x[1], { chit_id: row.chit_id, state: row.state, shared_at: row.shared_at })); return true;
  }
  return null;
}
async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method(); let x;
  S.calls.push(m + ' ' + p + (p === '/api/books/daybook' ? u.search : ''));   /* PERF1: a by-id Day book read is told apart from a whole-range one */
  if (S.pay && /^\/api\/books\/payments/.test(p)) { if (await payRoute(S, r, p, m)) return; }
  /* M30 · E5: the chit rail — the advice is a chit the page sends with the server's body; a failing rail answers 500 (then the page says "Send again") */
  if (p === '/api/chits/send' && m === 'POST') {
    let b = {}; try { b = JSON.parse(q.postData() || '{}'); } catch (_) {}
    S.adv.sends.push(b);
    if (S.adv.failSend) return J(r, 500, { error: 'Failed', message: 'The rail did not answer.' });
    return J(r, 200, { message: 'Chit sent successfully', chit_id: 'chit-adv-' + S.adv.sends.length, auto_subject: b.manual_subject || '', is_draft: false, recipients: 1, fan_out: { to: 1, cc: 0, for: 0 }, summary: {} });
  }
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR' }, country: 'IN' });   /* crm.html reads the shop's country from /me (SESSION.country -> its pack's currency); with none known a page shows no symbol (N1) */
  if (p === '/api/books/health') return J(r, 200, books.health());
  if (p === '/api/books/dues') return J(r, 200, books.dues(DUES, { asOf: TODAY }));
  /* M29 · E4: the reverse route — the stand-in records what it was asked and answers as routes/books.js does (the mirror, the bills reopened, the words) */
  if ((x = p.match(/^\/api\/books\/entries\/([^/]+)\/reverse$/)) && m === 'POST') {
    let b = {}; try { b = JSON.parse(q.postData() || '{}'); } catch (_) {}
    S.reverses = S.reverses || []; S.reverses.push({ id: x[1], body: b });
    return J(r, 200, { ok: true, entry_id: 'e-rev' + S.reverses.length, entry_no: 'MJ/2026-27/00000' + S.reverses.length, posting_date: '2026-10-06', moved: false, reverses: 'PY/2026-27/000001', reverses_entry_id: x[1], items: 3,
      reopened: [{ against_ref: 'bill-a', bill_no: 'KT-0007' }], words: 'Reversed PY/2026-27/000001 — ₹1,120 — by MJ/2026-27/00000' + S.reverses.length + '. Reopened 1 bill (KT-0007).' });
  }
  if ((x = p.match(/^\/api\/books\/party\/([^/]+)\/statement$/)) && S.stmt && S.stmt[x[1]]) return J(r, 200, books.statement(x[1], S.stmt[x[1]]));
  if ((x = p.match(/^\/api\/books\/party\/([^/]+)\/statement$/))) {
    const neg = x[1] !== 'c1';
    const line = { date: '2026-09-05', what: neg ? 'Purchase' : 'Sale', ref: null, party_id: x[1], source_chit_id: null, dr_minor: neg ? 0 : 300000, cr_minor: neg ? 150000 : 0, running_minor: neg ? -150000 : 300000, source: null };
    return J(r, 200, books.statement(x[1], { opening_minor: 0, closing_minor: line.running_minor, lines: [line] }));
  }
  if (p === '/api/books/accounts') return J(r, 200, { accounts: [['1300', 'Customers (Sundry Debtors)'], ['2100', 'Suppliers (Sundry Creditors)'], ['1400', 'Cash']].map((a) => books.accountRow({ account_id: 'acc-' + a[0], code: a[0], name: a[1], is_group: false })) });
  if (p === '/api/books/trial-balance') return J(r, 200, books.trialBalance([{ code: '1300', name: 'Customers (Sundry Debtors)', dr_minor: 300000, cr_minor: 0 }, { code: '2100', name: 'Suppliers (Sundry Creditors)', dr_minor: 0, cr_minor: 250000 }], { total_dr_minor: 300000, total_cr_minor: 250000, balanced: false }));
  if ((x = p.match(/^\/api\/books\/ledger\/(1300|2100)$/))) return J(r, 200, books.ledger(x[1], x[1] === '1300' ? 'Customers (Sundry Debtors)' : 'Suppliers (Sundry Creditors)', [], { closing_minor: x[1] === '1300' ? 300000 : -250000 }));
  /* M28 · a bill chit and its thread (routes/chits.js :2539 GET /:id · :3821 / :3661 messages): a bill's line is 'ln-<chit>-1' */
  if ((x = p.match(/^\/api\/chits\/([^/]+)$/)) && m === 'GET') return J(r, 200, { header: { chit_id: x[1] }, actions: { message_external: { ok: true }, message_internal: { ok: true } }, live_set: [{ line_id: 'ln-' + x[1] + '-1', live: { particulars: 'Goods' }, removed: false }] });
  if ((x = p.match(/^\/api\/chits\/([^/]+)\/messages$/))) {
    if (m === 'GET') return J(r, 200, { messages: S.msgs.filter((g) => g.chit_id === x[1]), count: S.msgs.filter((g) => g.chit_id === x[1]).length });
    let b = {}; try { b = JSON.parse(q.postData() || '{}'); } catch (_) {}
    S.msgPosts.push({ chit_id: x[1], body: b });
    const row = { message_id: 'm' + S.msgPosts.length, chit_id: x[1], created_at: new Date().toISOString(), msg_type: b.msg_type || 'info', is_dispute: false, dispute_id: null, line_id: b.line_id || null, thread_type: b.thread_type, message_text: b.message_text, sender_entity_id: 'ent-M', sender_display_name: 'Mayur Bhavan', attachments: [] };
    S.msgs.push(row); return J(r, 200, { message_id: row.message_id, thread_type: row.thread_type, message_text: row.message_text, sender_display_name: row.sender_display_name, created_at: row.created_at });
  }
  if (p === '/api/books/todo') return J(r, 200, S.todo || []);
  if (p === '/api/crm/parties' && m === 'GET') return J(r, 200, (() => { const l = crmApi.list(S.list, { records: S.fx.records }); (l.parties || []).forEach((x) => { if (!x.currency) x.currency = 'INR'; }); return l; })());
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/timeline$/))) return J(r, 200, crmApi.timeline(S.fx.timelines[decodeURIComponent(x[1])] || { entries: [] }, x[1], {}));
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}
(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, ''), f = path.join(PUB, rel || 'index.html');
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch(), threw = [], offHost = [];
  let CUR = null, OPENED = null;   /* the stand-in of the popup now open: type() waits on ITS preview */
  async function open(url, S) {
    CUR = S;   /* type() waits on the stand-in of the page now open */
    const ctx = await b.newContext({ viewport: { width: 1366, height: 800 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, OWNER);
    const p = await ctx.newPage(); p.on('pageerror', (e) => { threw.push(e.message); console.log('  PAGEERR ' + e.message); });
    await p.goto(base + url); return { ctx, p };
  }
  const bodyText = (p) => p.evaluate(() => document.body.innerText);
  /* ── E9 · crm.html ─────────────────────────────────────────────────────────── */
  {
    const S = standIn(), { ctx, p } = await open('/crm.html', S);
    await p.waitForSelector('[data-testid^="party-due-"]', { timeout: 15000 });
    const chips = await p.$$eval('[data-testid^="party-due-"]:not([data-testid^="party-due-late-"])', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(chips.length >= 3, 'crm.html: the list shows dues chips (' + chips.length + ')');
    ok(chips.every((t) => CRMWORDS.test(t)), 'E9 crm.html list: every dues figure is said the shopkeeper way — you-will get / you-will give / "settled" (' + chips.filter((t) => !CRMWORDS.test(t)).join(' | ') + ')');
    ok(!MINUS.test(await bodyText(p)), 'E9 crm.html list: no minus sign in front of a figure');
    await p.click('[data-testid="crm-row-P-0001"]');
    await p.waitForSelector('[data-testid="crm-rec-name"]', { timeout: 15000 });
    await p.waitForTimeout(500);
    ok(!MINUS.test(await bodyText(p)), 'E9 crm.html record: no minus sign in front of a figure');
    const hdr = await p.$$eval('.rchips [data-testid^="party-due-"]:not([data-testid^="party-due-late-"])', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(hdr.length === 1 && /^[↑↓]?\s*₹\s?481\.65 you'll give/.test(hdr[0]), 'E9 crm.html record: the header figure says 481.65 you-will-give for the server\'s -48165 (' + hdr.join('|') + ')');
    try { await p.click('[data-testid="crm-sec-ledger"]', { timeout: 2000 }); } catch (_) {}
    await p.waitForTimeout(600);
    ok(!MINUS.test(await bodyText(p)), 'E9 crm.html ledger section opened: still no minus');
    const stmt = await p.$$eval('[data-testid="stmt-opening"],[data-testid="stmt-closing"]', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(stmt.every((t) => / (Dr|Cr)$|^\D*0(\.0+)?$/.test(t)), 'E9 crm.html statement: opening and closing are Dr / Cr (' + stmt.join(' | ') + ')');
    const btn = await p.evaluate(() => { const e = document.querySelector('[data-testid="crm-act-pay"], [data-testid="crm-next-pay"]'); return e ? getComputedStyle(e).backgroundColor : null; });
    if (btn) ok(btn !== 'rgba(0, 0, 0, 0)' && btn !== 'rgb(255, 255, 255)', 'the Pay / Receive button takes the primary look from bkCss (' + btn + ')');
    fs.mkdirSync(PNG, { recursive: true });
    await p.screenshot({ path: path.join(PNG, 'CRMLedger.png') });
    await ctx.close();
  }
  /* ── E9 · the Dues list on accounts.html ───────────────────────────────────── */
  {
    const S = standIn(), { ctx, p } = await open('/accounts.html', S);
    await p.waitForSelector('[data-testid="acc-nav-receivables"]', { timeout: 15000 });
    await p.evaluate(() => show('dues'));   /* the combined Dues list (both sides) is still a door - To do opens it; the menu has Receivables and Payables */
    await p.waitForSelector('[data-testid="dues-side-pay"]', { timeout: 15000 });
    await p.waitForTimeout(300);
    const text = await bodyText(p);
    ok(/Agro Mills/.test(text) && /1,500\.00/.test(text), 'accounts.html Dues: a supplier you owe shows 1,500.00, plain');
    ok(!MINUS.test(text), 'E9 accounts.html Dues: no minus sign in front of a figure (the group head says "You owe")');
    await p.click('[data-testid="dues-s1"]').catch(() => {});
    await p.waitForTimeout(500);
    ok(!MINUS.test(await bodyText(p)), 'E9 accounts.html Dues: a party opened, still no minus');
    await ctx.close();
  }
  /* ── the one Pay popup, opened from the CRM record of Agro Mills (P-0001) — the third door ── */
  const text = (p, id) => p.evaluate((i) => { const e = document.querySelector('[data-testid="' + i + '"]'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, id);
  const posts = (S) => S.pay.posts.length;
  async function openPay(url, S, o) {
    const { ctx, p } = await open(url || '/crm.html', S);
    await p.waitForSelector('[data-testid="crm-row-P-0001"]', { timeout: 15000 });
    await p.click('[data-testid="crm-row-P-0001"]');
    await p.waitForSelector('[data-testid="crm-rec-name"]', { timeout: 15000 });
    try { await p.click('[data-testid="crm-sec-ledger"]', { timeout: 3000 }); } catch (_) {}
    await p.waitForSelector('[data-testid="crm-act-pay"], [data-testid="crm-next-pay"]', { timeout: 15000 });
    return { ctx, p };
  }
  /* 17 Nov (walkfix): Receive/Pay now opens FILLED with the dues total and Bank first (l16 2664a890, cap-books.js payOpenTotal). These walks drive a typed amount by cash: say so once, here; the bank-first default is checked in 'opens filled' below */
const popup = async (p) => { await p.click('[data-testid="crm-act-pay"], [data-testid="crm-next-pay"]'); await p.waitForSelector('[data-testid="pay_amt"]', { timeout: 8000 }); OPENED = await p.evaluate(() => ({ mode: document.getElementById('pay_mode').value, amt: document.getElementById('pay_amt').value })); await p.selectOption('[data-testid="pay_mode"]', 'cash'); await p.waitForTimeout(150); };
  const type = async (p, amt) => { const want = Math.round(Number(String(amt).replace(/,/g, '')) * 100); await p.fill('[data-testid="pay_amt"]', amt); await p.waitForFunction(() => { const e = document.getElementById('pay_left'); return e && !/Type the amount/.test(e.textContent); }, null, { timeout: 8000 }); for (let i = 0; i < 40 && CUR; i++) { const pv = CUR.pay.previews[CUR.pay.previews.length - 1]; if (pv && pv.amount_minor === want) break; await p.waitForTimeout(100); } await p.waitForTimeout(150); };   /* the popup opens filled, so wait for the preview of the TYPED amount */
  const closeIf = (p) => p.evaluate(() => { if (typeof closeModal === 'function') closeModal(); });
  /* R102b: Record asks first (the app's own <dialog open>, no role attribute) — the Yes tap that writes */
  const ASK_OK = 'dialog[open] [data-testid="confirm-ok"]', ASK_NO = 'dialog[open] [data-testid="confirm-cancel"]';
  const askText = (p) => p.evaluate(() => { const d = document.querySelector('#cb_confirm'); return d ? d.textContent.replace(/\s+/g, ' ').trim() : ''; });
  const yesPay = async (p) => { await p.waitForSelector(ASK_OK, { timeout: 5000 }); await p.click(ASK_OK); };
  /* ── R102b · a payment asks first (walk 24 Oct): who, how much, how — Cancel writes nothing; Yes writes once ── */
  {
    const S = standIn(), { ctx, p } = await openPay('/crm.html', S);
    await popup(p);
    ok(OPENED && OPENED.mode === 'bank' && /481.65/.test(OPENED.amt), 'L16-2 · Pay opens FILLED with what is owed (481.65) and Bank first (' + JSON.stringify(OPENED) + ')');
    await type(p, '2000');
    await p.click('[data-testid="pay_record"]');
    await p.waitForSelector(ASK_OK, { timeout: 5000 });
    const ask1 = await askText(p);
    ok(/Pay Agro Mills ₹\s?2,000(\.00)? by cash\?/.test(ask1) && /Your books will show it paid\./.test(ask1), 'R102b · Record asks first, in the screen\'s words: "Pay Agro Mills ₹2,000.00 by cash? Your books will show it paid." — got ' + ask1.slice(0, 110));
    ok(await p.locator('dialog[open]#cb_confirm:not([role])').count() === 1, 'R102b · the ask is the app\'s own <dialog open> with no role attribute — never the browser\'s confirm()');
    await p.click(ASK_NO); await p.waitForTimeout(300);
    ok(posts(S) === 0 && await p.locator('[data-testid="pay_amt"]').count() === 1 && await p.locator('[data-testid="pay_record"]').isEnabled() && await p.locator('dialog[open]#cb_confirm').count() === 0, 'R102b · Cancel: no POST, the form stays as it was, Record is pressable again (' + posts(S) + ' POST)');
    await p.selectOption('[data-testid="pay_mode"]', 'bank'); await p.waitForTimeout(300);
    await p.click('[data-testid="pay_record"]');
    await p.waitForSelector(ASK_OK, { timeout: 5000 });
    await p.evaluate(() => payRecord());   /* a second press while the question is up opens no second question */
    const ask2 = await askText(p);
    ok(/by bank\?/.test(ask2) && await p.locator('dialog[open]#cb_confirm').count() === 1, 'R102b · the ask names the mode the screen knows, once (' + ask2.slice(0, 60) + ')');
    await p.click(ASK_OK);
    await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 8000 });
    ok(posts(S) === 1 && S.pay.posts[0].mode === 'bank' && S.pay.posts[0].amount_minor === 200000 && S.pay.posts[0].direction === 'out', 'R102b · Yes: ONE POST — out, by bank, ₹2,000 (' + posts(S) + ' POST)');
    await p.screenshot({ path: path.join(PNG, 'PayAsk.png') }).catch(() => {});
    await ctx.close();
  }
  /* ── E10 · the door ── */
  {
    const S = standIn(), { ctx, p } = await openPay('/crm.html', S);
    const url0 = p.url();
    await popup(p);
    ok(p.url() === url0, 'E10 the CRM record\'s Pay opens the popup without leaving the page (url unchanged)');
    ok(await p.locator('[data-testid="pay_amt"]').count() === 1 && await p.locator('[data-testid="pay_mode"]').count() === 1 && await p.locator('[data-testid="pay_adv"]').count() === 1, 'E10 it is the ONE unit: amount · how · "keep as an advance" · bills — in one step');
    ok(!/\bLater\b/.test(await bodyText(p)) && !/\bNext\b/.test(await text(p, 'pay_record') || ''), 'E10 there is no "Later" and no "Next": the button says Record (' + (await text(p, 'pay_record')) + ')');
    ok(await p.evaluate(() => typeof payConfirm === 'undefined' && typeof payProposalPaint === 'undefined'), 'E10 the old confirm step and its painter are gone from the page');
    ok(posts(S) === 0, 'E10 opening the popup records nothing');
    await ctx.close();
  }
  /* ── E2 · oldest first, edit one ── */
  {
    const S = standIn(), { ctx, p } = await openPay('/crm.html', S);
    await popup(p); await type(p, '5000');
    const prev = S.pay.previews[S.pay.previews.length - 1];
    ok(prev.allocate === 'oldest_first' && prev.amount_minor === 500000 && prev.direction === 'out' && prev.party_id === 'pid-0001', 'E2 the preview is asked for 5,000 oldest first, to pay (' + JSON.stringify(prev) + ')');
    const rows = await p.$$eval('[data-testid^="alloc-row-"]', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ')));
    const vals = await p.$$eval('input[data-testid^="alloc-"]', (e) => e.map((x) => Math.round(Number(x.value) * 100)));
    ok(rows.length === 4 && ['KT-0007', 'KT-0008', 'KT-0010', 'KT-0011'].every((n, i) => rows[i].indexOf(n) >= 0), 'E2 four bills, oldest due first (' + rows.map((x) => x.slice(0, 8)).join(' ') + ')');
    ok(JSON.stringify(vals) === JSON.stringify([112000, 56000, 105000, 99012]), 'E2 each amount is what the preview applied (' + vals.join(', ') + ')');
    const l0 = await text(p, 'pay_left');
    ok(/3,720\.12 settles 4 bills/.test(l0) && /1,279\.88 stays with Agro Mills as an advance/.test(l0), 'E2 the line under the table says where the money goes (' + l0 + ')');
    await p.screenshot({ path: path.join(PNG, 'Pay.png') });
    await p.fill('[data-testid="alloc-3"]', '500');
    const l1 = await text(p, 'pay_left');
    ok(/3,230\.00 settles 4 bills/.test(l1) && /1,770\.00 stays with Agro Mills as an advance/.test(l1), 'E2 edit one amount → the line follows (' + l1 + ')');
    await ctx.close();
  }
  /* ── E3 · part payment, then an advance ── */
  {
    const S = standIn(), { ctx, p } = await openPay('/crm.html', S);
    await popup(p); await type(p, '2000');
    const vals = await p.$$eval('input[data-testid^="alloc-"]', (e) => e.map((x) => Math.round(Number(x.value) * 100)));
    ok(JSON.stringify(vals) === JSON.stringify([112000, 56000, 32000, 0]), 'E3 ₹2,000 → two bills and part of the third (' + vals.join(', ') + ')');
    ok(/2,000\.00 settles 3 bills/.test(await text(p, 'pay_left')) && !/advance/.test(await text(p, 'pay_left')) && await p.locator('[data-testid="pay_band"]').isHidden(), 'E3 the line says 3 bills, nothing left over, and no band');
    await p.click('[data-testid="pay_record"]'); await yesPay(p);
    await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 8000 });
    ok(posts(S) === 1 && JSON.stringify(S.pay.posts[0].allocations) === JSON.stringify([{ against_ref: 'bill-a', amount_minor: 112000 }, { against_ref: 'bill-b', amount_minor: 56000 }, { against_ref: 'bill-c', amount_minor: 32000 }]), 'E3 ONE call, with the allocations in it');
    ok(await text(p, 'pay_outcome') === 'Paid ₹2,000 cash to Agro Mills. Settled 3 bills (₹2,000).', 'E3 outcome words, exact (' + (await text(p, 'pay_outcome')) + ')');
    ok(await text(p, 'pay_settled') === 'Settled: KT-0007, KT-0008, KT-0010', 'E3 the outcome names the bills settled (' + (await text(p, 'pay_settled')) + ')');
    ok(/^Balance: they owe you|^Balance: you owe/.test(await text(p, 'pay_balance') || ''), 'E3 the balance is in words, never a minus (' + (await text(p, 'pay_balance')) + ')');
    await p.click('[data-testid="pay_done"]');
    ok(await p.locator('[data-testid="pay_amt"]').count() === 0, 'E3 Done closes it');
    await ctx.close();
  }
  {
    const S = standIn(), { ctx, p } = await openPay('/crm.html', S);
    await popup(p); await type(p, '5000');
    ok(/1,279\.88 stays with Agro Mills as an advance/.test(await text(p, 'pay_left')), 'E3 ₹5,000 → "₹1,279.88 stays with Agro Mills as an advance"');
    const band = await text(p, 'pay_band_words');
    ok(/5,000 is more than the ₹3,720\.12 open/.test(band || '') && await p.locator('[data-testid="pay_record"]').isDisabled(), 'E3 more than is owed → the band, and Record waits for it (' + band + ')');
    await p.click('[data-testid="pay_ack"]');
    await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 8000 });
    ok(posts(S) === 1 && JSON.stringify(S.pay.posts[0].acknowledge) === '["excess"]', 'E3 "Pay as advance" is the one POST, and it acknowledges "excess"');
    ok(await text(p, 'pay_outcome') === 'Paid ₹5,000 cash to Agro Mills. Settled 4 bills (₹3,720.12). ₹1,279.88 left with Agro Mills as an advance — they owe you this.', 'E3 outcome words, exact (' + (await text(p, 'pay_outcome')) + ')');
    ok(await text(p, 'pay_settled') === 'Settled: KT-0007, KT-0008, KT-0010, KT-0011' && /Balance: they owe you.*1,279\.88.*PY\/2026-27\/000001/.test(await text(p, 'pay_balance') || ''), 'E3 the four bills are named; the balance now is in words with the voucher (' + (await text(p, 'pay_balance')) + ')');
    await p.screenshot({ path: path.join(PNG, 'PayOutcome.png') });
    await ctx.close();
  }
  /* ── E1 · paying twice ── */
  {
    const S = standIn(), { ctx, p } = await openPay('/crm.html', S);
    await popup(p); await type(p, '3720.12');
    ok(await p.locator('[data-testid="pay_band"]').isHidden(), 'E1 paying exactly what is owed raises no band');
    await p.click('[data-testid="pay_record"]'); await yesPay(p);
    await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 8000 });
    ok(posts(S) === 1 && S.pay.bills.length === 0 && !('acknowledge' in S.pay.posts[0]), 'E1 first payment: one POST, no acknowledge, all four bills settled');
    await p.click('[data-testid="pay_done"]');
    await popup(p); await type(p, '3720.12');
    await p.waitForSelector('[data-testid="pay_band"]:not([hidden])', { timeout: 8000 });
    const band = await text(p, 'pay_band_words');
    ok(/Nothing is owed to Agro Mills/.test(band) && /PY\/2026-27\/000001/.test(band) && /Pay ₹3,720\.12 again as an advance\?/.test(band), 'E1 the second time: the band names what is owed and the voucher (' + band + ')');
    ok(await p.locator('[data-testid="pay_record"]').isDisabled(), 'E1 nothing records until a button in the band is pressed (Record is dead)');
    await p.evaluate(() => payRecord());
    await p.waitForTimeout(300);
    ok(posts(S) === 1, 'E1 even calling Record from outside records nothing while the band is up');
    await p.screenshot({ path: path.join(PNG, 'PayBand.png') });
    await p.click('[data-testid="pay_band_cancel"]');
    await p.waitForTimeout(300);
    ok(posts(S) === 1 && await p.locator('[data-testid="pay_amt"]').count() === 0, 'E1 Cancel records nothing and closes the popup (' + posts(S) + ' POST)');
    await popup(p); await type(p, '3720.12');
    await p.waitForSelector('[data-testid="pay_band"]:not([hidden])', { timeout: 8000 });
    await p.click('[data-testid="pay_ack"]');
    await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 8000 });
    const ack = S.pay.posts[1] && S.pay.posts[1].acknowledge || [];
    ok(posts(S) === 2 && ack.indexOf('nothing_owed') >= 0 && ack.indexOf('same_again') >= 0 && ack.indexOf('just_settled') >= 0, '"Pay as advance" → ONE more POST, carrying acknowledge ' + JSON.stringify(ack));
    ok(/^Paid ₹3,720\.12 cash to Agro Mills\. ₹3,720\.12 left with Agro Mills as an advance/.test(await text(p, 'pay_outcome')), 'E1 the outcome says it went on as an advance (' + (await text(p, 'pay_outcome')) + ')');
    /* M30-1c (Athi's black-box 2026-10-09): behind the box the party's Ledger said "settled" while the Day book had the payment - it repaints from the answer, and stays open */
    const outBal = await text(p, 'pay_balance');
    await p.click('[data-testid="pay_done"]');
    await p.waitForTimeout(400);
    const ledBal = await text(p, 'party-balance');
    ok(!/settled/.test(ledBal) && /advance|owe/i.test(ledBal + outBal) && await p.locator('[data-testid="crm-act-pay"], [data-testid="crm-next-pay"]').isVisible(), 'M30-1c the ledger behind the box repaints with the new balance and stays open (' + ledBal + ' · answer: ' + outBal + ')');
    await ctx.close();
  }
  /* ── E11 · owner 2026-10-08: W1 only when there is an allocation ── */
  {
    const S = standIn(); S.pay = payBooks({ bills: [] });
    const { ctx, p } = await openPay('/crm.html', S);
    await popup(p); await type(p, '5000');
    await p.waitForSelector('[data-testid="pay_band"]:not([hidden])', { timeout: 8000 });
    ok(/Nothing is owed to Agro Mills/.test(await text(p, 'pay_band_words')) && S.pay.previews[S.pay.previews.length - 1].allocate === 'oldest_first', 'E11 nothing owed and bills meant (oldest first) → W1 fires: the band');
    await p.check('[data-testid="pay_adv"]');
    await p.waitForFunction(() => document.getElementById('pay_band').hidden, null, { timeout: 8000 });
    const pv = S.pay.previews[S.pay.previews.length - 1];
    ok(pv.allocate === 'none' && !('allocations' in pv), 'E11 "Keep it as an advance" asks for allocate:"none" with no allocation (' + JSON.stringify(pv) + ')');
    ok(await p.locator('[data-testid="pay_band"]').isHidden() && await p.locator('[data-testid="pay_record"]').isEnabled(), 'E11 no allocation → no W1 band, and Record is pressable');
    await p.click('[data-testid="pay_record"]'); await yesPay(p);
    await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 8000 });
    const po = S.pay.posts[0];
    ok(posts(S) === 1 && po.allocate === 'none' && !('allocations' in po) && !('acknowledge' in po), 'E11 the POST carries allocate:"none", no allocations, no acknowledge');
    ok(await text(p, 'pay_outcome') === 'Paid ₹5,000 cash to Agro Mills. ₹5,000 left with Agro Mills as an advance — they owe you this.', 'E11 outcome words (' + (await text(p, 'pay_outcome')) + ')');
    await ctx.close();
  }
  /* ── E10 · M28 doors + Dues: the ledger's Pay beside Statement, Dues rows with To collect / To pay, Remind = a message on the oldest open bill ── */
  {
    const S = standIn(), { ctx, p } = await open('/accounts.html', S);
    await p.waitForSelector('[data-testid="acc-nav-receivables"]', { timeout: 15000 });
    await p.evaluate(() => show('dues'));   /* the combined Dues list (both sides) is still a door - To do opens it; the menu has Receivables and Payables */
    await p.waitForSelector('[data-testid="dues-side-pay"]', { timeout: 15000 });
    await p.waitForTimeout(400);
    const hr = await text(p, 'dues-side-rcv'), hp = await text(p, 'dues-side-pay');
    ok(/To collect/.test(hr) && /To pay/.test(hp) && !/They owe you|You owe\b/.test(hr + hp), 'E10 Dues has two headings: To collect and To pay (' + hr + ' | ' + hp + ')');
    const sum = (side) => DUES.filter((d) => (side === 'rcv' ? d.balance_minor > 0 : d.balance_minor < 0)).reduce((t, d) => t + d.balance_minor, 0);
    ok(/they owe you ₹3,000\.00/.test(hr) && /you owe ₹2,500\.00/.test(hp) && sum('rcv') === 300000 && sum('pay') === -250000, 'E10 each heading carries its total in words, equal to the /dues balances (' + hr + ' | ' + hp + ')');
    ok(await p.locator('[data-testid="dues-pay-c1"]').innerText() === 'Receive' && await p.locator('[data-testid="dues-pay-s1"]').innerText() === 'Pay' && await p.locator('[data-testid="dues-remind-c1"]').count() === 1 && await p.locator('[data-testid="dues-remind-s1"]').count() === 0, 'E10 To collect rows say Receive and Remind; To pay rows say Pay and have no Remind');
    ok(/Ravi Stores/.test(await text(p, 'dues-c1')) && /₹3,000.00/.test(await text(p, 'dues-c1')), 'E10 a row names the party and what is owed; the ageing is said once, in the ageing chips and the bill lines, no longer on the row (l16 one ageing, 7da93b84) (' + (await text(p, 'dues-c1')) + ')');
    const url0 = p.url();
    await p.click('[data-testid="dues-pay-s1"]'); await p.waitForSelector('[data-testid="pay_amt"]', { timeout: 8000 });
    ok(p.url() === url0 && /^Pay ·/.test(await text(p, 'pay_title')) && await p.locator('[data-testid="pay_remind"]').count() === 0, 'E10 a Dues row\'s Pay opens the same pay_amt popup without leaving the page (no "remind me" on what you owe)');
    await closeIf(p); await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(PNG, 'Dues.png') });
    S.calls.length = 0;
    await p.click('[data-testid="dues-remind-c1"]'); await p.waitForSelector('[data-testid="msg-body"]', { timeout: 8000 });
    const prefill = await p.inputValue('[data-testid="msg-body"]');
    ok(/KT-0007/.test(prefill) && /1,120\.00/.test(prefill) && /KT-0007/.test(await text(p, 'remind_for')), 'E10 Remind opens a prefilled message about the oldest open bill (' + prefill.slice(0, 90) + ')');
    await p.fill('[data-testid="msg-body"]', prefill + ' Thank you.');
    await p.click('[data-testid="msg-send"]'); await p.waitForFunction(() => /notified|Note added|Sent/.test((document.querySelector('[data-testid="rt-out"]') || {}).textContent || ''), null, { timeout: 8000 });
    const mp = S.msgPosts;
    ok(mp.length === 1 && mp[0].chit_id === 'bill-a' && mp[0].body.line_id === 'ln-bill-a-1' && mp[0].body.thread_type === 'external' && /Thank you\.$/.test(mp[0].body.message_text), 'E10 ONE message lands on the oldest open bill\'s line, with the person\'s edit (' + JSON.stringify(mp.map((x) => [x.chit_id, x.body.line_id, x.body.thread_type])) + ')');
    ok(!S.calls.some((c) => /^POST \/api\/chits(\/send)?$/.test(c)) && S.calls.filter((c) => /^POST /.test(c) && !/\/messages$/.test(c) && !/payments\/preview$/.test(c)).length === 0 && S.pay.posts.length === 0, 'E10 Remind makes no new chit and posts nothing to the books (' + S.calls.filter((c) => /^POST /.test(c)).join(', ') + ')');
    await closeIf(p);
    S.msgPosts.length = 0;
    await p.click('[data-testid="dues-pay-c1"]'); await p.waitForSelector('[data-testid="pay_remind"]', { timeout: 8000 });
    await p.click('[data-testid="pay_remind"]'); await p.waitForSelector('[data-testid="msg-body"]', { timeout: 8000 });
    ok(await p.locator('[data-testid="pay_amt"]').count() === 0 && /KT-0007/.test(await p.inputValue('[data-testid="msg-body"]')) && S.pay.posts.length === 0 && S.msgPosts.length === 0, 'E10 "Not paid yet — remind me" closes the payment and opens the same Remind; nothing is posted or sent until the person sends');
    await closeIf(p);
    await ctx.close();
  }
  /* ── E10 · the LEDGER door and the ₹5,000 ledger test ── */
  {
    const S = standIn(), { ctx, p } = await open('/accounts.html', S);
    await p.waitForSelector('[data-testid="acc-nav-ledgers"]', { timeout: 15000 });
    await p.click('[data-testid="acc-nav-ledgers"]');
    await p.waitForSelector('[data-testid="lg-acc-2100"]', { timeout: 15000 });
    await p.click('[data-testid="lg-acc-2100"]'); await p.waitForSelector('[data-testid="lg-party-s1"]', { timeout: 8000 });
    const leaves = await p.$$eval('[data-testid="lg-party-s1"], [data-testid="lg-party-s2"]', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const tot = leaves.map((t) => Number((t.match(/₹\s?([\d,]+\.\d\d)/) || [0, '0'])[1].replace(/,/g, ''))).reduce((a, b) => a + b, 0);
    ok(tot === 2500, 'E10 the ledger\'s supplier balances (' + leaves.join(' | ') + ') add to the To pay total, 2,500.00');
    await p.click('[data-testid="lg-party-s1"]'); await p.waitForSelector('[data-testid="lg-statement"]', { timeout: 8000 });
    ok(await p.locator('[data-testid="lg-pay"]').count() === 1 && (await text(p, 'lg-pay')) === 'Pay', 'E10 a party\'s ledger has Pay beside Statement');
    const url0 = p.url();
    await p.click('[data-testid="lg-pay"]'); await p.waitForSelector('[data-testid="pay_amt"]', { timeout: 8000 });
    ok(p.url() === url0, 'E10 the ledger\'s Pay opens the popup without leaving the page');
    await type(p, '5000');
    const prev = S.pay.previews[S.pay.previews.length - 1];
    ok(prev.party_id === 's1' && prev.direction === 'out' && prev.amount_minor === 500000, 'the ₹5,000 ledger test: the preview is for Agro Mills (s1), to pay, 5,000 (' + JSON.stringify(prev) + ')');
    ok(/₹1,279\.88 stays with .* as an advance/.test(await text(p, 'pay_left')), 'the ₹5,000 ledger test: ₹1,279.88 stays as an advance (' + (await text(p, 'pay_left')) + ')');
    await p.waitForSelector('[data-testid="pay_band"]:not([hidden])', { timeout: 8000 }); await p.click('[data-testid="pay_ack"]'); await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 8000 });
    ok(S.pay.posts.length === 1 && S.pay.posts[0].party_id === 's1' && /^Paid ₹5,000 by bank to Agro Mills\. /.test(await text(p, 'pay_outcome')), 'the ₹5,000 ledger test: ONE payment is recorded for s1 and the outcome names it - by bank, the opened-filled default (2664a890) (' + (await text(p, 'pay_outcome')) + ')');
    await ctx.close();
  }
  /* ── E4 · M29 reverse from the row: the statement's payment row → Reverse → reason → ONE POST /entries/:id/reverse; the row repaints "reversed by"; the Day book was never read ── */
  {
    const S = standIn();
    /* Agro Mills' statement as the M29 api sends it: a purchase bill and the ₹1,120 payment that settled KT-0007 (the payment line names its entry) */
    S.stmt = { s1: { opening_minor: 0, closing_minor: -38000, code: '2100', lines: [
      { date: '2026-10-06', what: 'Payment made', ref: 'PY/2026-27/000001', entry_id: 'e-pay1', entry_no: 'PY/2026-27/000001', event_type: 'payment_made', payment_id: 'pay1', unapplied_minor: 0,
        advice: { chit_id: null, state: 'none', shared_at: null }, party_id: 's1', source_chit_id: null, source: null, dr_minor: 112000, cr_minor: 0, running_minor: -38000 },
      { date: '2026-09-01', what: 'Purchase', ref: 'PV/2026-27/000001', entry_id: 'e-bill1', entry_no: 'PV/2026-27/000001', event_type: 'purchase_bill', party_id: 's1', source_chit_id: 'bill-a', source: { chit_id: 'bill-a', ref: 'KT-0007' },
        dr_minor: 0, cr_minor: 150000, running_minor: -150000 }] } };
    const { ctx, p } = await open('/accounts.html', S);
    await p.waitForSelector('[data-testid="acc-nav-ledgers"]', { timeout: 15000 });
    await p.click('[data-testid="acc-nav-ledgers"]');
    await p.waitForSelector('[data-testid="lg-acc-2100"]', { timeout: 15000 });
    await p.click('[data-testid="lg-acc-2100"]'); await p.waitForSelector('[data-testid="lg-party-s1"]', { timeout: 8000 });
    await p.click('[data-testid="lg-party-s1"]'); await p.waitForSelector('[data-testid="stmt-row-0"]', { timeout: 8000 });
    ok(/PY\/2026-27\/000001/.test(await text(p, 'stmt-row-0')) && await p.locator('[data-testid="stmt-0-rev"]').count() === 0, 'E4 the payment row is there, not yet reversed (' + (await text(p, 'stmt-row-0')).slice(0, 60) + ')');
    await p.click('[data-testid="stmt-row-0"]'); await p.waitForSelector('[data-testid="lg-reverse"]', { timeout: 8000 });
    S.calls.length = 0;   /* from here: what REVERSE itself calls (opening a row reads its journal for the detail panel — that is the row, not the reversal) */
    await p.click('[data-testid="lg-reverse"]'); await p.waitForSelector('[data-testid="confirm"] [data-testid="en-reason"]', { timeout: 8000 });
    ok(/PY\/2026-27\/000001 stays as it is/.test(await text(p, 'confirm')), 'E4 Reverse asks first (M64: irreversible → confirm) and names the entry; it asks the reason');
    ok(!S.reverses, 'E4 nothing is posted until the person confirms');
    await p.fill('[data-testid="en-reason"]', 'Paid twice');
    await p.click('[data-testid="confirm-ok"]');
    await p.waitForSelector('[data-testid="stmt-0-rev"]', { timeout: 8000 });
    ok(S.reverses && S.reverses.length === 1 && S.reverses[0].id === 'e-pay1' && S.reverses[0].body.reason === 'Paid twice' && !!S.reverses[0].body.client_ref, 'E4 ONE POST /api/books/entries/e-pay1/reverse with the reason typed (' + JSON.stringify(S.reverses) + ')');
    ok(await text(p, 'stmt-0-rev') === 'reversed by MJ/2026-27/000001 — Paid twice', 'E4 the row repaints locally: "reversed by MJ/2026-27/000001 — Paid twice" (' + (await text(p, 'stmt-0-rev')) + ')');
    ok(!S.calls.some((c) => /\/api\/books\/daybook(?!\?[^ ]*\bentries=)/.test(c)) && !S.calls.some((c) => /\/statement$/.test(c)), 'E4 Reverse never read the Day book range (PERF1: only the opened line entry, by id) and never re-read the statement: the row was repainted from the answer (' + S.calls.join(', ') + ')');
    const toastText = await p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
    ok(/Reopened 1 bill \(KT-0007\)/.test(toastText), 'E4 the outcome words name the bills reopened (' + toastText.trim() + ')');
    await p.click('[data-testid="stmt-row-0"]'); await p.waitForTimeout(200); await p.click('[data-testid="stmt-row-0"]'); await p.waitForTimeout(300);
    ok(await p.locator('[data-testid="lg-reverse"]').count() === 0, 'E4 a reversed row offers no second Reverse (a reversed entry is never edited, only mirrored — once)');
    await p.click('[data-testid="stmt-row-1"]'); await p.waitForTimeout(300);
    ok(await p.locator('[data-testid="lg-reverse"]').count() === 1, 'E4 the bill\'s own row still offers Reverse this entry (it names its entry too)');
    await ctx.close();
  }
  /* ── E5 · M30 advice OUT, on rail: the outcome panel, Send, the failed send, the statement row, the To-do, a viewer ── */
  {
    const S = standIn(), { ctx, p } = await openPay('/crm.html', S);
    await popup(p); await type(p, '2000');
    await p.click('[data-testid="pay_record"]'); await yesPay(p); await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 8000 });
    await p.waitForSelector('[data-testid="pay_advice"] [data-testid="adv-send"]', { timeout: 8000 });
    ok((S.adv.reads || 0) === 0 && S.calls.filter((c) => /\/advice$/.test(c)).length === 0, 'E5 the outcome panel mounts CBAdvice from the record\'s own advice block — no second read');
    ok(await text(p, 'adv-send') === '✉ Send advice' && !(await p.getAttribute('[data-testid="adv-send"]', 'class') || '').split(' ').includes('off') && await p.locator('[data-testid="adv-share"]').count() === 1 && (await p.getAttribute('[data-testid="adv-share"]', 'class') || '').split(' ').includes('off'),
      'E5 on rail: Send advice is live, Share is shown greyed (every action shown; the server\'s may decides) (' + (await text(p, 'adv-send')) + ')');
    ok(/is on ChitBridge — send the advice instead\./.test(await p.getAttribute('[data-testid="adv-share"]', 'title') || ''), 'E5 the greyed Share carries the server\'s sentence as its title');
    await p.click('[data-testid="adv-send"]');
    await p.waitForFunction(() => /✓/.test((document.querySelector('[data-testid="adv-out"]') || {}).textContent || ''), null, { timeout: 8000 });
    const sent = S.adv.sends[0] || {}, bj = sent.business_json || {}, pa = bj.payment_advice || {};
    ok(S.adv.sends.length === 1 && sent.purpose === 'general' && bj.kind === 'payment_advice' && sent.client_ref === 'advice:pay:pay1' && JSON.stringify(sent.recipients) === JSON.stringify([{ entity_id: 'pid-0001', role: 'to' }]),
      'E5 ONE POST /api/chits/send with the server\'s body: purpose general, kind payment_advice, client_ref advice:pay:pay1, to the party (' + JSON.stringify(sent).slice(0, 160) + ')');
    ok(pa.action === 'paid' && pa.amount_minor === 200000 && JSON.stringify((sent.line_items || []).map((l) => [l.ref_chit_id, l.applied_minor])) === JSON.stringify([['bill-a', 112000], ['bill-b', 56000], ['bill-c', 32000]]), 'E5 the body names the bills by chit_id with what each took, and the amount in minor units — the page composed none of it');
    ok(S.adv.patches.length === 1 && S.adv.patches[0].id === 'pay1' && S.adv.patches[0].body.advice_chit_id === 'chit-adv-1', 'E5 then ONE PATCH /payments/pay1 { advice_chit_id } (' + JSON.stringify(S.adv.patches) + ')');
    ok(await text(p, 'adv-out') === 'Advice sent to Agro Mills ✓' && await text(p, 'adv-state') === '✉ advice sent', 'E5 the outcome says it: "Advice sent to Agro Mills ✓", the state chip "✉ advice sent" (' + (await text(p, 'adv-out')) + ')');
    ok((await p.getAttribute('[data-testid="adv-send"]', 'class') || '').split(' ').includes('off') && await text(p, 'adv-why-send') === 'An advice is already sent for this payment.', 'E5 one advice per payment: Send greys with its sentence');
    await p.click('[data-testid="adv-send"]', { force: true }); await p.waitForTimeout(300);
    ok(S.adv.sends.length === 1 && S.adv.patches.length === 1, 'E5 pressing the greyed Send sends nothing');
    await p.click('[data-testid="pay_done"]');
    /* the failed send: a second payment, the rail down */
    S.adv.failSend = true;
    await popup(p); await type(p, '500');
    await p.click('[data-testid="pay_record"]'); await yesPay(p); await p.waitForSelector('[data-testid="pay_advice"] [data-testid="adv-send"]', { timeout: 8000 });
    await p.click('[data-testid="adv-send"]');
    await p.waitForFunction(() => /Send again/.test((document.querySelector('[data-testid="adv-out"]') || {}).textContent || ''), null, { timeout: 8000 });
    ok(S.adv.sends.length === 2 && S.adv.patches.length === 1 && await text(p, 'adv-out') === 'Advice not sent — Send again' && await text(p, 'adv-send') === '✉ Send again' && await p.getAttribute('[data-testid="adv-send"]', 'data-action-state') === 'failed',
      'E5 the rail refuses → "Advice not sent — Send again", NO PATCH (the row keeps Send), the button says Send again, action-state failed (' + (await text(p, 'adv-out')) + ')');
    S.adv.failSend = false;
    await p.click('[data-testid="adv-send"]');
    await p.waitForFunction(() => /✓/.test((document.querySelector('[data-testid="adv-out"]') || {}).textContent || ''), null, { timeout: 8000 });
    ok(S.adv.sends.length === 3 && S.adv.sends[2].client_ref === S.adv.sends[1].client_ref && S.adv.patches.length === 2 && S.adv.patches[1].body.advice_chit_id === 'chit-adv-3', 'E5 Send again: the SAME client_ref (the rail dedupes), then the PATCH lands');
    await p.click('[data-testid="pay_done"]');
    await ctx.close();
  }
  /* ── E5 · the statement row: the chip, the Advice button mounts the unit (one read); the To-do row; a viewer ── */
  {
    const S = standIn();
    S.adv.rows.pay1 = { body: { party_id: 's1', direction: 'out', amount_minor: 112000, currency: 'INR', mode: 'cash' }, settled: [{ against_ref: 'bill-a', bill_no: 'KT-0007', amount_minor: 112000 }], entry_no: 'PY/2026-27/000001', state: 'delivered', chit_id: 'chit-adv-9', shared_at: null };
    S.stmt = { s1: { opening_minor: 0, closing_minor: -38000, code: '2100', lines: [
      { date: '2026-10-06', what: 'Payment made', ref: 'PY/2026-27/000001', entry_id: 'e-pay1', entry_no: 'PY/2026-27/000001', event_type: 'payment_made', payment_id: 'pay1', unapplied_minor: 0,
        advice: { chit_id: 'chit-adv-9', state: 'delivered', shared_at: null }, party_id: 's1', source_chit_id: null, source: null, dr_minor: 112000, cr_minor: 0, running_minor: -38000 },
      { date: '2026-10-07', what: 'Payment made', ref: 'PY/2026-27/000002', entry_id: 'e-pay2', entry_no: 'PY/2026-27/000002', event_type: 'payment_made', payment_id: 'pay2', unapplied_minor: 50000,
        advice: { chit_id: null, state: 'none', shared_at: null }, party_id: 's1', source_chit_id: null, source: null, dr_minor: 50000, cr_minor: 0, running_minor: 12000 }] } };
    S.todo = [books.todoRow({ kind: 'advices_to_send', count: 1, words: '1 payment has no advice yet — Agro Mills does not know you paid.', action: { label: 'Send advice', screen: 'ledgers', call: 'PATCH /api/books/payments/:id' }, items: [{ payment_id: 'pay2', party_id: 's1', name: 'Agro Mills', direction: 'out', amount_minor: 50000, currency: 'INR', received_at: '2026-10-07' }] })];
    const { ctx, p } = await open('/accounts.html', S);
    await p.waitForSelector('[data-testid="todo-row-advices_to_send"]', { timeout: 15000 });
    ok(await text(p, 'todo-words-advices_to_send') === '1 payment has no advice yet — Agro Mills does not know you paid.' && await text(p, 'todo-n-advices_to_send') === '1' && await text(p, 'todo-go-advices_to_send') === 'Send advice',
      'E5 the Accounts To-do shows advices_to_send with the server\'s words, the count and its button (' + (await text(p, 'todo-words-advices_to_send')) + ')');
    await p.click('[data-testid="todo-go-advices_to_send"]'); await p.waitForSelector('[data-testid="lg-acc-2100"]', { timeout: 15000 });
    ok(true, 'E5 its button opens Ledgers (the party\'s statement row is where the advice is sent)');
    await p.click('[data-testid="lg-acc-2100"]'); await p.waitForSelector('[data-testid="lg-party-s1"]', { timeout: 8000 });
    await p.click('[data-testid="lg-party-s1"]'); await p.waitForSelector('[data-testid="stmt-row-0"]', { timeout: 8000 });
    /* the ledger numbers a row by its line's _ix, not its place on screen — read the number off the testid */
    const rows = await p.$$eval('[data-testid^="stmt-row-"]', (e) => e.map((x) => [x.getAttribute('data-testid').slice(9), x.textContent.replace(/\s+/g, ' ').trim()]));
    const ixOf = (re) => { const r = rows.find((x) => re.test(x[1])); return r ? r[0] : null; }, sentRow = ixOf(/PY.2026-27.000001/), noneRow = ixOf(/PY.2026-27.000002/);
    ok(sentRow !== null && await text(p, 'stmt-' + sentRow + '-adv') === '✉ advice sent · delivered', 'E5 the sent payment\'s row reads "✉ advice sent · delivered" (' + (await text(p, 'stmt-' + sentRow + '-adv')) + ')');
    ok(noneRow !== null && await p.locator('[data-testid="stmt-' + noneRow + '-adv"]').count() === 0 && await p.locator('[data-testid="stmt-' + noneRow + '-advbtn"]').count() === 1, 'E5 a payment with no advice shows no chip and an Advice button');
    S.calls.length = 0;
    await p.click('[data-testid="stmt-' + noneRow + '-advbtn"]'); await p.waitForSelector('[data-testid="adv-host"] [data-testid="adv-send"]', { timeout: 8000 });
    ok(S.calls.filter((c) => /\/advice$/.test(c)).length === 1 && S.calls.filter((c) => /\/statement$/.test(c)).length === 0, 'E5 the Advice button mounts the unit with ONE GET /payments/pay2/advice (no statement re-read) (' + S.calls.join(', ') + ')');
    await p.click('[data-testid="adv-host"] [data-testid="adv-send"]');
    await p.waitForFunction(() => /✓/.test((document.querySelector('[data-testid="adv-host"] [data-testid="adv-out"]') || {}).textContent || ''), null, { timeout: 8000 });
    ok(S.adv.sends.length === 1 && S.adv.sends[0].client_ref === 'advice:pay:pay2' && S.adv.patches.length === 1 && S.adv.patches[0].id === 'pay2', 'E5 Send from the row: the chit, then the PATCH, for THAT payment');
    ok(await text(p, 'stmt-' + noneRow + '-adv') === '✉ advice sent' && !S.calls.some((c) => /\/statement$/.test(c)), 'E5 the row\'s chip flips locally to "✉ advice sent" — the statement was never re-read');
    /* a viewer: the server says read_only; the unit shows Send greyed WITH the sentence, sends nothing */
    S.adv.may = { send_advice: { ok: false, why: 'read_only', say: 'Your access is view-only. You can read this chit but not change it.' }, share_advice: { ok: false, why: 'read_only', say: 'Your access is view-only. You can read this chit but not change it.' } };
    await p.click('[data-testid="stmt-' + sentRow + '-advbtn"]'); await p.waitForSelector('[data-testid="stmt-row-' + sentRow + '"] [data-testid="adv-host"] [data-testid="adv-send"]', { timeout: 8000 });
    const vw = '[data-testid="stmt-row-' + sentRow + '"] [data-testid="adv-host"] ';
    ok((await p.getAttribute(vw + '[data-testid="adv-send"]', 'class') || '').split(' ').includes('off') && /view-only/.test(await p.textContent(vw + '[data-testid="adv-why-send"]')), 'E5 a viewer: Send is shown greyed WITH the server\'s sentence (' + (await p.textContent(vw + '[data-testid="adv-why-send"]')).trim() + ')');
    await p.click(vw + '[data-testid="adv-send"]', { force: true }); await p.waitForTimeout(300);
    ok(S.adv.sends.length === 1 && S.adv.patches.length === 1, 'E5 the viewer\'s press sends nothing');
    await ctx.close();
  }
  /* ── E7 · M30 advice OUT, off rail: Share, never a chit ── */
  {
    const S = standIn(); S.adv.on_rail = false;
    const { ctx, p } = await openPay('/crm.html', S);
    await popup(p); await type(p, '2000');
    await p.click('[data-testid="pay_record"]'); await yesPay(p); await p.waitForSelector('[data-testid="pay_advice"] [data-testid="adv-copy"]', { timeout: 8000 });
    ok((await p.getAttribute('[data-testid="adv-send"]', 'class') || '').split(' ').includes('off') && await text(p, 'adv-why-send') === 'Agro Mills is not on ChitBridge — share the advice instead.',
      'E7 off rail: Send advice is shown greyed with the sentence "Agro Mills is not on ChitBridge — share the advice instead." (' + (await text(p, 'adv-why-send')) + ')');
    const words = adviceOf(S, 'pay1').words, wa = await p.getAttribute('[data-testid="adv-wa"]', 'href'), mail = await p.getAttribute('[data-testid="adv-mail"]', 'href');
    ok(wa === 'https://wa.me/?text=' + encodeURIComponent(words) && /^mailto:\?subject=/.test(mail) && mail.indexOf(encodeURIComponent(words)) > 0, 'E7 Share = WhatsApp (wa.me) and E-mail (mailto:) hrefs carry the words (' + words + ')');
    await p.click('[data-testid="adv-send"]', { force: true }); await p.waitForTimeout(200);
    ok(S.adv.sends.length === 0 && S.adv.patches.length === 0, 'E7 the greyed Send never sends a chit to nowhere');
    await p.click('[data-testid="adv-copy"]');
    await p.waitForFunction(() => /shared/.test((document.querySelector('[data-testid="adv-state"]') || {}).textContent || ''), null, { timeout: 8000 });
    ok(S.adv.patches.length === 1 && S.adv.patches[0].body.advice_shared_at === true && S.adv.sends.length === 0, 'E7 Copy → ONE PATCH { advice_shared_at: true }, no chit (' + JSON.stringify(S.adv.patches) + ')');
    ok(/^↗ advice shared · \S/.test(await text(p, 'adv-state')) && await text(p, 'adv-out') === 'Copied — paste it to Agro Mills', 'E7 the row reads "↗ advice shared · <when>"; the outcome says what to do next (' + (await text(p, 'adv-state')) + ' | ' + (await text(p, 'adv-out')) + ')');
    await p.click('[data-testid="pay_done"]'); await ctx.close();
  }
  ok(threw.length === 0, 'no page error' + (threw.length ? ' · ' + threw[0] : ''));
  ok(offHost.length === 0, 'nothing tried to leave for another host' + (offHost.length ? ' · ' + offHost[0] : ''));
  /* the payments answers (preview · record · the 409s) are held to the contract M26 sent; the E9 stand-ins' older CRM answers are not this file's to judge */
  { const bad = C.STATE.bad.filter((b) => /books\/payments/.test(b.where)); ok(bad.length === 0 && C.STATE.routes.has('POST /api/books/payments') && C.STATE.routes.has('POST /api/books/payments/preview') && C.STATE.routes.has('GET /api/books/payments/:id/advice') && C.STATE.routes.has('PATCH /api/books/payments/:id'), 'every payments answer the stand-in served has the keys, nesting and types of the API contract (M26 · M30)' + (bad.length ? ' - ' + bad.map((b) => b.where + ': ' + b.problems.slice(0, 3).join('; ')).join(' | ') : '')); }
  await b.close(); srv.close();
  console.log('\n  ' + (fail ? '✗ ' + fail + ' FAILED · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
