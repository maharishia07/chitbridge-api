'use strict';
// @type: unit
/**
 * a3c-client-view.test.cjs - A3C (auditor paper 17 Nov): the Day book's review-by-exception filters, the carried period (D1), the focus kept after a Check, the key that marks. No browser, no api.
 * OWNS      hand-computed fixtures (8 entries, section below) run through the REAL books-grant-filters.js, cap-evidence.js stateOf, helpers.js dayBookKind and the REAL books-grant-drill.js openLedger query
 * CALLED BY by hand: node e2e/a3c-client-view.test.cjs   (A3C_MUTATE=period | focus | typing must fail it)
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const mutate = process.env.A3C_MUTATE || '';
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

/* the real sources, loaded into one sandbox */
const box = { URLSearchParams, setTimeout, console };
box.window = box; box.globalThis = box;
vm.createContext(box);
const kinds = src('day-book-kind.js'); /* moved out of helpers.js: the Day book's group and party line */
vm.runInContext(kinds, box);
vm.runInContext(src('cap-evidence.js'), box);
vm.runInContext(src('books-grant-filters.js'), box);
const F = box.CBBooksGrantFilters;

/* THE FIXTURE, by hand. entry, event_type, evidence, mark  ->  kind, evidence key, mark filter
 *  e1 sale            {}                   none          -> Sales     nodoc  Not checked
 *  e2 sale            {doc:true}           clear         -> Sales     none   Checked
 *  e3 purchase        flag no_tax_invoice  none          -> Purchases flag   Not checked
 *  e4 purchase        {count:1}            open (query)  -> Purchases held   Not checked, Queried
 *  e5 manual_journal  (no evidence field)  hold          -> Other     ''     Not checked, On hold
 *  e6 reversal        {doc:true}           clear+altered -> Other     none   Not checked (a check that changed after review)
 *  e7 zzz_unknown     {}                   reject        -> Other     nodoc  Not checked
 *  e8 expense         {count:3}            clear         -> Expenses  held   Checked
 * bar: of 8, checked 2 (e2, e8) -> Not checked must be 8 - 2 = 6; Checked 2; Queried 1; On hold 1.            */
const E = [
  ['e1', 'sale', {}, null], ['e2', 'sale', { doc: true }, 'clear'], ['e3', 'purchase', { flag: 'no_tax_invoice' }, null], ['e4', 'purchase', { count: 1 }, 'open'],
  ['e5', 'manual_journal', undefined, 'hold'], ['e6', 'reversal', { doc: true }, 'clear!'], ['e7', 'zzz_unknown', {}, 'reject'], ['e8', 'expense', { count: 3 }, 'clear']
].map(([id, type, ev, m]) => ({ entry_id: id, event_type: type, evidence: ev, _m: m }));
const marks = {}; E.forEach((e) => { if (e._m) marks[e.entry_id] = { state: e._m.replace('!', ''), altered: e._m.endsWith('!') }; });
const mk = { markOf: (id) => marks[id] || { state: 'none', altered: false } };
const filt = F.filtersFor(mk), by = (k) => filt.find((f) => f.key === k);
const ids = (k, v) => E.filter((e) => by(k).match(e, v)).map((e) => e.entry_id).join(',');
const bar = { of: 8, checked: 2 };

check(by('ev').options.map((o) => o.label).join('|') === box.CBEvidence.words.flag + '|' + box.CBEvidence.words.none + '|' + box.CBEvidence.words.nodoc + '|' + box.CBEvidence.words.held, 'the Evidence options use the chip own words (one wording per state)');
check(ids('mark', 'checked') === 'e2,e8' && ids('mark', 'checked').split(',').length === bar.checked, 'Checked shows e2,e8 and equals the bar n (2)');
check(ids('mark', 'notchecked').split(',').length === bar.of - bar.checked, 'Not checked equals the bar m - n (8 - 2 = 6): ' + ids('mark', 'notchecked'));
check(ids('mark', 'notchecked') === 'e1,e3,e4,e5,e6,e7', 'Not checked holds the altered check (e6), the refused (e7), the queried (e4) and the held (e5)');
check(ids('mark', 'query') === 'e4' && ids('mark', 'hold') === 'e5', 'Queried is e4, On hold is e5');
check(ids('ev', 'flag') === 'e3' && ids('ev', 'none') === 'e2,e6' && ids('ev', 'nodoc') === 'e1,e7' && ids('ev', 'held') === 'e4,e8', 'Evidence: no tax invoice e3, no file e2 e6, no source e1 e7, has a file e4 e8; e5 (no evidence field) is in none and does not throw');
check(ids('kind', 'Sales') === 'e1,e2' && ids('kind', 'Purchases') === 'e3,e4' && ids('kind', 'Expenses') === 'e8' && ids('kind', 'Other') === 'e5,e6,e7', 'Type: the Day book own kinds; a journal, a reversal and an unknown event type are Other, none throws');
const typed = ['Sales', 'Purchases', 'Expenses', 'Returns', 'Receipts', 'Payments', 'Other'].reduce((n, v) => n + E.filter((e) => by('kind').match(e, v)).length, 0);
check(typed === E.length, 'every entry is in exactly one Type (8 of 8, none lost)');
check(F.filtersFor(null)[0].match({ entry_id: 'x' }, 'notchecked') === true && [].filter((e) => by('mark').match(e, 'notchecked')).length === 0, '0 entries: nothing to match; no marker control: an entry is Not checked, no throw');
check(F.toAddress({ mark: 'notchecked', kind: 'Other' }) === 'dbf_mark=notchecked&dbf_kind=Other' && JSON.stringify(F.fromAddress('?open=1&dbf_ev=flag&dbf_mark=hold')) === '{"mark":"hold","ev":"flag"}' && JSON.stringify(F.fromAddress('')) === '{}', 'the choices ride the address and come back from it');

