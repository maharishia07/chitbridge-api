'use strict';
/**
 * incidents.test.js — WHAT A PERSON EXPERIENCED, AND WHAT WAS DONE ABOUT IT.
 *
 * ── ⭐⭐⭐ THE ASK ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"now we have testlab from our system, similarly we have to create incident management tool
 * from our system so we can use it to record incidents and the entire change control."*
 *
 * ── ⚠️ WHAT THIS CHECKS, AND WHY IT IS STATIC ───────────────────────────────────────────────────────────────
 *
 * The routes need a database and a signed-in person, which this suite has neither of — `suite.cjs` refuses
 * anything that reaches a live host, and rightly. So this asserts the CONTRACT in the source.
 *
 * ⭐ Every rule below is one somebody could relax while changing something else, and NONE OF THEM FAILS LOUDLY
 * when broken: an incident resolved with nothing recorded still shows green, a stored duration still prints a
 * number, and a lifecycle word in the status column still saves. They are exactly the rules that need a guard.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'testing.js'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.error('  FAIL ' + what + '\n       ' + (e.message || e)); process.exitCode = 1; } };

it('⭐⭐ an incident is a DEFINITION, so it needs no migration', () => {
  /* `definition.kind` is free text on purpose (b160). A new table would have re-implemented versioning and RLS,
     and — the part that actually bites — it would have needed a migration, which is Athi's to run and would
     have parked the whole feature behind him. */
  assert.ok(/VALUES \(\$1,'incident'/.test(SRC), 'recording no longer writes an incident definition');
  assert.ok(SRC.indexOf("kind = 'incident'") > 0, 'the board no longer reads incident definitions');
  assert.ok(!/CREATE TABLE[\s\S]{0,80}incident/i.test(SRC), 'a table crept in where a definition was enough');
});

it('⚠️⚠️ an INCIDENT, a DEFECT and a REQUIREMENT stay three different things', () => {
  /**
   * ITIL 4 draws the first line and it earns its keep: the shop does not care which module is wrong, it cares
   * that billing stopped. Filed as one thing, nobody can answer "how many Sev-1 are open" — the question both a
   * release gate and a support desk ask.
   */
  assert.ok(SRC.indexOf('INC_STATES') > 0 && SRC.indexOf('REQ_STATES') > 0,
    'the two lifecycles have been merged — an incident is not a requirement');
  assert.ok(/defects: \[\]/.test(SRC), 'an incident no longer LINKS to defects; it must not absorb them');
  assert.ok(/defects\.indexOf\(String\(b\.defect\)\) < 0/.test(SRC),
    'the same defect can be linked twice, which double-counts it on every report');
});

it('⚠️⚠️ the lifecycle uses the shelf vocabulary b160 already documents', () => {
  const m = SRC.match(/INC_SHELF\s*=\s*\{([^}]*)\}/);
  assert.ok(m, 'INC_SHELF is gone — the mapping from lifecycle to shelf was the point');
  const shelf = m[1];
  assert.ok(/raised:\s*'draft'/.test(shelf), 'a raised incident is not settled: draft');
  assert.ok(/investigating:\s*'draft'/.test(shelf), 'being looked at is still not settled: draft');
  assert.ok(/resolved:\s*'live'/.test(shelf), 'a resolution is a fact: live');
  assert.ok(/closed:\s*'retired'/.test(shelf), 'closed leaves the board, and is not deleted');
});

it('⭐ severity is what the shop LOST, and it says so in words', () => {
  /* IEEE 1044 classifies by impact, which is the axis a person standing at a stopped counter can judge.
     ⚠️ A bare "Sev-2" means whatever the reader assumes, and two people will assume differently. */
  assert.ok(/INC_SEV = \['Sev-1', 'Sev-2', 'Sev-3', 'Sev-4'\]/.test(SRC), 'the severity scale has changed shape');
  assert.ok(SRC.indexOf('SEV_MEANS') > 0, 'the severities no longer carry their meaning');
  assert.ok(SRC.indexOf('stopped — the work cannot go on') > 0, 'Sev-1 no longer says what it means');
  assert.ok(/means: SEV_MEANS/.test(SRC), 'the board is sent severities without their meanings');
});

