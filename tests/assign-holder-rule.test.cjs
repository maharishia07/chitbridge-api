/**
 * tests/assign-holder-rule.test.cjs — ASSIGN-1 W1 (cb-people): ONE rule for "may this person hold this work?", no database.
 *
 * HAND-COMPUTED (critic W1, D1 rows 27 and 34; the register's `assignable` word per plug):
 *   task / unknown plug   the holder is an EDITOR by the one level function (lib/access.levelOf): hat act or manager with no level; or any hat with level editor.
 *                         hat audit / mis / view_only with no level = commenter = NOT; hat act with level viewer = NOT (the level wins, as the web has always read it).
 *   client (a job chit)   any person of the team, read-only included: holding a job writes nothing.
 *   the SQL               holderSql(plug) is that same ladder: `TRUE` for a seat plug; for a task it names every level and every editor hat from lib/access, no literal list of its own.
 *   the helper            a stranger / a word / a person off shift answer null; a person of the team who passes answers the row; it composes teamAmong (asks it first).
 *   one copy              no route or lib spells `hat IN ('act','manager')` any more (the eight copies of W1 are gone).
 *   the list              every row of GET /api/actors carries `assignable` (task rule) and `job_assignable` (seat rule), so the web computes nothing.
 * Run: node tests/assign-holder-rule.test.cjs
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { mayHold, holderSql, assignableActor } = require('../lib/assign-chit');
const access = require('../lib/access');
const { listedActor } = require('../lib/actors-contract');

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
  }
};

/* ── the pure rule ───────────────────────────────────────────────────────────────────── */
const ROWS = [
  [{ hat: 'act' }, true, 'hat act, no level'],
  [{ hat: 'manager' }, true, 'hat manager, no level'],
  [{ hat: 'audit' }, false, 'hat audit, no level = commenter'],
  [{ hat: 'mis' }, false, 'hat mis'],
  [{ hat: 'view_only' }, false, 'hat view_only'],
  [{ hat: 'audit', access_level: 'editor' }, true, 'hat audit but level editor (the level wins, as the web reads it)'],
  [{ hat: 'act', access_level: 'viewer' }, false, 'hat act but level viewer (the level wins)'],
  [{ hat: 'act', access_level: 'commenter' }, false, 'hat act, level commenter'],
  [{ access_level: 'editor' }, true, 'level editor, no hat'],
  [{}, true, 'nothing set = editor (lib/access: an absent level means editor, never a silent demotion)']
];
for (const [person, want, what] of ROWS) {
  check('task: ' + what + ' → ' + want, mayHold('task', person) === want);
  check('an unknown plug is the task rule: ' + what, mayHold('no-such-plug', person) === want);
  const viewOnly = person.access_level === 'viewer' || (!person.access_level && person.hat === 'view_only');
  check('client (a job): ' + what + ' → ' + !viewOnly + ' (A5: a VIEW-ONLY seat holds nothing, a commenter may)', mayHold('client', person) === !viewOnly);
}
check('line (team) takes any person of the team', mayHold('line', { hat: 'view_only', access_level: 'viewer' }) === true);
check('A5: client refuses level viewer and (no level) hat view_only; the level wins over the hat', mayHold('client', { access_level: 'viewer' }) === false && mayHold('client', { hat: 'view_only' }) === false && mayHold('client', { hat: 'view_only', access_level: 'commenter' }) === true && mayHold('client', { hat: 'act', access_level: 'viewer' }) === false);
check('the web answer: access_level === editor is the same as the task rule for every row', ROWS.every(([person]) => mayHold('task', person) === (access.levelOf(Object.assign({ identity_type: 'actor' }, person)) === 'editor')));

