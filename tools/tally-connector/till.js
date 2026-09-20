#!/usr/bin/env node
/**
 * till.js — THE COUNTER (TILL-SPEC-2026-09-07).
 *
 * Athi, 2026-09-07: *"someone runs a store without a computer… why can't we develop a desktop application — you download it, we still
 * run everything in the cloud, but the minimum sits on the desktop so the billing works faster."*
 *
 * ── WHAT IT IS ────────────────────────────────────────────────────────────────────────────────────────────────
 * The connector kit with a screen. It runs on the shop PC beside the same connector.json, holds a COPY of the shop (items, prices,
 * offers, tax slabs, customers), serves one page at http://127.0.0.1:7071, and bills against that copy — so a sale costs nothing on
 * the network and works with the line down. Every bill is queued and sent afterwards as an ordinary chit, which is what makes the
 * shop's suppliers, books and reconciliation work without a second system.
 *
 * ── THE FOUR RULES IT KEEPS ───────────────────────────────────────────────────────────────────────────────────
 *  1 · A BILL IS NEVER LOST. It is written to disk before anything else happens, and the queue is a file, not memory.
 *  2 · A BILL IS NEVER SENT TWICE. Its number rides as `client_ref`; the server answers a repeat with the first chit.
 *  3 · A NUMBER IS NEVER REUSED. series.json is written before the bill is, and the financial year is part of the number.
 *  4 · IT NEVER BLOCKS A SALE. No network, no snapshot, no printer — the sale still records, and catches up later.
 *
 * ── WHAT IT IS NOT ────────────────────────────────────────────────────────────────────────────────────────────
 * Not stock control, not returns (version 2), not accounts. A till feature that puts nothing on the rail belongs to the shop's ERP.
 *
 * Run:  node till.js --config connector.json [--port 7071]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
/**
 * ⭐⭐ A STAGED UPDATE IS APPLIED AT THE START, NEVER WHILE A SHOP IS BILLING (2026-09-08).
 * The refresh downloads a newer till.js or core.js as <name>.new and stops there. This is the only place they are swapped in, before
 * a single line of the program has run, and the process restarts itself so no half-old, half-new pair can ever be loaded together.
 * ⚠️ A file that does not PARSE is never swapped in — a shop would be left with a counter that cannot start, which is worse than a
 * counter that is a week old. The version being replaced is kept as <name>.bak.
 * ⚠️ CB_TILL_UPDATED marks the child, so a swap can happen once per start and never loop.
 */
(function applyStagedUpdate() {
  if (process.env.CB_TILL_UPDATED) return;
  const here = __dirname;
  const names = ['till.js', 'core.js', 'printer.js'].filter((n) => fs.existsSync(path.join(here, n + '.new')));
  if (!names.length) return;
  const vm = require('vm');
  for (const n of names) {
    try { new vm.Script(fs.readFileSync(path.join(here, n + '.new'), 'utf8'), { filename: n }); }
    catch (e) {
      console.log('the newer ' + n + ' does not run (' + e.message + ') — the counter kept the version it has');
      for (const x of names) { try { fs.unlinkSync(path.join(here, x + '.new')); } catch (_) {} }
      return;
    }
  }
  for (const n of names) {
    try { fs.copyFileSync(path.join(here, n), path.join(here, n + '.bak')); } catch (_) {}
    fs.renameSync(path.join(here, n + '.new'), path.join(here, n));
  }
  console.log('the counter program was updated (' + names.join(', ') + ') — starting the new one');
  const r = require('child_process').spawnSync(process.execPath, [path.join(here, 'till.js')].concat(process.argv.slice(2)),
    { stdio: 'inherit', env: Object.assign({}, process.env, { CB_TILL_UPDATED: '1' }) });
  process.exit(typeof r.status === 'number' ? r.status : 0);
})();

const core = require('./core');
const printer = require('./printer');
/**
 * ⭐⭐ ONE ROLLUP RULE FOR THE COUNTER AND THE SERVER ([TILL-122]). Byte-equal to lib/rollup.js, held so by
 * scripts/vendor-till.cjs — Athi: *"this can be kept in local and also in server."* Requiring it means the
 * day's figures are computed with the line down, which is when a shop closes its till.
 */
const rollup = require('./rollup');   /* the slip, on paper — raw ESC/POS through the Windows spooler */

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const log = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);

const cfgFile = path.resolve(flag('config', 'connector.json'));
/**
 * ⚠️⚠️⚠️ KEYLESS, BECAUSE A COUNTER WITH NO KEY MUST STILL OPEN ([TILL-121]). This threw until
 * 2026-09-19: an unpaired PC could not start the counter at all, so the sign-in screen the counter serves was
 * unreachable and the only way to get a key was to already have one. A program that cannot start cannot tell
 * anybody why — the same argument counter.cmd makes about opening the page before the key is checked.
 */
const cfg = core.loadConfig(cfgFile, { keyless: true });
/**
 * ⚠️ `keepDays` IS THE PURGE FLOOR ([TILL-123]). Athi: *"do the purge with a floor of 90 days."* It is
 * configuration rather than a constant because a shop's own rule may be longer — never shorter in practice,
 * since lib/rollup refuses a floor of zero or less and falls back to 90.
 */
const tillCfg = Object.assign({ port: 7071, id: 'C1', name: 'Counter 1', refreshMinutes: 15, drainSeconds: 20, keepDays: 90 }, cfg.till || {});
const PORT = Number(flag('port', tillCfg.port)) || 7071;
/**
 * ── ⭐⭐⭐ ONE FOLDER PER SHOP ([TILL-120]) ──────────────────────────────────────────────────────────────
 *
 * Athi: *"for each shop there can be a folder in the name of entity id or bridge id, in that way we can
 * distinguish, this cannot be mixed?"*
 *
 * ⚠️⚠️ THEY COULD BE MIXED. This was ONE `till-data/` beside connector.json, for whatever key was in it.
 * Re-point the kit at a second shop and that shop opened the FIRST one's snapshot, bill series and day's
 * bills — and its unsent queue, which would then have been posted under the new shop's key. The browser half
 * has been namespaced by key since [ISO-01]; the desktop half, which is the one holding the money, was not.
 *
 * ⭐ THE NAME COMES OFF THE KEY, NOT OFF THE NETWORK. A minted key is a JWT and routes/keys.js:88 puts
 * `bridge_id` in its payload, so the folder can be named at boot, offline, before a single call — which is
 * the only timing that works on a counter that may not see the internet for a day.
 * ⚠️ READING IS NOT TRUSTING. The payload is read as a LABEL to pick a folder by. Nothing is authorised on
 * the strength of it; the server verifies the signature on every call, as it always did.
 */
/**
 * ⭐ ONE READER FOR WHAT THE KEY SAYS ABOUT ITSELF. The folder name and the shop the page displays come from
 * the same parse, so they can never disagree — and both work with the line down.
 * ⚠️ READING IS NOT TRUSTING: this is a LABEL. Nothing is authorised on it; the server checks the signature
 * on every call, as it always did.
 */
