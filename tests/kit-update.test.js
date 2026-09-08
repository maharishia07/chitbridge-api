/**
 * kit-update.test.js — A KIT KEEPS ITSELF CURRENT (2026-09-08). Athi: *"build the kit update path."*
 *
 * A kit on a shop PC used to be frozen at the day it was downloaded. Now it asks what it should be, fetches only what differs, writes
 * the page at once and stages the program for its next start. Every one of those steps can hurt a shop if it is wrong, so each is
 * proven here: what may be asked for, what is written, what is refused, and — the one that matters most — that a program which does
 * not parse is NEVER swapped in, because a counter that cannot start is worse than a counter that is a week old.
 *
 * Run: node tests/kit-update.test.js   · no DB, no browser, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');

const API = path.join(__dirname, '..');
const KIT = path.join(API, 'tools', 'tally-connector');
const integrations = require(path.join(API, 'routes', 'integrations.js'));
const core = require(path.join(KIT, 'core.js'));

let pass = 0;
/* ⚠️ HALF OF THESE ARE ASYNC (they drive kitUpdate). An async check that is not awaited prints "ok" before it has checked anything, so
   every check is queued and run in order — a green line must mean the assertion passed, not that it was scheduled. */
const JOBS = [];
const it = (what, fn) => JOBS.push([what, fn]);
const say = (line) => JOBS.push([null, () => console.log(line)]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cb-kit-'));

say('— what a kit should be —');

it('the manifest names real files, and every hash is the hash of what is on disk', () => {
  const m = integrations.kitManifest();
  assert.ok(m.files.length > 5, 'a kit is more than a handful of files');
  for (const f of m.files) {
    const p = path.join(KIT, f.name);
    assert.ok(fs.existsSync(p), f.name + ' is promised but not there');
    assert.strictEqual(f.sha256, sha(fs.readFileSync(p)), f.name + ' does not hash to what the manifest says');
    assert.strictEqual(f.bytes, fs.statSync(p).size);
  }
});

it('the counter is in it — the page, the program and the shared code', () => {
  const names = integrations.kitManifest().files.map((f) => f.name);
  for (const n of ['till.html', 'till.js', 'core.js']) assert.ok(names.indexOf(n) >= 0, n + ' is not offered to a kit');
});

it('⚠️ the list IS the boundary: nothing outside it can be named', () => {
  for (const bad of ['../.env', '../../server.js', 'connector.json', '.env', 'till.js.bak'])
    assert.ok(integrations.KIT_NAMES.indexOf(bad) < 0, bad + ' must never be part of the kit');
  /* and a secret a kit does hold on disk is not on the list either */
  assert.ok(integrations.KIT_NAMES.every((n) => n.indexOf('..') < 0), 'a kit name may not climb out of the folder');
});

it('⚠️ the counter is downloaded with a TILL key, not a connector one — it could not read its own shop otherwise', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'integrations.js'), 'utf8');
  const i = src.indexOf('const scopes = ');
  assert.ok(i > 0, 'the kit download no longer chooses a scope by kit');
  const line = src.slice(i, src.indexOf('\n', i));
  assert.ok(line.indexOf("'till'") > 0 && line.indexOf("c.id === 'till'") > 0, 'the counter kit must mint a till key: ' + line);
  /* and the till scope must actually open the four calls the counter program makes */
  const auth = fs.readFileSync(path.join(API, 'middleware', 'auth.js'), 'utf8');
  /* the scope table is written as regexes, so read it with the escaping taken out */
  const till = auth.slice(auth.indexOf('  till:'), auth.indexOf('  connector:')).split('\\').join('');
  for (const call of ['snapshot', 'bills', 'tasks', 'engine', '/api/chits/send', '/api/integrations/kit', 'deliver-lines'])
    assert.ok(till.indexOf(call) > 0, 'a till key cannot reach ' + call);
});

say('— fetching only what differs —');

/** a server that answers with exactly these files */
function fakeCB(files, opts) {
  const o = opts || {};
  return { call: async (method, p) => {
    if (p === '/api/integrations/kit') {
      if (o.offline) throw new Error('fetch failed');
      return { version: 'v1', files: Object.keys(files).map((n) => ({ name: n, sha256: sha(Buffer.from(files[n])), bytes: files[n].length })) };
    }
    const name = p.replace('/api/integrations/kit/', '');
    return { raw: o.corrupt ? (files[name] + ' /* lost a packet */') : files[name] };
  } };
}

it('a page that changed is written straight away — nothing is running it', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'till.html'), '<b>old</b>');
  const out = await core.kitUpdate({ cb: fakeCB({ 'till.html': '<b>new</b>' }), dir, live: ['till.html'], staged: [] });
  assert.deepStrictEqual(out.updated, ['till.html']);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'till.html'), 'utf8'), '<b>new</b>');
});

it('⭐ the running program is only STAGED — it is never replaced under a shop that is billing', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'till.js'), 'console.log(1)');
  const out = await core.kitUpdate({ cb: fakeCB({ 'till.js': 'console.log(2)' }), dir, live: [], staged: ['till.js'] });
  assert.deepStrictEqual(out.staged, ['till.js']);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'till.js'), 'utf8'), 'console.log(1)', 'the running program was overwritten');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'till.js.new'), 'utf8'), 'console.log(2)');
});

