/* till-pair.cjs — A COUNTER SIGNS IN, GETS A KEY, AND KEEPS ITS SHOP APART FROM EVERY OTHER ([TILL-120], [TILL-121])
 *
 * ── ⭐⭐⭐ WHAT ATHI ASKED FOR, IN HIS OWN WORDS ──────────────────────────────────────────────────────────────
 *
 * *"this is the blank engine. it is not connected to any shop, nothing, we should be able to login to a shop
 * using this desktop app?"*
 *
 * *"what is the difference between counter app and to the main engine? if we tie each app with the user id then
 * they should be able to login using the same user id / password combination / OTP?"*
 *
 * *"can you create a separate directory for the counter app and for each shop there can be a folder in the name
 * of entity id or bridge id, in that way we can distinguish, this cannot be mixed?"*
 *
 * *"each should sit separately in the system irrespective of the sandbox environment, you may be doing in the
 * test, i would have created shop in live"*
 *
 * ── ⚠️⚠️ WHY THIS RUNS THE REAL PROGRAM ─────────────────────────────────────────────────────────────────────
 *
 * Every other counter harness serves till.html from a static server. The sign-in and the per-shop folder do NOT
 * live in the page — they live in till.js, the program on the shop's PC: it is what writes connector.json and
 * what chooses the folder at boot. So this harness spawns the actual `node till.js`, twice, and then LOOKS AT
 * THE DISK. Reading the source would only prove the source says so. [[feedback-check-after-the-wire]]
 *
 * ⚠️ NO DATABASE AND NO LIVE SERVER. ChitBridge is stubbed here, which is also the point: the counter's own
 * behaviour is what is under test, and creating entities on the live database to test a folder name would be a
 * poor trade. The stub answers exactly the three routes the sign-in uses, in the shapes routes/entities.js and
 * routes/till.js actually return (checked against them, not invented).
 *
 * Run: node e2e/till-pair.cjs        · no browser, no DB, no network
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const KIT = path.join(__dirname, '..', '..', 'chitbridge-api', 'tools', 'tally-connector');
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(34) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** a token shaped the way routes/keys.js:88 mints one — the counter reads bridge_id straight out of it */
function token(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(payload) + '.stub';
}

/**
 * ⚠️ THE STUB ANSWERS WHAT THE REAL ROUTES ANSWER. register → { dev_otp } (routes/entities.js, gated by
 * lib/dev-otp.mayExposeOtp); verify → { token }; /api/till/enrol → { key, shop } (routes/till.js). If any of
 * those shapes change, this harness should break — that is the value of pinning them here.
 */
function chitbridge(shop) {
  let enrolled = 0;
  const srv = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const j = (code, o) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    const u = q.url.split('?')[0];
    if (u === '/api/entities/register') return j(200, { message: 'Verification code sent to your email', dev_otp: '123456' });
    if (u === '/api/entities/verify') {
      const b = JSON.parse(raw || '{}');
      if (b.otp !== '123456') return j(400, { error: 'Verification failed', message: 'Wrong code' });
      return j(200, { message: 'Verified successfully', token: token({ identity_id: shop.entity_id, bridge_id: shop.bridge_id }) });
    }
    if (u === '/api/till/enrol') {
      if (!String(q.headers.authorization || '').startsWith('Bearer ')) return j(403, { message: 'Sign in to connect a counter.' });
      enrolled++;
      return j(200, { key: token({ identity_id: shop.entity_id, bridge_id: shop.bridge_id, display_name: shop.name, kind: 'api_key', scopes: ['till'], exp: Math.floor(Date.now() / 1000) + 86400 }),
                      shop: { entity_id: shop.entity_id, bridge_id: shop.bridge_id, name: shop.name } });
    }
    if (u === '/api/till/snapshot') return j(200, { at: new Date().toISOString(), entity_id: shop.entity_id,
      shop: { country: 'IN', name: shop.name }, items: [{ item_id: 'x1', name: 'Tomato', code: 'V1', unit: 'kg', price: 40 }] });
    if (u.startsWith('/api/till/engine/')) { r.writeHead(200, { 'content-type': 'application/javascript' }); return r.end('/* stub engine */'); }
    if (u === '/api/integrations/heartbeat') return j(200, { ok: true });
    return j(404, { message: 'no' });
  });
  return { srv, enrolled: () => enrolled };
}

async function listen(srv) { await new Promise((r) => srv.listen(0, '127.0.0.1', r)); return srv.address().port; }