function keyShop(key) {
  if (!key) return null;
  try {
    const mid = String(key).split('.')[1];
    const pay = JSON.parse(Buffer.from(mid.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return { bridge_id: pay.bridge_id || null, entity_id: pay.identity_id || null,
             name: pay.display_name || null, scopes: Array.isArray(pay.scopes) ? pay.scopes : [],
             expires_at: pay.exp ? new Date(pay.exp * 1000).toISOString() : null };
  } catch (_) { return null; }
}
function shopFolder(key) {
  if (!key) return '_unpaired';   /* a counter with no key still boots, and still has somewhere to write */
  {
    const pay = keyShop(key);
    const id = pay && (pay.bridge_id || pay.entity_id);
    /* ⚠️ A FOLDER NAME IS NOT FREE TEXT. Whatever the payload says, only these characters reach the disk. */
    const safe = String(id || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
    if (safe) return safe;
  }   /* not a JWT, or not ours — fall through to the hash, which still separates shops */
  /* ⚠️ STILL SEPARATE, JUST NOT READABLE. djb2 of the key, same shape the page uses — a name, never a secret. */
  let h = 5381;
  for (let i = 0; i < String(key).length; i++) h = (((h * 33) ^ String(key).charCodeAt(i)) >>> 0);
  return 'key-' + h.toString(36);
}
/**
 * ⭐⭐⭐ WHICH SERVER, AS PART OF THE ADDRESS ([TILL-120]). Athi: *"each should sit separately in the system
 * irrespective of the sandbox environment — you may be doing in the test, i would have created shop in live."*
 * ⚠️⚠️ THE SHOP ID ALONE IS NOT ENOUGH: the same shop tried on test and then created on live carries the
 * same name, and a test bill in the live day's takings — or a live bill posted into a sandbox that discards it
 * — is silent either way. Two servers are two worlds. The host is the one thing that always tells them apart.
 */
function serverFolder(api) {
  let h = String(api || 'no-server');
  try { h = new URL(h).host; } catch (_) { /* not a URL — use it as written, sanitised below */ }
  const safe = h.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return safe || 'no-server';
}
const SHOP_DIR = path.join(serverFolder(cfg.api), shopFolder(cfg.key));
const DIR = path.join(path.dirname(cfgFile), 'till-data', SHOP_DIR);
/**
 * ⭐ EVERY ENGINE THE COUNTER PAGE LOADS, in its order (till.html <script src="/engine/…">). The program fetches each from
 * GET /api/till/engine/:name and serves it at /engine/<name>.js; tests/till-vendor.test.js holds the three lists equal.
 * ⚠️ It was four of thirteen until 2026-09-17 — on a shop PC money, the bill-number rules, pricing and the QR were absent.
 */
/* ⭐ 'variant' joined on 2026-09-19: one product, many combinations, and what makes two of them the same
   thing to sell. A shop PC bills combinations with the line down, so it keeps the rule locally too.
   ⚠️ THE ORDER MATCHES THE PAGE'S SCRIPT TAGS, and the guard checks that — load order is load-bearing here. */
const ENGINE_NAMES = ['qr', 'money', 'docnumber', 'locale', 'pricing', 'offers', 'tax', 'search', 'variant', 'gs1', 'lots', 'nums', 'units', 'profilemap', 'jurisdiction', 'govcontext', 'rollup', 'verdict', 'rewards', 'screen'];
const ENGINE_RE = new RegExp('^/engine/(' + ENGINE_NAMES.join('|') + ')\\.js$');
const F = {
  snapshot: path.join(DIR, 'snapshot.json'),
  series: path.join(DIR, 'series.json'),
  queue: path.join(DIR, 'queue.jsonl'),
  bills: (day) => path.join(DIR, 'bills-' + day + '.jsonl'),
  docs: (day) => path.join(DIR, 'docs-' + day + '.jsonl'),      /* receipts and despatch notes — the other two doors of a shop */
  engine: (n) => path.join(DIR, 'engine-' + n + '.js'),
  /**
   * ⭐⭐⭐ THE SUMMARY FOLDER ([TILL-122]). Athi: *"we have to have other folder called summary, so we keep
   * one chit for every day as a summary chit."* 365 day files a year, 52 or 53 week files, 12 month files — and
   * the daily BILLS can eventually go, because the summary is folded from them and proven equal
   * (tests/rollup.test.js). This folder is the shop's long record; bills-*.jsonl is its working detail.
   */
  summary: (period, key) => path.join(DIR, 'summary', period + '-' + key + '.json'),
  summaryDir: () => path.join(DIR, 'summary'),
};
const NEW_SHOP_DIR = !fs.existsSync(DIR);
for (const d of [DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
/* ⭐ summary/ is created up front, so an empty one reads as "nothing summarised yet" rather than as a fault */
if (!fs.existsSync(path.join(DIR, 'summary'))) fs.mkdirSync(path.join(DIR, 'summary'), { recursive: true });
/**
 * ⚠️⚠️ THE UPGRADE MUST NOT STRAND A DAY'S TAKINGS ([TILL-120]). An install that has been billing has its
 * queue — sales taken and NOT YET SENT — in the old flat `till-data/`. Ship the per-shop folder without moving
 * them and those sales are still on the disk, still unsent, and now in a folder nothing reads: money that
 * silently stops existing. So the first boot after the upgrade MOVES the flat layout into this shop's folder.
 *
 * ⚠️ ONCE, AND ONLY INTO AN EMPTY FOLDER. If this shop's folder already exists it has its own history and the
 * flat files are some OTHER shop's — the exact mixing this change exists to stop. Then they are left alone and
 * said out loud, because a folder of another shop's bills is a thing a person must decide about, not a thing a
 * program should quietly delete. [[feedback-question-is-not-an-instruction]]
 */
const flatDir = path.join(path.dirname(cfgFile), 'till-data');
try {
  /* ⚠️ isFile() IS LOAD-BEARING: till-data/ now holds one DIRECTORY per server, and those are not strays. */
  const strays = fs.existsSync(flatDir)
    ? fs.readdirSync(flatDir).filter((n) => fs.statSync(path.join(flatDir, n)).isFile())
    : [];
  if (strays.length && NEW_SHOP_DIR) {
    for (const n of strays) fs.renameSync(path.join(flatDir, n), path.join(DIR, n));
    log('moved ' + strays.length + ' file(s) from till-data/ into till-data/' + SHOP_DIR + '/ — one folder per shop from now on');
  } else if (strays.length) {
    log('NOTE: till-data/ still holds ' + strays.length + ' loose file(s) from an earlier install, and this shop (' + SHOP_DIR
      + ') already has its own folder. They have been LEFT ALONE — they may belong to a different shop. Nothing reads them.');
  }
} catch (e) { log('could not tidy the old till-data folder: ' + e.message + ' — billing is unaffected'); }

/* what the last refresh found about the kit itself — the page tells the person at the counter, in their words */
const UPDATE = { version: null, page_at: null, program_ready: false };

/**
 * ⚠️ AN UNPAIRED COUNTER SAYS SO ON THE CONSOLE TOO. The page will say it, but whoever is setting the PC up
 * is looking at this window — and a boot that looks entirely normal, then sells nothing, is the confusing one.
 */
if (!cfg.key) log('not connected to a shop yet — open http://127.0.0.1:' + PORT + ' and sign in to connect this counter');
const cb = new core.CB({ api: cfg.api, key: cfg.key, log });
cb.name = tillCfg.name || 'Till';

/* ── files, kept simple and crash-safe ─────────────────────────────────────────────────────────────────────── */
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } };
/** write through a temp file: a power cut mid-write leaves the OLD file, never half a new one */
function writeJSON(f, obj) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2)); fs.renameSync(t, f); }
const appendLine = (f, obj) => fs.appendFileSync(f, JSON.stringify(obj) + '\n');
const readLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) { return []; } };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * ⭐ THE NUMBER. India's GST wants a series that is continuous within a financial year and unique to the shop; a till that is offline
 * cannot ask anyone, so the series is LOCAL and the counter's id is part of it: C1/26-27/0041. Two tills never collide, and a number is
 * written to disk BEFORE the bill it belongs to, so a crash costs a gap of one rather than a duplicate.
 */
function fyOf(d) {
  const y = d.getFullYear(), apr = d.getMonth() >= 3;      /* the Indian financial year starts on 1 April */
  const a = apr ? y : y - 1;
  return String(a).slice(2) + '-' + String(a + 1).slice(2);
}
function nextNumberOf(kind){
  /* ⚠️ ONE SERIES PER KIND. A goods receipt in the middle of the sales run puts a hole in the very thing a gapless series proves. */
  const tag = (kind === 'GRN' || kind === 'DC') ? kind : '';
  const file = tag ? path.join(DIR, 'series-' + tag + '.json') : F.series;
  const fy = fyOf(new Date());
  const s = readJSON(file, { prefix: tillCfg.id, fy, next: 1 });
  if (s.fy !== fy) { s.fy = fy; s.next = 1; }
  s.prefix = tillCfg.id || s.prefix;
  const n = s.next; s.next = n + 1;
  writeJSON(file, s);
  return (tag ? tag + '/' : '') + s.prefix + '/' + fy + '/' + String(n).padStart(4, '0');
}
function nextNumber() {
  const fy = fyOf(new Date());
  const s = readJSON(F.series, null) || { prefix: tillCfg.id || 'C1', fy: fy, next: 1 };
  if (s.fy !== fy) { s.fy = fy; s.next = 1; }              /* a new year starts at 1, as the law expects */
  const n = s.next;
  s.next = n + 1;
  writeJSON(F.series, s);
  return (s.prefix || 'C1') + '/' + fy + '/' + String(n).padStart(4, '0');
}

/* ── the copy of the shop ──────────────────────────────────────────────────────────────────────────────────── */
let snapshot = readJSON(F.snapshot, null);
let online = false;
/* ⚠️ said ONCE per spell of failure — a wrong key would otherwise fill the log every drain */
let QUEUE_SAID = false;
/**
 * ⭐⭐ THE LAST REASON THE QUEUE COULD NOT GO ([TILL-132]) — kept, not just logged, so GET /api/state can hand
 * it to the screen. A count on its own reads as patience; a count with a reason reads as a thing to do.
 */
let QUEUE_WHY = null;

/**
 * ── ⭐⭐⭐ WHY A CALL DID NOT WORK, AND WHETHER THE LINE IS THE REASON ([TILL-117]) ──────────────
 *
 * A counter said *"offline (… 403 This key is not scoped…)"* and a person went looking at their network. The
 * server had answered in a fifth of a second to say the key was the wrong kind.
 *
 * ⚠️ THE TEST IS WHETHER AN ANSWER CAME BACK. `e.status` means the server replied — so the line is UP, and
 * the counter must not mark itself offline, because that is what makes the pill, the page and the queue all
 * behave as though there were no network.
 * ⚠⚠ AND A 401/403 NEVER FIXES ITSELF. Retrying a wrong key for ever is the silent version of this bug, so
 * it is named with the thing to do, not merely reported.
 */
