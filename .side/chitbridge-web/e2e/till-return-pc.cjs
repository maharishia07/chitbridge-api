/* till-return-pc.cjs — ⭐⭐⭐ A RETURN AND AN EXPENSE ON THE SHOP PC, OFFLINE, ARRIVE WITH THEIR OWN NUMBERS
 *
 * 2026-09-28 (backlog M10). The shop PC — the primary deployment — could not issue a credit note or record an
 * expense at all: AgentHost had neither, so the page hid Return and Expense there. Now the program numbers them
 * in their own series (CN/…, EXP/…), the page builds the chit with the same chitOfCN / chitOfExpense the browser
 * uses, and the program files and queues them like a bill.
 *
 * ⭐ DRIVES THE REAL PROGRAM from a COPY of the kit (never the repo folder — its self-update rewrites till.html),
 * on a FREE port, against a stand-in ChitBridge that can be made to refuse. Through the real controls: the bills
 * list's "return", the return sheet, ☰ Expense. [[feedback-shoot-the-screen-not-the-dom]]
 *
 * Run: node e2e/till-return-pc.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const SI = require('./lib/signin.cjs');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const { spawn } = require('child_process');
const KIT = path.join(__dirname, '..', '..', 'chitbridge-api', 'tools', 'tally-connector');
const ENG = path.join(__dirname, '..', 'public', 'engine');
const SHOTS = path.join(__dirname, '..', 'test-results', 'till-return-pc');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (p) => b64({ alg: 'HS256' }) + '.' + b64(p) + '.stub';
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(66) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const PORT = await new Promise((res) => { const t = net.createServer(); t.listen(0, '127.0.0.1', () => { const n = t.address().port; t.close(() => res(n)); }); });
  const KEY = jwt({ identity_id: 'ent-x', bridge_id: 'CB-X', display_name: 'Shop X', kind: 'api_key', scopes: ['till'] });
  const sent = []; const dead = { on: false };
  const api = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const j = (c2, o) => { r.writeHead(c2, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    const u = q.url.split('?')[0];
    const b = raw ? (() => { try { return JSON.parse(raw); } catch (_) { return {}; } })() : {};
    /* the kit passes the window's /api/signin/ask·verify through to the cloud (till.js) — the stand-in answers both names */
    if (u === '/api/entities/register' || u === '/api/signin/ask') return j(200, { message: 'sent', dev_otp: '123456' });
    if (u === '/api/entities/verify' || u === '/api/signin/verify') return j(200, { token: 'T', identity: { identity_id: 'p-x', user_id: 'xclerk', display_name: 'X Clerk', identity_type: 'actor', entity_id: 'ent-x' } });
    if (u === '/api/till/snapshot') return j(200, { at: new Date().toISOString(), version: 'x-1', entity_id: 'ent-x',
      shop: { country: 'IN', name: 'Shop X', bridge_id: 'CB-X' }, till: { suggested_id: 'C1', assigned_id: 'C1' },
      items: [{ id: 'xmango', name: 'XMANGO', price: 50, unit: 'nos', code: 'XMANGO' }] });
    if (u.indexOf('/api/till/engine/') === 0) {
      const f = path.join(ENG, u.split('/').pop().replace(/\.js$/, '') + '.js');
      if (!fs.existsSync(f)) return j(404, {});
      r.writeHead(200, { 'content-type': 'application/javascript' }); return r.end(fs.readFileSync(f));
    }
    if (u === '/api/chits/send') {
      if (dead.on) return j(503, { message: 'refusing on purpose' });
      sent.push(b); return j(200, { chit_id: 'c' + sent.length, ok: true });
    }
    if (q.method === 'GET') return j(404, { message: 'not in this stand-in' });
    return j(200, { ok: true });
  });
  await new Promise((res) => api.listen(0, '127.0.0.1', res));

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbretpc-'));
  const kit = path.join(home, 'kit'); fs.mkdirSync(kit);
  fs.readdirSync(KIT).filter((n) => /\.(js|html)$/.test(n)).forEach((n) => fs.copyFileSync(path.join(KIT, n), path.join(kit, n)));
  const cfgFile = path.join(home, 'connector.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ api: 'http://127.0.0.1:' + api.address().port, key: KEY, till: { id: 'C1' } }, null, 2));
  let out = '';
  const proc = spawn(process.execPath, [path.join(kit, 'till.js'), '--config', cfgFile, '--port', String(PORT)], { cwd: kit, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
  const state = () => fetch('http://127.0.0.1:' + PORT + '/api/state').then((x) => x.json()).catch(() => null);
  for (let i = 0; i < 100 && !(await state()); i++) await sleep(150);

  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto('http://127.0.0.1:' + PORT + '/');
    await p.waitForFunction(() => typeof AgentHost !== 'undefined' && S && S.shop && S.shop.name === 'Shop X', null, { timeout: 60000 });
    say('the shop PC has returns and expenses now', await p.evaluate(() => typeof HOST.creditNote === 'function' && typeof HOST.expense === 'function' && retCanIssue() && expCanIssue()), 'creditNote + expense on AgentHost');

    /* somebody on the counter — through the one sign-in */
    await SI.signIn(p, 'xclerk'); await SI.signedIn(p);        /* the one window (CBSignin, #68) — e2e/lib/signin.cjs */
    await p.evaluate(() => usignClose());

    /* a sale, online */
    await p.fill('#q', 'XMANGO');
    await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
    await p.click('[data-testid="till-add-0"]');
    await p.click('[data-testid="till-pay-cash"]');
    await p.fill('#tendered', '100');
    await p.click('#save');
    await p.waitForSelector('#sliptitle', { timeout: 20000 });
    const saleNo = (await p.textContent('#sliptitle')).replace(/^.*?(C1\/\S+).*$/, '$1');
    await p.click('#slipdlg button:has-text("Close")').catch(() => {});
    await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
    for (let i = 0; i < 40 && !sent.some((c) => c.purpose !== 'credit_note' && c.purpose !== 'expense'); i++) await sleep(250);
    const saleChit = sent.filter((c) => c.client_ref === saleNo)[0] || sent[0] || {};
    const saleTotal = Number((saleChit.line_items || []).reduce((a, l) => a + Number(l.total || 0), 0).toFixed(2));
    console.log('    (sale lines: ' + JSON.stringify((saleChit.line_items || []).map((l) => [l.particulars, l.quantity, l.price, l.total])) + ')');
    say('the sale reached ChitBridge', sent.length >= 1, 'bill ' + saleNo + ' · ' + saleTotal);

    console.log('\n── ⭐⭐⭐ THE LINE GOES: a return and an expense on the shop PC ' + '─'.repeat(0));
    dead.on = true;
    await p.evaluate(() => openBills());
    const retBtn = p.locator('[data-testid^="till-bill-return-"]').first();
    await retBtn.waitFor({ timeout: 15000 });
    await retBtn.click();
    await p.click('[data-testid="till-ret-all"]');
    await p.click('[data-testid="till-return-go"]');
    await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
    await p.click('#askok');
    await p.waitForFunction(() => /Credit note/.test(document.getElementById('sliptitle').textContent || ''), null, { timeout: 20000 });
    const cnNo = (await p.textContent('#sliptitle')).replace(/^Credit note\s*/, '').trim();
    await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
    say('the return was ISSUED on the shop PC, with the line down', /^CN\/C1\//.test(cnNo), 'credit note ' + cnNo);

    await p.evaluate(() => expOpen());
    await p.fill('#expamt', '20');
    await p.fill('#expwhat', 'Delivery boy');
    await p.click('[data-testid="till-expense-go"]');
    await p.waitForSelector('#askdlg[open]', { timeout: 10000 });        /* "Record ₹20 paid for Delivery boy?" */
    await p.click('#askok');
    await p.waitForSelector('[data-testid="till-expense-done"]', { timeout: 15000 });
    await p.evaluate(() => { try { document.getElementById('expdlg').close(); } catch (_) {} });
    const st1 = await state();
    await p.screenshot({ path: path.join(SHOTS, '1-offline.png') });
    say('both are WAITING on the program\'s queue, not lost', st1.queued >= 2, 'queued=' + st1.queued);
    say('the day nets them: sold − returned (all of it) − 20 paid out', st1.today && Math.abs(st1.today.total - (-20)) < 0.01 && Math.abs(st1.today.returns - saleTotal) < 0.01,
      JSON.stringify(st1.today));

    console.log('\n── ⭐⭐ THE LINE COMES BACK ' + '─'.repeat(0));
    dead.on = false;
    await fetch('http://127.0.0.1:' + PORT + '/api/send', { method: 'POST' }).catch(() => {});
    for (let i = 0; i < 40 && !(sent.some((c) => c.purpose === 'credit_note') && sent.some((c) => c.purpose === 'expense')); i++) await sleep(250);
    const cn = sent.filter((c) => c.purpose === 'credit_note')[0], ex = sent.filter((c) => c.purpose === 'expense')[0];
    say('the credit note arrived with ITS number', !!cn && cn.client_ref === cnNo, cn ? cn.client_ref : 'not sent');
    say('built by the same builder, marked as from the shop PC', !!cn && cn.business_json.till.host === 'agent' && cn.business_json.refund.total === saleTotal
      && cn.business_json.against && cn.business_json.against.bill_no === saleNo, cn ? JSON.stringify({ host: cn.business_json.till.host, refund: cn.business_json.refund.total, against: cn.business_json.against && cn.business_json.against.bill_no }) : '—');
    say('the expense arrived in its OWN series', !!ex && /^EXP\/C1\//.test(ex.client_ref), ex ? ex.client_ref : 'not sent');

    /* M16: the program wrote its own health down as it CHANGED — waiting during the outage, clear after it */
    await sleep(500);
    const hs = await state();
    const hlog = hs.health_log || [];
    const wentBad = hlog.findIndex((h) => h.waiting), cameBack = hlog.findIndex((h, i) => i > wentBad && !h.waiting);
    say('⭐ the program RECORDED the outage and the recovery, with times', wentBad >= 0 && cameBack > wentBad,
      hlog.map((h) => h.at.slice(11, 19) + (h.waiting ? ' waiting ' + h.queued : ' clear')).join(' → '));
    say('and /api/state reports its health now — clear, with no stale reason', hs.health && hs.health.queued === 0 && !hs.health.fatal && !hs.health.why, JSON.stringify(hs.health));
    const hfile = fs.readdirSync(path.join(home, 'till-data')).map((h) => path.join(home, 'till-data', h, 'CB-X', 'health.jsonl')).filter((x) => fs.existsSync(x))[0];
    say('in the shop\'s own folder, where a morning check can read it', !!hfile && fs.readFileSync(hfile, 'utf8').trim().split('\n').length === hlog.length, hfile ? path.basename(path.dirname(hfile)) + '/health.jsonl' : 'missing');

    console.log('\n── ⚠️ THE SALES SERIES IS UNTOUCHED ' + '─'.repeat(0));
    await p.fill('#q', 'XMANGO');
    await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
    await p.click('[data-testid="till-add-0"]');
    await p.click('[data-testid="till-pay-cash"]');
    await p.fill('#tendered', '100');
    await p.click('#save');
    await p.waitForFunction((prev) => { const t = document.getElementById('sliptitle').textContent || ''; return /C1\//.test(t) && t.indexOf(prev) < 0; }, saleNo, { timeout: 20000 });
    const sale2 = (await p.textContent('#sliptitle')).replace(/^.*?(C1\/\S+).*$/, '$1');
    const n1 = Number(saleNo.split('/').pop()), n2 = Number(sale2.split('/').pop());
    say('the next sale follows the last one — no hole for the CN or EXP', n2 === n1 + 1, saleNo + ' → ' + sale2);

    /* M11: the program lists the bills it holds for the last N days — what a return after midnight reads, offline */
    const held = await p.evaluate(() => HOST.local(30));
    say('the program lists what it holds over days (a return after midnight reads this)', held.some((x) => x.no === saleNo) && held.some((x) => x.no === cnNo),
      held.length + ' held: ' + held.map((x) => x.no).join(', '));
    const forged = await fetch('http://127.0.0.1:' + PORT + '/api/record', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: { kind: 'credit_note', no: 'CN/C1/26-27/9999' }, chitBody: { client_ref: 'CN/C1/26-27/9999' } }) }).then((x) => x.json());
    say('⚠️ a record with a number the program never issued is refused', forged.ok === false, forged.message || '');
  } finally {
    console.log('\nconsole/page errors:', errs.length ? errs.join(' | ').slice(0, 300) : 'none');
    try { proc.kill(); } catch (_) {}
    await b.close(); api.close();
  }
  say('no page errors', errs.length === 0, errs.length + ' error(s)');
  if (bad) console.log('\n── program log (tail) ──\n' + out.split('\n').slice(-20).join('\n'));
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
