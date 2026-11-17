'use strict';
/* MNT (6 Nov 2026): public/app/cap-tasks.js, the Tasks and Orders screen, run in node with a stub page: it mounts, reads GET /api/work/list
   through the registry name workList, and hands CBList its rows, columns, filters and orders; the list's cells say the stage word with its
   marks, who holds it and how many lines are open; a greyed action carries the server's sentence (actRow); a host page that throws in its
   callback no longer goes silent (the failure is said in the log). Pins the behaviour the readability pass must not change.
   Run: node tests/tasks-orders-list.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const logged = [], calls = [];
let config = null;
const node = () => new Proxy({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], showModal() {}, close() {}, value: '' }, { get: (t, k) => (k in t ? t[k] : undefined), set: (t, k, v) => { t[k] = v; return true; } });
const nodes = {};
const rows = [
  { chit_id: 'c1', kind: 'order_in', stage: 'new', word: 'New', channel: 'online', fulfilment: 'pickup', subject: 'Bolts', party: 'Ravi', assignee: { name: 'Meena' }, lines_n: 3, lines_open_n: 2, age_days: 2, billed: true, requested_for: '2026-11-09' },
  { chit_id: 'c2', kind: 'task', stage: 'closed', word: 'Done', lines_n: 0, age_days: 0, stuck: true, stuck_why: 'No reply' }
];
const sandbox = {
  console, esc: (s) => String(s == null ? '' : s), tx: (s) => s, bkMoney: (m, c) => c + ' ' + m,
  document: { getElementById: (id) => nodes[id] || (nodes[id] = node()) },
  cblog: (level, words) => logged.push(level + ': ' + words),
  EP: {}, CBList: { mount: (host, cfg) => { config = cfg; return { destroy() {}, refresh() {} }; } },
  api: (key) => { calls.push(key); return Promise.resolve(key === 'workList' ? { rows, counts: { orders_in: 1 }, total: 2 } : {}); }
};
const cx = vm.createContext(sandbox);
cx.window = cx; cx.globalThis = cx;
vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cap-tasks.js', 'utf8'), cx);
const T = cx.CBTasks;

(async () => {
  ok(T && T.VIEWS.join() === 'orders_in,orders_out,tasks,done' && typeof T.mount === 'function', 'the screen offers its four views and a mount');
  const greyed = T.actRow('tk_do_bill', 'Bill it', { ok: false, say: 'Already billed' }, '', 'quiet');
  ok(greyed.includes('disabled') && greyed.includes('title="Already billed"') && greyed.includes('tk_do_bill-why'), 'a refused action is greyed with the server sentence, on the button and beside it');
  ok(!T.actRow('x', 'Go', { ok: true }, '<i>extra</i>').includes('disabled') && T.actRow('x', 'Go', undefined, '<i>extra</i>').includes('<i>extra</i>'), 'an allowed action is live and keeps its extra');

  const handle = T.mount(nodes.root = node(), { view: 'tasks', embed: true, onCounts: () => { throw new Error('host broke'); }, onView: () => { throw new Error('view broke'); } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  ok(calls[0] === 'workList' && config && config.rows().length === 2, 'mounting reads the work list by its registry name and hands CBList the rows');
  ok(config.columns.length >= 5 && config.columns.every((c) => c.key && typeof c.cell === 'function'), 'every column has a key and a cell');
  ok(logged.some((line) => /counts callback of the host page failed — host broke/.test(line)), 'a host callback that throws is said in the log, not swallowed');

  const sorts = config.sorts;
  ok(sorts[0].key === 'age' && rows.slice().sort(sorts[0].cmp)[0].chit_id === 'c2', 'sorted by newest first (age in days, smaller first)');
  const filters = config.filters.map((f) => f.key);
  ok(filters.includes('state') && filters.includes('assignee'), 'the list filters by where it is and who has it');
  const assignee = config.filters.find((f) => f.key === 'assignee');
  ok(assignee.match(rows[1], 'none') && !assignee.match(rows[0], 'none') && assignee.match(rows[0], 'Meena'), 'the Who has it filter finds no-one, and a named person');
  const state = config.filters.find((f) => f.key === 'state');
  ok(state.match(rows[1], 'stuck') && state.match(rows[0], 'new'), 'the Where it is filter finds stuck rows and rows by stage');
  const text = config.search(rows[0]);
  ok(/Bolts/.test(text) && /Ravi/.test(text) && /Meena/.test(text), 'search covers the subject, the party and the assignee');

  handle.show('done');
  await new Promise((resolve) => setTimeout(resolve, 20));
  ok(logged.some((line) => /view callback of the host page failed — view broke/.test(line)), 'a view callback that throws is said in the log too');
  console.log(n + ' checks, all ok');
})().catch((error) => { console.error(error); process.exit(1); });