function whyNot(e) {
  const msg = (e && e.message) || 'it did not work';
  const st = e && e.status;
  if (st === 401 || st === 403) {
    /**
     * ⚠️⚠️⚠️ A 401 IS NOT ONE THING, AND GUESSING COSTS A DAY ([TILL-131]). This used to answer "wrong
     * scope, mint a till key" to every refusal — including COUNTER_CLOSED, where the scope is perfectly
     * correct and minting another key fixes nothing. Ten bills sat unsent behind that advice.
     * ⭐ THE SERVER ALREADY SAID THE TRUE THING. core.js attaches the parsed body; use its words.
     */
    const code = (e && e.body && e.body.code) || null;
    const said = (e && e.body && e.body.message) || null;
    if (code === 'COUNTER_CLOSED') {
      return { online: true, fatal: true,
        say: said || 'this counter was closed in ChitBridge. Open it again from ChitBridge › Counters, '
           + 'then sign this counter in — nothing is lost, the bills wait in this shop\'s folder.' };
    }
    /* ⚠️ enrolment, and anything else the server chose to name, is relayed rather than re-guessed */
    if (said && !/not scoped/i.test(said)) return { online: true, fatal: true, say: said };
    return { online: true, fatal: true,
      say: 'this key is not allowed to read the shop (' + st + '). Mint a key with scope "till" in ChitBridge › '
         + 'Settings › Integrations › Keys, put it in the config, and start the counter again. '
         + 'The connector\'s own key will not do — they are different scopes.' };
  }
  if (st >= 400 && st < 500) return { online: true, fatal: false, say: 'ChitBridge refused it — ' + msg };
  if (st >= 500) return { online: true, fatal: false, say: 'ChitBridge is having trouble — ' + msg + '. Billing continues from the copy on disk.' };
  if (e && e.timeout) return { online: false, fatal: false, say: 'no answer in time — ' + msg + '. Billing continues from the copy on disk.' };
  /* ⚠️ nothing came back at all: this is the only case that is really offline */
  return { online: false, fatal: false, say: 'offline (' + msg + ') — billing continues from the copy on disk' };
}

async function refresh() {
  try {
    /* ⭐ only what changed since we last looked (2026-09-08) — a 10,000-item shop must not travel every fifteen minutes */
    const since = (snapshot && snapshot.at) ? '?since=' + encodeURIComponent(snapshot.at) : '';
    const snap = await cb.call('GET', '/api/till/snapshot' + since);
    if (snap && snap.shop) {
      if (snap.delta && snapshot && Array.isArray(snapshot.items)) {
        const byId = new Map(snapshot.items.map((i) => [i.item_id, i]));
        for (const id of (snap.removed || [])) byId.delete(id);      /* off the shelf, off the counter */
        for (const i of (snap.items || [])) byId.set(i.item_id, i);
        const touched = (snap.items || []).length + (snap.removed || []).length;
        snap.items = [...byId.values()];
        if (touched) log('the shop changed: ' + (snap.items || []).length + ' items now (' + touched + ' touched)');
      }
      const changed = !snapshot || snapshot.version !== snap.version;
      snapshot = snap; writeJSON(F.snapshot, snap);
      online = true;
      if (changed && !snap.delta) log('the shop was re-read: ' + (snap.items || []).length + ' items, ' + (snap.offers || []).length + ' offer(s), version ' + snap.version);
    }
    /* the engines, cached beside the snapshot — the till prices with the same code the server does.
       ⚠️ CB.call parses JSON and hands back { raw } when the body is not JSON, which is exactly what a .js file is. */
    /* ⚠️ EVERY engine the page loads (ENGINE_NAMES) — it was four of thirteen until 2026-09-17 */
    for (const [name, file] of ENGINE_NAMES.map((n) => [n, F.engine(n)])) {
      try { const r = await cb.call('GET', '/api/till/engine/' + name); const js = (r && typeof r.raw === 'string') ? r.raw : '';
        if (js.length > 500) fs.writeFileSync(file, js); }
      catch (_) { /* keep the copy we have — an engine we already hold is what makes the counter work offline */ }
    }
    /* ⭐ and the kit itself: the page is written now (nothing is running it), the program waits for the next start */
    try {
      const up = await core.kitUpdate({ cb, dir: __dirname, log, live: ['till.html'], staged: ['till.js', 'core.js', 'printer.js'] });
      if (up) {
        UPDATE.version = up.version;
        if (up.updated.length) { UPDATE.page_at = new Date().toISOString(); log('the counter screen was updated — reload the page in the browser (F5) when you are between customers'); }
        if (up.staged.length) { UPDATE.program_ready = true; log('a newer counter program is ready — it starts being used the next time this PC starts the counter'); }
      }
    } catch (_) { /* an update is never worth a sale */ }
    return true;
  } catch (e) {
    /* ⚠️ THE SERVER ANSWERING IS NOT AN OUTAGE — see whyNot(). A 403 arriving proves the line is up. */
    const w = whyNot(e);
    online = w.online;
    log(w.say);
    return false;
  }
}

/* ── the queue: every bill leaves exactly once ─────────────────────────────────────────────────────────────── */
/**
 * ── ⚠️⚠️ THE FLAG THAT WEDGED THE QUEUE ────────────────────────────────────────────────────────────────────────
 *
 * `draining` was cleared after the loop, and `cb.call` had no deadline. A stalled connection left the await
 * pending for ever, so the loop never ended, so the flag was never cleared — and this agent never sent another
 * bill until it was restarted. Silently: nothing threw, nothing was logged, it was simply still waiting.
 *
 * ⭐ Two changes, and both are needed. The deadline in core.js means the ordinary stall now ends in a throw the
 * catch below already handles. The `finally` and the watchdog mean that whatever a deadline cannot cover — a
 * bug in here, an await that resolves never for some other reason — costs one cycle rather than the day's takings.
 */
let draining = false, drainAt = 0;
async function drain() {
  if (draining) {
    /* ⚠️ it cannot still be running: every call inside has a 2-minute deadline. A flag outliving that is stuck. */
    if (drainAt && (Date.now() - drainAt) > 300000) { log('queue: the previous send never finished — starting again'); }
    else return;
  }
  draining = true; drainAt = Date.now();
  try {
    const rows = readLines(F.queue);
    if (!rows.length) return;
    const left = [];
    for (const bill of rows) {
      try {
        /**
         * ⭐ THREE KINDS RIDE ONE QUEUE (2026-09-08): a bill, a receipt or despatch note, and the MOVEMENT rows that belong to an
         * order. Each row says which it is — nothing here guesses, because a wrong guess would post a goods receipt as a sale.
         * ⚠️ A movement goes to b144's deliver-lines, which writes into EVERY party's copy. That is the shared half of the claim;
         * the chit above is our own record of it. Either half may wait for the line without the other.
         */
        /**
         * ⭐⭐ A FOURTH KIND ON THE ONE QUEUE ([TILL-122]): the day, week and month summaries. Same send, same
         * retry, same backoff as a bill — and on success the LOCAL copy is stamped, which is what turns
         * "summarised" into "summarised and safely at ChitBridge" for whoever reads the folder.
         * ⚠️ THE STAMP IS WRITTEN ONLY AFTER THE SERVER ANSWERED. A record that claims to have arrived when it
         * has not is the exact failure this rollup exists to make visible. [[feedback-check-after-the-wire]]
         */
        if (bill.summary) {
          const rs = await cb.call('POST', '/api/chits/send', rollup.chitOf(bill.summary));
          const cur = readSummary(bill.summary.period, bill.summary.key) || bill.summary;
          cur.synced_at = new Date().toISOString();
          cur.chit_ref = (rs && (rs.chit_id || (rs.chit && rs.chit.chit_id))) || cur.chit_ref || null;
          writeSummary(cur);
          log('summary ' + bill.no + ' → ' + (rs && rs.duplicate ? 'already recorded' : 'recorded'));
          online = true;
          continue;
        }
        if (bill.doc) {
          const r0 = await cb.call('POST', '/api/chits/send', chitOfDoc(bill.doc));
          log((bill.doc.kind === 'receipt' ? 'receipt ' : 'despatch ') + bill.no + ' → ' + (r0 && r0.duplicate ? 'already recorded' : 'recorded'));
          const moves = movesOfDoc(bill.doc);
          if (moves) {
            try { await cb.call('POST', '/api/chits/' + moves.chit_id + '/deliver-lines', { rows: moves.rows });
                  log('  and ' + moves.rows.length + ' line(s) recorded against the order'); }
            catch (e2) { log('  the order could not be updated yet (' + e2.message + ') — the document is safe, this retries'); throw e2; }
          }
          online = true;
          continue;
        }
        const r = await cb.call('POST', '/api/chits/send', chitOf(bill));
        const id = r && (r.chit_id || (r.chit && r.chit.chit_id));
        log('bill ' + bill.no + ' → ' + (r && r.duplicate ? 'already recorded' : 'recorded') + (id ? ' (' + String(id).slice(0, 8) + ')' : ''));
        /**
         * ⭐⭐ THE POINTS RIDE THE SAME QUEUE AS THE BILL THEY CAME FROM (2026-09-10). A counter that was offline
         * when it sold has already told the customer what they earned; this is what makes that true afterwards.
         * ⚠️ ONE QUEUE, NOT TWO — the bill and its points cannot end up on different sides of an outage, and the
         * server's unique index on (entity, ref, why, holder) means posting again after a successful counter post
         * is a no-op rather than a second award.
         * ⚠️ AND IT NEVER HOLDS THE BILL BACK. The sale is recorded above; if the points post fails, that is a line
         * in the log, not a bill sent round again — sending it again would be safe but pointless, and the shop
         * would learn nothing from a queue that never empties.
         */
        if (bill.reward && bill.reward.holder) {
          try {
            const rw = await cb.call('POST', '/api/till/reward', {
              ref: bill.no, holder: bill.reward.holder, spend: bill.reward.spend || 0,
              net: bill.total, gross: (bill.total || 0) + (bill.saved || 0),
              count: (bill.lines || []).length,
              lines: (bill.lines || []).map((l) => ({ item_id: l.item_id, qty: l.qty, net: l.net, category: l.category })),
            });
            if (rw && (rw.added || rw.spent)) log('  points ' + (rw.added ? '+' + rw.added : '') + (rw.spent ? ' −' + rw.spent : '')
              + ' → ' + rw.points + ' held');
          } catch (e3) { log('  the points for ' + bill.no + ' are not recorded yet (' + e3.message + ')'); }
        }
        online = true;
        QUEUE_SAID = false; QUEUE_WHY = null;   /* ⭐ it worked — say it again if it stops working */
      } catch (e) {
        /**
         * ⚠️⚠️ A REFUSED BILL IS NOT A DEAD LINE. Marking the counter offline on a 403 told the shopkeeper
         * their internet was down while their bills piled up behind a credential nobody had mentioned.
         * ⚠⚠ AND A WRONG KEY NEVER COMES RIGHT BY WAITING, so it is said out loud once rather than retried in
         * silence for ever. The bill is still kept — nothing is ever dropped.
         */
        const w = whyNot(e);
        online = w.online;
        /* ⭐ remembered for the SCREEN, and logged once for whoever is reading the window */
        QUEUE_WHY = { say: w.say, fatal: !!w.fatal, online: !!w.online,
                      code: (e && e.body && e.body.code) || null, at: new Date().toISOString() };
        if (w.fatal && !QUEUE_SAID) { QUEUE_SAID = true; log('the queue cannot be sent: ' + w.say); }
        left.push(bill);                                    /* keep it; the next tick tries again */
      }
    }
    fs.writeFileSync(F.queue, left.map((b) => JSON.stringify(b)).join('\n') + (left.length ? '\n' : ''));
  } catch (e) { log('queue: ' + e.message); }
  /* ⚠️ FINALLY, NOT AFTER. The old placement was reachable only if nothing above threw past its own catch —
     which is exactly the condition that cannot be relied on when the thing that fails is the network. */
  finally { draining = false; }
}

