/* till-summary.cjs — THE DAY, WEEK AND MONTH CHITS, ON THE REAL PROGRAM ([TILL-122])
 *
 * ── ⭐⭐⭐ ATHI'S BRIEF, 2026-09-19 ───────────────────────────────────────────────────────────────────────────
 *
 * *"in our counter app, we have today's sale / bill, it should go in there, the same format as in the server.
 * here anything synced can be set as a status as synced. at some intervals, that has to be summarised. assuming
 * we are summarising once per day, we have to set the status that summarised as part of some indicator,
 * possibly that day's summary chit. we have to have other folder called summary, so we keep one chit for every
 * day as a summary chit. each week summarise day chit to week chit. summarise, summarise month chit, so we will
 * have 365 chit per year … after a certain days, we don't need to refer the daily chit data. so, this can be
 * kept in local and also in server. this includes any returns and so on."*
 *
 * ── ⚠️⚠️ WHAT THIS PROVES THAT tests/rollup.test.js CANNOT ───────────────────────────────────────────────────
 *
 * rollup.test.js proves the ARITHMETIC. This proves the PROGRAM: that the files land in summary/, that a closed
 * day is summarised and an open one is not, that the week waits for all its days, that the chit actually
 * reaches ChitBridge and the local copy is only then stamped synced — and that running it twice changes
 * nothing. Those are the parts a unit test cannot see. [[feedback-check-after-the-wire]]
 *
 * Run: node e2e/till-summary.cjs   · no browser, no DB, no network
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const KIT = path.join(__dirname, '..', '..', 'chitbridge-api', 'tools', 'tally-connector');
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(30) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function token(p) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(p) + '.stub';
}

/** the stub records every chit it is sent, so the harness can look at what actually crossed the wire */
function chitbridge() {
  const got = [];
  const srv = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const j = (code, o) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    const u = q.url.split('?')[0];
    if (u === '/api/chits/send') { const b = JSON.parse(raw || '{}'); got.push(b); return j(200, { chit_id: 'chit-' + got.length }); }
    if (u === '/api/till/snapshot') return j(200, { at: new Date().toISOString(), shop: { country: 'IN', name: 'Anbu Vegetables' }, items: [] });
    if (u.startsWith('/api/till/engine/')) { r.writeHead(200, { 'content-type': 'application/javascript' }); return r.end('/* stub */'); }
    return j(200, { ok: true });
  });
  return { srv, got };
}

