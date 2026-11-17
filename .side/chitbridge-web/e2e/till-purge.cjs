/* till-purge.cjs — THE 90-DAY FLOOR, ON THE REAL PROGRAM ([TILL-123])
 *
 * Athi: *"after a certain days, we don't need to refer the daily chit data"* → *"do the purge with a floor of
 * 90 days."*
 *
 * ── ⚠️⚠️⚠️ THIS IS THE ONLY THING THE COUNTER DOES THAT DESTROYS A RECORD OF MONEY TAKEN ─────────────────────
 *
 * tests/rollup.test.js proves the DECISION — fifteen cases against the pure planner. This proves the ACT: that
 * the file actually goes, that the summary behind it actually stays, and above all that the four refusals hold
 * when the inputs are real files on a real disk rather than a stub function.
 *
 * A wrong answer here is not a failed test, it is a shop's sales gone. So the harness checks both directions on
 * every condition: that the day which SHOULD go does, and that each day which should NOT go is still there
 * afterwards, with the counter saying why.
 *
 * Run: node e2e/till-purge.cjs   · no browser, no DB, no network
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

/** ⚠️ `dead:true` makes every send fail, so a harness can create the "not synced" state honestly */
function chitbridge(state) {
  const got = [];
  const srv = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const j = (code, o) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    const u = q.url.split('?')[0];
    if (state.dead) return j(503, { message: 'stub is refusing on purpose' });
    if (u === '/api/chits/send') { got.push(JSON.parse(raw || '{}')); return j(200, { chit_id: 'c' + got.length }); }
    if (u === '/api/till/snapshot') return j(200, { at: new Date().toISOString(), shop: { country: 'IN', name: 'Anbu' }, items: [] });
    if (u.startsWith('/api/till/engine/')) { r.writeHead(200, { 'content-type': 'application/javascript' }); return r.end('/* stub */'); }
    return j(200, { ok: true });
  });
  return { srv, got };
}