/** the bill, as the chit every other part of ChitBridge already understands */
function chitOf(bill) {
  /* a shift travels as its own chit — the same queue, a different shape */
  if (bill.shift) {
    const sh = bill.shift;
    return {
      recipients: [{ self: true, name: 'self' }], purpose: 'general',
      subject: 'Shift — ' + sh.by.name + ' — ' + String(sh.to).slice(0, 10),
      manual_subject: 'Shift — ' + sh.by.name + ' — ' + String(sh.to).slice(0, 10),
      client_ref: bill.no,
      business_json: { shift: sh, till: { id: tillCfg.id, name: tillCfg.name, host: os.hostname(), by: sh.by } },
      line_items: [],
    };
  }
  return {
    recipients: [{ self: true, name: 'self' }],
    purpose: 'order',
    subject: 'Counter sale ' + bill.no,
    manual_subject: 'Counter sale ' + bill.no,
    client_ref: bill.no,
    business_json: {
      customer: bill.customer && bill.customer.name ? bill.customer : { name: 'Walk-in' },
      till: { id: tillCfg.id, name: tillCfg.name, host: os.hostname(), by: bill.by || null },
      bill_no: bill.no, billed_at: bill.at,
      catalogue_version: bill.catalogue_version || null,
      payment: { mode: (bill.payments || []).map((p) => p.how).join('+') || 'cash', paid: bill.paid, change: bill.change, parts: bill.payments || [] },
      slip: bill.kind || 'cash',
    },
    line_items: (bill.lines || []).map((l) => Object.assign({
      particulars: l.name, quantity: l.qty, unit: l.unit || 'piece', price: l.price, total: l.net,
    }, l.item_id ? { item_id: l.item_id } : {}, l.hsn ? { hsn: l.hsn } : {}, l.gst_rate != null ? { gst_rate: l.gst_rate } : {},
       l.off ? { offer: { off: l.save, label: l.off_label || 'Offer' } } : {})),
  };
}

/**
 * ⭐ THE SAME TWO SHAPES THE PAGE BUILDS. A receipt and a despatch note are OUR OWN chits (a till key may address nobody else), with
 * the other party named inside business_json; what actually moved travels on the ORDER, through deliver-lines, into both copies.
 * ⚠️ client_ref is the document number, so a replay after a dropped line returns the first chit instead of recording the lorry twice.
 */
function chitOfDoc(d) {
  const receipt = d.kind === 'receipt';
  const who = receipt ? ((d.vendor && d.vendor.name) || 'Not named') : ((d.against && d.against.party) || 'Customer');
  const subject = (receipt ? 'Goods received from ' : 'Despatched to ') + who + ' — ' + d.no;
  return {
    recipients: [{ self: true, name: 'self' }],
    purpose: receipt ? 'receipt' : 'delivery_note',
    subject, manual_subject: subject,
    client_ref: d.no,
    business_json: {
      doc: d.kind, doc_no: d.no, doc_at: d.at,
      till: { id: d.till, name: tillCfg.name, by: d.by || null },
      party: { name: who },
      against: d.against || null,
      their_bill: d.their_bill || null,
      costs: d.costs || null, goods: d.goods, extras: d.extras, landed_total: d.landed_total,
      ref: d.ref || null, cartons: d.cartons || null, weight: d.weight || null,
      differences: (d.lines || []).filter((l) => (receipt ? l.difference : l.short > 0))
                                  .map((l) => ({ name: l.name, by: receipt ? l.difference : -l.short, reason: l.reason || null })),
    },
    line_items: (d.lines || []).map((l) => ({
      particulars: l.name, quantity: receipt ? l.counted : l.picked, unit: l.unit,
      price: receipt ? (l.rate == null ? null : l.rate) : null,
      total: receipt ? (l.value == null ? null : l.value) : null,
      item_data: { item_id: l.item_id || null, line_id: l.line_id || null, lot: l.lot || null, ordered: l.ordered,
                   difference: receipt ? l.difference : (l.short ? -l.short : 0), reason: l.reason || null,
                   landed: receipt ? l.landed : null, unit_cost: receipt ? l.unit_cost : null,
                   carton: receipt ? null : l.carton },
    })),
  };
}
/** what moved, against the order it was agreed on. Null when there was no order — a receipt at the door is still a receipt. */
function movesOfDoc(d) {
  if (!d.against || !d.against.chit_id) return null;
  const rows = (d.lines || [])
    .filter((l) => l.line_id && ((d.kind === 'receipt' ? l.counted : l.picked) > 0))
    .map((l) => ({ line_id: l.line_id, quantity: (d.kind === 'receipt' ? l.counted : l.picked), unit: l.unit,
                   reference: d.no, note: l.reason || null }));
  return rows.length ? { chit_id: d.against.chit_id, rows } : null;
}

/* ── the screen ────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⭐ A CALL WITH NO KEY — the only kind that can be made before there is one ([TILL-121]). core.CB always
 * sends X-Api-Key, which is right for every other call in this program and wrong for exactly these three.
 */
