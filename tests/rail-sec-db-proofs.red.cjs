#!/usr/bin/env node
/**
 * rail-sec-db-proofs.red.cjs — THE RED SIDE of the 2026-11-14 proof pass (RAIL-30 · RAIL-65 · RAIL-71 · RAIL-121 · RAIL-141 a · SEC-23 · PLT-67 · DB-74). Not enrolled (nothing runs it in CI; it is the
 * evidence that each proof can FAIL): for each claim it breaks ONE line of the code that does the job and runs the proof against the broken code. Every row must go red
 * (exit 1, a FAIL line printed) — a row whose mutation did not apply (exit 9) or that stayed green is a proof that proves nothing, and this file exits 1.
 * RUN       node tests/rail-sec-db-proofs.red.cjs
 * HOW       the five new proofs read their code through tests/lib-proof-mutate.cjs (PROOF_MUT env: file, from, to); PLT-67 and DB-74 are older tests that read the files directly,
 *           so those two files are broken in place from a copy held in memory and restored in a finally.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const rows = [
  // RAIL-71
  ['RAIL-71', 'db/index.js withTransaction never rolls back', 'rail-71-with-transaction.test.cjs', 'db/index.js', "try { await client.query('ROLLBACK'); } catch (rbErr) { console.error('Rollback failed:', rbErr.message); }", ''],
  ['RAIL-71', 'db/index.js withTransaction never commits', 'rail-71-with-transaction.test.cjs', 'db/index.js', "await client.query('COMMIT');", ''],
  ['RAIL-71', 'dispute creation outside the transaction primitive', 'rail-71-with-transaction.test.cjs', 'routes/chits.js', 'const raised = await withEntity(entity_id, (client) =>', 'const raised = await ((e, f) => f({ query }))(entity_id, (client) =>'],
  ['RAIL-71', 'legacy /send fan-out outside withTransaction', 'rail-71-with-transaction.test.cjs', 'routes/chits.js', 'await withTransaction(async (client) => {\n    await creditCap.holdUnderLock(client, sendState); /* ACC-286 */', 'await (async (f) => f({ query }))(async (client) => {\n    await creditCap.holdUnderLock(client, sendState); /* ACC-286 */'],
  // RAIL-30
  ['RAIL-30', 'a draft is metered too', 'rail-30-meter-chit-send.test.cjs', 'routes/chits.js', 'const { sender_id, purpose, is_draft, chit_id, summary, summary_json } = sendState;\n  if (!is_draft) {', 'const { sender_id, purpose, is_draft, chit_id, summary, summary_json } = sendState;\n  if (true) {'],
  ['RAIL-30', 'the send is metered under another name', 'rail-30-meter-chit-send.test.cjs', 'routes/chits.js', ".meter(sender_id, 'chit.send', {", ".meter(sender_id, 'chit.sent', {"],
  ['RAIL-30', 'the basis no longer travels with the charge', 'rail-30-meter-chit-send.test.cjs', 'routes/chits.js', 'basis: summary && summary.total_value != null ? summary.total_value : null,', 'basis: null,'],
  ['RAIL-30', 'the floating meter promise is no longer caught', 'rail-30-meter-chit-send.test.cjs', 'routes/chits.js', 'meta: { purpose: purpose || undefined }\n        })\n        .catch(cbLog.orElse(\'chits: failed — carried on without it\'));', 'meta: { purpose: purpose || undefined }\n        });'],
  ['RAIL-30', 'the meter is silent when it fails', 'rail-30-meter-chit-send.test.cjs', 'lib/meter.js', "log.warn('usage not metered'", "(() => {})('usage not metered'"],
  ['RAIL-30', 'the meter lets a ledger failure reach the send', 'rail-30-meter-chit-send.test.cjs', 'lib/meter.js', 'return false;\n  }\n}', 'throw e;\n  }\n}'],
  // RAIL-121
  ['RAIL-121', 'the stored roster names the raiser alone (the walk bug)', 'rail-121-dispute-participants-both-sides.test.cjs', 'routes/chits.js', "partyIds.map((pid) => ({ entity_id: pid, display_name: partyNames[pid] || null, role: 'party' }))", '[]'],
  ['RAIL-121', 'the read shows only the raiser', 'rail-121-dispute-participants-both-sides.test.cjs', 'routes/chits.js', 'const parts = (roster || disputeRow.participants || []).map((item) => ({', "const parts = (roster || disputeRow.participants || []).filter((item) => item.role === 'raiser').map((item) => ({"],
  ['RAIL-121', 'only the raiser gets a copy', 'rail-121-dispute-participants-both-sides.test.cjs', 'routes/chits.js', 'const audience = [...new Set([entity_id, ...partyIds])];', 'const audience = [entity_id];'],
  // RAIL-65
  ['RAIL-65', 'money.sum adds across currencies', 'rail-65-labelled-never-converted.test.cjs', 'lib/money.js', 'if (currencies.length > 1) {', 'if (false) {'],
  ['RAIL-65', 'the bill door skips the currency check on a cell', 'rail-65-labelled-never-converted.test.cjs', 'lib/currency-cells.js', 'Money.assertSameCurrency({ amount: 0, currency: cell.currency }, { amount: 0, currency: shop }, cell.field);', '/* skipped */'],
  ['RAIL-65', 'a rail file reaches the rate table', 'rail-65-labelled-never-converted.test.cjs', 'lib/mint.js', "'use strict';", "'use strict'; const _fx = require('./fx-rates');"]
];

let bad = 0;
const report = (id, label, red, why) => { if (!red) bad++; console.log((red ? 'red  ' : 'FAIL ') + id + ' · ' + label + ' → ' + why); };

for (const [id, label, test, file, from, to] of rows) {
  const ran = spawnSync(process.execPath, [path.join(__dirname, test)], { env: { ...process.env, PROOF_MUT: JSON.stringify({ file, from, to }) }, encoding: 'utf8', timeout: 90000 });
  const out = ran.stdout + ran.stderr;
  const firstFail = (out.split('\n').find((l) => /^FAIL /.test(l)) || '').slice(0, 110);
  if (ran.status === 9) report(id, label, false, 'the mutation did not apply (' + file + ')');
  else report(id, label, ran.status === 1 && !!firstFail, ran.status === 1 ? firstFail : 'stayed green (exit ' + ran.status + ')');
}

/* the two older proofs read their files directly: break in place, run, restore from the copy held in memory */
const inPlace = [
  ['PLT-67', 'the master upserts over a taken key', 'plt-67-register-member-taken.test.cjs', 'lib/netmember.js', 'if (reason) throw Object.assign(', 'if (false) throw Object.assign('],
  ['PLT-67', 'a retired member is revived by --update', 'plt-67-register-member-taken.test.cjs', 'lib/netmember.js', "row.active === false ? 'belongs to a retired member'", "row.active === false && !update ? 'belongs to a retired member'"],
  ['RAIL-141', 'open() believes an envelope when no verifier is handed in (finding a)', 'ctp-conformance.test.cjs', 'lib/ctpenvelope.js', "if (!ctx || typeof ctx.verify !== 'function') return no('no way to check the signature here — refused');", ''],
  ['SEC-23', 'the actor PIN door is no longer the one sign-in handler', 'signin-routes.test.cjs', 'routes/actors.js', "...checked('POST /login'), signin.verifyChecks, validate, signin.handlers.verify);", "...checked('POST /login'), signin.verifyChecks, validate, signin.handlers.ask);"],
  ['DB-74', 'the connect plan no longer needs DATABASE_URL first', 'hosting-neutral.test.cjs', 'db/connect-config.js', "if (!plan.length || plan[0].label !== 'DATABASE_URL') throw new Error('Invalid DATABASE_URL');", ''],
  ['DB-74', 'DATABASE_URL\'s password is copied to the pooler attempt', 'hosting-neutral.test.cjs', 'db/connect-config.js', "const url = String(env[name] || '').trim();", "const url = String(env[name] || env.DATABASE_URL || '').trim();"]
];
for (const [id, label, test, file, from, to] of inPlace) {
  const target = path.join(ROOT, file);
  const original = fs.readFileSync(target, 'utf8');
  if (!original.includes(from)) { report(id, label, false, 'the mutation did not apply (' + file + ')'); continue; }
  try {
    fs.writeFileSync(target, original.replace(from, () => to));
    const ran = spawnSync(process.execPath, [path.join(__dirname, test)], { env: process.env, encoding: 'utf8', timeout: 90000 });
    const out = ran.stdout + ran.stderr;
    const firstFail = (out.split('\n').find((l) => /FAIL|not ok|AssertionError/.test(l)) || '').trim().slice(0, 110);
    report(id, label, ran.status !== 0, ran.status !== 0 ? (firstFail || 'exit ' + ran.status) : 'stayed green');
  } finally {
    fs.writeFileSync(target, original);
  }
}
console.log(bad ? '\n' + bad + ' proof(s) did not go red' : '\nevery proof goes red under its mutation');
process.exit(bad ? 1 : 0);