async function counter(home, port) {
  const p = spawn(process.execPath, [path.join(KIT, 'till.js'), '--config', path.join(home, 'connector.json'), '--port', String(port)],
    { cwd: KIT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/api/state'); if (r.ok) return { p, log: () => out }; } catch (_) {}
    await sleep(150);
  }
  throw new Error('the counter never answered\n' + out);
}
const stop = (c) => new Promise((r) => { if (!c || c.p.exitCode !== null) return r(); c.p.once('exit', r); c.p.kill(); });
const get = (port, p) => fetch('http://127.0.0.1:' + port + p).then((r) => r.json());
const post = (port, p) => fetch('http://127.0.0.1:' + port + p, { method: 'POST' }).then((r) => r.json());

const sale = (no, total, at, how) => ({ no, total, at, payments: [{ how: how || 'Cash', amount: total }] });
const back = (no, amount, at) => ({ no, kind: 'credit_note', total: -amount, at, refunds: [{ how: 'Cash', amount }] });

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbsum-'));
  const cb = chitbridge();
  await new Promise((r) => cb.srv.listen(0, '127.0.0.1', r));
  const api = 'http://127.0.0.1:' + cb.srv.address().port;
  const key = token({ identity_id: 'ent-1', bridge_id: 'CB-SUMMY', display_name: 'Anbu Vegetables', kind: 'api_key', scopes: ['till'] });
  fs.writeFileSync(path.join(home, 'connector.json'), JSON.stringify({ api, key, till: { id: 'C1', name: 'Counter 1' } }, null, 2));

  /**
   * ⚠️⚠️ THE WEEK IS COMPUTED FROM TODAY, NOT WRITTEN DOWN. The first version of this harness hard-coded
   * 2026-09-14…20 and failed on the day it was written — because 2026-09-20 was that week's Sunday, so the week
   * was still OPEN and the counter correctly refused to summarise it. The code was right and the test data was
   * wrong, which is the good way round. Anchored to the LAST FULLY CLOSED ISO week, it stays true every day.
   */
  const dir = path.join(home, 'till-data', '127.0.0.1-' + cb.srv.address().port, 'CB-SUMMY');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7) - 7);   /* Monday of LAST week — wholly past */
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10);
  });
  const RETURN_DAY = week[2];
  const WEEKKEY = (() => {
    const t = new Date(week[0] + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 3);
    const ft = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    ft.setUTCDate(ft.getUTCDate() - ((ft.getUTCDay() + 6) % 7) + 3);
    const w = 1 + Math.round((t - ft) / (7 * 864e5));
    return t.getUTCFullYear() + '-W' + (w < 10 ? '0' : '') + w;
  })();
  week.forEach((d, i) => {
    const rows = [sale('B-' + i + 'a', 100 + i, d + 'T10:00:00Z'), sale('B-' + i + 'b', 50, d + 'T12:00:00Z', 'UPI')];
    /* ⚠️ Athi: "this includes any returns and so on" — one day carries a credit note */
    if (d === RETURN_DAY) rows.push(back('CN-1', 30, d + 'T15:00:00Z'));
    fs.writeFileSync(path.join(dir, 'bills-' + d + '.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  });
  /* and TODAY, which must NOT be summarised */
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dir, 'bills-' + today + '.jsonl'), JSON.stringify(sale('B-TODAY', 999, today + 'T09:00:00Z')) + '\n');

  console.log('\n── the folder ' + '─'.repeat(52));
  const c = await counter(home, 7321);
  await sleep(900);                                     /* the boot rollup, then a drain tick */

  const sdir = path.join(dir, 'summary');
  say('summary folder', fs.existsSync(sdir), 'summary/ exists beside the bills');
  const files = fs.readdirSync(sdir);
  say('one chit per day', week.every((d) => files.includes('day-' + d + '.json')),
    'all seven closed days were summarised (' + files.filter((f) => /^day-/.test(f)).length + ' day files)');

  /**
   * ⚠️⚠️ THE ONE THAT MATTERS MOST. A summary of today would change after it was published, and once the bills
   * behind it are purged nobody could correct it.
   */
  say('TODAY IS NOT SUMMARISED', !files.includes('day-' + today + '.json'),
    'the day still being billed has no summary yet');

  console.log('\n── the arithmetic, on the real files ' + '─'.repeat(29));
  const d16 = JSON.parse(fs.readFileSync(path.join(sdir, 'day-' + RETURN_DAY + '.json'), 'utf8'));
  say('a return is not a sale', d16.totals.count === 2 && d16.totals.returns === 1,
    'the day with a credit note counts 2 sales and 1 return');
  say('a refund leaves the drawer', d16.totals.by.Cash === 102 - 30 + 0 || d16.totals.by.Cash === 72,
    'cash = 102 sold − 30 handed back = ' + d16.totals.by.Cash);
  say('the totals split', d16.totals.gross === 152 && d16.totals.refunds === 30 && d16.totals.total === 122,
    'gross 152, refunds 30, kept 122');

  console.log('\n── week and month, folded ' + '─'.repeat(40));
  const wk = JSON.parse(fs.readFileSync(path.join(sdir, 'week-' + WEEKKEY + '.json'), 'utf8'));
  say('the week', !!wk, 'the week chit exists: ' + WEEKKEY);
  say('folded from its days', Array.isArray(wk.source) && wk.source.length === 7,
    'and it names the seven days it was folded from');
  const byHand = week.reduce((a, d) => a + JSON.parse(fs.readFileSync(path.join(sdir, 'day-' + d + '.json'), 'utf8')).totals.total, 0);
  say('the week equals its days', Math.round(wk.totals.total * 100) === Math.round(byHand * 100),
    'week total ' + wk.totals.total + ' = the seven day totals added up');

  console.log('\n── ⚠️ it reaches ChitBridge, and only THEN says so ' + '─'.repeat(15));
  const sums = cb.got.filter((x) => x.business_json && x.business_json.summary);
  say('sent as chits', sums.length >= 8, sums.length + ' summary chits crossed the wire (7 days + 1 week at least)');
  say('the right shape', sums.every((x) => x.purpose === 'general' && Array.isArray(x.line_items) && !x.line_items.length),
    "every one is purpose 'general' with no line items — a summary must not double the books");
  say('a stable reference', sums.some((x) => x.client_ref === 'SUM/D/C1/' + RETURN_DAY),
    'the day chit carries SUM/D/C1/' + RETURN_DAY + ', so re-sending cannot duplicate it');

  const d16b = JSON.parse(fs.readFileSync(path.join(sdir, 'day-' + RETURN_DAY + '.json'), 'utf8'));
  say('stamped synced', !!d16b.synced_at && !!d16b.chit_ref,
    'the local copy is stamped only after the server answered (' + String(d16b.synced_at).slice(11, 19) + ')');

  console.log('\n── what the counter says about itself ' + '─'.repeat(28));
  const st = await get(7321, '/api/state');
  say('state reports it', st.summary && st.summary.day === 7 && st.summary.week === 1,
    'state: ' + st.summary.day + ' days, ' + st.summary.week + ' week(s), ' + st.summary.unsent + ' unsent');
  say("today's figures", st.today && st.today.count === 1 && st.today.total === 999,
    "and today's own takings are still live, not summarised");

  const tr = await get(7321, '/api/summary?period=day&limit=5');
  say('the trend, offline', Array.isArray(tr.rows) && tr.rows.length === 5 && tr.rows[0].key === week[6],
    'GET /api/summary reads the folder, newest first — no server needed');
  say('today is flagged open', tr.today && tr.today.open === true && tr.today.key === today,
    'and today is returned separately, marked open');

  console.log('\n── ⚠️ running it again changes nothing ' + '─'.repeat(27));
  const before = fs.readFileSync(path.join(sdir, 'day-' + RETURN_DAY + '.json'), 'utf8');
  const again = await post(7321, '/api/summarise');
  say('idempotent', again.ok && again.made.length === 0, 'a second pass summarises nothing new');
  say('nothing rewritten', fs.readFileSync(path.join(sdir, 'day-' + RETURN_DAY + '.json'), 'utf8') === before,
    'and does not touch a summary already written');

  /**
   * ── ⚠️⚠️ A WEEK STILL RUNNING IS NEVER WRITTEN ───────────────────────────────────────────────────────────
   *
   * ⚠️ AN EARLIER VERSION OF THIS ASSERTED THE WRONG THING — that a week with only five of its seven days must
   * wait. It must not, and the code was right to fold it: a shop closed on Saturday and Sunday leaves five day
   * files, and there is no way to tell that from two files being "missing". Nothing distinguishes them, and a
   * week that waited for seven would never be written for any shop with a day off.
   *
   * ⭐ WHAT ACTUALLY MAKES IT SAFE IS THE CLOSE, NOT THE COUNT. Once the week is over no new bill can be filed
   * into it — the counter only ever appends to TODAY's file — so folding whatever days exist is final and
   * correct. The real guard is therefore that an OPEN period is never summarised, which is what this checks.
   */
  console.log('\n── ⚠️ a week still running is never written ' + '─'.repeat(21));
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'cbsum2-'));
  fs.writeFileSync(path.join(fresh, 'connector.json'), JSON.stringify({ api, key, till: { id: 'C2' } }, null, 2));
  const fdir = path.join(fresh, 'till-data', '127.0.0.1-' + cb.srv.address().port, 'CB-SUMMY');
  fs.mkdirSync(fdir, { recursive: true });
  /**
   * ⚠️⚠️ THE MONDAY TRAP, AND IT ONLY FIRES ONE DAY IN SEVEN. This used to write "yesterday and today" and
   * call them "both inside the CURRENT week". On a Monday, yesterday is SUNDAY — the last day of the previous
   * ISO week — so the counter correctly closes that week and writes a week chit, and the assertion below
   * failed. The product was right and the fixture was wrong; it took until 2026-09-21 for a run to land on a
   * Monday and say so.
   *
   * ⭐ SO THE DAYS ARE DERIVED FROM THE WEEK, not from the clock: every fixture day is inside the current ISO
   * week by construction. On a Monday that is today alone, which is the honest shape of "this week so far".
   */
  /* ⚠️ UTC, like every date string here AND like till.js (today() = toISOString): getDay() is LOCAL, and between
     00:00 and 05:30 IST it named Tuesday while the dates still said Monday — "yesterday" became last Sunday, the
     counter rightly closed that week, and THE WEEK WAITS went red (2026-09-29, 00:40 IST). */
  const dow = (new Date().getUTCDay() + 6) % 7;           /* 0 = Monday, ISO — on the same clock as the dates */
  const days = [];
  for (let back = Math.min(dow, 1); back >= 1; back--) {
    days.push(new Date(Date.now() - back * 864e5).toISOString().slice(0, 10));
  }
  const yest = days[0] || null;                            /* null on a Monday: there is no earlier day this week */
  days.push(today);
  for (const d of days) {
    fs.writeFileSync(path.join(fdir, 'bills-' + d + '.jsonl'), JSON.stringify(sale('X', 10, d + 'T10:00:00Z')) + '\n');
  }
  const c2 = await counter(fresh, 7322);
  await sleep(700);
  const ff = fs.readdirSync(path.join(fdir, 'summary'));
  /* ⚠️ on a Monday there is no earlier day in this week, so there is nothing to assert about one */
  if (yest) say('yesterday is closed', ff.includes('day-' + yest + '.json'), 'yesterday is summarised');
  else console.log('  (Monday: no earlier day inside this week — nothing to close)');
  say('today is not', !ff.includes('day-' + today + '.json'), 'today is not');
  say('THE WEEK WAITS', !ff.some((f) => /^week-/.test(f)),
    'and no week chit is written at all, because this week is not over');

  /**
   * ⚠️ AND A CLOSED WEEK WITH A DAY OFF *IS* FOLDED — the other half of the same rule, stated so nobody
   * "fixes" it back into waiting for seven.
   */
  const shut = fs.mkdtempSync(path.join(os.tmpdir(), 'cbsum3-'));
  fs.writeFileSync(path.join(shut, 'connector.json'), JSON.stringify({ api, key, till: { id: 'C3' } }, null, 2));
  const gdir = path.join(shut, 'till-data', '127.0.0.1-' + cb.srv.address().port, 'CB-SUMMY');
  fs.mkdirSync(gdir, { recursive: true });
  week.slice(0, 5).forEach((d) => fs.writeFileSync(path.join(gdir, 'bills-' + d + '.jsonl'), JSON.stringify(sale('X', 10, d + 'T10:00:00Z')) + '\n'));
  const c3 = await counter(shut, 7323);
  await sleep(700);
  const gf = fs.readdirSync(path.join(gdir, 'summary'));
  say('a shop with a day off', gf.includes('week-' + WEEKKEY + '.json'),
    'a CLOSED week is folded from the five days the shop actually traded');
  const gw = JSON.parse(fs.readFileSync(path.join(gdir, 'summary', 'week-' + WEEKKEY + '.json'), 'utf8'));
  say('and it says which', gw.source.length === 5, 'and records exactly which five: ' + gw.source.length + ' days');
  await stop(c3);

  await stop(c); await stop(c2); await new Promise((r) => cb.srv.close(r));
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n✗ harness itself broke:\n' + (e && e.stack || e)); process.exit(1); });
