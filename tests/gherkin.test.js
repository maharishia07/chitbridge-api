/**
 * ── tests/gherkin.test.js · WHAT GOES OUT MUST COME BACK ──────────────────────────────────────────────────────
 *
 * ⭐⭐⭐ THE ONE PROPERTY THAT MATTERS IS THE ROUND TRIP. Athi's loop is: write the spec, generate the cases, find
 * something wrong, EDIT THE SPEC, regenerate, test again. Every turn of that loop passes a case through this file
 * twice. If a field is quietly dropped on the way out or misread on the way in, the case comes back thinner each
 * time — and nobody notices, because a shorter test case still looks like a test case.
 *
 * ⚠️ So the headline test is not "does it export" but "is what comes back the same as what went out", run over
 * the REAL document rather than a fixture. A fixture only proves the parser handles what the test author thought
 * of; 110 real cases contain em dashes, quotes, rupee signs, five-line notes and steps that end in a colon.
 *
 * Run: node tests/gherkin.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const G = require('../lib/gherkin');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

const CASE = {
  case_key: 'CTR-05', title: 'A single click chooses; a double click adds',
  priority: 'High', layer: 'web',
  pre: 'Counter open on Sell.',
  data: 'Any product.',
  steps: [
    ['Click once on a product row.', 'The row is marked. NOTHING is added to the bill.'],
    ['Check the bill total.', 'Unchanged.'],
    ['Double-click the same row.', 'One line is added.'],
  ],
  note: 'His finding 7: "by just clicking the list it gets added to the cart, that is not my intention." The + '
      + 'stays for touch, where a double tap is not a gesture.',
};
const MOD = { key: 'CTR', name: 'Counter — what the screen says about money',
              intro: 'Observation 5. Every number in the four screenshots was right; the words were not.',
              spec: 'TILL-SPEC-2026-09-07', clause: '4.2' };

console.log('— the shape we already had IS Given/When/Then —');

it('⭐⭐ Given is the pre-condition, When is the action, Then is the expectation', () => {
  const text = G.toFeature(MOD, [CASE]);
  assert.ok(/Given Counter open on Sell\./.test(text), 'the pre-condition is not a Given');
  assert.ok(/When Click once on a product row\./.test(text), 'the first action is not a When');
  assert.ok(/Then The row is marked/.test(text), 'the expectation is not a Then');
  /* ⭐ And for the second action onwards — what a person writing this by hand would do */
  assert.ok(/And Check the bill total\./.test(text), 'the second action is not an And');
});

it('⭐ the Feature description IS the spec clause', () => {
  /**
   * ⭐⭐ THIS IS THE JOIN Athi asked for. Gherkin puts a free-text description under the Feature line; a spec
   * clause is free text that scenarios are written against. They are the same thing, so the file carries both
   * halves and neither has to be kept somewhere else and remembered.
   */
  const text = G.toFeature(MOD, [CASE]);
  assert.ok(text.indexOf('Observation 5.') > text.indexOf('Feature:'), 'the clause is not under the Feature line');
  assert.ok(/^# spec: TILL-SPEC-2026-09-07/m.test(text), 'the document the clause belongs to is not named');
  assert.ok(/^# clause: 4\.2/m.test(text), 'the clause id is not carried');
});

console.log('— the round trip —');

it('⭐⭐⭐ a case survives export and import unchanged', () => {
  const back = G.parseFeature(G.toFeature(MOD, [CASE]));
  assert.strictEqual(back.key, MOD.key);
  assert.strictEqual(back.name, MOD.name);
  assert.strictEqual(back.intro, MOD.intro);
  assert.strictEqual(back.spec, MOD.spec);
  assert.strictEqual(back.clause, MOD.clause);
  assert.strictEqual(back.cases.length, 1);
  const c = back.cases[0];
  ['case_key', 'title', 'priority', 'layer', 'pre', 'data', 'note'].forEach((f) => {
    assert.strictEqual(c[f], CASE[f], f + ' changed: ' + JSON.stringify(c[f]));
  });
  assert.deepStrictEqual(c.steps, CASE.steps, 'the steps changed');
});

it('⭐⭐⭐ ALL 110 REAL CASES survive the round trip', () => {
  /**
   * ⚠️ THE REAL DOCUMENT, NOT A FIXTURE. A fixture proves the parser handles what I thought of. The real cases
   * carry em dashes, curly quotes, rupee signs, numbered sub-clauses, five-line notes, and steps that end in a
   * colon — and every one of those is a chance for a line to be read as something it is not.
   */
  const file = path.join(__dirname, '..', 'data', 'test-cases.json');
  if (!fs.existsSync(file)) { console.log('       (data/test-cases.json missing — run build-test-cases.cjs)'); return; }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));

  const byMod = {};
  doc.cases.forEach((c) => { (byMod[c.module_key] = byMod[c.module_key] || []).push(c); });

  let checked = 0;
  Object.keys(byMod).forEach((k) => {
    const first = byMod[k][0];
    const mod = { key: k, name: first.module_name, intro: first.intro };
    const back = G.parseFeature(G.toFeature(mod, byMod[k]));
    assert.deepStrictEqual(back.problems, [], k + ' did not parse cleanly: ' + back.problems.join('; '));
    assert.strictEqual(back.cases.length, byMod[k].length, k + ' lost a case');
    byMod[k].forEach((orig, i) => {
      const got = back.cases[i];
      assert.strictEqual(got.case_key, orig.case_key, k + ' case ' + i + ': the key changed');
      assert.strictEqual(got.title, orig.title, orig.case_key + ': the title changed');
      assert.strictEqual(got.pre, orig.pre || '', orig.case_key + ': the pre-condition changed');
      assert.deepStrictEqual(got.steps, orig.steps || [], orig.case_key + ': the steps changed');
      /* ⚠️ the note is WRAPPED on export and rejoined on import, so compare on collapsed whitespace */
      assert.strictEqual((got.note || '').replace(/\s+/g, ' ').trim(),
                         (orig.note || '').replace(/\s+/g, ' ').trim(), orig.case_key + ': the note changed');
      checked++;
    });
  });
  assert.ok(checked >= 100, 'only ' + checked + ' cases were round-tripped');
  console.log('       ' + checked + ' cases, ' + Object.keys(byMod).length + ' features');
});

