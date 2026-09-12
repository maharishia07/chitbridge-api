'use strict';
/**
 * requirements.test.js — A REQUIREMENT RAISED WHILE TESTING, AND WHAT MAY BE DONE TO IT.
 *
 * ── ⭐⭐⭐ THE ASK ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"you are running a test and you found an issue and it becomes a new requirement... the
 * testers will not have you. So it has to be written down and we have to pick it up and then it has to be
 * fulfilled and the status has to be updated as implemented or rejected. Either way."*
 * Then: *"we must be having an option to filter the requirements which are not actioned, so we can set the
 * flag"* and *"this will help to keep it prioritised, backlog and so on."*
 *
 * ── ⚠️ WHAT THIS CHECKS, AND WHY IT IS STATIC ───────────────────────────────────────────────────────────────
 *
 * The routes need a database and a signed-in tester, which this suite has neither of — `suite.cjs` refuses to
 * run anything that reaches a live host, and rightly. So this asserts the CONTRACT in the source: the states,
 * where each one puts the definition on the shelf, and the four rules that are easy to lose in a later edit.
 *
 * ⭐ A static check earns its place here because every one of these is a rule somebody could quietly relax while
 * changing something else, and none of them fails loudly when broken — a rejected requirement with no reason
 * simply reappears in six months and nobody connects the two.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'testing.js'), 'utf8');
const APP = (() => {
  const p = path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'app.html');
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
})();
const PANEL = (() => {
  const p = path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'app', 'cap-testing.js');
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
})();

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.error('  FAIL ' + what + '\n       ' + (e.message || e)); process.exitCode = 1; } };

it('⭐ a requirement is a SPEC CLAUSE, not a new table', () => {
  /* ⚠️ The whole argument for this feature was that nothing new was needed underneath: a clause is already
     versioned, already RLS-isolated, and already what a case cites. A new table would have re-implemented all
     three, and the citation would have had nothing to point at. */
  assert.ok(/VALUES \(\$1,'spec'/.test(SRC), 'raising no longer writes a spec definition');
  assert.ok(SRC.indexOf("kind = 'spec'") > 0, 'the list no longer reads spec definitions');
});

it("⚠️⚠️ the lifecycle uses the shelf vocabulary b160 already documents", () => {
  /**
   * b160 says `draft | live | retired`, and other screens filter on those words. A state of its own invention
   * — 'raised' in the status column — would have made every one of them quietly wrong about what is on the
   * shelf, and nothing would have said so.
   */
  const m = SRC.match(/REQ_SHELF\s*=\s*\{([^}]*)\}/);
  assert.ok(m, 'REQ_SHELF is gone — the mapping from lifecycle to shelf was the whole point');
  const shelf = m[1];
  assert.ok(/raised:\s*'draft'/.test(shelf), 'a raised requirement is not yet a rule: draft');
  assert.ok(/accepted:\s*'draft'/.test(shelf), 'agreed but unbuilt is still not a rule: draft');
  assert.ok(/implemented:\s*'live'/.test(shelf), 'once built it IS a rule: live');
  assert.ok(/rejected:\s*'retired'/.test(shelf), 'rejected leaves the shelf, and is not deleted');
  assert.ok(!/'raised'\s*,\s*1\s*,/.test(SRC), 'a lifecycle word must never be written into the status column');
});

it('⚠️⚠️ both halves are required: the evidence AND the rule', () => {
  /* Only the second is the requirement. Without the first, in six months nobody can tell whether it was ever
     real — the fraction work of the same day is the proof: the rule was obvious BECAUSE the line vanished. */
  assert.ok(/if \(!requirement\) return res\.status\(400\)/.test(SRC), 'a requirement with no rule is accepted');
  assert.ok(/if \(!observed\) return res\.status\(400\)/.test(SRC), 'a requirement with no evidence is accepted');
});

it('⚠️⚠️ a rejection carries its reason, or it is refused', () => {
  /* A "no" with no reason gets re-raised by the next tester, and rightly. */
  assert.ok(/state === 'rejected' && !why/.test(SRC), 'a rejection can be recorded with no reason');
});