it('nothing to do is nothing done — the same file is not fetched twice', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'till.html'), 'same');
  const out = await core.kitUpdate({ cb: fakeCB({ 'till.html': 'same' }), dir, live: ['till.html'], staged: [] });
  assert.deepStrictEqual(out.updated, []);
  assert.strictEqual(out.checked, 1);
});

it('⚠️ a file that did not arrive whole is not written — a truncated download is a broken counter', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'till.html'), 'old');
  const out = await core.kitUpdate({ cb: fakeCB({ 'till.html': 'new' }, { corrupt: true }), dir, live: ['till.html'], staged: [], log: () => {} });
  assert.deepStrictEqual(out.updated, []);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'till.html'), 'utf8'), 'old');
});

it('the line being down is not an error — it is no update today', async () => {
  const dir = tmp();
  const out = await core.kitUpdate({ cb: fakeCB({}, { offline: true }), dir, live: ['till.html'], staged: [] });
  assert.strictEqual(out, null);
});

it('a staged file that already matches is not fetched again, and stays pending', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'till.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'till.js.new'), 'console.log(2)');
  let fetched = 0;
  const cb = fakeCB({ 'till.js': 'console.log(2)' });
  const inner = cb.call; cb.call = async (m, p) => { if (p.indexOf('/kit/') > 0) fetched++; return inner(m, p); };
  const out = await core.kitUpdate({ cb, dir, live: [], staged: ['till.js'] });
  assert.strictEqual(fetched, 0, 'it downloaded a file it already had staged');
  assert.deepStrictEqual(out.staged, ['till.js']);
});

say('— the swap, at the start, or not at all —');

/** the real block out of till.js, put in a folder of its own with a marker so we can see WHICH version ran */
function stage(newBody) {
  const src = fs.readFileSync(path.join(KIT, 'till.js'), 'utf8');
  const from = src.indexOf('(function applyStagedUpdate()');
  const to = src.indexOf('})();', from) + 5;
  assert.ok(from > 0 && to > from, 'applyStagedUpdate is no longer in till.js');
  const head = "'use strict';\nconst fs = require('fs');\nconst path = require('path');\n";
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'till.js'), head + src.slice(from, to) + "\nconsole.log('RAN old');\n");
  fs.writeFileSync(path.join(dir, 'till.js.new'), head + src.slice(from, to) + newBody);
  return dir;
}

it('⭐⭐ a newer program is swapped in at the start, the old one kept as .bak, and the new one is what runs', () => {
  const dir = stage("\nconsole.log('RAN new');\n");
  const out = execFileSync(process.execPath, [path.join(dir, 'till.js')], { encoding: 'utf8', env: Object.assign({}, process.env, { CB_TILL_UPDATED: '' }) });
  assert.ok(out.indexOf('RAN new') >= 0, 'the new program did not run: ' + out);
  assert.ok(out.indexOf('was updated') >= 0, 'it swapped silently — a shop is told what changed on its own PC');
  assert.ok(fs.existsSync(path.join(dir, 'till.js.bak')), 'the version being replaced was not kept');
  assert.ok(!fs.existsSync(path.join(dir, 'till.js.new')), 'the staged file is still pending after being applied');
});

it('⚠️⚠️ a program that does not parse is NEVER swapped in — the counter keeps the version it has', () => {
  const dir = stage("\nconsole.log('RAN new'\n");        /* a bracket short: it will not run */
  const before = fs.readFileSync(path.join(dir, 'till.js'), 'utf8');
  const out = execFileSync(process.execPath, [path.join(dir, 'till.js')], { encoding: 'utf8', env: Object.assign({}, process.env, { CB_TILL_UPDATED: '' }) });
  assert.ok(out.indexOf('RAN old') >= 0, 'the counter did not go on running: ' + out);
  assert.ok(out.indexOf('does not run') >= 0, 'it said nothing about refusing the update');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'till.js'), 'utf8'), before, 'a broken program was written over a working one');
  assert.ok(!fs.existsSync(path.join(dir, 'till.js.new')), 'a refused update must not be tried again at every start');
});

it('the child of a swap does not swap again — one update per start, never a loop', () => {
  const dir = stage("\nconsole.log('RAN new');\n");
  const out = execFileSync(process.execPath, [path.join(dir, 'till.js')], { encoding: 'utf8', env: Object.assign({}, process.env, { CB_TILL_UPDATED: '1' }) });
  assert.ok(out.indexOf('RAN old') >= 0, 'a marked child still swapped');
  assert.ok(fs.existsSync(path.join(dir, 'till.js.new')), 'it consumed the staged file it was told to leave alone');
});

(async () => {
  for (const [what, fn] of JOBS) {
    if (!what) { await fn(); continue; }
    try { await fn(); pass++; console.log('  ok  ' + what); }
    catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; }
  }
  console.log(pass + ' checks');
})();
