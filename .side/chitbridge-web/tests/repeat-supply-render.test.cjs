'use strict';
/* MNT (6 Nov 2026): public/app/cap-repeat.js, Repeat supply as an agreement, run in node with a stub page: the schedule in words
   ("every 2 weeks"), the per-run money as frozen (never a sum), a verb button greyed WITH the server's sentence, the schedule guard's
   sentences, whether a sheet model is an agreement, and the list's sorts, filter and columns. Pins the text the readability pass must not change.
   Run: node tests/repeat-supply-render.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const cx = vm.createContext({
  console, EP: {}, tx: (s) => s, esc: (s) => String(s == null ? '' : s),
  document: { getElementById: () => null, querySelector: () => null }, fmtMoney: (minor, cur) => cur + ' ' + minor
});
cx.window = cx;
vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cap-repeat.js', 'utf8'), cx);
const run = (code) => vm.runInContext(code, cx);

ok(run("rpEvery({ unit: 'weekly', every: 2 })") === 'every 2 weeks', 'every 2 weeks reads "every 2 weeks"');
ok(run("rpEvery({ unit: 'daily', every: 1 })") === 'every day', 'every 1 day reads "every day"');
ok(run("rpMoney({ money: { total: 500, currency_code: 'INR' }, currency: 'AUD' })") === 'AUD 500', 'the per-run money is the frozen total in the agreement currency');
ok(run("rpMoney({ money: {} })") === '—' && run('rpMoney(null)') === '—', 'no frozen total shows a dash, never a made-up sum');

const live = run("rpBtn({ agreement_id: 'a1', actions: { run: { ok: true } } }, 'run', 'rp-run-a1')");
ok(live.includes('data-verb="run"') && !live.includes('disabled') && live.includes("CBRepeat.act('a1','run',this)"), 'an allowed verb is an enabled button calling the one action handler');
const greyed = run("rpBtn({ agreement_id: 'a1', actions: { end: { ok: false, say: 'Already ended' } } }, 'end', 'rp-end-a1', '', true)");
ok(greyed.includes('disabled') && greyed.includes('title="Already ended"') && greyed.includes('rp-end-a1-say'), 'a refused verb is greyed WITH the server sentence, on the control and beside it');
ok(run("rpBtn({ actions: {} }, 'run', 'x')") === '', 'a verb the server does not list shows no button');
const says = run("rpSaysHTML({ actions: { run: { ok: false, say: 'Paused' }, end: { ok: false, say: 'Paused' }, skip: { ok: true } } }, ['run', 'end', 'skip'])");
ok(says.includes('Run now · End: Paused') && !says.includes('Skip'), 'greyed verbs share one sentence, listed once with the verbs it refuses');

run("RP.draft = { every: 0, start_on: '2026-11-01', until: 'none', runs: 12, on: '' };");
ok(run("rpGuard('schedule')") === 'Every how many? 1 to 365.', 'every 0 is refused with its sentence');
run("RP.draft.every = 2; RP.draft.start_on = ''");
ok(run("rpGuard('schedule')") === 'From when?', 'no start date asks "From when?"');
run("RP.draft.start_on = '2026-11-01'; RP.draft.until = 'runs'; RP.draft.runs = 0;");
ok(run("rpGuard('schedule')") === 'How many runs?', 'until a number of runs needs the number');
run("RP.draft.until = 'on'; RP.draft.on = 'soon';");
ok(run("rpGuard('schedule')") === 'Until when?', 'until a date needs a real date');
run("RP.draft.until = 'none';");
ok(run("rpGuard('schedule')") === null && run("rpGuard('review')") === null, 'a good schedule, or another step, passes');

ok(run("rpIsAgreement({ bj: { repeat: { agreement_id: 'x' } } })") === true && run("rpIsAgreement({ bj: {} })") === false, 'a chit is an agreement when send stamped an agreement id');

const sorts = run('rpSorts()');
const rows = [{ next_on: '2026-12-01', customer: { name: 'Zed' }, state: 'agreed' }, { next_on: null, customer: { name: 'Amy' }, state: 'paused' }, { next_on: '2026-11-01', state: 'ended' }];
ok(rows.slice().sort(sorts[0].cmp).map((r) => r.state).join() === 'ended,agreed,paused', 'sorted by next run, a row with no date last');
ok(rows.slice().sort(sorts[1].cmp)[0].state === 'ended', 'sorted by customer name, a nameless row first');
const filter = run('rpFilters()')[0];
ok(filter.match({ state: 'paused' }, 'live') && filter.match({ state: 'countered' }, 'waiting') && filter.match({ state: 'declined' }, 'over') && !filter.match({ state: 'agreed' }, 'over'), 'the filter splits running, waiting on them and ended');
const cols = run('rpCols()');
ok(cols.map((c) => c.key).join() === 'customer,money,next,last,state,act', 'the list has customer, money, next, last, state and action columns');
ok(cols[2].cell({ state: 'agreed', next_on: '2026-11-01', due: true }).includes('Due') && cols[2].cell({ state: 'ended' }).includes('—'), 'the next-run cell flags a due run; an ended agreement shows a dash');
console.log(n + ' checks, all ok');
