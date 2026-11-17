'use strict';
// @type: unit
/**
 * bulk-resume.test.cjs — a bulk job survives a restart (Athi 11 Nov; PM/designs/BULK-RESUME-AUDIT.md section c; SEC-140).
 *
 * Each "page" is a fresh sandbox (the real cb-offline.js, ui.js and the saved-job block of app.html) over the SAME localStorage, so a reload is a new page with the old storage.
 * Cases: a job of 25 → the page dies after 12 steps → a fresh page resumes the other 13 and every key is called once (job:<id>:<n>, 200 characters at most);
 * a different entity signed in → its entries are never replayed, the owner's stay; 503 then 200 → retried after 2 s and done, "Server busy, trying again in 2 s"; the four waits then "Stopped";
 * a private window (storage refuses writes) says closing loses the job; a job older than 48 h asks first (Continue resumes, Cancel drops it); a replayed 404 counts as done only after an earlier attempt;
 * status change and categorise say "Keep this tab open" and stay out of the outbox; every state's words, as recorded.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * Run: node e2e/bulk-resume.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const html = read('app.html');
const jobBlock = html.slice(html.indexOf('/* ⭐ SAVE AND RESUME'), html.indexOf('\n}\n', html.indexOf('async function bulkResume(')) + 3);
function sourceOf(name) {
  const start = Math.max(html.indexOf('\nasync function ' + name + '('), html.indexOf('\nfunction ' + name + '('));
  if (start < 0) throw new Error('no function ' + name);
  return html.slice(start, html.indexOf('\n}\n', start) + 3);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = (n) => Array.from({ length: n }, (_, i) => 'c' + (i + 1));

/* the device: one localStorage shared by every page; refuseWrites turns it into a private window */
function makeStorage(refuseWrites) {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { if (refuseWrites === 'quota' && k !== '__cb') throw new Error('quota'); if (refuseWrites === true) throw new Error('private'); map.set(k, String(v)); }, removeItem: (k) => map.delete(k) };
}
/* the server: holds each Idempotency-Key once and answers a replay with the first answer; counts every call per key */
function makeServer() {
  const server = { calls: [], answers: new Map(), archived: new Set(), script: null };
  server.handle = async (ep, options) => {
    const key = options && options.idemKey;
    server.calls.push({ ep, key, id: options && options.params && options.params.id });
    if (server.script) { const scripted = server.script(ep, options, server.calls.filter((c) => c.key === key).length); if (scripted) return scripted(); }
    if (key && server.answers.has(key)) return server.answers.get(key);
    const reply = ep === 'assignBulk' ? { assigned: options.body.chit_ids.length, skipped: [] } : ep === 'prodBulkCategories' ? { results: options.body.ids.map((id) => ({ id, result: id === 'c8' ? 'refused' : id === 'c4' ? 'unchanged' : 'done' })) } : {};
    if (key) server.answers.set(key, reply);
    return reply;
  };
  return server;
}
/* one page: a fresh sandbox, the real files, the shared storage; die(after) makes api hang forever once that many calls were made (the tab died before the next request left) */
function makePage(storage, server, who, options) {
  options = options || {};
  const spoken = [], toasts = [], asks = [], listeners = {};
  let made = 0;
  const sandbox = {
    console, setTimeout, clearTimeout, localStorage: storage, navigator: { onLine: true }, spoken, toasts, asks,
    tx: (t) => t, txf: (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)), esc: (t) => String(t),
    CBAction: { run: (b, fn) => Promise.resolve(fn()) }, SESSION: { token: who ? 'tok-' + who : '' },
    document: { addEventListener() {}, body: { appendChild() {} }, createElement: () => { const el = { attrs: {}, innerHTML: '', className: '', setAttribute() {}, remove() {} }; let said = ''; Object.defineProperty(el, 'textContent', { get: () => said, set: (v) => { said = v; spoken.push(v); } }); return el; }, querySelector: () => null, getElementById: () => null },
    modal() {}, closeModal() {}, addEventListener: (name, handler) => { (listeners[name] = listeners[name] || []).push(handler); }, removeEventListener() {},
    MSG: { fail: (verb, e) => 'Could not ' + verb + ': ' + ((e && e.message) || e) },
    UI: { rows: [], selected: new Set() }, toast: (m) => toasts.push(m), announce: undefined, loadList: async () => {}, loadCatalogue: async () => {},
    cblog: () => {}, confirmAsk: (title, body, ok, onOk, danger, onCancel) => asks.push({ title, body, ok, onOk, onCancel }),
    epOf: (key) => ({ m: key === 'assignBulk' ? 'POST' : 'POST', p: key === 'assignBulk' ? '/api/chits/assign-bulk' : '/api/chits/:id/' + key.toLowerCase() }),
    fill: (p, params) => p.replace(/:(\w+)/g, (m, k) => (params && params[k]) || m),
    api: async (ep, opts) => {
      if (options.dieAfter != null && made >= options.dieAfter) await new Promise(() => {});
      made += 1;
      return server.handle(ep, opts);
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('cb-offline.js'), sandbox);
  vm.runInContext(read('app/ui.js'), sandbox);
  sandbox.listeners = listeners;
  sandbox.CBOffline.configure({ entity: options.noStamp ? null : () => who, sleep: (ms) => { (sandbox.waits = sandbox.waits || []).push(ms); return Promise.resolve(); } });
    vm.runInContext(jobBlock, sandbox);
  ['chitNameOf', 'groupRun', 'groupToast', 'tickUndone', 'confirmStatus', 'prodCategoriseApply'].forEach((name) => { try { vm.runInContext(sourceOf(name), sandbox); } catch (e) { /* a function this page does not carry */ } });
  sandbox.goOnline = (up) => { sandbox.navigator.onLine = up; if (up) (listeners.online || []).forEach((handler) => handler()); };
  return sandbox;
}
const archive = (page, n) => page.groupJob(ids(n), { ep: 'archive', mount: 'WRK001-U51', speed: 'quick', verb: 'archive', label: 'Archiving records', unit: 'archived' });
const quiet = (p) => p.catch(() => {});
const sourceOfApply = () => sourceOf('prodCategoriseApply');

