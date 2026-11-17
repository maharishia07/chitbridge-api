'use strict';
/* ACC-342 (2026-11-13): a To do row with no action (api kind bills_not_in_books) shows its count and sentence and NO button — no dead
   "Open" that toasts "starts after an update". A row with an action keeps its one button. Run: node tests/acc342-todo-no-action.test.cjs */
const fs = require('fs'), assert = require('assert'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/../public/accounts.html', 'utf8');
const start = html.indexOf('const todoOff'), end = html.indexOf('function todoGo');
const rowAt = html.indexOf('function todoButton'), rowEnd = html.indexOf('async function accTodo');
assert(start > 0 && rowAt > end && rowEnd > rowAt, 'todo helpers found');
const ctx = { esc: (v) => String(v), tx: (v) => v };
vm.createContext(ctx);
vm.runInContext(html.slice(start, end) + html.slice(rowAt, rowEnd), ctx);
const withGo = ctx.todoRow({ kind: 'ledgers', count: 2, words: 'two to sort', action: { screen: 'ledgers', label: 'Sort' } }, 0);
assert(/<button[^>]*data-testid="todo-go-ledgers"/.test(withGo) && withGo.includes('>Sort<'), 'with an action: the button');
const noGo = ctx.todoRow({ kind: 'bills_not_in_books', count: 3, words: 'three bills not in the books' }, 1);
assert(!/<button/.test(noGo) && !noGo.includes('todo-go'), 'no action: no button');
assert(noGo.includes('todo-n-bills_not_in_books') && noGo.includes('three bills not in the books'), 'no action: count and sentence stay');
console.log('  ok  To do row: button only with an action');