/** start the real till.js against a home directory, and wait until it answers */
async function counter(home, port) {
  const p = spawn(process.execPath, [path.join(KIT, 'till.js'), '--config', path.join(home, 'connector.json'), '--port', String(port)],
    { cwd: KIT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/api/state'); if (r.ok) return { p, log: () => out }; } catch (_) {}
    await sleep(150);
  }
  throw new Error('the counter never answered on ' + port + '\n' + out);
}
const stop = (c) => new Promise((r) => { if (!c || c.p.killed || c.p.exitCode !== null) return r(); c.p.once('exit', r); c.p.kill(); });
const post = (port, p, b) => fetch('http://127.0.0.1:' + port + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const state = (port) => fetch('http://127.0.0.1:' + port + '/api/state').then((r) => r.json());

/** one whole setup: a blank kit, signed in, restarted — returns where it put things */
async function setUp(label, shop, freePort) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbtill-'));
  const cb = chitbridge(shop);
  const apiPort = await listen(cb.srv);
  const api = 'http://127.0.0.1:' + apiPort;
  fs.writeFileSync(path.join(home, 'connector.json'), JSON.stringify({ api, till: { id: 'C1', name: 'Counter 1' } }, null, 2));

  /* ── the blank counter, before anybody signs in ── */
  let c = await counter(home, freePort);
  const before = await state(freePort);
  say(label + ' · blank', before.paired === false, 'says it is NOT paired before sign-in');
  say(label + ' · blank folder', String(before.folder || '').endsWith('_unpaired'),
    'writes to _unpaired until it knows the shop (' + before.folder + ')');

  /* ── sign in, exactly as the screen does ── */
  const s1 = await post(freePort, '/api/signin/start', { email: 'shop@example.com' });
  say(label + ' · code', s1.ok === true && s1.dev_otp === '123456', 'asks ChitBridge for a code and passes the test OTP back');

  const badTry = await post(freePort, '/api/signin/finish', { email: 'shop@example.com', otp: '999999' });
  say(label + ' · wrong code', badTry.ok === false, 'a wrong code is refused, in words: "' + String(badTry.message).slice(0, 40) + '"');

  const s2 = await post(freePort, '/api/signin/finish', { email: 'shop@example.com', otp: '123456' });
  say(label + ' · connected', s2.ok === true && s2.shop && s2.shop.bridge_id === shop.bridge_id,
    'signs in and names the shop back: ' + (s2.shop && s2.shop.name));

  /* ⚠️ THE KEY MUST BE ON THE DISK, not merely in the reply — that is the whole difference from a session */
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'connector.json'), 'utf8'));
  say(label + ' · key saved', typeof cfg.key === 'string' && cfg.key.length > 20, 'the counter key is written into connector.json');
  say(label + ' · config kept', cfg.api === api && cfg.till && cfg.till.id === 'C1',
    'and the rest of connector.json survived the write (merge, not rewrite)');

  /* it exits itself so its folder is re-chosen; bring it back the way counter.cmd would */
  await stop(c);
  c = await counter(home, freePort);
  const after = await state(freePort);
  say(label + ' · paired', after.paired === true, 'after the restart it reports itself paired');
  say(label + ' · knows the shop', after.shop && after.shop.bridge_id === shop.bridge_id && after.shop.name === shop.name,
    'and names the shop offline, off the key: ' + (after.shop && after.shop.name));

  const dir = path.join(home, 'till-data', '127.0.0.1-' + apiPort, shop.bridge_id);
  say(label + ' · folder', fs.existsSync(dir), 'its folder is named after the shop: till-data/127.0.0.1-' + apiPort + '/' + shop.bridge_id);

  return { home, api, apiPort, dir, c, cb, shop };
}

