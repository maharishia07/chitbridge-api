#!/usr/bin/env node
/* standards-one-list.cjs — ONE STANDARDS LIST (STDREG1, 2026-10-14). Pure node, no browser: run `node e2e/standards-one-list.cjs` (exit 1 on a failure).
 *
 * catalogue-model.js kept its own 19-standard list and it disagreed with the register (UN/ECE Rec 20: "roadmap" there, In force here). The register,
 * public/app/cap-standards.js, is the ONE list; everything else names a row by its `id`. This proves it:
 *  1  every register row has a unique `id` and a product area (`pa`) from STD_PRODUCT_AREAS; every compat.json row a `pa` too
 *  2  catalogue-model.js names standards only by id (STANDARD_REFS), every id is on the register, and it exports no list of its own
 *  3  no second standards list anywhere in public/: no object outside the register carries a register row's shape (n · w · s:'live|part|plan')
 *     or the old catalogue shape (name · body · status:'in code|roadmap|by reference|vocabulary')
 *  4  the design's data.js holds no rows (derived from the register), and e2e/standards-page.cjs counts rows from the source, never a fixed number
 *  5  CMP-24 (2026-10-28): every standard this repo CITES is a register row (its n · id · w · note · aka) or a named exclusion in
 *     public/data/standards-mentioned.json (name · kind · why · cited); nothing is on both; and the guard bites when a row is taken away
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

const REGF = path.join(PUB, 'app', 'cap-standards.js');
const ctx = { tx: (s) => s, esc: (s) => String(s) }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(REGF, 'utf8') + ';this.R = { S: STANDARDS, PA: STD_PRODUCT_AREAS, compat: stdCompatRows };', ctx);
const R = ctx.R, PAS = R.PA.map((a) => a[0]);

/* 1 */
const noId = R.S.filter((r) => !/^[a-z0-9][a-z0-9.-]*$/.test(r.id || ''));
ok(noId.length === 0, 'every one of the ' + R.S.length + ' register rows has an id' + (noId.length ? ' — none on: ' + noId.map((r) => r.n).join('; ') : ''));
const ids = R.S.map((r) => r.id), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
ok(dup.length === 0, 'no id is used twice' + (dup.length ? ' — ' + dup.join(', ') : ''));
const noPa = R.S.filter((r) => PAS.indexOf(r.pa) < 0);
ok(noPa.length === 0, 'every row names its product area, one of the ' + PAS.length + ' in STD_PRODUCT_AREAS' + (noPa.length ? ' — not on: ' + noPa.map((r) => r.n).join('; ') : ''));
const CJ = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'compat.json'), 'utf8')).rows || [];
ok(CJ.every((x) => PAS.indexOf(x.pa) >= 0) && R.compat({ rows: CJ }).length === CJ.length, 'every compat.json row names its product area and maps onto the register (' + CJ.length + ')');

/* 2 */
const CM = require(path.join(PUB, 'app', 'catalogue-model.js'));
ok(!('STANDARDS' in CM) && Array.isArray(CM.STANDARD_REFS) && typeof CM.standards === 'function', 'catalogue-model.js exports ids (STANDARD_REFS) and a reader (standards()), no list of its own');
const missing = CM.standards(R.S).filter((x) => x.missing).map((x) => x.id);
ok(CM.STANDARD_REFS.length > 0 && missing.length === 0, 'every one of its ' + CM.STANDARD_REFS.length + ' ids is a register row' + (missing.length ? ' — not on the register: ' + missing.join(', ') : ''));
ok(CM.STANDARD_REFS.every((x) => Object.keys(x).sort().join() === 'id,where'), 'and each names only its id and where in the model it is implemented (no name, no status of its own)');
const rec20 = CM.standards(R.S).filter((x) => x.id === 'unece-rec20')[0];
ok(rec20 && rec20.s === R.S.filter((r) => r.id === 'unece-rec20')[0].s, 'Rec 20 reads the same status in both places (' + (rec20 && rec20.s) + ') — the drift this round was opened for');