async function counter(home, port) {
  const p = spawn(process.execPath, [path.join(KIT, 'till.js'), '--config', path.join(home, 'connector.json'), '--port', String(port)],
    { cwd: KIT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/api/state'); if (r.ok) return { p, log: () => out }; } catch (_) {}
    await sleep(150);
  }
  throw new Error('the counter never answered\n' + out);
}
const stop = (c) => new Promise((r) => { if (!c || c.p.exitCode !== null) return r(); c.p.once('exit', r); c.p.kill(); });
const get = (port, p) => fetch('http://127.0.0.1:' + port + p).then((r) => r.json());

const ago = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const sale = (no, total, d) => ({ no, total, at: d + 'T10:00:00Z', payments: [{ how: 'Cash', amount: total }] });

(async () => {
  const state = { dead: false };
  const cb = chitbridge(state);
  await new Promise((r) => cb.srv.listen(0, '127.0.0.1', r));
  const port = cb.srv.address().port;
  const api = 'http://127.0.0.1:' + port;
  const key = token({ identity_id: 'e1', bridge_id: 'CB-PURGE', display_name: 'Anbu', kind: 'api_key', scopes: ['till'] });

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbpurge-'));
  fs.writeFileSync(path.join(home, 'connector.json'), JSON.stringify({ api, key, till: { id: 'C1', name: 'Counter 1' } }, null, 2));
  const dir = path.join(home, 'till-data', '127.0.0.1-' + port, 'CB-PURGE');
  fs.mkdirSync(dir, { recursive: true });

  /**
   * ⚠️ FOUR AGES, chosen to sit either side of the boundary: well past it, just past it, exactly ON it (which
   * must be treated as INSIDE), and comfortably inside.
   */
  const OLD = ago(200), OLDER = ago(120), EDGE = ago(90), NEW = ago(10);
  for (const d of [OLD, OLDER, EDGE, NEW]) {
    fs.writeFileSync(path.join(dir, 'bills-' + d + '.jsonl'), JSON.stringify(sale('B-' + d, 100, d)) + '\n');
  }
  /**
   * ⚠️⚠️ shifts.jsonl APPENDED FOR EVER AND NO PURGE TOUCHED IT ([TILL-174]). Small, so never noticed — but a
   * counter that bounds its bills and quietly keeps one file for ever has a rule with an exception in it, and
   * the exception is what is still growing on the oldest machine in the shop.
   */
  fs.writeFileSync(path.join(dir, 'shifts.jsonl'),
    [{ till: 'C1', from: OLD + 'T09:00:00Z', to: OLD + 'T18:00:00Z', by: { name: 'old' } },
     { till: 'C1', from: NEW + 'T09:00:00Z', to: NEW + 'T18:00:00Z', by: { name: 'new' } },
     /* ⚠️ unparseable is not the same as old — this line must survive */
     { till: 'C1', by: { name: 'undated' } }]
      .map((x) => JSON.stringify(x)).join('\n') + '\n');

  const bills = (d) => fs.existsSync(path.join(dir, 'bills-' + d + '.jsonl'));
  const sum = (p, k) => fs.existsSync(path.join(dir, 'summary', p + '-' + k + '.json'));

  console.log('\n── the floor, on real files ' + '─'.repeat(40));
  let c = await counter(home, 7331);
  await sleep(1400);                                  /* rollup, drain, then the sweep on the next boot */
  /* the first boot summarises and sends; a day can only go on a LATER pass, which is the design */
  await stop(c); c = await counter(home, 7331);
  await sleep(1200);

  say('the oldest went', !bills(OLD), OLD + ' (200 days) is gone');
  say('the older went', !bills(OLDER), OLDER + ' (120 days) is gone');
  /* ⚠️ the boundary: exactly 90 days old is still INSIDE the floor */
  say('THE EDGE STAYED', bills(EDGE), EDGE + ' (exactly 90 days) is kept — the floor is inclusive');
  say('the recent stayed', bills(NEW), NEW + ' (10 days) is kept');

  /**
   * ⚠️⚠️ THE POINT OF THE WHOLE EXERCISE. The detail goes; the FIGURES do not. If this ever fails, the shop has
   * lost the day entirely rather than compacted it.
   */
  say('THE SUMMARY SURVIVED', sum('day', OLD) && sum('day', OLDER),
    'the day summaries of both purged days are still there');
  const kept = JSON.parse(fs.readFileSync(path.join(dir, 'summary', 'day-' + OLD + '.json'), 'utf8'));
  say('and still has its figures', kept.totals && kept.totals.total === 100 && !!kept.synced_at,
    'total ' + kept.totals.total + ', synced');

  /* ⭐ and the shift lines go with the days they describe — one floor, no exceptions ([TILL-174]) */
  const shifts = fs.readFileSync(path.join(dir, 'shifts.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const names = shifts.map((x) => x.by && x.by.name);
  say('THE OLD SHIFT WENT', names.indexOf('old') < 0, 'the 200-day shift line was trimmed');
  say('the recent shift stayed', names.indexOf('new') >= 0, 'the 10-day line is kept');
  /* ⚠️ a line whose date cannot be read is KEPT — unparseable is not old */
  say('and an undated line is kept', names.indexOf('undated') >= 0,
    'a line we cannot date is never dropped for being old');

  console.log('\n── the dry run says what it would do ' + '─'.repeat(30));
  const plan = await get(7331, '/api/purge');
  say('the floor is 90', plan.floor_days === 90, 'GET /api/purge reports a 90-day floor, cutoff ' + plan.cutoff);
  say('nothing left to take', plan.would_remove.length === 0, 'it would remove nothing more right now');
  say('and says why it keeps', plan.keeping.every((k) => k.day && k.why),
    'every kept day carries a reason (' + plan.keeping.length + ' days)');
  say('the state states it', (await get(7331, '/api/state')).keep_days === 90,
    'the counter reports keep_days so nobody reads a config file to find out');
  await stop(c);

  /**
   * ── ⚠️⚠️⚠️ THE REFUSALS, WITH REAL FILES ──────────────────────────────────────────────────────────────────
   *
   * A counter whose summaries never reached ChitBridge must delete NOTHING, however old the bills are — this
   * disk is then the shop's only copy. The stub refuses every send to produce that state honestly, rather than
   * the harness writing a `synced_at: null` by hand.
   */
  console.log('\n── ⚠️⚠️ nothing synced → nothing deleted ' + '─'.repeat(26));
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cbpurge2-'));
  fs.writeFileSync(path.join(home2, 'connector.json'), JSON.stringify({ api, key, till: { id: 'C2' } }, null, 2));
  const dir2 = path.join(home2, 'till-data', '127.0.0.1-' + port, 'CB-PURGE');
  fs.mkdirSync(dir2, { recursive: true });
  for (const d of [OLD, OLDER]) {
    fs.writeFileSync(path.join(dir2, 'bills-' + d + '.jsonl'), JSON.stringify(sale('X-' + d, 50, d)) + '\n');
  }
  state.dead = true;                                  /* the line is up but ChitBridge refuses everything */
  let c2 = await counter(home2, 7332);
  await sleep(1200); await stop(c2); c2 = await counter(home2, 7332); await sleep(1200);

  const still = fs.existsSync(path.join(dir2, 'bills-' + OLD + '.jsonl'))
             && fs.existsSync(path.join(dir2, 'bills-' + OLDER + '.jsonl'));
  say('NOTHING WAS DELETED', still, 'both 200- and 120-day files survive when nothing reached ChitBridge');
  const p2 = await get(7332, '/api/purge');
  say('and it says why', p2.would_remove.length === 0 && p2.keeping.some((k) => /reached ChitBridge/.test(k.why)),
    'the plan names the unsynced summary as the reason');
  await stop(c2);

  /**
   * ⚠️⚠️ AND THE WORST ONE: a bill of that day still waiting to be sent. Summaries all synced, the day is
   * ancient — and it must still stay, because ChitBridge has never seen that sale.
   */
  console.log('\n── ⚠️⚠️ an unsent bill holds its whole day ' + '─'.repeat(23));
  state.dead = false;
  const home3 = fs.mkdtempSync(path.join(os.tmpdir(), 'cbpurge3-'));
  fs.writeFileSync(path.join(home3, 'connector.json'), JSON.stringify({ api, key, till: { id: 'C3' } }, null, 2));
  const dir3 = path.join(home3, 'till-data', '127.0.0.1-' + port, 'CB-PURGE');
  fs.mkdirSync(dir3, { recursive: true });
  for (const d of [OLD, OLDER]) {
    fs.writeFileSync(path.join(dir3, 'bills-' + d + '.jsonl'), JSON.stringify(sale('Y-' + d, 70, d)) + '\n');
  }
  let c3 = await counter(home3, 7333);
  await sleep(1200);
  await stop(c3);
  /* ⚠️ a sale from OLD that never reached ChitBridge, left in the queue exactly as an outage would leave it */
  fs.writeFileSync(path.join(dir3, 'queue.jsonl'), JSON.stringify(sale('STUCK', 999, OLD)) + '\n');
  state.dead = true;                                  /* so the drain cannot quietly send it and clear the state */
  c3 = await counter(home3, 7333);
  await sleep(1200);

  say('ITS DAY IS HELD', fs.existsSync(path.join(dir3, 'bills-' + OLD + '.jsonl')),
    OLD + ' is kept because one of its bills is still queued');
  const p3 = await get(7333, '/api/purge');
  say('and it says so', p3.keeping.some((k) => k.day === OLD && /waiting to be sent/.test(k.why)),
    'the plan names the unsent bill');
  /* ⚠️ and only THAT day is held — the hold must be per-day, not a blanket stop */
  say('the other day is not held', !p3.keeping.some((k) => k.day === OLDER && /waiting to be sent/.test(k.why)),
    OLDER + ' is not blocked by another day’s unsent bill');

  await stop(c3); await new Promise((r) => cb.srv.close(r));
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n✗ harness itself broke:\n' + (e && e.stack || e)); process.exit(1); });
