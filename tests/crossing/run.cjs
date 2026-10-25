#!/usr/bin/env node
'use strict';
// @type: system
/**
 * tests/crossing/run.cjs — THE HEADLESS RUNNER for trading across installations (the 25 Oct 2026 walk, R0-R30 + G1-G4, replayed by script). No browser.
 * OWNS      the command line · the preflight (tester code per installation) · the loop over the plan · the result file
 * CALLED BY a person / the coordinator on a machine with the SIT ssh key; toolset/pack.cjs lists it under the `crossing` area as a LIVE file (never run by a pack unless --live)
 * FLOW      args -> topology.json -> plan (lib/plan.cjs) -> [dry-run: print and stop] -> read the tester code over ssh (memory only) -> each scenario signs its shops in through the app's own door,
 *           drives the screen's routes, then reads BOTH installations' rows read-only -> table + JSON + exit code
 *
 *   node tests/crossing/run.cjs --multi                     every scenario (needs the SIT hosts and the ssh key)
 *   node tests/crossing/run.cjs --single sit-grund          only scenarios whose shops all live on sit-grund (G1-G3)
 *   node tests/crossing/run.cjs --multi --only R16,G3       those ids (+ their prerequisites, shown as such)
 *   node tests/crossing/run.cjs --multi --dry-run           print the plan; sign in nothing, open no ssh
 *   --allow-outage      also run R8 (it STOPS the api container on the far installation for about a minute and starts it again, even when a check throws)
 *   --topology <file>   another topology file  --out <file>   where the JSON result goes (default: the temp folder)  --run-id <id>
 * Exit: 0 no scenario failed (KNOWN and SKIP do not fail) - 1 a scenario failed - 2 wrong command line - 3 the preflight could not read a tester code.
 * Every run tags its chits "[CTPX <run id>]" and never deletes anything. The tester code is read at run time, held in memory, never printed or written.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const topology = require('./lib/topology.cjs');
const planLib = require('./lib/plan.cjs');
const report = require('./lib/report.cjs');
const { makeCtx } = require('./lib/ctx.cjs');
const registry = require('./scenarios/index.cjs');

const USAGE = 'usage: node tests/crossing/run.cjs (--single <installation> | --multi) [--only R16,G3] [--dry-run] [--allow-outage] [--topology f] [--out f] [--run-id id]';

/** the command line as options; throws a usage error in words */
function parseArgs(argv) {
  const o = { mode: null, installation: null, only: [], dryRun: false, flags: {}, topology: null, out: null, runId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--multi') o.mode = 'multi';
    else if (a === '--single') {
      o.mode = 'single';
      o.installation = argv[++i];
    } else if (a === '--only') o.only = String(argv[++i] || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--allow-outage') o.flags.allowOutage = true;
    else if (a === '--topology') o.topology = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--run-id') o.runId = argv[++i];
    else throw new Error('unknown argument ' + a + '\n' + USAGE);
  }
  if (!o.mode) throw new Error('say --single <installation> or --multi\n' + USAGE);
  if (o.mode === 'single' && !o.installation) throw new Error('--single needs an installation key\n' + USAGE);
  return o;
}

/** the dry-run text: the plan and what a live run would touch. Touches nothing. */
function planText(topo, plan, o) {
  const lines = ['PLAN  mode=' + o.mode + (o.installation ? ' ' + o.installation : '') + '  (dry-run: nothing is signed in, no ssh is opened)', 'id    state    pair            installations              title'];
  const hidden = plan.filter((r) => r.reason === 'not selected').length;
  for (const r of plan.filter((x) => x.reason !== 'not selected')) lines.push(r.id.padEnd(5) + ' ' + r.state.padEnd(8) + ' ' + String(r.pair).padEnd(15) + ' ' + r.installations.join('+').padEnd(26) + ' ' + r.title + (r.reason ? '  [' + r.reason + ']' : ''));
  if (hidden) lines.push('(' + hidden + ' scenarios not selected)');
  const live = plan.filter((r) => r.state !== 'skip');
  const shops = [...new Set(live.flatMap((r) => r.shops))];
  lines.push('', 'a live run would: read the tester code over ssh from ' + planLib.touched(plan).join(', ') + ' (memory only);');
  lines.push('sign in as ' + shops.map((k) => topo.shops[k].user_id + '@' + topo.installations[topo.shops[k].installation].host).join(', '));
  lines.push('and read (read-only psql) the databases of ' + planLib.touched(plan).join(', ') + '.');
  return lines.join('\n');
}

/** run one scenario; its recorder is turned into a row; a thrown error is a FAIL row, never a crash */
async function runOne(ctx, scenario, plan) {
  const rec = ctx.recorder(scenario.id);
  const t0 = Date.now();
  let error = null;
  try {
    await scenario.run(ctx, rec);
  } catch (err) {
    error = err;
  }
  return report.rowOf(plan, rec, error, Date.now() - t0);
}

async function main(argv) {
  const o = parseArgs(argv);
  const topo = topology.load(o.topology || undefined);
  const plan = planLib.buildPlan(topo, registry.all, { mode: o.mode, installation: o.installation, only: o.only, flags: o.flags });
  if (o.mode === 'single' && !topo.installations[o.installation]) throw new Error('unknown installation ' + o.installation + ' (known: ' + Object.keys(topo.installations).join(', ') + ')');
  if (o.dryRun) {
    console.log(planText(topo, plan, o));
    return 0;
  }
  const ctx = makeCtx(topo, Object.assign({ runId: o.runId }, o.flags));
  for (const key of planLib.touched(plan)) {
    try {
      await ctx.secret(key); // preflight: the tester code must be readable everywhere the plan goes
    } catch (err) {
      console.error('preflight: ' + err.message);
      return 3;
    }
  }
  console.log('run ' + ctx.runId + '  chits are tagged "' + ctx.tag + '"; nothing is deleted');
  const rows = [];
  const failed = new Set();
  for (const p of plan) {
    if (p.state === 'skip') {
      if (p.reason !== 'not selected') rows.push(report.skipRow(p, p.reason));
      if (p.reason !== 'not selected') failed.add(p.id);
      continue;
    }
    const blocked = p.requires.find((id) => failed.has(id));
    if (blocked) {
      rows.push(report.skipRow(p, 'prerequisite ' + blocked + ' did not pass'));
      failed.add(p.id);
      continue;
    }
    const row = await runOne(ctx, registry.byId(p.id), p);
    rows.push(row);
    if (row.status === 'FAIL') failed.add(p.id);
  }
  console.log('\n' + report.table(rows));
  const sum = report.summary(rows);
  console.log('\nPASS ' + sum.pass + '  FAIL ' + sum.fail + '  KNOWN ' + sum.known + '  SKIP ' + sum.skip);
  const file = o.out || path.join(os.tmpdir(), 'crossing-' + ctx.runId + '.json');
  fs.writeFileSync(file, JSON.stringify({ run_id: ctx.runId, mode: o.mode, installation: o.installation, finished: new Date().toISOString(), summary: sum, scenarios: rows }, null, 2));
  console.log('result: ' + file);
  return report.exitCode(rows);
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(2);
    }
  );
}

module.exports = { parseArgs, planText, main };
