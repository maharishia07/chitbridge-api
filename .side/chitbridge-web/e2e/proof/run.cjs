'use strict';
// @type: system
/* OWNS: the proof runner — runs the chosen packs one after another against the stack that is already up, then writes junit-proof.xml and summary.md
   (pass/fail per pack, per page, per width). CALLED BY: .github/workflows/proof.yml (and by hand on a laptop with a local stack).
     node e2e/proof/run.cjs --packs a11y,keyboard,walks,walk-locale.cjs [--widths 1366,390] [--out out/proof] [--only crm,till] [--strict]
   Packs: a11y (axe serious+critical, 19 pages) · keyboard (tab/focus/popups, 19 pages) · walks (every fixture walk, the six shards of e2e/run-shard.cjs, one after another)
          · a single e2e file by name (e2e/walk-*.cjs or till-*.cjs).
   Exit: 1 when a pack could not run or a page errored or a walk failed; an a11y / keyboard FINDING (serious or critical, a trap, Esc not closing) is a FAIL row in the
   report and a ::warning, not a red job, unless --strict (a proof measures; the baseline decides). */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const L = require('./lib.cjs');
const E2E = path.join(__dirname, '..'), OUT = path.resolve(L.arg('out', 'out/proof')), STRICT = L.argv.includes('--strict');
const PACKS = String(L.arg('packs', 'a11y,keyboard')).split(',').map((s) => s.trim()).filter(Boolean);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
fs.mkdirSync(OUT, { recursive: true });
const rows = [];   // { pack, name, r: 'pass'|'fail'|'error', msg }
const row = (pack, name, r, msg) => rows.push({ pack, name, r, msg: msg || '' });
const pass = () => process.argv.includes('--only') ? ['--only', L.arg('only', '')] : [];
// the stack flags go on to the packs unchanged (--base/--api/--remote-ok/--users/--server/--as/--tz: a SIT box run, see lib.cjs); the packs' own lib decides what is allowed
const FWD = ['base', 'api', 'shop', 'remote-ok', 'users', 'server', 'as', 'tz'].flatMap((n) => (L.argv.includes('--' + n) ? ['--' + n, L.arg(n, '')] : []));