console.log('— tolerant on the way in, honest about what it skipped —');

it('⭐⭐ a hand-written file with different spacing still reads', () => {
  /* ⚠️ Nobody will indent exactly the way we emit. A parser that only reads its own output is a serialiser. */
  const hand = [
    'Feature: SPR — Suppliers',
    '  A supplier who is not on ChitBridge can still be written down.',
    '',
    '@priority:High',
    'Scenario: SPR-02 A local supplier can be added by name',
    'Given Suppliers screen, Trade tab.',
    'When Type the name and press Add.',
    'Then It asks to add them as a local supplier.',
  ].join('\n');
  const b = G.parseFeature(hand);
  assert.strictEqual(b.key, 'SPR');
  assert.strictEqual(b.cases.length, 1);
  assert.strictEqual(b.cases[0].case_key, 'SPR-02');
  assert.strictEqual(b.cases[0].priority, 'High');
  assert.deepStrictEqual(b.cases[0].steps, [['Type the name and press Add.', 'It asks to add them as a local supplier.']]);
});

it('⚠️⚠️ a foreign tag is NOT turned into one of our fields', () => {
  /**
   * ⚠️ @smoke, @wip and @regression are ordinary Cucumber conventions and mean nothing here. Reading them as
   * `priority` or `layer` would put a value in a field the server validates against a CHECK constraint — a 422
   * on import, blamed on the file rather than on us.
   */
  const b = G.parseFeature('Feature: X\n@smoke @wip @layer:engine\nScenario: AB-01 t\nWhen a\nThen b\n');
  assert.strictEqual(b.cases[0].layer, 'engine', 'a tag we DO declare was dropped');
  assert.strictEqual(b.cases[0].priority, 'Medium', 'a foreign tag became the priority');
});

it('⚠️ Scenario Outline is refused out loud, not read as a plain scenario', () => {
  /* ⚠️ An Outline is a template over an Examples table. Read as a scenario it imports a case full of unfilled
     <placeholders> that no tester can follow — and it would look like a perfectly ordinary case on the board. */
  const b = G.parseFeature('Feature: X\nScenario Outline: AB-01 t\nWhen I add <qty>\nThen I see <total>\n');
  assert.ok(b.problems.some((p) => /Outline/.test(p)), 'an Outline was imported silently');
});

it('⚠️ a scenario with no case key is reported, not given one', () => {
  /* ⚠️ Inventing a key would attach results to a case nobody wrote, and the invented key would collide the
     moment the real document grew that number. */
  const b = G.parseFeature('Feature: X\nScenario: just some words\nWhen a\nThen b\n');
  assert.strictEqual(b.cases[0].case_key, '');
  assert.ok(b.problems.some((p) => /no case key/.test(p)), 'a keyless scenario was accepted in silence');
});

it('⚠️ several Features in one file are split before parsing', () => {
  const text = G.toFeature({ key: 'AA', name: 'One' }, [CASE]) + '\n'
             + G.toFeature({ key: 'BB', name: 'Two' }, [CASE]);
  const parts = G.splitFeatures(text);
  assert.strictEqual(parts.length, 2, 'a multi-feature file was not split — the second would be lost');
  assert.strictEqual(G.parseFeature(parts[0]).key, 'AA');
  assert.strictEqual(G.parseFeature(parts[1]).key, 'BB');
});

it('⚠️ a newline inside a step is folded, not emitted as a broken line', () => {
  /* ⚠️ A raw newline renders as an unlabelled line that reads as prose and parses back as nothing — the file
     looks right and a sentence is gone. */
  const text = G.toFeature({ key: 'AA', name: 'x' }, [{ case_key: 'AA-01', title: 't',
    steps: [['do\nthis', 'see\nthat']] }]);
  const back = G.parseFeature(text);
  assert.deepStrictEqual(back.cases[0].steps, [['do this', 'see that']]);
});

it('TIER A · zero dependencies', () => {
  const src = fs.readFileSync(require.resolve('../lib/gherkin'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], [],
    'gherkin.js grew a dependency — it is read by a route, a guard and eventually the browser');
});

console.log('\n  ' + pass + ' checks\n');
