/**
 * tests/generated-files.test.cjs — a feature PR does not carry what a tool derives; the two line-per-entry files merge clean (Athi, 11 Nov: stop the generated-file clashes).
 *
 * OWNS      tools/generated-guard.cjs (allow-list of hand keys, derived files), tools/hand-file-fix.cjs (one entry per line, union-merge repair, duplicate keys),
 *           and the ratchet's two directions in strict mode (a count may not rise; a committed count may not sit above the code).
 * CALLED BY scripts/guards.cjs (the offline gate)
 * FLOW      pure functions on strings and objects; one real `git merge` with merge=union in a temp repo (the batch build's merge)
 * CARD      qa/generated-files
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const API = path.join(__dirname, '..');
const guard = require('../tools/generated-guard.cjs');
const fix = require('../tools/hand-file-fix.cjs');
const ratchet = require('../tools/api-ratchet.cjs');

let pass = 0; let fail = 0;
const t = (name, ok, why) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name + (why ? '\n        ' + why : '')); } };
console.log('\ngenerated files · guard, line layout, union merge, ratchet directions');

/* ---- the guard ---- */
t('guard: a PR touching the register json is refused and the message says how to put it back', (() => { const p = guard.problemsOf({ files: ['docs/api-register.json', 'routes/x.js'], base: {}, head: {} }); return p.length === 1 && /docs\/api-register\.json/.test(p[0]) && /git checkout/.test(p[0]); })());
t('guard: every derived file is covered', ['docs/API-REGISTER.md', 'docs/contracts/api-contract-results.json', 'docs/contracts/api-hardening-results.json', 'docs/contracts/api-hardening-evidence.json'].every((f) => guard.problemsOf({ files: [f], base: {}, head: {} }).length === 1));
t('guard: a PR touching only code, tests and the sign-offs passes', guard.problemsOf({ files: ['routes/x.js', 'tests/x.test.cjs', 'docs/api-signoffs.json', 'readability.ratchet.json'], base: {}, head: {} }).length === 0);
const R0 = { version: 1, stage: '2b', not_meeting: 97, total: 639, updated: '2026-11-10', debt: [], columns_failing: { a: 3 } };
t('guard: ratchet debt and stage edits are hand facts and pass', guard.problemsOf({ files: ['docs/api-ratchet.json'], base: R0, head: { ...R0, debt: [{ route: 'GET /x' }], stage: 'all' } }).length === 0);
t('guard: a LOWERED count in a feature PR is refused too (the batch writes it)', guard.problemsOf({ files: ['docs/api-ratchet.json'], base: R0, head: { ...R0, not_meeting: 90 } }).length === 1);
t('guard: a raised count is refused', guard.problemsOf({ files: ['docs/api-ratchet.json'], base: R0, head: { ...R0, not_meeting: 120 } }).length === 1);
t('guard: `updated` and a derived key added later are refused (allow-list, not deny-list)', guard.derivedRatchetChanges(R0, { ...R0, updated: '2026-11-11', brand_new_count: 4 }).join() === 'brand_new_count,updated');

/* ---- the ratchet itself: a count that goes backwards is refused, in regen and in strict ---- */
const head = (meets) => ({ stage: '2b', counts: { routes: 10, meets, columns: {} } });
const base = { stage: '2b', not_meeting: 3, total: 10, columns_failing: {} };
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const saved = process.env.CB_GENERATED;
process.env.CB_GENERATED = 'regen';
t('ratchet (regen): not_meeting 3 -> 4 is refused', quiet(() => ratchet.checkCounts(base, head(6), { stage: '2b', not_meeting: 4, total: 10 }, '2b')).length > 0);
t('ratchet (regen): not_meeting 3 -> 2 is accepted', quiet(() => ratchet.checkCounts(base, head(8), { stage: '2b', not_meeting: 2, total: 10 }, '2b')).length === 0);
process.env.CB_GENERATED = 'strict';
t('ratchet (strict): a committed count ABOVE the code is refused (a stale-high slack)', quiet(() => ratchet.checkCounts(base, head(8), { stage: '2b', not_meeting: 3, total: 10 }, '2b')).length > 0);
t('ratchet (strict): a committed count equal to the code is accepted', quiet(() => ratchet.checkCounts(base, head(8), { stage: '2b', not_meeting: 2, total: 10 }, '2b')).length === 0);
t('ratchet (strict): a rise is still refused', quiet(() => ratchet.checkCounts(base, head(6), { stage: '2b', not_meeting: 4, total: 10 }, '2b')).length > 0);
if (saved === undefined) delete process.env.CB_GENERATED; else process.env.CB_GENERATED = saved;

/* ---- the line layout ---- */
const E = (hash) => ({ hash, names_clear: true, signed_off_by_date: 'cb-api 2026-11-11 PR#1', lifecycle: 'stable' });
const HEAD = '{\n "about": "Hand file: test",\n "version": 1,\n "routes": {\n';
const entry = (key, value) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(value);
const file = (obj) => { const keys = Object.keys(obj).sort(); return HEAD + keys.map((k, i) => entry(k, obj[k]) + (i < keys.length - 1 ? ',' : '')).join('\n') + '\n }\n}\n'; };
const canon = (text) => fix.normalise('signoffs', text);
const BASE = { 'GET /a': E('h1'), 'GET /m': E('h5'), 'GET /z': E('h9') };

