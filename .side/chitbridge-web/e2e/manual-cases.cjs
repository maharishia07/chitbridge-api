/**
 * e2e/manual-cases.cjs — which of TEST-CASES.md's manual cases the automated suite already covers.
 *
 * Athi, 2026-08-21: *"we have created a lot of documents, but many would have been stale as we moved on… if
 * out of sync or not fit for purpose, retire them."*
 *
 * ⚠️⚠️ `TEST-CASES.md` WAS DELIBERATELY **NOT** RETIRED IN THAT SWEEP. 74 manual cases written 2026-07-28,
 * before the automated suite existed; there are now 174 tests in 54 spec files plus 31 standalone guards.
 * Retiring it *because a suite exists* would be a claim about coverage nobody had measured — the exact species
 * of confident-and-wrong statement that made these documents unreliable in the first place. This measures it.
 *
 * ⭐ THE TWO SUITES USE DIFFERENT ID SCHEMES ON PURPOSE and cannot simply be joined. TEST-CASES numbers by
 * SECTION (A1–A9 auth, B1–B11 chits…); the specs number by MODULE (`[CHIT-01]`, `[CAT-01]`, `[A11Y-01]`). So
 * this matches on the WORDS of each case against every spec title — which is a weaker instrument than an id,
 * and the report says so rather than pretending otherwise.
 *
 * ⚠️ IT PRODUCES A TRIAGE, NOT A VERDICT. Three outcomes, and only the first is safe to act on alone:
 *   MANUAL   — the case says so itself. A human at a browser; no spec was ever going to cover it.
 *   LIKELY   — strong word overlap with a named spec. A person confirms, then the case can go.
 *   UNMATCHED— nothing in the suite reads like it. Either genuinely uncovered, or worded differently.
 *
 * ⚠️ AND "UNMATCHED" IS THE HALF THAT MATTERS. A case with no spec is a behaviour nothing checks — which is an
 * argument for keeping the document, not for deleting it.
 */
const fs = require('fs');
const path = require('path');

const DOC = path.join(__dirname, '..', '..', 'TEST-CASES.md');
const T = path.join(__dirname, 'tests');

if (!fs.existsSync(DOC)) { console.error('  TEST-CASES.md not found at ' + DOC); process.exit(1); }