check(F.carry('?open=c1&view=daybook&dbf_kind=Other', 'c1') === '&dbf_kind=Other' && F.carry('?open=c1&dbf_kind=Other', 'c2') === '' && F.carry('?open=c1', 'c1') === '', 'the address carries the narrowing for the same client only');

/* D1: the ledger is read for the picked period */
let drill = src('books-grant-drill.js');
if (mutate === 'period') drill = drill.replace(/else if \(ctx\.period[^\n]*\n?/, '\n');
const seen = [];
const dbox = { console, setTimeout };
dbox.window = dbox;
dbox.CBBooksGrantApi = { run: (call, key, o) => { seen.push({ key, query: o.query }); return Promise.reject({ status: 500, message: 'stop' }); } };
dbox.CBBooksActing = { headers: () => ({}) };
dbox.tx = (s) => s;
dbox.esc = (s) => String(s);
dbox.document = { getElementById: () => null };
vm.createContext(dbox);
vm.runInContext(drill, dbox);
const ctx = (more) => Object.assign({ call: null, sheet: () => {}, mountList: () => {} }, more);
const acct = { code: '1500', name: 'Business bank account' };
dbox.CBBooksGrantDrill.openLedger(ctx({ period: { from: '2025-07-01', to: '2026-06-30' } }), acct);
dbox.CBBooksGrantDrill.openLedger(ctx({ day: '2026-03-31', period: { from: '2025-07-01', to: '2026-06-30' } }), acct);
dbox.CBBooksGrantDrill.openLedger(ctx({}), acct);
check(seen[0].query.from === '2025-07-01' && seen[0].query.to === '2026-06-30', 'D1: a ledger opened from a 30 June 2026 trial balance asks 1 Jul 2025 to 30 Jun 2026 (red before: no dates, so the server read 1 Jul 2026 to today)');
check(seen[1].query.to === '2026-03-31' && seen[1].query.from === undefined, 'a typed day still wins (as at that day)');
check(seen[2].query.from === undefined && seen[2].query.to === undefined, 'no period picked: the server default, as before');
const view = src('books-grant-view.js');
check(/period: grantKit\.viewState\.period/.test(view), 'the view hands its period to the drill');

/* rank 8: focus kept, a key that marks */
let cap = src('cap-mark.js');
if (mutate === 'focus') cap = cap.replace('next.focus()', '0');
let keys = src('books-grant-list.js');
if (mutate === 'typing') keys = keys.replace('/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || ', '');
check(/keepFocus\(host, button, hostControl\.ctl\.set\(id, 'clear', '', button\)\)/.test(cap) && /next\.focus\(\)/.test(cap), 'a Check hands the focus to the row new chip, not the page top');
check(/event\.key !== 'c' && event\.key !== 'q'/.test(keys) && /\^\(INPUT\|TEXTAREA\|SELECT\)\$/.test(keys) && /ctrlKey \|\| event\.metaKey \|\| event\.altKey/.test(keys), 'c and q act only on a row, never in Search or with a modifier');
check(/mark\.markOf\(entry\.entry_id\)\.state === 'none'/.test(keys) && /mark\.mayCheck\(entry\.entry_id\)/.test(keys), 'c writes only the auditor own Check, only where the server says the seat may and the entry carries no mark (one write per entry, one stamp each, no bulk)');
check(!/\b(POST|PUT|PATCH|DELETE)\b/.test(src('books-grant-filters.js')), 'the filters file has no write');

process.exit(failures ? 1 : 0);