/* 3 */
function walk(d, out) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f, out); } else if (/\.(js|html|json)$/.test(e.name)) out.push(f); }); return out; }
const REG_SHAPE = /\{[^{}]*\bn\s*:\s*['"][^'"]+['"][^{}]*\bw\s*:\s*['"][^{}]*\bs\s*:\s*['"](?:live|part|plan)['"]/;
const OLD_SHAPE = /\{[^{}]*\bname\s*:\s*['"][^'"]+['"][^{}]*\bbody\s*:\s*['"][^{}]*\bstatus\s*:\s*['"](?:in code|roadmap|by reference|vocabulary)['"]/;
const second = walk(PUB, []).filter((f) => f !== REGF).filter((f) => { const t = fs.readFileSync(f, 'utf8'); return REG_SHAPE.test(t) || OLD_SHAPE.test(t); });
ok(second.length === 0, 'no second standards list in public/ — only the register holds rows' + (second.length ? ' — found in: ' + second.map((f) => path.relative(ROOT, f)).join(', ') : ''));

/* 4 */
const DJ = fs.readFileSync(path.join(ROOT, 'docs', 'design', 'standards-page', 'data.js'), 'utf8');
ok(!/"rows"\s*:\s*\[|\brows\s*:\s*\[\s*\{/.test(DJ) && /STANDARDS\.map\(/.test(DJ), 'the design\'s data.js holds no rows: it derives them from the register');
const SP = fs.readFileSync(path.join(__dirname, 'standards-page.cjs'), 'utf8');
ok(!/REG\.S\.length\s*===\s*\d+/.test(SP) && !/DESIGN\.rows/.test(SP), 'e2e/standards-page.cjs counts the register from the source, never a fixed number, and compares against no copy');

/* 5 */
const SCAN = require(path.join(ROOT, 'tools', 'standards-scan.cjs'));
const LISTF = path.join(PUB, 'data', 'standards-mentioned.json');
const allow = SCAN.readAllowList(LISTF), ALLOW_KINDS = ['holds', 'research', 'detail'];
ok(allow.length > 0 && allow.every((x) => ALLOW_KINDS.indexOf(x.kind) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.since || '')), 'every one of the ' + allow.length + ' mentioned-only standards says its kind (holds · research · detail), why, where it is cited and since when');
const regKeys = R.S.map(SCAN.rowKeys), allowKeys = new Set(allow.map((x) => SCAN.keyOf(x.name)));
const onBoth = allow.filter((x) => regKeys.some((keys) => keys.some((k) => k.includes(SCAN.keyOf(x.name)))));
ok(onBoth.length === 0, 'no mentioned-only standard is also answered by a register row' + (onBoth.length ? ' — ' + onBoth.map((x) => x.name).join(', ') : ''));
ok(R.S.filter((r) => 'aka' in r).every((r) => Array.isArray(r.aka) && r.aka.length && r.aka.every((a) => typeof a === 'string' && a.length > 2)), 'aka, where a row has it, is a list of other names');
const webScan = SCAN.scanRoots([path.join(PUB, 'app'), path.join(ROOT, 'docs')], LISTF);
const verdict = SCAN.judge(webScan.found, regKeys, allowKeys);
ok(verdict.missing.length === 0, 'every standard cited in public/app and docs (' + Object.keys(webScan.found).length + ') is a register row or a named exclusion' + (verdict.missing.length ? ' — on neither: ' + verdict.missing.join(', ') : ''));
const withoutCsv = SCAN.judge(webScan.found, regKeys.filter((_, i) => R.S[i].id !== 'rfc4180'), allowKeys);
ok(withoutCsv.missing.indexOf('RFC 4180') >= 0, 'the guard bites: take the RFC 4180 row away and its citation is reported as on neither list');

/* 6  UX-137 (2026-11-08): the seven UI build standards are register rows, each with a product area and a status, so the UI standard page can link them */
const UI_ROWS = ['wai-aria-1-2', 'wcag-2.5.8', 'iso-9241-110', 'iso-9241-161', 'html-living-standard', 'w3c-design-tokens', 'ui-identity-codes'];
const missingUi = UI_ROWS.filter((id) => !R.S.some((r) => r.id === id && PAS.indexOf(r.pa) >= 0 && /^(live|part|plan)$/.test(r.s)));
ok(missingUi.length === 0, 'the ' + UI_ROWS.length + ' UI build standards are on the register with an area and a status' + (missingUi.length ? ' — missing or incomplete: ' + missingUi.join(', ') : ''));

console.log('\n' + pass + ' passed · ' + fail + ' failed');
process.exit(fail ? 1 : 0);