async function noKey(method, p, body, bearer) {
  const ac = new AbortController();
  const t = setTimeout(function () { ac.abort(); }, 20000);
  try {
    const h = { 'Content-Type': 'application/json' };
    if (bearer) h.Authorization = 'Bearer ' + bearer;
    const r = await fetch(String(cfg.api).replace(/\/$/, '') + p,
      { method: method, signal: ac.signal, headers: h, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    let out = null; try { out = JSON.parse(txt); } catch (_) { out = { message: txt.slice(0, 200) }; }
    if (!r.ok) throw Object.assign(new Error((out && out.message) || ('HTTP ' + r.status)), { status: r.status });
    return out;
  } finally { clearTimeout(t); }
}
/**
 * ⚠️⚠️ SAY WHICH WALL IT HIT. 'fetch failed' on a sign-in screen reads as "wrong password" to the person
 * typing, who then tries it three more times — when the real answer is that this PC has no internet and there
 * is nothing to retry. Same discipline as whyNot(). [[feedback-silence-is-the-bug]]
 */
function signinWhy(e) {
  const m = String((e && e.message) || e || '');
  if (e && e.name === 'AbortError') return 'ChitBridge did not answer in twenty seconds. The line may be very slow — try once more.';
  /* ⚠️ NO URL. Athi: *"no technical details are required — keep it in diagnosis, offer the solution."* The
     address of the server is not a thing a shopkeeper can act on; being offline is. */
  if (/ENOTFOUND|EAI_AGAIN|dns/i.test(m)) return 'This PC is not online. Check the internet, then try again.';
  if (/ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(m)) return 'This PC could not reach the server. Check the internet, then try again.';
  if (e && e.status === 429) return 'Too many tries. Wait a minute, then ask for a new code.';
  if (e && e.status === 403) return m || 'That account is not allowed to connect a counter.';
  return m || 'Could not sign in.';
}

const PAGE = path.join(__dirname, 'till.html');
const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

/**
 * ⚠️⚠️⚠️ THIS COUNTED A REFUND AS A SALE, AND KEPT ITS MONEY IN THE DRAWER ([TILL-122]).
 *
 * It was `count: rows.length` — so a credit note counted as a sale made — and `by` only ever ADDED payments,
 * so the drawer figure was over by exactly the day's refunds. till.html was fixed for precisely this on
 * 2026-09-18 ("four figures on four screens, and three of them disagreed") and the program on the shop's PC
 * was not, so the desktop counter and the browser counter reported different takings for the same day.
 *
 * ⭐ NOW THERE IS ONE RULE, in lib/rollup.js, and the summary is folded with the same one.
 */
function todayTotals() {
  const t = rollup.totals(readLines(F.bills(today())));
  /* ⚠️ the page reads `returns` as an amount — same word, same meaning, both hosts */
  return { count: t.count, total: t.total, by: t.by, returns: t.refunds, gross: t.gross };
}

/**
 * ── ⭐⭐⭐ THE ROLLUP: DAY → WEEK → MONTH ([TILL-122]) ───────────────────────────────
 *
 * Athi: *"assuming we are summarising once per day, we have to set the status that summarised … each week
 * summarise day chit to week chit. summarise, summarise month chit, so we will have 365 chit per year, if we
 * want to check trend on weekly basis we have 52 chit, monthly trend we can look at 12 chit, that is all."*
 *
 * ⚠️⚠️ ONLY A CLOSED PERIOD IS EVER SUMMARISED. A summary of today would change after it was published, and
 * once the bills behind it are gone nobody could correct it. rollup.isClosed decides, against a clock passed
 * in, so the boundary is testable rather than whatever the machine believes at the time.
 *
 * ⚠️ AND IT IS FOLDED, NOT RE-READ. A week is built from its seven DAY summaries, which is the whole reason
 * the daily detail can eventually go — tests/rollup.test.js holds fold() equal to summarising the bills
 * directly, and that equality is the only thing that makes purging safe.
 */
function daysOnDisk() {
  try {
    return fs.readdirSync(DIR).map((n) => (/^bills-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(n) || [])[1]).filter(Boolean).sort();
  } catch (_) { return []; }
}
function readSummary(period, key) {
  try { return JSON.parse(fs.readFileSync(F.summary(period, key), 'utf8')); } catch (_) { return null; }
}
function writeSummary(sum) { writeJSON(F.summary(sum.period, sum.key), sum); return sum; }

/**
 * ⚠️ ONE PASS, AND IT SAYS WHAT IT DID. Called on boot and on every refresh tick — so a shop that leaves the
 * counter on for a week still gets its days closed, and one that opens it once a month gets all of them.
 * ⚠️⚠️ IT NEVER DELETES A BILL. Purging the daily detail is a separate decision with its own floor; this
 * only ever WRITES. [[project-retention-lifecycle]]
 */
function rollUp(now) {
  const made = [];
  const till = { id: tillCfg.id, name: tillCfg.name, host: os.hostname() };
  const days = daysOnDisk();

  /* ── days, from the bills themselves ── */
  for (const d of days) {
    if (!rollup.isClosed('day', d, now)) continue;          /* today is still being billed */
    if (readSummary('day', d)) continue;                     /* already done — and it is never redone */
    const rows = readLines(F.bills(d));
    const nos = rows.map((b) => b.no).filter(Boolean);
    const sum = rollup.summary('day', d, rollup.totals(rows), {
      till, bills_from: nos[0] || null, bills_to: nos[nos.length - 1] || null });
    writeSummary(sum); queueSummary(sum); made.push('day ' + d);
  }

  /* ── weeks and months, FOLDED from what is already summarised ── */
  for (const period of ['week', 'month']) {
    const keys = Array.from(new Set(days.map((d) => rollup.keyOf(period, d))));
    for (const key of keys) {
      if (!rollup.isClosed(period, key, now)) continue;
      if (readSummary(period, key)) continue;
      const mine = rollup.daysIn(period, key, days);
      const parts = mine.map((d) => readSummary('day', d)).filter(Boolean);
      /**
       * ⚠️⚠️ A WEEK IS NOT WRITTEN UNTIL EVERY ONE OF ITS DAYS IS. A partial fold would be published as the
       * week's figure and then never corrected — and because a summary is written ONCE, the missing day would
       * be silently absent from the shop's permanent record. It simply waits for the next pass.
       */
      if (parts.length !== mine.length) continue;
      const sum = rollup.summary(period, key, rollup.fold(parts), { till, source: mine });
      writeSummary(sum); queueSummary(sum); made.push(period + ' ' + key);
    }
  }
  /* ⭐ ONE DRAIN, once everything is written — see the note in queueSummary */
  if (made.length) { log('summarised: ' + made.join(', ')); drain().catch(() => {}); }
  return made;
}

/**
 * ⚠️ THE SAME QUEUE AS A BILL, deliberately. Athi: *"the same format as in the server."* A summary is a chit,
 * it waits out an outage exactly as a sale does, and it is retried by the same drain with the same backoff.
 * A second rail for summaries would be a second thing to go wrong on the day the line is bad.
 * [[feedback-stay-in-the-construct]]
 */
function queueSummary(sum) {
  /**
   * ⚠️⚠️ IT DOES NOT DRAIN HERE, AND THAT IS DELIBERATE. It used to, and drain() is guarded by a `draining`
   * flag while reading the queue ONCE at the top — so queueing eight summaries in a loop sent the first and
   * left seven waiting for the twenty-second tick. rollUp() drains once when it has written them all.
   */
  appendLine(F.queue, { no: rollup.refOf(sum), at: sum.summarised_at, summary: sum });
}

/**
 * ── ⚠️⚠️⚠️ THE PURGE — THE ONLY CODE IN THIS PROGRAM THAT DESTROYS A RECORD OF MONEY ([TILL-123]) ──
 *
 * Athi: *"after a certain days, we don't need to refer the daily chit data"* → *"do the purge with a floor of
 * 90 days."*
 *
 * ⭐ THE DECISION IS NOT MADE HERE. lib/rollup.planPurge() decides, from inputs this function gathers, and it
 * is a pure function with fifteen guarded cases behind it. This half only reads the folder and unlinks. That
 * split is deliberate: the rule that decides whether a sale may be deleted should be testable without a disk.
 *
 * ⚠️ A DAY GOES ONLY IF ALL FIVE HOLD: past the floor · summarised · that summary synced · nothing of that
 * day still queued · its week and month summarised and synced too. See planPurge for why each one is there.
 */
function queuedDays() {
  /**
   * ⚠️⚠️ WHICH DAYS STILL HAVE SOMETHING UNSENT. A bill is written to bills-<day>.jsonl AND to the queue;
   * it leaves the queue only when ChitBridge has it. So a day named here is a day ChitBridge has not fully
   * seen, and its detail must not be deleted whatever its age.
   * ⚠️ SUMMARY ROWS ARE SKIPPED ON PURPOSE — their `at` is when they were folded, not the day they describe,
   * so counting them would block the wrong day (and never the right one).
   */
  const out = new Set();
  for (const row of readLines(F.queue)) {
    if (row && row.summary) continue;
    const at = row && row.at ? String(row.at).slice(0, 10) : null;
    if (at) out.add(at);
  }
  return out;
}

/** ⭐ the DRY RUN — what would go, and for everything else, why not. Deletes nothing. */
function purgePlan(now) {
  return rollup.planPurge({
    days: daysOnDisk(),
    summaryOf: readSummary,
    queuedDays: queuedDays(),
    floorDays: tillCfg.keepDays,
    now: now || Date.now(),
  });
}

/**
 * ⚠️⚠️ AND THE SWEEP. It runs after rollUp() on the same tick, so a day can never be deleted in the same
 * pass that would have summarised it — the summary is written and SENT first, and only a later run, at least
 * ninety days afterwards, can remove the detail behind it.
 * ⚠️ EVERY DELETION IS NAMED IN THE LOG. This is the one place where being quiet would be indefensible.
 */
function purgeOld(now) {
  const plan = purgePlan(now);
  const gone = [];
  for (const d of plan.due) {
    try { fs.unlinkSync(F.bills(d)); gone.push(d); }
    catch (e) { log('could not remove the bills of ' + d + ': ' + e.message); }
    /* ⚠️ the day's DOCUMENTS go with it — same day, same floor, same proof; absent is not an error */
    try { if (fs.existsSync(F.docs(d))) fs.unlinkSync(F.docs(d)); } catch (_) {}
  }
  if (gone.length) {
    log('purged the detailed bills of ' + gone.length + ' day(s) older than ' + plan.floor + ' days ('
      + gone[0] + (gone.length > 1 ? ' … ' + gone[gone.length - 1] : '') + ') — their summaries are kept and were sent');
  }
  return { purged: gone, kept: plan.kept, floor: plan.floor, cutoff: plan.cutoff };
}

/**
 * ⭐⭐ WHAT IS WAITING, BY KIND ([TILL-137]). One queue carries four different things and the count alone made
 * the health page contradict itself. Each row says which it is; nothing here guesses.
 */
function queueKinds() {
  const out = { bill: 0, document: 0, shift: 0, summary: 0 };
  let oldest = null;
  for (const r of readLines(F.queue)) {
    const k = r && r.summary ? 'summary' : r && r.doc ? 'document' : r && r.shift ? 'shift' : 'bill';
    out[k] = (out[k] || 0) + 1;
    if (r && r.at && (!oldest || String(r.at) < oldest)) oldest = String(r.at);
  }
  return { by: out, oldest: oldest };
}

/** ⭐ what is summarised and what has reached the server — the status Athi asked to be able to see */
function summaryState() {
  let files = [];
  try { files = fs.readdirSync(F.summaryDir()); } catch (_) { files = []; }
  const out = { day: 0, week: 0, month: 0, unsent: 0, last: null };
  for (const f of files) {
    const m = /^(day|week|month)-(.+)\.json$/.exec(f);
    if (!m) continue;
    out[m[1]]++;
    const sum = readSummary(m[1], m[2]);
    if (sum && !sum.synced_at) out.unsent++;
    if (m[1] === 'day' && (!out.last || m[2] > out.last)) out.last = m[2];
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))
      return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(PAGE, 'utf8'));

    if (req.method === 'GET' && ENGINE_RE.test(url.pathname)) {
      const n = url.pathname.split('/')[2].replace('.js', '');
      if (!fs.existsSync(F.engine(n))) return send(res, 503, 'text/plain', '// the engine has not been fetched yet — press Refresh while online');
      return send(res, 200, 'application/javascript; charset=utf-8', fs.readFileSync(F.engine(n), 'utf8'));
    }

    /* ⭐ the open orders, straight through — a device holds no copy, because an order changes while you are working it */
    if (req.method === 'GET' && url.pathname === '/api/tasks') {
      const kind = url.searchParams.get('kind') === 'receive' ? 'receive' : 'despatch';
      try { return json(res, 200, await cb.call('GET', '/api/till/tasks?kind=' + kind)); }
      catch (e) { return json(res, 200, { tasks: [], offline: true, why: e.message }); }
    }

    /**
     * ⭐⭐ A RECEIPT OR A DESPATCH NOTE (2026-09-08). The number first, then the file, then the queue — the same order as a bill, so
     * a crash costs a gap and never a duplicate. The movement rows, when the document was against an order, are queued SEPARATELY:
     * they go to b144's deliver-lines, which writes into every party's copy, and either half may wait for the line without the other.
     */
    if (req.method === 'POST' && url.pathname === '/api/doc') {
      let raw = ''; for await (const c of req) raw += c;
      const d = JSON.parse(raw || '{}');
      if (!d || !Array.isArray(d.lines) || !d.lines.length) return json(res, 400, { error: 'a document needs at least one line' });
      const kind = d.kind === 'despatch' ? 'despatch' : 'receipt';
      const doc = Object.assign({ no: nextNumberOf(kind === 'receipt' ? 'GRN' : 'DC'), at: new Date().toISOString(),
                                  till: tillCfg.id, catalogue_version: snapshot && snapshot.version }, d, { kind });
      appendLine(F.docs(today()), doc);
      appendLine(F.queue, { no: doc.no, at: doc.at, doc: doc });
      drain().catch(() => {});
      return json(res, 200, { ok: true, doc: doc });
    }

    /**
     * ⭐⭐ THE PRINTER (2026-09-08). Three things the browser cannot do: say what printers this PC has, send a bill straight to one
     * without a dialog, and cut the paper afterwards.
     * ⚠️ A USB thermal printer with no driver installed does not appear in the list, however well the cable is plugged in — so the
     * screen can tell the shopkeeper which of the two problems they actually have.
     */
    /**
     * ── ⭐⭐⭐ SIGNING IN, WHICH IS HOW A COUNTER GETS ITS KEY ([TILL-121]) ─────────────────
     *
     * Athi: *"we should be able to login to a shop using this desktop app?"* — and *"if we tie each app with
     * the user id then they should be able to login using the same user id / password combination / OTP?"*
     *
     * ⭐ THE SAME SIGN-IN AS THE WEB: /api/entities/register sends the OTP, /verify returns a session. The
     * session is then spent immediately on POST /api/till/enrol and never kept — what is kept is the key.
     * ⚠️⚠️ WHICH IS THE WHOLE POINT. A session expires and needs the network to renew; a counter that must
     * reach the server to open cannot bill on a morning the line is down, and billing with the line down is
     * what this application is FOR. Sign in once, hold a key for a year, never sign in again.
     *
     * ⚠️ THESE TWO ROUTES CARRY NO KEY, deliberately — they run before there is one. All they can do is ask
     * ChitBridge to send a code to an address, and hand a code back. Neither reads shop data.
     */
    /**
     * ── ⚠️⚠️⚠️ SIGNING OUT — THE DAY'S MONEY GOES FIRST ([TILL-127]) ────────────────────
     *
     * Athi: *"if they are signing out, then that also has to be synced — or the couldn't sync due to network
     * has to be informed, and close the shop."*
     *
     * ⚠️⚠️ A COUNTER SIGNED OUT WITH BILLS STILL WAITING IS THE WORST STATE THIS PROGRAM CAN REACH. The
     * queue can only be sent with the key that took the sales, so forgetting the key strands them. That is the
     * same shape as the re-pairing fault that once left five abandoned stores on one device — except deliberate.
     *
     * ⭐ SO IT DRAINS FIRST, AND REFUSES BY DEFAULT. Only an explicit `force` — which the page asks for in
     * words, with the number in front of the person — signs out over unsent work.
     *
     * ⭐⭐ AND NOTHING IS DELETED, WHICH IS WHAT MAKES EVEN A FORCED SIGN-OUT RECOVERABLE. The key is removed
     * from connector.json; the shop's folder stays exactly where it is. Because [TILL-120] names that folder
     * after the shop rather than the key, signing back in to the SAME shop re-opens the SAME folder and the
     * queue picks up where it left off. Say so, or a shopkeeper will think the sales are gone.
     */
    if (req.method === 'POST' && url.pathname === '/api/signout') {
      let raw = ''; for await (const c of req) raw += c;
      const b = JSON.parse(raw || '{}');
      if (!cfg.key) return json(res, 200, { ok: true, already: true, message: 'This counter was not signed in to a shop.' });
      const shop = keyShop(cfg.key);
      const name = (shop && (shop.name || shop.bridge_id)) || 'the shop';

      /* ⚠️ ONE LAST ATTEMPT, ALWAYS — even when forcing, because the best outcome is that there is nothing left */
      let left = readLines(F.queue).length;
      if (left) { try { await drain(); } catch (_) {} left = readLines(F.queue).length; }

      if (left && !b.force) {
        /**
         * ⚠️ IT SAYS WHAT IS WAITING AND WHY IT COULD NOT GO. `online` is set by the drain's own classifier
         * (whyNot), so "the line is down" and "the key is refused" are not reported as the same thing — they
         * need different actions from whoever is reading.
         */
        return json(res, 200, { ok: false, queued: left, online: online, shop: name,
          message: left + ' bill(s) from this counter have not reached the server yet'
            + (online ? ', and ChitBridge is refusing them' : ' because this PC is offline') + '.' });
      }

      /**
       * ⚠️⚠️ MERGE-PATCH, and DELETE the key rather than blanking it. A `key: ""` would read as a key to
       * every check that tests truthiness and as a config error to loadConfig. Everything else on this PC — the
       * Tally paths, the printer, the counter id — survives untouched. [[feedback-partial-writes-merge-patch]]
       */
      const cfgNow = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      delete cfgNow.key;
      writeJSON(cfgFile, cfgNow);
      log('signed out of ' + name + (left ? ' with ' + left + ' bill(s) still unsent — they stay in ' + SHOP_DIR : '')
        + ' — the folder is kept, so signing back in resumes it');
      json(res, 200, { ok: true, left: left, shop: name, folder: SHOP_DIR, restarting: true,
        message: left
          ? left + ' bill(s) are still waiting. They are kept in this shop\u2019s own folder — sign back in to '
            + name + ' on this PC and they will go.'
          : 'Everything reached the server. This counter is signed out of ' + name + '.' });
      /* ⚠️ restart for the same reason the sign-in does: DIR was chosen at boot from the key this no longer has */
      setTimeout(function () { log('restarting — this counter is no longer signed in to a shop'); process.exit(0); }, 400);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/signin/start') {
      let raw = ''; for await (const c of req) raw += c;
      const b = JSON.parse(raw || '{}');
      const who = String(b.email || b.user_id || '').trim();
      if (!who) return json(res, 400, { ok: false, message: 'Type the email address or User ID you use for ChitBridge.' });
      try {
        const out = await noKey('POST', '/api/entities/register',
          who.indexOf('@') > 0 ? { email: who } : { user_id: who });
        /**
         * ⚠️ THE SERVER DECIDES WHETHER A CODE WAS SENT, not this program. `dev_otp` comes back only from a
         * test server — lib/dev-otp.js refuses to leak it anywhere else — and passing it through is what lets
         * a counter be set up end to end against test without a mailbox.
         */
        return json(res, 200, { ok: true, sent: true, dev_otp: (out && out.dev_otp) ? String(out.dev_otp) : null,
          message: 'ChitBridge has sent a 6-digit code to ' + who + '.' });
      } catch (e) { return json(res, 200, { ok: false, message: signinWhy(e) }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/signin/finish') {
      let raw = ''; for await (const c of req) raw += c;
      const b = JSON.parse(raw || '{}');
      const who = String(b.email || b.user_id || '').trim();
      const otp = String(b.otp || '').replace(/[^0-9]/g, '');
      if (otp.length !== 6) return json(res, 400, { ok: false, message: 'The code is six digits.' });
      try {
        const vr = await noKey('POST', '/api/entities/verify',
          Object.assign({ otp: otp }, who.indexOf('@') > 0 ? { email: who } : { user_id: who }));
        const token = vr && (vr.token || vr.access_token);
        if (!token) return json(res, 200, { ok: false, message: 'That code was not accepted. Ask for a new one.' });
        /* ⭐ the session is spent HERE and kept nowhere — one call, and the counter holds a key instead */
        /**
         * ⚠️⚠️ A HELD COUNTER IS A DECISION, NOT AN ERROR ([TILL-138]). The server refuses with 409
         * COUNTER_HELD and names the device that has it. Flattening that into "could not sign in" would send
         * somebody hunting for a fault when what they need is to choose whether to take it back.
         */
        let en;
        try {
          en = await noKey('POST', '/api/till/enrol',
            { name: require('os').hostname(), counter: tillCfg.id || 'C1', takeover: !!b.takeover }, token);
        } catch (e) {
          if (e && e.status === 409 && e.body && e.body.code === 'COUNTER_HELD') {
            return json(res, 200, { ok: false, held: true, counter: (e.body.counter && e.body.counter.id) || tillCfg.id,
              held_by: e.body.held_by || null, seen: e.body.seen || null, message: e.body.message });
          }
          throw e;
        }
        if (!en || !en.key) return json(res, 200, { ok: false, message: 'Signed in, but ChitBridge did not issue a counter key.' });
        /**
         * ⚠️⚠️ MERGE, NEVER REWRITE. connector.json is this PC's whole configuration — the Tally paths, the
         * printer, the counter id. Writing a fresh object here would take the shop online and quietly lose
         * everything else the kit was set up with. [[feedback-partial-writes-merge-patch]]
         */
        const cfgNow = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        cfgNow.key = en.key;
        writeJSON(cfgFile, cfgNow);
        log('signed in to ' + ((en.shop && (en.shop.name || en.shop.bridge_id)) || 'the shop') + ' — counter key saved');
        /**
         * ⚠️⚠️ AND NOW IT MUST RESTART, WHICH IS NOT OPTIONAL. DIR was computed at boot from the OLD key
         * ([TILL-120]), so this process is still writing into the previous shop's folder — or into `_unpaired`.
         * Carrying on would put the new shop's first bills exactly where this change exists to stop them going.
         * The reply goes out FIRST so the page can say what happened; the exit follows a beat later, and
         * counter.cmd / the scheduled task bring it back up.
         */
        json(res, 200, { ok: true, shop: en.shop || null, restarting: true });
        setTimeout(function () { log('restarting to open this shop\u2019s own folder'); process.exit(0); }, 400);
        return;
      } catch (e) { return json(res, 200, { ok: false, message: signinWhy(e) }); }
    }

    if (req.method === 'GET' && url.pathname === '/api/printers')
      return printer.list((_e, out) => json(res, 200, Object.assign({ chosen: tillCfg.printer || null, mm: tillCfg.paper_mm || 80, drawer: !!tillCfg.drawer }, out)));

    if (req.method === 'POST' && url.pathname === '/api/printer') {
      let raw = ''; for await (const c of req) raw += c;
      const b = JSON.parse(raw || '{}');
      /* the choice belongs to THIS PC, so it lives in this PC's connector.json and nowhere else */
      tillCfg.printer = b.printer || null;
      tillCfg.paper_mm = Number(b.mm) === 58 ? 58 : 80;
      tillCfg.drawer = !!b.drawer;
      try { const cfgNow = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); cfgNow.till = Object.assign({}, cfgNow.till || {}, { printer: tillCfg.printer, paper_mm: tillCfg.paper_mm, drawer: tillCfg.drawer }); writeJSON(cfgFile, cfgNow); } catch (e) { log('could not save the printer choice: ' + e.message); }
      log(tillCfg.printer ? ('slips print to ' + tillCfg.printer + ' (' + tillCfg.paper_mm + ' mm)') : 'slips no longer print by themselves');
      return json(res, 200, { ok: true, chosen: tillCfg.printer, mm: tillCfg.paper_mm, drawer: tillCfg.drawer });
    }

    if (req.method === 'POST' && url.pathname === '/api/print') {
      let raw = ''; for await (const c of req) raw += c;
      const b = JSON.parse(raw || '{}');
      const opts = { printer: b.printer || tillCfg.printer, mm: tillCfg.paper_mm || 80, drawer: b.drawer != null ? !!b.drawer : !!tillCfg.drawer };
      if (b.test) {
        if (!opts.printer) return json(res, 200, { ok: false, why: 'choose a printer first' });
        return printer.sendRaw(opts.printer, printer.testPage((snapshot && snapshot.shop) || null, opts),
          (e) => json(res, 200, e ? { ok: false, why: e.message } : { ok: true }));
      }
      if (!b.doc) return json(res, 400, { error: 'nothing to print' });
      return printer.print(b.doc, (snapshot && snapshot.shop) || null, opts, (_e, out) => {
        if (out && !out.ok) log('the slip did not print: ' + out.why);      /* said out loud, and the sale stands */
        json(res, 200, out);
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/state')
      /**
       * ⚠️⚠️ `paired` AND `shop` ARE NOT DECORATION ([TILL-121]). Without them the page cannot tell a blank
       * desktop counter from a working one — its only pairing test is CloudHost.key, which AgentHost has never
       * had — so it showed a paired counter the unpaired wording and an unpaired one the reassuring wording.
       * ⭐ BOTH COME OFF THE KEY ITSELF, so they are right with the line down, which is when they are read.
       * ⚠️ THE KEY NEVER CROSSES THIS WIRE. The page gets the shop's NAME, never the credential — same rule
       * the /api/op proxy keeps.
       */
      return json(res, 200, { snapshot: snapshot, online: online, queued: readLines(F.queue).length, today: todayTotals(),
                              paired: !!cfg.key, shop: keyShop(cfg.key), folder: SHOP_DIR,
                              /**
                               * ⭐⭐ WHY THE QUEUE IS STUCK ([TILL-132]). Without this the screen could only say
                               * "10 waiting" — a number that looks like patience. With it the counter can say
                               * what happened and offer the one control that fixes it.
                               */
                              queue_why: QUEUE_WHY,
                              /**
                               * ⭐⭐ WHAT IS WAITING, NOT JUST HOW MANY ([TILL-137]). The counter-health design
                               * calls the bare count the page's first fault: "Bills 0, queued 0, then 10 rows
                               * tried". A breakdown by kind is what reconciles it — and lets the page say in
                               * words when none of the waiting things are bills.
                               */
                              queue_kinds: queueKinds(),
                              /* ⭐ what is summarised and what of it has reached the server ([TILL-122]) */
                              summary: summaryState(),
                              /* ⭐ the floor, stated — a shop should not have to read a config file to know
                                 how long its detailed bills are kept ([TILL-123]) */
                              keep_days: Number(tillCfg.keepDays) > 0 ? Number(tillCfg.keepDays) : 90,
                              till: { id: tillCfg.id, name: tillCfg.name, host: os.hostname() },
                              engines: Object.fromEntries(ENGINE_NAMES.map((n) => [n, fs.existsSync(F.engine(n))])),
                              printer: { chosen: tillCfg.printer || null, mm: tillCfg.paper_mm || 80, drawer: !!tillCfg.drawer },
                              update: UPDATE });

    if (req.method === 'POST' && url.pathname === '/api/refresh') { const ok = await refresh(); return json(res, 200, { ok: ok, online: online, at: snapshot && snapshot.at }); }

    /**
     * ⭐⭐ SEND NOW, ON THE SHOP PC. The page's "Send now" called HOST.drain() — which the browser host has and
     * this one did not, so on the desktop counter the button threw and did nothing at all. The queue lives HERE
     * on this host, in a file, and only this process can send it; the page can only ask.
     * ⚠️ It reports the queue length after trying, so the page can say what happened instead of guessing.
     */
    if (req.method === 'POST' && url.pathname === '/api/send') {
      const before = readLines(F.queue).length;
      await drain();
      const after = readLines(F.queue).length;
      return json(res, 200, { ok: true, before: before, sent: before - after, queued: after, online: online });
    }

    /* ⭐ THE SMALL WRITES a counter makes on its feet — stock out, price change. Forwarded, so the page never cares which
       host it is on; the agent already holds the key and already knows how to reach the server. */
    /**
     * ⭐ THE SMALL READS. Forwarded the same way and allow-listed the same way, so a shop PC and a browser answer a
     * question identically. ⚠️ Never queued: a read has nothing to replay, and a suggestion computed from last
     * week's shelf is worse than no suggestion at all.
     */
    if (req.method === 'GET' && url.pathname === '/api/op') {
      var want = url.searchParams.get('get') || '';
      var READ = ['/api/till/worth-an-offer', '/api/till/reward',
                  /* ⭐⭐ QUICK KEYS, LEVEL 2 (b262, 2026-09-18) */
                  /* ⭐ what a shop can start from ([TILL-107]) — the trades, their outcomes and the axiom */
                  '/api/till/catalogue/blueprints',
                  /* ⭐ the workbook to start from ([TILL-115]) — download first, then bring it back */
                  '/api/products/workbook.xlsx',
                  '/api/till/counters', '/api/till/quick-keys/groups', '/api/till/quick-keys/hidden',
                  '/api/till/quick-keys/screen-config'];
      var base = want.split('?')[0];
      if (READ.indexOf(base) < 0) return json(res, 400, { ok:false, why:'not a question this counter may ask' });
      try { const r = await cb.call('GET', want, null);
        return json(res, 200, Object.assign({ ok:true }, r || {}));
      } catch (e) { return json(res, 200, { ok:false, why: e.message }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/op') {
      let body = ''; for await (const c of req) body += c;
      let o = {}; try { o = JSON.parse(body || '{}'); } catch (_) {}
      /* ⚠️ AN EXPLICIT LIST, NOT A PATTERN. This is an allow-list for what a page may ask its own agent to POST upstream, and a
         pattern is one careless edit away from letting through a path nobody meant. Two operations, named. */
      var ALLOW = ['/api/till/stock', '/api/till/price', '/api/till/flags', '/api/till/offer-item',
                   /* ⭐ points earned and encashed on a bill, and the claim that moves a walk-in's balance onto an account */
                   '/api/till/reward', '/api/till/reward/claim',
                   /* ⭐⭐ a counter that is stuck reporting itself. A desktop-kit PC is exactly the machine nobody
                      can reach, so this list is the LAST place it should be missing from. */
                   '/api/till/diagnostic',
                   /* ⭐ did the chit I was given record MY bill? — the recovery for absorbed sales */
                   '/api/till/reconcile',
                   /* ⚠️⚠️ the shop's own header and GSTIN, till key alone ([TILL-105], Athi 2026-09-19). A shop PC is
                      exactly the machine whose owner has no back office open, so the agent must forward this one too. */
                   '/api/till/shop',
                   /* ⭐⭐ starting the shop ([TILL-107]) — a desktop counter is exactly the machine whose owner
                      has no back office open, so the agent must forward the mint as well. */
                   '/api/till/catalogue',
                   /* ⭐ the upload, read then committed — the same two routes the back office uses ([TILL-108]) */
                   '/api/products/import/preflight', '/api/products/import',
                   /* ⭐ a counter finishing, deliberately and online */
                   '/api/till/close',
                   /* ⭐ on break, or billing — for the shop's Counters screen */
                   '/api/till/state',
                   /* ⭐⭐ QUICK KEYS, LEVEL 2 (b262, 2026-09-18) — this counter's own active groups and sold-out
                      items, and pushing a sold-out to the shop's other counters when asked (decision 3). */
                   '/api/till/quick-keys/state', '/api/till/quick-keys/hide', '/api/till/quick-keys/unhide',
                   '/api/till/quick-keys/screen-config'];
      if (!o.path || ALLOW.indexOf(o.path) < 0) return json(res, 400, { ok:false, why:'not an operation this counter may send' });
      try { const r = await cb.call('POST', o.path, o.body || {});
        return json(res, 200, Object.assign({ ok:true }, r || {}));
      } catch (e) { return json(res, 200, { ok:false, why: e.message }); }
    }

    /* ⭐ THE SAME SECOND OPINION THE HOSTED COUNTER GETS. The page must not care which host it is on, so the agent forwards
       it rather than the page reaching past its host to the internet. */
    if (req.method === 'GET' && url.pathname === '/api/verify') {
      try { const r = await cb.call('GET', '/api/till/verify');
        return json(res, 200, Object.assign({ ok: true }, r || {}));
      } catch (e) { return json(res, 200, { ok: false, why: e.message }); }
    }

    /* ⭐ EARLIER BILLS come from ChitBridge; the page asks its host, never the internet directly (2026-09-08) */
    if (req.method === 'GET' && url.pathname === '/api/history') {
      try { const days = Math.min(Number(url.searchParams.get('days')) || 30, 365);
        const r = await cb.call('GET', '/api/till/bills?days=' + days + '&limit=200');
        return json(res, 200, r || { bills: [] });
      } catch (e) { return json(res, 200, { bills: [], offline: true, why: e.message }); }
    }

    /* ⭐ A SHIFT IS A RECORD, NOT A NOTE ON A LAPTOP (2026-09-08): who took the counter, what was taken, what was counted */
    if (req.method === 'POST' && url.pathname === '/api/shift') {
      let body = ''; for await (const c of req) body += c;
      const sh = JSON.parse(body || '{}');
      appendLine(path.join(DIR, 'shifts.jsonl'), sh);
      appendLine(F.queue, { no: 'SHIFT/' + (sh.till || tillCfg.id) + '/' + sh.from, at: sh.to, shift: sh });
      drain().catch(() => {});
      return json(res, 200, { ok: true });
    }

    /**
     * ⭐⭐ GET /api/summary — THE SHOP'S OWN TREND, WITH NO LINE AT ALL ([TILL-122]).
     *
     * Athi: *"if we want to check trend on weekly basis we have 52 chit, monthly trend we can look at 12 chit,
     * that is all."* /api/history asks the SERVER and returns nothing when the line is down; this reads the
     * folder, so a shopkeeper can see their own months on a morning the internet is out.
     */
    if (req.method === 'GET' && url.pathname === '/api/summary') {
      const period = ['day', 'week', 'month'].indexOf(url.searchParams.get('period')) >= 0 ? url.searchParams.get('period') : 'day';
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 60, 1), 400);
      let files = [];
      try { files = fs.readdirSync(F.summaryDir()); } catch (_) { files = []; }
      const rows = files.map((f) => (new RegExp('^' + period + '-(.+)\\.json$').exec(f) || [])[1]).filter(Boolean)
        .sort().slice(-limit).map((k) => readSummary(period, k)).filter(Boolean).reverse();
      /* ⚠️ `today` is NOT in there — it is not summarised yet, and saying so is the honest shape */
      return json(res, 200, { period, rows, today: period === 'day' ? { key: today(), totals: rollup.totals(readLines(F.bills(today()))), open: true } : null,
                              state: summaryState() });
    }

    /**
     * ⭐⭐ GET /api/purge — THE DRY RUN, WHICH DELETES NOTHING ([TILL-123]).
     *
     * A shopkeeper (or Athi) can see exactly which days would go and, for every day that stays, the reason.
     * ⚠️ There is deliberately NO POST here. The purge is not a button: it happens on the tick, behind five
     * conditions, and a control that made it happen sooner would only ever be used by mistake.
     */
    if (req.method === 'GET' && url.pathname === '/api/purge') {
      const plan = purgePlan(Date.now());
      return json(res, 200, { floor_days: plan.floor, cutoff: plan.cutoff, would_remove: plan.due, keeping: plan.kept });
    }

    /* ⚠️ a way to ask for the rollup now, rather than waiting out the tick — used by the day-close and by tests */
    if (req.method === 'POST' && url.pathname === '/api/summarise') {
      let made = [];
      try { made = rollUp(Date.now()); } catch (e) { return json(res, 200, { ok: false, why: e.message }); }
      return json(res, 200, { ok: true, made, state: summaryState() });
    }

    if (req.method === 'GET' && url.pathname === '/api/bills')
      return json(res, 200, { day: today(), bills: readLines(F.bills(today())).slice(-50).reverse(), totals: todayTotals() });

    if (req.method === 'POST' && url.pathname === '/api/bill') {
      let body = ''; for await (const c of req) body += c;
      const b = JSON.parse(body || '{}');
      if (!Array.isArray(b.lines) || !b.lines.length) return json(res, 400, { error: 'a bill needs at least one line' });
      /* ⚠️ THE NUMBER FIRST, THEN THE FILE, THEN THE QUEUE — in that order, so a crash can cost a gap but never a duplicate. */
      const bill = Object.assign({ no: nextNumber(), at: new Date().toISOString(), till: tillCfg.id,
                                   catalogue_version: snapshot && snapshot.version }, b);
      appendLine(F.bills(today()), bill);
      appendLine(F.queue, bill);
      drain().catch(() => {});                              /* try at once; if the line is down the queue keeps it */
      return json(res, 200, { ok: true, bill: bill, today: todayTotals() });
    }

    return json(res, 404, { error: 'not here' });
  } catch (e) { json(res, 500, { error: String(e && e.message) }); }
});

(async () => {
  log('till ' + tillCfg.id + ' starting · data in ' + DIR);
  await refresh();
  if (!snapshot) log('⚠ no copy of the shop yet — connect once, then this till bills with the line down');
  /**
   * ⭐⭐ THE ROLLUP RUNS ON BOOT AND ON EVERY TICK ([TILL-122]) — never on a schedule of its own.
   * ⚠️ A SHOP DOES NOT LEAVE THE COUNTER ON OVERNIGHT, and one that does may leave it on for a month. Either
   * way this catches up: every CLOSED day it has bills for and no summary of is summarised, in order, however
   * long ago it was. A nightly timer would have missed exactly the shops that switch the PC off at closing.
   * ⚠️ It never throws into the boot path — a counter that would not open because a summary failed would be
   * the worst possible trade.
   */
  try { rollUp(Date.now()); } catch (e) { log('the rollup could not run: ' + e.message + ' — billing is unaffected'); }
  /* ⚠️ AFTER the rollup, never before — so a day is summarised and sent long before its detail can go */
  try { purgeOld(Date.now()); } catch (e) { log('the purge could not run: ' + e.message + ' — nothing was removed'); }
  setInterval(() => refresh().catch(() => {}), Math.max(1, Number(tillCfg.refreshMinutes) || 15) * 60 * 1000).unref();
  setInterval(() => { try { rollUp(Date.now()); } catch (_) {} try { purgeOld(Date.now()); } catch (_) {} },
    Math.max(1, Number(tillCfg.refreshMinutes) || 15) * 60 * 1000).unref();
  setInterval(() => drain().catch(() => {}), Math.max(5, Number(tillCfg.drainSeconds) || 20) * 1000).unref();
  /**
   * ⚠️⚠️ ALREADY RUNNING IS NOT AN ERROR ([TILL-117]). The scheduled task `install` registers fires every
   * five minutes whenever the counter is not running — and if it IS running, this is the path that used to
   * throw an unhandled EADDRINUSE and print a stack trace. The counter that is already up is the right one.
   * ⚠️ Exit 0, not 1: nothing failed. A non-zero exit would have Task Scheduler reporting a fault every five
   * minutes for a counter that is working perfectly.
   */
  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      log('the counter is already running — open http://127.0.0.1:' + PORT + ' (nothing needed to be started)');
      /* ⚠️ LET THE IN-FLIGHT READ SETTLE FIRST. Exiting while the shop request is still open trips a libuv
         assertion on Windows — a crash dump printed straight after a friendly sentence, which undoes it. */
      setTimeout(function(){ process.exit(0); }, 250);
      /* ⚠️⚠️ RETURN. process.exit(0) used to end the handler by itself; deferring it left the code falling
         through to 'could not start' and exit(1) — the friendly sentence printed, then the crash anyway. */
      return;
    }
    log('the counter could not start: ' + ((e && e.message) || e));
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    log('counter ready → http://127.0.0.1:' + PORT);
    log('bills are kept in ' + DIR + ' and sent when the line is up');
  });
})();
