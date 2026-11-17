// @type: unit
/**
 * messages-threads.test.cjs - the replies list (public/app/cap-messages.js) lifted into a vm sandbox: threads, unread, filter, load, age words.
 *   node e2e/messages-threads.test.cjs
 * OWNS      the proof that ONE thread is made per chit + line (a message with no line is its own thread, never folded into a line's), a thread reads oldest first with the
 *           newest as its headline and the list is newest thread first, the unread count (per thread and overall) counts messages with no read_at, the Order/Task filter works on
 *           the THREAD and toggles off on the second press, loadMessages takes the three reply shapes and says its error in words, and msgWhen words (just now / Nm / Nh).
 * CALLED BY .github/workflows/ci.yml (offline, no browser, no api).
 * CARD      22-channels-capture-and-messaging/messages-replies-list
 * Hand data: m1 C1/L1 10:00 unread, m2 C1/L1 11:00 read, m3 C1/no line 02-Nov unread, m4 C2/L9 03-Nov unread -> 3 threads, order C2, C1-noline, C1-L1; unread 3 overall, 1 in C1/L1.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-messages.js'), 'utf8');
let apiCalls = [], apiAnswer = null;
const sb = { document: { getElementById: () => null }, console, Date, String, Math,
  CBLocale: { date: (d) => 'DATE:' + d.toISOString().slice(0, 10) },
  api: async (name, opts) => { apiCalls.push({ name, opts }); if (apiAnswer instanceof Error) throw apiAnswer; return apiAnswer; }, toast: () => {} };
vm.createContext(sb); vm.runInContext(SRC, sb, { filename: 'cap-messages.js' });
const run = (code) => vm.runInContext(code, sb);
const D = [
  { chit_id: 'C1', line_id: 'L1', created_at: '2026-11-01T10:00:00Z', read_at: null, track: 'order' },
  { chit_id: 'C1', line_id: 'L1', created_at: '2026-11-01T11:00:00Z', read_at: '2026-11-01T12:00:00Z', track: 'order' },
  { chit_id: 'C1', line_id: null, created_at: '2026-11-02T09:00:00Z', read_at: null, track: 'order' },
  { chit_id: 'C2', line_id: 'L9', created_at: '2026-11-03T09:00:00Z', read_at: null, track: 'task' }
];
const load = (rows) => { sb.__rows = JSON.parse(JSON.stringify(rows)); run('RPL.data = __rows; RPL.track = ""; RPL.open = {};'); };
const keys = () => run('msgThreads()').map((t) => t.chit_id + '/' + (t.line_id || '-'));

(async () => {
  load(D);
  ok(keys().join() === 'C2/L9,C1/-,C1/L1', 'three threads: one per chit+line, a no-line message is its own thread, newest thread first (' + keys().join() + ')');
  const th = run('msgThreads()').find((t) => t.line_id === 'L1');
  ok(th.msgs.length === 2 && th.msgs[0].created_at < th.msgs[1].created_at && th.latest.created_at === '2026-11-01T11:00:00Z', 'a thread reads oldest first and its headline is the newest');
  ok(th.unread === 1 && run('msgUnread()') === 3, 'unread: 1 in C1/L1, 3 overall (messages with no read_at)');
  ok(run('msgKey({chit_id:"C1",line_id:null})') === run('msgKey({chit_id:"C1"})') && run('msgKey({chit_id:"C1",line_id:"L1"})') !== run('msgKey({chit_id:"C1"})'), 'the thread key separates a line from the whole-order conversation');
  run('rplTrack("task")');
  ok(keys().join() === 'C2/L9', 'filter Task keeps the one task thread');
  run('rplTrack("task")');
  ok(run('RPL.track') === '' && keys().length === 3, 'pressing Task again switches the filter off');
  run('rplTrack("order")');
  ok(keys().join() === 'C1/-,C1/L1', 'filter Order keeps the two order threads');
  run('RPL.open = {x:1}; rplTrack("task")');
  ok(Object.keys(run('RPL.open')).length === 0, 'changing the filter closes the open threads');
  load([]); ok(run('msgThreads()').length === 0 && run('msgUnread()') === 0, 'no messages: no threads, 0 unread');

  apiAnswer = { messages: D }; apiCalls = []; await run('loadMessages()');
  ok(run('RPL.data').length === 4 && apiCalls[0].name === 'msgInbox' && JSON.stringify(apiCalls[0].opts) === '{}', 'loadMessages: {messages} shape, plain inbox asks with no query');
  apiAnswer = { items: D.slice(0, 2) }; await run('loadMessages()'); ok(run('RPL.data').length === 2, 'loadMessages: {items} shape');
  apiAnswer = D.slice(0, 3); await run('loadMessages()'); ok(run('RPL.data').length === 3, 'loadMessages: a bare array');
  apiAnswer = null; await run('loadMessages()'); ok(run('RPL.data').length === 0, 'loadMessages: an empty answer is an empty list, not a crash');
  run('RPL.all = true'); apiAnswer = { messages: [] }; apiCalls = []; await run('loadMessages()'); ok(JSON.stringify(apiCalls[0].opts) === '{"query":{"all":1}}', 'Show all asks with query all=1'); run('RPL.all = false');
  apiAnswer = new Error('Server said no'); await run('loadMessages()'); ok(run('RPL.err') === 'Server said no' && run('RPL.busy') === false, 'a failed read keeps the words and clears busy');
  apiAnswer = { message: 'x' }; apiAnswer = Object.assign(new Error(''), {}); await run('loadMessages()'); ok(run('RPL.err') === 'Could not read your messages.', 'an error with no words says "Could not read your messages."');

  const ago = (ms) => new Date(Date.now() - ms).toISOString(); sb.__a = ago(20 * 1000); sb.__b = ago(5 * 60000 + 500); sb.__c = ago(3 * 3600000 + 500); sb.__d = ago(3 * 86400000);
  ok(run('msgWhen(__a)') === 'just now' && run('msgWhen(__b)') === '5m ago' && run('msgWhen(__c)') === '3h ago' && /^DATE:/.test(run('msgWhen(__d)')) && run('msgWhen("")') === '', 'msgWhen: 20 s = just now, 5 min = 5m ago, 3 h = 3h ago, 3 days = a date, empty = nothing');

  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
