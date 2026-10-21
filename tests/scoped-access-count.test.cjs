/**
 * tests/scoped-access-count.test.cjs — AI-15 (K-SEC PR A, critic C12): HOW MANY CHIT READ ROUTES SKIP THE ONE SCOPE CHECK.
 *
 * lib/access.js seesWholeEntity is "the one check" for a co-assist's reach, and `entity_actor_settings.all_task_visible` is
 * saved by Settings (routes/actors.js) but read by nothing. Before wiring the flag into the check this guard COUNTS, so the
 * wiring can be planned on a number, not a feeling — and it is a RATCHET: the count may fall, never grow.
 *
 * WHY THIS STOPS AT THE COUNT (the brief's stop rule): the INSERT that first saves a shop's actor settings writes
 * `COALESCE($4, false)` — a shop that saved its settings once without the field holds all_task_visible = FALSE, although the
 * column default is TRUE. Wiring the flag would therefore hide tasks from co-assists in such shops, which is more than the
 * critic's "changes nothing for today's shops". Athi decides; the production count is a read-only query in the PR body.
 *
 * A "chit read route" here: a GET handler whose body names a chit table (chit_header · chit_status · chit_detail · chit_line ·
 * chit_participants) or the work list (lib/work-rows). A handler that calls a helper defined elsewhere is not seen — the
 * number is a floor, said as one.
 * Run: node tests/scoped-access-count.test.cjs · no network, no DB.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROUTES = path.join(__dirname, '..', 'routes');

/* the count on 2026-10-21 (api origin/main 6fa94519): 43 chit read routes, 0 of them call seesWholeEntity */
const BASELINE_SKIPPING = 43;
const READS_CHITS = /\bchit_(header|status|detail|line|participants)\b|\bwork\.\w+\(/;

/** chitReadRoutes() → [{ file, path, scoped }] — every GET handler in routes/ that reads chits, and whether it asks the one check */
function chitReadRoutes() {
  const out = [];
  for (const file of fs.readdirSync(ROUTES).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROUTES, file), 'utf8');
    const starts = [];
    const re = /router\.get\(\s*['`]([^'`]+)['`]/g;
    let m;
    while ((m = re.exec(src))) starts.push([m.index, m[1]]);
    starts.forEach(([at, p], k) => {
      const body = src.slice(at, k + 1 < starts.length ? starts[k + 1][0] : src.length);
      if (READS_CHITS.test(body)) out.push({ file, path: p, scoped: /seesWholeEntity/.test(body) });
    });
  }
  return out;
}

let pass = 0,
  fail = 0;
function it(what, fn) {
  try {
    fn();
    pass++;
    console.log('  ok  ' + what);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + what + '\n       ' + e.message);
  }
}

const rows = chitReadRoutes();
const skipping = rows.filter((r) => !r.scoped);
const byFile = skipping.reduce((a, r) => ((a[r.file] = (a[r.file] || 0) + 1), a), {});
console.log('  chit read routes: ' + rows.length + ' · skip seesWholeEntity: ' + skipping.length + ' · ' + JSON.stringify(byFile));

it('RATCHET: chit read routes that skip seesWholeEntity ≤ ' + BASELINE_SKIPPING + ' (may fall, never grow)', () =>
  assert.ok(skipping.length <= BASELINE_SKIPPING, skipping.length + ' now skip it — a new chit read route must ask lib/access seesWholeEntity'));
it('the scan still finds the chit routes (a scan that finds nothing proves nothing)', () => assert.ok(rows.length >= 30, 'found ' + rows.length));
it('all_task_visible is written by Settings and read by NO route or lib today (AI-15 is open, not wired)', () => {
  const readers = [];
  for (const dir of ['routes', 'lib', 'middleware']) {
    const base = path.join(__dirname, '..', dir);
    for (const n of fs.readdirSync(base).filter((x) => x.endsWith('.js'))) {
      if (/all_task_visible/.test(fs.readFileSync(path.join(base, n), 'utf8'))) readers.push(dir + '/' + n);
    }
  }
  assert.deepStrictEqual(readers, ['routes/actors.js'], 'a reader appeared — update this guard and the AI-15 line: ' + readers.join(', '));
});
it("⚠️ the first save writes all_task_visible = FALSE when the field is absent (why wiring is Athi's call)", () => {
  const src = fs.readFileSync(path.join(ROUTES, 'actors.js'), 'utf8');
  assert.ok(/COALESCE\(\$4,false\)/.test(src), 'the insert default changed — re-check what wiring would hide before wiring it');
});

console.log('\n  ' + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks');
if (fail) process.exit(1);