it('⚠️ every decision is APPENDED, never overwritten', () => {
  /* The same append-only argument the result ledger won: a status that can change with no trace is a status
     nobody can be held to. */
  assert.ok(/INSERT INTO definition_version[\s\S]{0,400}current_version \+ 1/.test(SRC),
    'a decision no longer writes a new version');
  assert.ok(/history: \(ru\.history \|\| \[\]\)\.concat/.test(SRC), 'the history is no longer appended to');
  assert.ok(!/DELETE FROM definition/.test(SRC), 'nothing about a requirement may delete a definition');
});

it("⭐ raising CITES the case that found it — the citation the board never had", () => {
  /**
   * ⚠️⚠️ 0 of 889 cases cited a clause before this. Nobody back-fills citations; a tester who has just watched
   * something fail knows the rule at the only moment anybody does. This is what fills the requirement column.
   */
  assert.ok(/cites: \{ definition_id: id, version: 1/.test(SRC), 'the raised clause is not cited by its case');
  assert.ok(/!\(\(row\.rules \|\| \{\}\)\.cites \|\| \{\}\)\.definition_id/.test(SRC),
    'an existing citation must not be overwritten — it would lose the clause the case was written against');
});

it('⭐ the default filter is what is NOT ACTIONED, and that includes accepted-but-unbuilt', () => {
  /* An accepted requirement nobody has built is exactly the one that gets forgotten, so "open" is both. */
  assert.ok(/state === 'raised' \|\| q\.state === 'accepted'/.test(SRC), 'open no longer means not-actioned');
});

it('⭐ it sorts as a BACKLOG: priority first, oldest first inside it', () => {
  /* Newest-first is right for a log and wrong for a worklist — the oldest High must not sink. */
  assert.ok(/RANK\s*=\s*\{\s*High: 0/.test(SRC), 'the priority ranking is gone');
  assert.ok(/RANK\[a\.priority\] - RANK\[b2\.priority\]/.test(SRC), 'the list no longer sorts by priority');
});

if (APP && PANEL) {
  it('⚠️ the three routes are registered in the app, or the panel calls nothing', () => {
    /* Same coupling as the CORS header list: a route added in one repo is useless until the other names it. */
    ['testReqRaise', 'testReqList', 'testReqSet'].forEach((k) => {
      assert.ok(APP.indexOf(k) > 0, k + ' is not in app.html\'s endpoint table');
      assert.ok(PANEL.indexOf(k) > 0, k + ' is registered and the panel never calls it');
    });
  });
  it('⚠️ the panel asks for a reason before it sends a rejection', () => {
    /* The server refuses it too — but a refusal that arrives after the click is a worse way to learn it. */
    assert.ok(/state === 'rejected'[\s\S]{0,200}prompt\(/.test(PANEL), 'rejecting no longer asks why');
  });
} else {
  console.log('  (web repo not checked out — the two cross-repo checks are skipped, never failed)');
}

it('⭐⭐ a raised requirement records WHERE the tester was standing', () => {
  /**
   * Athi, 2026-09-12: *"I am doing all those so when I ask the external tester to perform testing they should be
   * able to record against it."* A report saying "the catalogue screen" is a conversation; one saying CAT004 is
   * a work item.
   * ⚠️ The BROWSER sends it — the server cannot know which of 84 dialogs was open — so it is shape-checked here
   * rather than trusted, because it reaches a screen.
   */
  assert.ok(/screen_code: codeOf/.test(SRC), 'the screen code is not stored with the requirement');
  assert.ok(/popup_code: codeOf/.test(SRC), 'the dialog code is not stored with the requirement');
  assert.ok(SRC.indexOf('[A-Z]{3}[0-9]{3}') > 0, 'a code is accepted without being shape-checked');
  if (PANEL) {
    assert.ok(PANEL.indexOf('screen_code: sc') > 0, 'the panel does not send the screen code');
    /* ⚠️ and it must SAY what it is about to record — capturing quietly is how a tool loses trust */
    assert.ok(PANEL.indexOf('Recorded against') > 0, 'the form does not say what it will record');
  }
});

console.log('\n  ' + pass + ' checks\n');