/* ── the manual cases: | ID | Title | Steps | Expected | ─────────────────────────────────────────────────── */
const cases = [];
let section = '';
for (const line of fs.readFileSync(DOC, 'utf8').split(/\r?\n/)) {
  const h = line.match(/^##\s+([A-Z])\.\s+(.*)$/);
  if (h) { section = h[1] + ' · ' + h[2].trim(); continue; }
  /* ⚠️ THE TRAILING CELLS ARE OPTIONAL. Requiring four pipes read 52 of the 60 rows — eight cases were
     silently dropped because their Steps or Expected column is empty or unclosed. A parser that skips rows it
     cannot fully parse reports better coverage than exists. */
  const m = line.match(/^\|\s*([A-Z]\d+)\s*\|\s*([^|]+?)\s*\|([^|]*)\|?([^|]*)\|?/);
  if (!m) continue;
  const title = m[2].replace(/\*\*/g, '').trim();
  cases.push({
    id: m[1], section, title,
    /* the case's own tag is the most reliable signal in the file — it was written by someone who knew */
    manual: /\[MANUAL\]/i.test(line),
    text: (m[2] + ' ' + m[3] + ' ' + m[4]).toLowerCase(),
  });
}

/* ── every automated test title ─────────────────────────────────────────────────────────────────────────── */
const specs = [];
for (const f of fs.readdirSync(T).filter((x) => /\.(spec|setup)\.js$/.test(x))) {
  const src = fs.readFileSync(path.join(T, f), 'utf8');
  for (const m of src.matchAll(/test\(\s*['"`]([^'"`]+)['"`]/g)) specs.push({ f, title: m[1] });
}
/* the guards are tests too — they just do not run in Playwright */
const guards = fs.readdirSync(__dirname).filter((x) => x.endsWith('.cjs') && x !== 'manual-cases.cjs');

/**
 * ⚠️ STOPWORDS, OR EVERY CASE MATCHES EVERY SPEC. "chit", "the", "a" and "as" appear in most titles on both
 * sides; without removing them the overlap score is a measure of how English the sentence is.
 */
const STOP = new Set(('the a an as of to on in and or is it its with for from by then that this be are was'
  + ' chit chits test check verify open close see show shows must should can not no yes new').split(' '));
const words = (s) => [...new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/))]
  .filter((w) => w.length > 3 && !STOP.has(w));

/**
 * ⚠️⚠️ MATCHED AGAINST THE SPEC **BODIES**, NOT THE TITLES — and the first version, which used titles, was
 * badly wrong. "Void" came back UNMATCHED while `void` appears in three spec files: the behaviour is exercised
 * inside tests whose titles say something else entirely, which is normal and correct. A title is a label for a
 * human, not an index of what the test touches.
 *
 * ⚠️ IT ALSO MEANS "LIKELY" IS STILL WEAKER THAN AN ID. A spec that MENTIONS voiding is not proof it ASSERTS
 * the void guard. This narrows 60 documents-worth of reading to a handful; a person still confirms.
 */
const bodies = {};
for (const f of fs.readdirSync(T).filter((x) => /\.(spec|setup)\.js$/.test(x))) {
  bodies[f] = fs.readFileSync(path.join(T, f), 'utf8').toLowerCase();
}
/* the guards count as coverage too — asking a11y-contrast to have a Playwright title would be the wrong test */
for (const g of guards) bodies[g] = fs.readFileSync(path.join(__dirname, g), 'utf8').toLowerCase();

const scored = cases.map((c) => {
  if (c.manual) return { ...c, verdict: 'MANUAL', best: null, score: 0 };
  const cw = words(c.title);
  if (!cw.length) return { ...c, verdict: 'UNMATCHED', best: null, score: 0 };
  let best = null, score = 0;
  for (const [f, body] of Object.entries(bodies)) {
    const hit = cw.filter((w) => body.includes(w)).length;
    if (hit > score) { score = hit; best = { f, title: f }; }
  }
  /* every distinctive word of the title present in one file is the bar; one word is a coincidence */
  const strong = score === cw.length && cw.length >= 1;
  return { ...c, verdict: strong ? 'LIKELY' : 'UNMATCHED', best, score, need: cw.length };
});

const by = (v) => scored.filter((s) => s.verdict === v);
console.log('\n  ' + cases.length + ' manual cases  ·  ' + specs.length + ' automated tests in '
  + new Set(specs.map((s) => s.f)).size + ' spec files  ·  ' + guards.length + ' standalone guards\n');
console.log('    ' + String(by('MANUAL').length).padStart(3) + '  MANUAL     — the case says so itself; keep');
console.log('    ' + String(by('LIKELY').length).padStart(3) + '  LIKELY     — a named spec reads like it; confirm, then retire the case');
console.log('    ' + String(by('UNMATCHED').length).padStart(3) + '  UNMATCHED  — nothing in the suite reads like it\n');

console.log('  LIKELY ALREADY COVERED:\n');
by('LIKELY').forEach((c) => console.log('    ' + c.id.padEnd(4) + c.title.slice(0, 34).padEnd(36)
  + '→ ' + c.best.title.slice(0, 54)));

console.log('\n  UNMATCHED — either uncovered, or just worded differently:\n');
by('UNMATCHED').forEach((c) => console.log('    ' + c.id.padEnd(4) + c.section.split(' · ')[0] + '  ' + c.title.slice(0, 62)));

console.log('\n  MANUAL by its own tag — a human at a browser:\n');
console.log('    ' + by('MANUAL').map((c) => c.id).join(' ') + '\n');