it('⭐⭐ TWO CLOCKS: when the shop stopped, and when anybody heard', () => {
  /**
   * They are never the same, and the gap is the most useful number here — how long the shop suffered before we
   * knew. ⚠️ A tool storing only the report time reports its own responsiveness as the shop's.
   */
  assert.ok(SRC.indexOf('happened_at') > 0 && SRC.indexOf('raised_at') > 0, 'one of the two clocks is gone');
  assert.ok(SRC.indexOf('unnoticed_mins') > 0, 'the gap before anybody knew is no longer reported');
  assert.ok(/Date\.parse\(happened\) > Date\.parse\(now\)/.test(SRC),
    'a happened-time in the future is accepted, and shows as a negative delay');
});

it('⚠️ the durations are COMPUTED on read, never stored', () => {
  /* A stored duration stops being true the moment the row changes and nobody recomputes it — and it is the
     kind of wrong that looks fine, because a number is still printed. */
  assert.ok(!/unnoticed_mins:\s*mins\(t0, t1\)[\s\S]{0,200}INSERT/.test(SRC), 'a duration is being written down');
  assert.ok(/const mins = \(a, b2\)/.test(SRC), 'the reader no longer computes the durations');
});

it('⚠️⚠️ RESOLVED must say what changed', () => {
  /**
   * The failure mode of every incident tool: the row goes green, the shop is still broken, and six months later
   * nobody can tell whether it was fixed or forgotten. A resolution carries the commit that did it, or in words
   * why nothing needed doing.
   */
  assert.ok(/state === 'resolved' && !b\.change && !why/.test(SRC), 'an incident can be resolved with nothing recorded');
  assert.ok(/state === 'closed' && !why/.test(SRC), 'an incident can be closed with no reason');
});

it('⭐⭐ a change is CITED from git, never re-typed into a second copy', () => {
  /**
   * Every change already exists, written at the moment it was made, in the commits of these three repos. A tool
   * that re-types them creates a second copy that drifts — and the drifted copy is the one people read.
   * ⚠️ So the sha is shape-checked: a citation that does not resolve in git is worse than no citation, because
   * it looks like evidence.
   */
  assert.ok(/\[0-9a-f\]\{7,40\}/.test(SRC), 'a commit sha is accepted without being shape-checked');
  assert.ok(SRC.indexOf('repo:') > 0, 'a sha is stored with no repo — it resolves in three places or none');
  assert.ok(!/message: String\(b\.change\.message/.test(SRC), 'the commit MESSAGE is being copied out of git');
});

it('⭐ the board sorts by severity, then oldest', () => {
  /* Newest-first is right for a log and wrong for a board: the oldest Sev-1 is precisely the row that must not
     sink, and a date sort is what buries it. */
  assert.ok(/RANK\[a\.severity\] - RANK\[b2\.severity\]/.test(SRC), 'the board no longer sorts by severity first');
  assert.ok(/open_by_severity/.test(SRC), 'the open-by-severity count a release gate asks for is gone');
});

it('⭐⭐ where the person was standing, shape-checked', () => {
  /* CAT005 is a work item; "the catalogue screen" is a conversation. ⚠️ The browser sends it — the server cannot
     know which of 84 dialogs was open — so it is checked here rather than trusted, because it reaches a screen. */
  const inc = SRC.slice(SRC.indexOf("router.post('/incidents'"), SRC.indexOf("router.get('/incidents'"));
  assert.ok(/screen_code: codeOf/.test(inc), 'the screen code is not recorded with the incident');
  assert.ok(/popup_code: codeOf/.test(inc), 'the dialog code is not recorded with the incident');
  assert.ok(inc.indexOf('[A-Z]{3}[0-9]{3}') > 0, 'a code is accepted without being shape-checked');
});

it('⚠️ nothing is recorded without an account of what happened', () => {
  const inc = SRC.slice(SRC.indexOf("router.post('/incidents'"), SRC.indexOf("router.get('/incidents'"));
  assert.ok(/if \(!observed\) return res\.status\(400\)/.test(inc),
    'an empty incident can be filed, and only its author will ever understand it');
});

it('⚠️⚠️ every move is APPENDED, never overwritten', () => {
  /* The same argument the result ledger and the requirement flag both won. An incident whose state changes with
     no trace is one nobody can be held to, and a support desk is exactly where that matters. */
  const p = SRC.slice(SRC.indexOf("router.patch('/incidents/:id'"));
  assert.ok(/history: \(ru\.history \|\| \[\]\)\.concat/.test(p), 'a state change no longer lands in the history');
  assert.ok(/INSERT INTO definition_version/.test(p), 'a change no longer writes a new version');
  assert.ok(/ru\.resolved_at \|\| now/.test(p),
    'a re-resolved incident overwrites the day the shop actually got its counter back');
});

console.log('\n  ' + pass + ' checks\n');