function runNode(args, timeoutMin) {
  const r = spawnSync(process.execPath, args, { cwd: path.join(E2E, '..'), stdio: 'inherit', timeout: timeoutMin * 60000, env: process.env });
  return r.status === null ? -1 : r.status;
}
function packA11y() {
  const out = path.join(OUT, 'a11y.json'), code = runNode([path.join(__dirname, 'a11y.cjs'), '--out', out, '--widths', L.WIDTHS.join(','), '--shots', path.join(OUT, 'shots'), ...pass(), ...FWD], 40);
  if (!fs.existsSync(out)) return row('a11y', 'pack', 'error', 'no result file (exit ' + code + ')');
  for (const p of JSON.parse(fs.readFileSync(out, 'utf8')).pages) for (const [w, m] of Object.entries(p.vp)) {
    const name = p.page + ' @' + w;
    if (m.err) row('a11y', name, 'error', m.err);
    else if (m.s + m.c > 0) row('a11y', name, 'fail', m.c + ' critical, ' + m.s + ' serious: ' + Object.entries(m.rules).filter(([, x]) => /serious|critical/.test(x.impact)).map(([k, x]) => k + 'x' + Object.keys(x.nodes).length).join(', '));
    else row('a11y', name, 'pass', m.mod + ' moderate (not counted)');
  }
}
function packKeyboard() {
  const out = path.join(OUT, 'keyboard.json'), code = runNode([path.join(__dirname, 'keyboard.cjs'), '--out', out, '--widths', L.WIDTHS.join(','), '--shots', path.join(OUT, 'shots'), ...pass(), ...FWD], 60);
  if (!fs.existsSync(out)) return row('keyboard', 'pack', 'error', 'no result file (exit ' + code + ')');
  for (const p of JSON.parse(fs.readFileSync(out, 'utf8')).pages) {
    const name = p.page + ' @' + p.width, bad = (p.popups || []).filter((x) => x.escCloses === false).length;
    const facts = 'tab stops ' + (p.tab ? p.tab.n : '?') + ', skip link ' + (p.skip ? 'yes' : 'no') + ', popups ' + (p.popups ? p.popups.length : 0) + ', writes blocked ' + p.writesBlocked;
    if (p.err) row('keyboard', name, 'error', p.err);
    else if (p.dataNotLoaded && p.dataNotLoaded.length) row('keyboard', name, 'error', 'data not loaded, popups and rows not counted: ' + p.dataNotLoaded.slice(0, 3).join(', '));
    else if (p.keyboardTrap || bad) row('keyboard', name, 'fail', (p.keyboardTrap ? 'keyboard trap at ' + p.keyboardTrap + '; ' : '') + (bad ? bad + ' popup(s) Esc does not close; ' : '') + facts);
    else row('keyboard', name, 'pass', facts);
  }
}
function packWalks() {
  for (let s = 1; s <= 6; s++) { const code = runNode([path.join(E2E, 'run-shard.cjs'), String(s), '6'], 25); row('walks', 'shard ' + s + ' of 6', code === 0 ? 'pass' : 'error', code === 0 ? '' : 'exit ' + code); }
}
function packFile(f) {
  if (!/^(walk|till)-[a-z0-9-]+\.cjs$/.test(f) || !fs.existsSync(path.join(E2E, f))) return row(f, 'pack', 'error', 'not a walk/till file in e2e/: ' + f);
  const code = runNode([path.join(E2E, f)], 20); row(f, f, code === 0 ? 'pass' : 'error', code === 0 ? '' : 'exit ' + code);
}
for (const p of PACKS) { if (p === 'a11y') packA11y(); else if (p === 'keyboard') packKeyboard(); else if (p === 'walks') packWalks(); else packFile(p.replace(/^e2e\//, '')); }

// ---- junit + summary ----
const by = {}; for (const r of rows) (by[r.pack] = by[r.pack] || []).push(r);
const x = ['<?xml version="1.0" encoding="UTF-8"?>', '<testsuites>'];
for (const [pack, rs] of Object.entries(by)) {
  x.push('<testsuite name="proof ' + esc(pack) + '" tests="' + rs.length + '" failures="' + rs.filter((r) => r.r !== 'pass').length + '">');
  for (const r of rs) x.push('<testcase classname="proof.' + esc(pack) + '" name="' + esc(r.name) + '">' + (r.r === 'pass' ? '' : '<failure message="' + esc(r.msg) + '"/>') + '</testcase>');
  x.push('</testsuite>');
}
x.push('</testsuites>'); fs.writeFileSync(path.join(OUT, 'junit-proof.xml'), x.join('\n'));
const md = ['## Proof run', '', 'web `' + (process.env.PROOF_WEB_REF || 'local') + '` · api `' + (process.env.PROOF_API_REF || 'local') + '` · widths ' + L.WIDTHS.join(', ') + ' · base ' + L.BASE, '', '| pack | pass | fail | error |', '|---|---|---|---|'];
for (const [pack, rs] of Object.entries(by)) md.push('| ' + pack + ' | ' + rs.filter((r) => r.r === 'pass').length + ' | ' + rs.filter((r) => r.r === 'fail').length + ' | ' + rs.filter((r) => r.r === 'error').length + ' |');
for (const [pack, rs] of Object.entries(by)) {
  const open = rs.filter((r) => r.r !== 'pass'); md.push('', '### ' + pack + (open.length ? ' - not clean' : ' - clean'), '');
  if (open.length) { md.push('| page | result | detail |', '|---|---|---|'); for (const r of open) md.push('| ' + r.name + ' | ' + r.r + ' | ' + r.msg.replace(/\|/g, '/').slice(0, 220) + ' |'); }
  md.push('', 'Passing: ' + (rs.filter((r) => r.r === 'pass').map((r) => r.name).join(', ') || 'none'));
}
fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
const fails = rows.filter((r) => r.r === 'fail').length, errs = rows.filter((r) => r.r === 'error').length;
if (fails && process.env.GITHUB_ACTIONS) console.log('::warning title=proof findings::' + fails + ' page/width rows with findings (see the job summary)');
console.log('proof: ' + rows.length + ' rows, ' + fails + ' findings, ' + errs + ' errors -> ' + OUT);
process.exit(errs || (STRICT && fails) ? 1 : 0);