(async () => {
  console.log('a job of 25: the page dies after 12 steps, a fresh page finishes it');
  {
    const storage = makeStorage(), server = makeServer();
    const first = makePage(storage, server, 'alice', { dieAfter: 12 });
    quiet(archive(first, 25));
    await wait(120);
    const stored = JSON.parse(storage.getItem('cb.outbox.v1'));
    check(stored.length === 13 && stored.every((e) => /^job:[0-9a-f]{32}:\d+$/.test(e.id) && e.id.length <= 200 && e.entity === 'alice'), 'the first page stored all 25 steps before step 1, 12 answered and gone, 13 left, each with its own job key and its entity');
    check(server.calls.length === 12, 'the server saw 12 calls');
    const second = makePage(storage, server, 'alice');
    await second.bulkResume();
    await wait(200);
    const perKey = {};
    server.calls.forEach((c) => { perKey[c.key] = (perKey[c.key] || 0) + 1; });
    check(Object.keys(perKey).length === 25 && Object.values(perKey).every((n) => n === 1), 'all 25 keys called, none twice (no double call per key)');
    check(!storage.getItem('cb.outbox.v1') || JSON.parse(storage.getItem('cb.outbox.v1')).length === 0, 'nothing left in the outbox');
    check(second.toasts.some((t) => /^25 done/.test(t)), 'the resumed page says "25 done": ' + second.toasts.join(' | '));
  }

  console.log('a step in flight when the tab died is sent again with the SAME key');
  {
    const storage = makeStorage(), server = makeServer();
    const first = makePage(storage, server, 'alice');
    server.script = (ep, o, nth) => (nth === 1 && o.params.id === 'c3' ? () => new Promise(() => {}) : null);
    quiet(archive(first, 5));
    await wait(80);
    server.script = null;
    const second = makePage(storage, server, 'alice');
    await second.bulkResume();
    await wait(150);
    const c3 = server.calls.filter((c) => c.id === 'c3');
    check(c3.length === 2 && c3[0].key === c3[1].key, 'c3 was sent twice with one key, so the server applies it once');
  }

  console.log('SEC-140: a different entity signed in never replays someone else\'s queue');
  {
    const storage = makeStorage(), server = makeServer();
    const alice = makePage(storage, server, 'alice', { dieAfter: 2 });
    quiet(archive(alice, 6));
    await wait(80);
    storage.setItem('cb.outbox.v1', JSON.stringify(JSON.parse(storage.getItem('cb.outbox.v1')).concat([{ id: 'plain1', method: 'POST', path: '/api/x', entity: 'alice', tries: 0 }, { id: 'legacy', method: 'POST', path: '/api/y', tries: 0 }])));
    const before = server.calls.length;
    const bob = makePage(storage, server, 'bob');
    let fetched = 0;
    bob.fetch = async () => { fetched += 1; return { status: 200, clone: () => ({ json: async () => ({}) }) }; };
    await bob.bulkResume();
    await wait(100);
    const left = JSON.parse(storage.getItem('cb.outbox.v1'));
    check(server.calls.length === before && fetched === 0, 'bob replayed nothing (no api call, no plain replay)');
    check(left.length === 4 + 2 && left.every((e) => e.id === 'legacy' || e.entity === 'alice'), 'all of alice\'s entries and the unstamped one are still there, untouched');
    check(bob.CBOffline.jobs().length === 0 && bob.CBOffline.pending() === 0, 'bob sees no job of his own and nothing of alice\'s in his count');
    const alice2 = makePage(storage, server, 'alice');
    alice2.fetch = bob.fetch;
    await alice2.bulkResume();
    await wait(150);
    check(fetched === 1, 'alice back: her plain entry goes (once), not the unstamped one');
    check(alice2.CBOffline.jobs().length === 0, 'and her job finished');
  }

  console.log('503 then 200: retried with back-off; the four waits, then stop and name what is left');
  {
    const storage = makeStorage(), server = makeServer();
    const page = makePage(storage, server, 'alice');
    server.script = (ep, o, nth) => (o.params.id === 'c2' && nth === 1 ? () => Promise.reject(Object.assign(new Error('busy'), { status: 503 })) : null);
    const result = await archive(page, 3);
    check(result.done.length === 3 && result.failed.length === 0 && JSON.stringify(page.waits) === '[2000]', '503 then 200: all three done after one 2 s wait');
    const key = server.calls.filter((c) => c.id === 'c2').map((c) => c.key);
    check(key.length === 2 && key[0] === key[1], 'the retry carries the same key');

    const storage2 = makeStorage(), server2 = makeServer();
    const page2 = makePage(storage2, server2, 'alice');
    server2.script = (ep, o) => (o.params.id === 'c2' ? () => Promise.reject(Object.assign(new Error('busy'), { status: 429 })) : null);
    const stopped = await archive(page2, 4);
    check(JSON.stringify(page2.waits) === '[2000,5000,15000,30000]', 'the waits are 2, 5, 15, 30 s: ' + JSON.stringify(page2.waits));
    check(stopped.done.length === 1 && stopped.left === 3 && stopped.failed.length === 0, 'then it stops and names what is left: 1 done, 3 not done, none called failed');
    const heard = page2.ui.progress.batch.noteWords('busy', { seconds: 15 });
    check(heard === 'Server busy, trying again in 15 s', 'the busy words');
  }

  console.log('offline: the job waits for the connection, then goes on');
  {
    const storage = makeStorage(), server = makeServer();
    const page = makePage(storage, server, 'alice');
    page.goOnline(false);
    const running = archive(page, 3);
    await wait(60);
    check(server.calls.length === 0, 'nothing is sent while offline');
    page.goOnline(true);
    const result = await running;
    check(result.done.length === 3 && server.calls.length === 3, 'back online: all three go');
  }

  console.log('a private window: the device keeps nothing, and the job says so');
  {
    const storage = makeStorage(true), server = makeServer();
    const page = makePage(storage, server, 'alice');
    check(page.CBOffline.durable() === false, 'durable() is false');
    const result = await archive(page, 2);
    check(result.done.length === 2, 'the job still runs in the tab');
    check(page.spoken.includes("This browser can't keep the job. Closing this tab loses it."), 'the box says closing loses the job');
    const kept = makePage(makeStorage(), makeServer(), 'alice');
    await archive(kept, 2);
    check(kept.spoken.includes('Saved on this device. Safe to keep working or close.') && !kept.spoken.some((w) => /loses it/.test(w)), 'a device that keeps it says Saved on this device');
  }

  console.log('a job older than 48 h asks before it resumes');
  {
    const storage = makeStorage(), server = makeServer();
    const first = makePage(storage, server, 'alice', { dieAfter: 0 });
    quiet(archive(first, 3));
    await wait(60);
    const entries = JSON.parse(storage.getItem('cb.outbox.v1'));
    entries.forEach((e) => { e.job.at = Date.now() - 3 * 86400000; });
    storage.setItem('cb.outbox.v1', JSON.stringify(entries));
    const second = makePage(storage, server, 'alice');
    await second.bulkResume();
    await wait(60);
    check(second.asks.length === 1 && server.calls.length === 0 && /3 days ago/.test(second.asks[0].body), 'it asked ("saved 3 days ago") and sent nothing');
    second.asks[0].onCancel();
    check(JSON.parse(storage.getItem('cb.outbox.v1')).length === 0, 'Cancel drops the rest of it');
    const third = makePage(storage, server, 'alice', { dieAfter: 0 });
    quiet(archive(third, 2));
    await wait(40);
    const again = JSON.parse(storage.getItem('cb.outbox.v1'));
    again.forEach((e) => { e.job.at = Date.now() - 49 * 3600000; });
    storage.setItem('cb.outbox.v1', JSON.stringify(again));
    const fourth = makePage(storage, server, 'alice');
    await fourth.bulkResume();
    fourth.asks[0].onOk();
    await wait(150);
    check(server.calls.length === 2, 'Continue resumes it');
  }

  console.log('a replayed step that answers 404');
  {
    const storage = makeStorage(), server = makeServer();
    const first = makePage(storage, server, 'alice', { dieAfter: 0 });
    quiet(archive(first, 2));
    await wait(40);
    const entries = JSON.parse(storage.getItem('cb.outbox.v1'));
    entries[0].attempts = 1; /* the first attempt was made, its answer never came */
    storage.setItem('cb.outbox.v1', JSON.stringify(entries));
    server.script = () => () => Promise.reject(Object.assign(new Error('already archived'), { status: 404 }));
    const second = makePage(storage, server, 'alice');
    let result = null;
    second.ui.progress.batch.run = ((run) => (...args) => run(...args).then((r) => (result = r)))(second.ui.progress.batch.run);
    await second.bulkResume();
    await wait(150);
    check(result && result.done.length === 1 && result.failed.length === 1, 'tried before: 404 counts as done; never tried: 404 is a failure (1 done, 1 failed)');
  }

  console.log('QA-130: a categorise job resumes after a reload; each step is add / remove, never the record');
  {
    const storage = makeStorage(), server = makeServer();
    const first = makePage(storage, server, 'alice', { dieAfter: 1 });
    first.UI.prods = ids(12).map((id) => ({ id, name: 'P' + id })); first.UI.prodPicked = new Set(ids(12)); first.UI._catgBulk = { ids: ids(12), add: new Set(['cat-fruit']), remove: new Set(['cat-old']) };
    first.prodId = (x) => x.id; first.pData = (x) => x; first.renderApp = () => {};
    quiet(first.prodCategoriseApply());
    await wait(150);
    const stored = JSON.parse(storage.getItem('cb.outbox.v1') || '[]');
    check(stored.length === 2 && stored.every((e) => /^job:[0-9a-f]{32}:\d+$/.test(e.id)), 'the first page saved all 3 steps (12 ids on the slow class: 5, 5, 2), 1 answered, 2 left in the outbox');
    check(JSON.stringify(Object.keys(stored[0].body).sort()) === '["add","ids","remove"]' && stored[0].body.add[0] === 'cat-fruit' && stored[0].body.remove[0] === 'cat-old' && !('item_data' in stored[0].body), 'each saved step is { ids, add, remove }: no record, so a late replay cannot overwrite a newer edit');
    const second = makePage(storage, server, 'alice');
    await second.bulkResume();
    await wait(250);
    const perKey = {};
    server.calls.forEach((c) => { perKey[c.key] = (perKey[c.key] || 0) + 1; });
    check(server.calls.every((c) => c.ep === 'prodBulkCategories') && Object.keys(perKey).length === 3 && Object.values(perKey).every((n) => n === 1), 'the reloaded page finished the other two steps: 3 keys, each called once, all prodBulkCategories');
    check(second.toasts.some((t) => /^11 done · 1 failed/.test(t)), 'the resumed page counts 11 done and names the refused one as failed: ' + second.toasts.join(' | '));
  }

  console.log('status change stays in the open tab and says so');
  {
    const page = makePage(makeStorage(), makeServer(), 'alice');
    const batch = page.ui.progress.batch;
    check(batch.resumable('status') === false && batch.resumable('prodBulkUpdate') === false && batch.resumable('prodBulkCategories') === true && batch.resumable('archive') === true && batch.resumable('prodStatusBulk') === true, 'the resumable map: status (and the old replace-write) no; archive, product status and categorise yes');
    let refused = '';
    try { batch.resumable('somethingNew'); } catch (e) { refused = e.message; }
    check(/no resume setting/.test(refused), 'an action with no setting is refused, so none is left unclassified');
    let wrong = '';
    try { page.groupRun(['c1'], { action: 'archive', mount: 'WRK001-U57', speed: 'quick', verb: 'x', label: 'x', unit: 'x' }, async () => {}); } catch (e) { wrong = e.message; }
    check(/can resume/.test(wrong), 'a resumable action is not run through the in-tab path');
    check(batch.noteWords('keepopen') === "Keep this tab open. This action can't continue after a restart.", 'the keep-tab-open words');
    check(!html.includes('async function prodCategoriseSend(') && sourceOfApply().includes("ep: 'prodBulkCategories'"), 'categorise goes through groupJob (the replace-write step is gone)');
    check(!sourceOf('confirmStatus').includes('groupJob'), 'status change stays on the in-tab path (groupRun); #527 makes it resumable');
  }

  console.log('review fixes: a write the device refuses is never counted done');
  {
    const storage = makeStorage('quota'), server = makeServer();
    const page = makePage(storage, server, 'alice');
    const result = await archive(page, 3);
    check(page.CBOffline.durable() === false, 'the device refused the write, durable() says so');
    check(server.calls.length === 3 && result.done.length === 3, 'all three steps were really sent (3 calls) before being counted done, kept in memory');
    check(page.spoken.includes("This browser can't keep the job. Closing this tab loses it."), 'and the box says closing loses it');
    check((page.listeners.beforeunload || []).length === 1, 'the leave-the-page question came back after the device refused (durable() re-read after prepare)');

    const s2 = makeStorage(), v2 = makeServer();
    const p2 = makePage(s2, v2, 'alice');
    v2.script = (ep, o) => (o.params.id === 'c1' ? () => { const q = JSON.parse(s2.getItem('cb.outbox.v1')); s2.setItem('cb.outbox.v1', JSON.stringify(q.filter((e) => !/:1$/.test(e.id)))); return {}; } : null);
    const two = await archive(p2, 3);
    check(two.done.length === 1 && two.leftItems.length === 2 && two.failed.length === 0 && v2.calls.length === 1, 'another tab took step 2: it is left, not counted done (1 done, 2 left, 0 failed)');
  }

  console.log('review fixes: a page that does not stamp replays only what carries no entity');
  {
    const storage = makeStorage(), server = makeServer();
    storage.setItem('cb.outbox.v1', JSON.stringify([{ id: 'stamped', method: 'POST', path: '/api/a', entity: 'alice', tries: 0, queued_at: Date.now() }, { id: 'legacy', method: 'POST', path: '/api/b', tries: 0, queued_at: Date.now() }]));
    const page = makePage(storage, server, null, { noStamp: true });
    const sent = [];
    page.fetch = async (url) => { sent.push(url); return { status: 200, clone: () => ({ json: async () => ({}) }) }; };
    await page.CBOffline.flush();
    check(sent.length === 1 && sent[0].endsWith('/api/b'), 'only the unstamped legacy entry went');
    check(JSON.parse(storage.getItem('cb.outbox.v1')).map((e) => e.id).join() === 'stamped', 'the stamped entry is still there');
  }

  console.log('review fixes: pending counts your own; entries past 48 h are swept (plain entries, others\' job steps), your own old job stays to ask');
  {
    const storage = makeStorage(), server = makeServer();
    const old = Date.now() - 3 * 86400000, fresh = Date.now();
    const job = (who, at) => ({ id: 'job:' + who + ':0', ep: 'archive', params: { id: 'x' }, items: ['x'], entity: who, queued_at: at, tries: 0, attempts: 0, job: { id: who, kind: 'archive', step: 0, of: 1, total: 1, at } });
    storage.setItem('cb.outbox.v1', JSON.stringify([
      { id: 'a-old', entity: 'alice', queued_at: old, method: 'POST', path: '/p' }, { id: 'b-old', entity: 'bob', queued_at: old, method: 'POST', path: '/p' },
      { id: 'b-new', entity: 'bob', queued_at: fresh, method: 'POST', path: '/p' }, job('alice', old), job('bob', old)
    ]));
    const page = makePage(storage, server, 'alice');
    page.fetch = async () => ({ status: 200, clone: () => ({ json: async () => ({}) }) });
    check(page.CBOffline.pending() === 2, 'alice sees 2 of hers (not bob\'s)');
    await page.CBOffline.flush();
    const ids = JSON.parse(storage.getItem('cb.outbox.v1')).map((e) => e.id).sort().join();
    check(ids === 'b-new,job:alice:0', 'swept: both old plain entries and bob\'s old job step; kept: bob\'s new entry (waits for bob) and alice\'s old job (the tray asks): ' + ids);
  }

  console.log('review fixes: a sweep is never silent');
  {
    const storage = makeStorage(), server = makeServer();
    const old = Date.now() - 3 * 86400000;
    storage.setItem('cb.outbox.v1', JSON.stringify([
      { id: 'o1', entity: 'alice', queued_at: old, method: 'PATCH', path: '/api/products/p1' }, { id: 'o2', entity: 'alice', queued_at: old, method: 'POST', path: '/api/suppliers' },
      { id: 'b1', entity: 'bob', queued_at: old, method: 'POST', path: '/api/secret' }
    ]));
    const page = makePage(storage, server, 'alice');
    const told = [];
    page.CBOffline.configure({ onSwept: (swept) => told.push(swept) });
    page.fetch = async () => ({ status: 200, clone: () => ({ json: async () => ({}) }) });
    await page.CBOffline.flush();
    check(told.length === 1 && told[0].own.length === 2 && told[0].others === 1 && !JSON.stringify(told[0]).includes('/api/secret'), 'the page is told: 2 of her own (named) and 1 of another sign-in (a count only, no details)');
    check(JSON.parse(storage.getItem('cb.outbox.v1')).length === 0, 'and they are gone');
    check(html.includes('onSwept: bulkSweptNotice') && /function bulkSweptNotice[\s\S]*toast\(txf\('Changes saved offline more than 2 days ago/.test(html), 'app.html shows it as a toast in words (a text key)');
    let missing = '';
    ['ar', 'fr', 'hi', 'ta'].forEach((lang) => { if (!read('app/strings-' + lang + '.js').includes('more than 2 days ago were not sent') && !read('app/strings-' + lang + '.js').includes("'Changes saved offline")) missing += lang + ' '; });
    check(!missing, 'the key is in all four packs ' + missing);
  }

  console.log('review fixes: a 429 is not an applied attempt; a stopped job keeps its steps and asks on the next visit');
  {
    const storage = makeStorage(), server = makeServer();
    const page = makePage(storage, server, 'alice');
    server.script = (ep, o) => (o.params.id === 'c2' ? () => Promise.reject(Object.assign(new Error('slow down'), { status: 429 })) : null);
    const stopped = await archive(page, 4);
    const kept = JSON.parse(storage.getItem('cb.outbox.v1') || '[]');
    check(stopped.done.length === 1 && kept.length === 3 && kept.every((e) => e.job.paused === true), 'stopped: 1 done, the other 3 steps stay in the outbox, flagged paused');
    check(kept[0].attempts === 0, 'the 429 attempts did not count (attempts back to 0), so a later first real send that answers 404 is a failure');
    server.script = null;
    const next = makePage(storage, server, 'alice');
    await next.bulkResume();
    await wait(30);
    check(next.asks.length === 1 && /stopped part-way: 3 not done/.test(next.asks[0].body) && server.calls.length === 6, 'the next visit asks (3 not done) and sends nothing yet');
    next.asks[0].onOk();
    await wait(200);
    check(server.calls.length === 9 && JSON.parse(storage.getItem('cb.outbox.v1') || '[]').length === 0, 'Continue finishes it, the outbox is empty');
    const dropped = makePage(storage, server, 'alice');
    dropped.CBOffline.enqueueJob({ id: 'zz', kind: 'archive', total: 1 }, [{ ep: 'archive', params: { id: 'q' }, items: ['q'], names: ['q'] }]);
    dropped.CBOffline.pauseJob('zz');
    const again = makePage(storage, server, 'alice');
    await again.bulkResume();
    again.asks[0].onCancel();
    check(JSON.parse(storage.getItem('cb.outbox.v1') || '[]').length === 0, 'Cancel drops the rest');
  }

  console.log('review fixes: the outbox identity is the token\'s own id, the same before and after the profile loads (co-assist)');
  {
    const snippet = html.match(/entity: function \(\) \{\s*return (SESSION && \(SESSION\.actorId \|\| SESSION\.entityId\));\s*\}/);
    check(!!snippet, 'app.html configures the outbox entity from SESSION.actorId || SESSION.entityId (not UI._me)');
    const read = (session, me) => new Function('SESSION', 'UI', 'return ' + snippet[1])(session, { _me: me });
    const coAssist = { actorId: 'actor-1', entityId: 'entity-1' };
    check(read(coAssist, undefined) === 'actor-1' && read(coAssist, { identity_id: 'something-else' }) === 'actor-1', 'a co-assist reads actor-1 before and after UI._me loads');
    check(read({ entityId: 'entity-1' }, undefined) === 'entity-1', 'an entity login reads its entity id');
  }

  console.log('every state, in the recorded words');
  {
    const page = makePage(makeStorage(), makeServer(), 'alice');
    const words = (kind, values) => page.ui.progress.batch.noteWords(kind, values);
    const expected = {
      saving: 'Saving the job on this device…',
      saved: 'Saved on this device. Safe to keep working or close.',
      busy: 'Server busy, trying again in 15 s',
      offline: 'Offline. Will continue when back online',
      resumed: 'Continuing your job: 12 of 40 done',
      keepopen: "Keep this tab open. This action can't continue after a restart.",
      doneAll: '40 done',
      doneFailed: '38 done · 2 failed',
      stopped: 'Stopped: 20 done · 20 not done (still ticked)',
      seeWhich: 'See which'
    };
    const values = { seconds: 15, done: 12, total: 40 };
    Object.keys(expected).forEach((kind) => {
      const v = kind === 'doneAll' ? { done: 40 } : kind === 'doneFailed' ? { done: 38, failed: 2 } : kind === 'stopped' ? { done: 20, left: 20 } : values;
      check(words(kind, v) === expected[kind], kind + ': ' + expected[kind]);
    });
    check(page.ui.components.batchnote.code === 'CMP032' && page.ui.components.batchnote.nonButton, 'CMP032 is registered, not a button');
    let missing = '';
    ['ar', 'fr', 'hi', 'ta'].forEach((lang) => { const pack = read('app/strings-' + lang + '.js'); page.ui.progress.batch.noteKinds.concat('label').forEach((kind) => { if (!pack.includes("'CMP032." + kind + "'")) missing += lang + ':' + kind + ' '; }); });
    check(!missing, 'each state is a standard text key in all four packs ' + missing);
  }

  const core = read('app/core.js');
  console.log('core.js: the step names its own key');
  check(core.includes('idemKey: stepKey') && core.includes('if (stepKey) return stepKey'), 'api() takes opts.idemKey (the same hunk as #527)');
  check(/'prodStatusBulk'/.test(core.slice(core.indexOf('const OUTBOX_KEYS'), core.indexOf('const OUTBOX_KEYS') + 2500)), 'prodStatusBulk is an outbox name');
  check(/'prodBulkCategories'/.test(core.slice(core.indexOf('const OUTBOX_KEYS'), core.indexOf('const OUTBOX_KEYS') + 2500)), 'prodBulkCategories is an outbox name (QA-130)');
  check(html.includes('entity: function') && html.includes('SESSION.actorId || SESSION.entityId'), 'app.html configures the outbox with the signed-in entity');

  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