t('layout: a canonical file is returned unchanged, entries sorted', (() => { const r = canon(file(BASE)); return r.text === file(BASE) && r.count === 3; })());
t('layout: unsorted lines are sorted, a missing comma and an extra last comma are repaired', (() => { const messy = HEAD + entry('GET /z', E('h9')) + ',\n' + entry('GET /a', E('h1')) + '\n' + entry('GET /m', E('h5')) + ',\n }\n}\n'; return canon(messy).text === file(BASE); })());
t('layout: the same line twice is one entry', (() => { const twice = HEAD + entry('GET /a', E('h1')) + ',\n' + entry('GET /a', E('h1')) + '\n }\n}\n'; const r = canon(twice); return r.problems.length === 0 && r.count === 1; })());
t('layout: one key on two DIFFERENT lines is a stop for a person to pick', (() => { const two = HEAD + entry('GET /a', E('h1')) + ',\n' + entry('GET /a', E('h2')) + '\n }\n}\n'; const r = canon(two); return r.text === null && /GET \/a/.test(r.problems.join()); })());
t('layout: an older pretty-printed file is read through its JSON and laid out per line with the same content', (() => { const pretty = JSON.stringify({ about: 'Hand file: test', version: 1, routes: BASE }, null, 1).replace(/^\{\n "about": "Hand file: test"/, '{\n "about": "Hand file: test"'); const r = canon(pretty); return r.text === file(BASE); })());
t('layout: a stray non-entry line is reported, not dropped', canon(HEAD + entry('GET /a', E('h1')) + '\n garbage here\n }\n}\n').problems.length === 1);
t('layout: readability duplicate rows keep the LOWER score (a ratchet only goes down)', (() => { const row = (score) => ({ score, long40: 0 }); const parsed = fix.parseLines('{\n  "_about": "x",\n  "a.js": ' + JSON.stringify(row(3)) + ',\n  "a.js": ' + JSON.stringify(row(1)) + '\n}\n'); return fix.byKey(parsed.entries, 'readability').map.get('a.js').value.score === 1; })());
t('layout: the committed docs/api-signoffs.json and readability.ratchet.json are canonical', (() => { const run = require('child_process').spawnSync(process.execPath, [path.join(API, 'tools', 'hand-file-fix.cjs'), '--check'], { encoding: 'utf8', env: { ...process.env, CB_WEB_DIR: process.env.CB_WEB_DIR || path.join(API, '..', 'chitbridge-web') } }); return run.status === 0; })(), 'run: node tools/hand-file-fix.cjs --fix');

/* ---- the batch build's merge: two PRs add different routes, merge=union, then --fix; delete against edit ---- */
t('union merge: two branches adding NEIGHBOURING routes merge with no conflict, and --fix leaves a canonical file with both', (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const put = (obj) => fs.writeFileSync(path.join(dir, 'signoffs.json'), file(obj));
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(dir, '.gitattributes'), 'signoffs.json merge=union\n');
    put(BASE); git('add', '.'); git('commit', '-qm', 'base');
    git('checkout', '-qb', 'one'); put({ ...BASE, 'GET /n': E('h2') }); git('commit', '-qam', 'one');
    git('checkout', '-q', 'main'); git('checkout', '-qb', 'two'); put({ ...BASE, 'GET /o': E('h3') }); git('commit', '-qam', 'two');
    git('merge', '-q', '--no-edit', 'one');   // would conflict without the union driver (both add a line at the same spot)
    const merged = fs.readFileSync(path.join(dir, 'signoffs.json'), 'utf8').replace(/\r/g, '');
    const r = canon(merged);
    return r.problems.length === 0 && r.text === file({ ...BASE, 'GET /n': E('h2'), 'GET /o': E('h3') });
  } catch (e) { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})());
t('union merge: one PR edits a route sign-off, the other deletes it: the file still lays out and register --check judges the entry (union keeps lines, never decides)', (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const put = (obj) => fs.writeFileSync(path.join(dir, 'signoffs.json'), file(obj));
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(dir, '.gitattributes'), 'signoffs.json merge=union\n');
    put(BASE); git('add', '.'); git('commit', '-qm', 'base');
    git('checkout', '-qb', 'edit'); put({ ...BASE, 'GET /m': E('h6') }); git('commit', '-qam', 'edit');
    git('checkout', '-q', 'main'); git('checkout', '-qb', 'del'); const { 'GET /m': gone, ...rest } = BASE; put(rest); git('commit', '-qam', 'del');
    git('merge', '-q', '--no-edit', 'edit');
    const r = canon(fs.readFileSync(path.join(dir, 'signoffs.json'), 'utf8').replace(/\r/g, ''));
    /* union may keep the old line and the new line for the edited route: that is a duplicate key with different content -> a stop, or the edit wins alone; never a silent pick */
    return r.text === null ? /GET \/m/.test(r.problems.join()) : /"h6"/.test(r.text);
  } catch (e) { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})());
t('.gitattributes names the two line-per-entry files for the union driver', (() => { const text = fs.readFileSync(path.join(API, '.gitattributes'), 'utf8'); return /^docs\/api-signoffs\.json\s+merge=union$/m.test(text) && /^readability\.ratchet\.json\s+merge=union$/m.test(text); })());

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
