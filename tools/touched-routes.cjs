#!/usr/bin/env node
'use strict';
/**
 * tools/touched-routes.cjs — THE TOUCH RULE FOR ROUTES (MNT-30): a change that touches a route leaves it at 13/13 in the API register.
 *
 * OWNS      the list of routes this change touched (new, or its handler hash moved against the base register) and, per route, how many of the
 *           13 machine columns pass; the §6 checklist line; the mode (warn or fail). It counts nothing the register does not already say:
 *           the columns, the status and the hash are read from docs/api-register.json, the base copy from git.
 * CALLED BY by hand and in the PR body (`node tools/touched-routes.cjs --md`); tests/touched-routes.test.cjs proves it offline.
 * FLOW      docs/api-register.json (head) + `git show <base>:docs/api-register.json` ──▶ routes whose hash moved or are new ──▶ columns passing
 *           ──▶ report · --md line · exit 1 only in FAIL mode with a touched route below 13/13
 * CARD      qa/api-register
 *
 * WARN MODE until the switch date (the readability touch rule's date, read from the web tool; without that tool, or without a readable base register, the tool prints one sentence and judges nothing): 205 of 637 routes
 * meet the standard today, so a hard rule would turn most open PRs red. `--strict` fails now. Regenerate the register first (node tools/api-register.cjs):
 * a route whose code moved but whose register row did not is not seen.
 *
 *   node tools/touched-routes.cjs [--base origin/main] [--md] [--strict] [--today YYYY-MM-DD]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const API = path.join(__dirname, '..');
const REGISTER = 'docs/api-register.json';

const WEB_TOUCH_RULE = path.join(API, '..', 'chitbridge-web', 'tools', 'readability', 'touch.cjs');

/** the switch date has ONE owner, the web tool's touch rule (FAIL_FROM); null when that tool is not beside this checkout: no second copy of the date */
function failFrom(webTool = WEB_TOUCH_RULE) {
  return fs.existsSync(webTool) ? require(webTool).FAIL_FROM : null;
}

/** warn or fail: an explicit option wins, else the date decides; 'skip' when there is no date to decide by */
function modeFor(today, option, from = failFrom()) {
  if (option === 'warn' || option === 'fail') return option;
  if (!from) return 'skip';
  return today >= from ? 'fail' : 'warn';
}

/** the routes the change touched: new in the head register, or their handler hash moved; each with its passing columns */
function touchedOf(baseRegister, headRegister) {
  const before = new Map(((baseRegister && baseRegister.routes) || []).map((route) => [route.key, route]));
  const columns = headRegister.machine_columns || [];
  return headRegister.routes
    .filter((route) => !before.has(route.key) || before.get(route.key).hash !== route.hash)
    .map((route) => ({
      key: route.key,
      file: route.file,
      isNew: !before.has(route.key),
      passing: columns.filter((column) => route.columns[column]).length,
      of: columns.length,
      meets: route.status === 'meets standard',
      failing: columns.filter((column) => !route.columns[column])
    }));
}

/** the verdict: how many touched routes are at 13/13, and which are not */
function judge(baseRegister, headRegister, mode) {
  const touched = touchedOf(baseRegister, headRegister);
  const below = touched.filter((route) => !route.meets);
  return { mode, touched, at13: touched.length - below.length, below, failed: mode === 'fail' && below.length > 0 };
}

/** the §6 checklist line: a report, always ticked; the exit code carries pass or fail */
function line(result, from = failFrom()) {
  const switchNote = result.mode === 'fail' ? 'FAIL mode' : 'report, warn mode' + (from ? ' until ' + from : '');
  return `- [x] Touch rule, routes (${switchNote}): routes touched ${result.touched.length} · at 13/13 ${result.at13} · below ${result.below.length}${result.below.length ? ' — each route a PR touches should end at 13/13' : ''}`;
}

/** the lines a person can act on: each route below 13/13 with the columns it lacks */
function report(result) {
  const lines = result.below.map((route) => `  ${result.mode === 'fail' ? '✗' : '⚠'} ${route.key} (${route.file}) ${route.passing}/${route.of}${route.isNew ? ' new' : ''} — lacks ${route.failing.join(', ') || 'a human column'}`);
  return [`touched routes: ${result.touched.length} · at 13/13: ${result.at13} · mode ${result.mode}`].concat(lines).join('\n');
}

/** the base register from git; null when it cannot be read (shallow clone, base ref missing): the caller then judges nothing */
function baseRegisterOf(baseRef) {
  const shown = spawnSync('git', ['-C', API, 'show', baseRef + ':' + REGISTER], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (shown.status !== 0) return null;
  try { return JSON.parse(shown.stdout); } catch (notJson) { console.error('base register is not JSON: ' + notJson.message); return null; }
}

/** read both registers, judge, print; the exit code: 1 only in fail mode with a touched route below 13/13 */
function main(argv) {
  const flag = (name) => {
    const at = argv.indexOf('--' + name);
    return at < 0 ? null : argv[at + 1] || true;
  };
  const head = JSON.parse(fs.readFileSync(path.join(API, REGISTER), 'utf8'));
  const from = failFrom(typeof flag('web-tool') === 'string' ? flag('web-tool') : WEB_TOUCH_RULE);
  const mode = modeFor(typeof flag('today') === 'string' ? flag('today') : new Date().toISOString().slice(0, 10), flag('strict') ? 'fail' : undefined, from);
  if (mode === 'skip') return console.log('web tool not found: touch rule skipped'), 0;
  const base = baseRegisterOf(String(flag('base') || 'origin/main'));
  if (!base) return console.log('base register unreadable: judgement skipped'), 0;
  const result = judge(base, head, mode);
  console.log(report(result));
  if (flag('md')) console.log('\n' + line(result, from));
  return result.failed ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { modeFor, touchedOf, judge, line, report };