/* ── the SQL is the same ladder, built from lib/access ───────────────────────────────── */
check('holderSql(client) refuses exactly the view-only seat (the level, else the hat), no literal list of its own', /^NOT [(]CASE WHEN .* THEN .* = 'viewer' ELSE COALESCE[(]hat = 'view_only', false[)] END[)]$/.test(holderSql('client')) && holderSql('line') === 'TRUE');
const taskSql = holderSql('task');
check('holderSql(task) names every level of lib/access', access.LEVELS.every((level) => taskSql.includes("'" + level + "'")));
check('holderSql(task) names every hat of FROM_HAT, the editors in its THEN', Object.keys(access.FROM_HAT).every((hat) => taskSql.includes("'" + hat + "'")));
check('holderSql(task) reads the named access_level column, never the whole row (sec-186)', /baccess_level IN/.test(taskSql) && !/to_jsonb/.test(taskSql));
check('holderSql(task) says an absent hat is an editor, as levelOf does (ELSE TRUE)', /ELSE TRUE END\)$/.test(taskSql));

/* ── the helper composes teamAmong ───────────────────────────────────────────────────── */
const OWNER = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const standIn = (onTeam, found) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push(sql);
      if (/SELECT identity_id FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: onTeam ? [{ identity_id: PERSON }] : [] };
      return { rows: found ? [{ identity_id: PERSON, display_name: 'Z', _params: params }] : [] };
    }
  };
};
(async () => {
  const stranger = standIn(false, true);
  check('a stranger answers null and the person read is never made (no oracle)', (await assignableActor(stranger, OWNER, 'task', PERSON)) === null && stranger.calls.length === 1);
  const word = standIn(true, true);
  check('a word that is no uuid answers null with NO query at all (teamAmong cuts it)', (await assignableActor(word, OWNER, 'task', 'not-a-uuid')) === null && word.calls.length === 0);
  const passing = standIn(true, true);
  const row = await assignableActor(passing, OWNER, 'client', PERSON, { columns: 'identity_id, display_name' });
  check('a team member who passes answers the row; the team read came FIRST', row && row.identity_id === PERSON && /ANY/.test(passing.calls[0]) && /^SELECT identity_id, display_name FROM identities WHERE identity_id = \$1/.test(passing.calls[1]));
  check('the person read asks for an actor of THIS shop who is on shift, with the plug fragment', /parent_entity_id = \$2 AND identity_type = 'actor' AND break_status = 'active' AND NOT [(]CASE/.test(passing.calls[1]));
  const taskCall = standIn(true, true);
  await assignableActor(taskCall, OWNER, 'task', PERSON);
  check('the task rule puts the ladder in the statement', taskCall.calls[1].includes(holderSql('task')));
  const away = standIn(true, true);
  await assignableActor(away, OWNER, 'task', PERSON, { onShift: false });
  check('onShift: false drops only the shift test (default assignee and cover keep today\'s behaviour)', !/break_status/.test(away.calls[1]));

  /* ── one copy ─────────────────────────────────────────────────────────────────────── */
  const ROOT = path.join(__dirname, '..');
  const files = ['lib', 'routes', 'middleware'].flatMap((dir) => fs.readdirSync(path.join(ROOT, dir)).filter((name) => name.endsWith('.js')).map((name) => path.join(dir, name)));
  const copies = files.filter((file) => /hat\s+IN\s+\(\s*'act'\s*,\s*'manager'\s*\)/i.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
  check('no lib, route or middleware spells hat IN (act, manager) any more: the rule is lib/assign-chit', copies.length === 0, copies.join(', '));
  const jsCopies = files.filter((file) => /hat\s*===\s*'act'\s*\|\|\s*\w+\.hat\s*===\s*'manager'/.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
  check('nor the in-memory spelling hat === act || hat === manager', jsCopies.length === 0, jsCopies.join(', '));

  /* ── the list ─────────────────────────────────────────────────────────────────────── */
  const seat = listedActor({ identity_id: PERSON, hat: 'audit', access_level: 'commenter', connector_config: null });
  check('a listed auditor-seat row: assignable false, job_assignable true', seat.assignable === false && seat.job_assignable === true);
  const viewer = listedActor({ identity_id: PERSON, hat: 'view_only', access_level: 'viewer', connector_config: null });
  check('A5: a listed view-only row: job_assignable false (the picker lists it no more)', viewer.job_assignable === false);
  const editor = listedActor({ identity_id: PERSON, hat: 'act', access_level: 'editor', connector_config: null });
  check('a listed editor row: assignable true, job_assignable true', editor.assignable === true && editor.job_assignable === true);

  console.log('assign-holder-rule: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
