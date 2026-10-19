// deploy/health-line.cjs — OWNS the ONE dated health line for PM/STATUS.md (PM-120 + HLT-1). CALLED BY cb-health (daily), by hand.
// FLOW: gather {health, mainSha, ci, stock} -> validate (fail loudly) -> format ONE line. Read-only: no sign-in, no writes except --write.
//   node deploy/health-line.cjs --fixture deploy/fixtures/health-line.ok.json     offline: prints the line
//   API_BASE=https://api… node deploy/health-line.cjs [--stock stock.json]       live: GET /health + `gh run list`; exit 1 if anything is red
// stock.json = {"drift":N,"chits_without_movement":N}: the counts come from the G-STOCK read-only query (STOCK-TRUTH-TESTS owns its text);
// absent -> the line says "stock n/a" instead of staying silent. Reuses deploy/proof-health.cjs's /health reading; that one stays the pass/fail proof.
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const REPOS = ['web', 'api', 'engines'];

/** Throws with a plain message unless the input has every field the line needs. */
function validate(d) {
  const bad = (m) => { throw new Error('bad health input: ' + m); };
  if (!d || typeof d !== 'object') bad('not an object');
  const h = d.health;
  if (!h || typeof h !== 'object') bad('health missing');
  if (typeof h.db !== 'string') bad('health.db missing');
  if (typeof h.environment !== 'string') bad('health.environment missing');
  if (!Number.isInteger(h.audit_lost) || h.audit_lost < 0) bad('health.audit_lost must be a whole number >= 0');
  if (h.db_ms !== undefined && typeof h.db_ms !== 'number') bad('health.db_ms must be a number');
  if (!d.mainSha || typeof d.mainSha.api !== 'string' || typeof d.mainSha.web !== 'string') bad('mainSha.api and mainSha.web needed');
  REPOS.forEach((r) => { if (!d.ci || typeof d.ci[r] !== 'string') bad('ci.' + r + ' needed (success|failure|…)'); });
  if (d.stock != null && (!Number.isInteger(d.stock.drift) || !Number.isInteger(d.stock.chits_without_movement))) bad('stock needs whole-number drift and chits_without_movement');
  return d;
}

/** True when the deployed commit starts with (or equals) main's sha; both short or long are fine. */
function sameSha(deployed, main) {
  const a = String(deployed || ''), b = String(main || '');
  return a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));
}

/** Builds { line, red[] } from validated input. */
function formatLine(d, date) {
  const h = d.health, red = [];
  const apiOk = h.environment === 'production' && h.db === 'ok';
  if (!apiOk) red.push('api not ok');
  const onMain = sameSha(h.commit, d.mainSha.api);
  if (!onMain) red.push('api commit behind main');
  const ci = REPOS.map((r) => d.ci[r] === 'success');
  const green = ci.filter(Boolean).length;
  if (green < REPOS.length) red.push('CI not green');
  if (h.audit_lost > 0) red.push('audit_lost ' + h.audit_lost);
  const stock = d.stock ? 'stock drift ' + d.stock.drift + ' · no-movement ' + d.stock.chits_without_movement : 'stock n/a (query pending)';
  if (d.stock && (d.stock.drift > 0 || d.stock.chits_without_movement > 0)) red.push('stock drift');
  const line = date + ' · api ' + (apiOk ? 'prod ok' : 'RED ' + h.environment + '/' + h.db) + (h.db_ms != null ? ' db ' + h.db_ms + 'ms' : '') +
    ' commit=' + (onMain ? 'main' : 'BEHIND(' + String(h.commit || '-').slice(0, 7) + '→' + d.mainSha.api.slice(0, 7) + ')') +
    ' · web ' + (d.web || 'unchecked') +
    ' · CI ' + green + '/' + REPOS.length + ' green · audit_lost ' + h.audit_lost + ' · ' + stock;
  return { line, red };
}

function gh(args) { return execFileSync('gh', args, { encoding: 'utf8' }).trim(); }

/** Live read: /health plus the newest main run per repo; read-only. */
async function gather(apiBase, stockFile) {
  const health = await (await fetch(apiBase.replace(/\/+$/, '') + '/health')).json();
  const ci = {}, mainSha = {};
  REPOS.forEach((r) => {
    const out = gh(['run', 'list', '-R', 'maharishia07/chitbridge-' + r, '-b', 'main', '-L', '1', '--json', 'conclusion,headSha']);
    const run = JSON.parse(out)[0] || {};
    ci[r] = run.conclusion || 'none'; mainSha[r] = run.headSha || '';
  });
  const stock = stockFile ? JSON.parse(fs.readFileSync(stockFile, 'utf8')) : undefined;
  return { health, mainSha, ci, stock, web: 'unchecked' };
}

async function main(argv) {
  const at = (f) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : null);
  const fixture = at('--fixture');
  const data = fixture ? JSON.parse(fs.readFileSync(fixture, 'utf8')) : await gather(process.env.API_BASE || '', at('--stock'));
  const { line, red } = formatLine(validate(data), (data.date || new Date().toISOString().slice(0, 10)));
  console.log(line);
  if (red.length) console.error('RED: ' + red.join('; '));
  return red.length ? 1 : 0;
}

module.exports = { validate, formatLine, sameSha };
if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error('✗ ' + e.message); process.exit(2); });