(async () => {
  console.log('\n── a blank counter signs in to a shop ' + '─'.repeat(30));
  const A = await setUp('shop A', { entity_id: 'ent-aaa', bridge_id: 'CB-AAAAA', name: 'Anbu Vegetables' }, 7311);

  console.log('\n── a second shop, on the same PC ' + '─'.repeat(35));
  const B = await setUp('shop B', { entity_id: 'ent-bbb', bridge_id: 'CB-BBBBB', name: 'Kumar Hotel' }, 7312);

  console.log('\n── ⚠️⚠️ they must not be mixed ' + '─'.repeat(41));
  say('two shops', A.dir !== B.dir, 'the two shops sit in different folders');

  /**
   * ⚠️⚠️ THE ONE THAT WOULD HAVE COST MONEY. Before [TILL-120] both shops shared till-data/, so the second
   * shop opened the first one's snapshot, bill series and UNSENT QUEUE — and would have posted the first
   * shop's sales under the second shop's key.
   */
  fs.writeFileSync(path.join(A.dir, 'queue.jsonl'), JSON.stringify({ no: 'A-1', total: 500 }) + '\n');
  await stop(B.c); B.c = await counter(B.home, 7312);
  const bs = await state(7312);
  say('no leakage', Number(bs.queued) === 0,
    "shop B's queue is empty although shop A has an unsent bill waiting (" + bs.queued + ')');

  const aq = fs.readFileSync(path.join(A.dir, 'queue.jsonl'), 'utf8');
  say('nothing lost', aq.indexOf('A-1') >= 0, "and shop A's unsent bill is still exactly where it was");

  console.log('\n── ⚠️ test and live are two worlds ' + '─'.repeat(36));
  /**
   * Athi: *"you may be doing in the test, i would have created shop in live."* The SAME shop, reached through
   * two different servers, must not share a tree — a test bill in the live takings is silent and expensive.
   */
  const same = { entity_id: 'ent-aaa', bridge_id: 'CB-AAAAA', name: 'Anbu Vegetables' };
  const C = await setUp('same shop, 2nd server', same, 7313);
  say('test vs live', C.dir !== A.dir, 'the same shop on a second server keeps a separate tree');
  say('both readable', /CB-AAAAA$/.test(A.dir) && /CB-AAAAA$/.test(C.dir),
    'and both are still named after the shop, under their own server');

  console.log('\n── ⚠️⚠️ upgrading a counter that is already billing ' + '─'.repeat(22));
  /**
   * ⚠️⚠️ THE PATH THAT TOUCHES REAL MONEY, and the reason it is tested. Every kit installed before
   * [TILL-120] has its snapshot, its bill series and its UNSENT QUEUE in a flat `till-data/`. Ship the per-shop
   * folder without moving them and those sales are still on the disk, still unsent, and now in a folder nothing
   * reads — money that silently stops existing. This is Athi's own PC on the morning after an update.
   */
  const shopD = { entity_id: 'ent-ddd', bridge_id: 'CB-DDDDD', name: 'Old Install' };
  const homeD = fs.mkdtempSync(path.join(os.tmpdir(), 'cbtill-old-'));
  const cbD = chitbridge(shopD);
  const apiD = 'http://127.0.0.1:' + (await listen(cbD.srv));
  const keyD = token({ identity_id: shopD.entity_id, bridge_id: shopD.bridge_id, display_name: shopD.name, kind: 'api_key', scopes: ['till'] });
  fs.writeFileSync(path.join(homeD, 'connector.json'), JSON.stringify({ api: apiD, key: keyD, till: { id: 'C1' } }, null, 2));

  /* the old flat layout, exactly as a billing counter leaves it */
  const flat = path.join(homeD, 'till-data');
  fs.mkdirSync(flat, { recursive: true });
  fs.writeFileSync(path.join(flat, 'queue.jsonl'), JSON.stringify({ no: 'D-7', total: 1250 }) + '\n' + JSON.stringify({ no: 'D-8', total: 90 }) + '\n');
  fs.writeFileSync(path.join(flat, 'series.json'), JSON.stringify({ C1: 8 }));
  /**
   * ⚠️⚠️ TODAY, NOT A FIXED DATE. This said 2026-09-19 and passed until the clock rolled over — once that day
   * was CLOSED the rollup summarised it and queued a summary chit, so `queued` became 3 and the upgrade
   * assertion failed for a reason that had nothing to do with upgrading. The same date trap that caught
   * till-summary.cjs on the day it was written. A day still being billed is never summarised, so using TODAY
   * keeps this test about the thing it is actually testing.
   */
  const dayNow = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(flat, 'bills-' + dayNow + '.jsonl'), JSON.stringify({ no: 'D-6', total: 300 }) + '\n');

  const D = await counter(homeD, 7314);
  const ds = await state(7314);
  const dDir = path.join(flat, '127.0.0.1-' + new URL(apiD).port, shopD.bridge_id);
  say('upgrade · folder', fs.existsSync(dDir), 'the shop folder is created under the server: ' + shopD.bridge_id);
  say('upgrade · QUEUE CARRIED', Number(ds.queued) === 2,
    'the two unsent bills came across and are still unsent (' + ds.queued + ' queued)');
  say('upgrade · series carried', fs.existsSync(path.join(dDir, 'series.json')),
    'the bill series came too — numbering does not restart');
  say('upgrade · the day carried', fs.existsSync(path.join(dDir, 'bills-' + dayNow + '.jsonl')),
    "and so did the day's bills");
  say('upgrade · nothing left behind', fs.readdirSync(flat).filter((n) => fs.statSync(path.join(flat, n)).isFile()).length === 0,
    'no loose file is stranded in the old flat folder');

  /**
   * ⚠️ AND IT HAPPENS ONCE. A second boot must not move anything again, and must not lose what is there.
   */
  await stop(D.p ? D : D); const D2 = await counter(homeD, 7314);
  const ds2 = await state(7314);
  say('upgrade · idempotent', Number(ds2.queued) === 2, 'a second boot changes nothing (' + ds2.queued + ' queued)');
  await stop(D2); await new Promise((r) => cbD.srv.close(r));

  for (const x of [A, B, C]) { await stop(x.c); await new Promise((r) => x.cb.srv.close(r)); }

  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n✗ harness itself broke:\n' + (e && e.stack || e)); process.exit(1); });
