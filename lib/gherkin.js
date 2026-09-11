'use strict';
/**
 * ── lib/gherkin.js · A TEST CASE, WRITTEN THE WAY THE WHOLE INDUSTRY WRITES ONE ────────────────────────────────
 *
 * Athi, 2026-09-11: *"then possibly both can work together? Spec vs test, in the V model? Or maybe Gherkin /
 * Cucumber kind of?"*
 *
 * ⭐⭐⭐ ADOPTED, AND IT COST ALMOST NOTHING, BECAUSE OUR CASES WERE ALREADY THIS SHAPE:
 *
 *     pre            →  Given      the world before you start
 *     steps[i][0]    →  When       the thing you do
 *     steps[i][1]    →  Then       what must be true afterwards
 *
 * That is not a coincidence and it is not cleverness — it is that Given/When/Then is simply what a test case IS,
 * and anybody writing one honestly arrives at the same three parts. So this file is a RENDERER and a READER, not
 * a translation layer: nothing is invented in between, and a case that goes out comes back the same.
 *
 * ── ⚠️⚠️ WHAT WAS DELIBERATELY **NOT** ADOPTED: CUCUMBER, THE RUNNER ──────────────────────────────────────────
 *
 * Gherkin the FORMAT is free. Cucumber the RUNNER is not: every `When I click the row` needs a step definition —
 * a regex in code that turns that English into an action — and a suite of any size becomes a second codebase
 * whose only job is mapping sentences onto clicks, kept in step with the first by hand. Playwright already drives
 * the app directly. For one person, the glue layer would cost more than the tests it runs.
 *
 * ⭐ So Gherkin is used for the thing it is genuinely best at: being the ONE text that a person writing a spec and
 * a person testing against it can both read, and that neither has to translate.
 *
 * ── ⭐⭐ AND THIS IS WHERE THE SPEC AND THE TEST MEET ────────────────────────────────────────────────────────
 *
 * A `.feature` file carries BOTH halves at once, which is the whole reason it answers his question:
 *
 *     Feature:      the module, and its description IS THE SPEC CLAUSE
 *     Scenario:     one test case against that clause
 *
 * So importing one file declares what the thing should do AND how you would know — and when the clause changes,
 * every scenario under it is, by construction, the set of cases that have to be looked at again.
 *
 * ⚠️ ZERO DEPENDENCIES. A parser for a format this flat does not justify a package, and this file is read by the
 * route, the guard, and eventually the browser — Tier A, same rule as money.js and units.js.
 */

/* ── the tags we carry. ⚠️ A CLOSED LIST: a tag we do not understand is preserved on export but never invented on
   import, so a Cucumber convention borrowed from elsewhere cannot quietly become one of our fields. */
const TAG_FIELDS = ['priority', 'layer'];

/** ⚠️ Gherkin has no comment syntax inside a step, so anything we carry beyond Given/When/Then rides on a `#`
 *  line with a named prefix. These are OURS; a foreign file simply has none and the field comes back empty. */
const META_PREFIX = { spec: '# spec:', clause: '# clause:', data: '# data:', why: '# why:' };

function indent(n) { return ' '.repeat(n); }

/**
 * ⚠️ A MULTI-LINE VALUE WOULD BREAK THE FORMAT SILENTLY. A step containing a newline renders as a second,
 * unlabelled line that reads as a `And`-less continuation and parses back as nothing. Folded to one line, with
 * the folding visible, rather than producing a file that looks right and loses a sentence.
 */
function oneLine(s) { return String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ').trim(); }

/**
 * ⭐ toFeature({ key, name, intro, spec }, cases) → the text of one .feature file.
 *
 * The Feature DESCRIPTION is the spec clause — indented prose under the Feature line, which is exactly where
 * Gherkin puts a description and exactly what a clause is.
 */
function toFeature(mod, cases) {
  const m = mod || {};
  const out = [];

  /* ⚠️ the spec the clause belongs to, before anything else — a clause with no document is unciteable */
  if (m.spec) out.push(META_PREFIX.spec + ' ' + oneLine(m.spec));
  if (m.clause) out.push(META_PREFIX.clause + ' ' + oneLine(m.clause));

  out.push('Feature: ' + oneLine(m.key ? m.key + ' — ' + (m.name || '') : (m.name || 'Untitled')));
  if (m.intro) {
    /* the description, wrapped at a readable width and indented two — Gherkin's own convention */
    wrap(oneLine(m.intro), 108).forEach((l) => out.push(indent(2) + l));
  }

  (cases || []).forEach((c) => {
    out.push('');
    const tags = TAG_FIELDS.filter((f) => c[f]).map((f) => '@' + f + ':' + String(c[f]).replace(/\s+/g, '-'));
    if (tags.length) out.push(indent(2) + tags.join(' '));
    out.push(indent(2) + 'Scenario: ' + oneLine((c.case_key ? c.case_key + ' ' : '') + (c.title || '')));

    if (c.pre) out.push(indent(4) + 'Given ' + oneLine(c.pre));
    /* ⚠️ `data` is not a Gherkin concept. It is not an Examples table either — an Examples table PARAMETERISES a
       scenario and ours does not vary; it just says which product to pick up. A comment is the honest place. */
    if (c.data && c.data !== '—') out.push(indent(4) + META_PREFIX.data + ' ' + oneLine(c.data));

    (c.steps || []).forEach((s, i) => {
      const when = oneLine(s[0]), then = oneLine(s[1]);
      /* ⭐ `And` for every When after the first, which is what a person writing this by hand would do */
      if (when) out.push(indent(4) + (i === 0 ? 'When ' : 'And ') + when);
      if (then) out.push(indent(4) + 'Then ' + then);
    });

    if (c.note) {
      out.push(indent(4) + META_PREFIX.why);
      wrap(oneLine(c.note), 100).forEach((l) => out.push(indent(6) + '# ' + l));
    }
  });

  return out.join('\n') + '\n';
}

/** greedy wrap — good enough for prose, and a file nobody can read is a file nobody edits */
function wrap(s, w) {
  const words = String(s || '').split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  words.forEach((word) => {
    if (!line) { line = word; return; }
    if ((line + ' ' + word).length > w) { lines.push(line); line = word; } else { line += ' ' + word; }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * ⭐ parseFeature(text) → { spec, clause, key, name, intro, cases: [...] }
 *
 * ⚠️ IT IS TOLERANT ON THE WAY IN AND STRICT ABOUT WHAT IT CLAIMS. A file written by hand, or by another tool,
 * will not match what toFeature emits — different indentation, `Scenario Outline`, `But`, `*`. Everything it
 * genuinely understands is read; everything else is IGNORED rather than guessed at, and `problems` says what was
 * skipped. A parser that quietly invents a field is how a spec and a test drift apart while both look fine.
 */
function parseFeature(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const out = { spec: '', clause: '', key: '', name: '', intro: '', cases: [], problems: [] };

  let cur = null;            // the scenario being read
  let inIntro = false;       // inside the Feature description
  let pendingTags = {};
  let whyLines = null;       // collecting the `# why:` block

  const push = () => { if (cur) { out.cases.push(cur); cur = null; } };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) { whyLines = null; continue; }

    /* ── our own metadata lines ── */
    if (t.startsWith(META_PREFIX.spec)) { out.spec = t.slice(META_PREFIX.spec.length).trim(); continue; }
    if (t.startsWith(META_PREFIX.clause)) { out.clause = t.slice(META_PREFIX.clause.length).trim(); continue; }
    if (t.startsWith(META_PREFIX.data)) {
      if (cur) cur.data = t.slice(META_PREFIX.data.length).trim(); continue;
    }
    if (t.startsWith(META_PREFIX.why)) { whyLines = []; if (cur) cur.note = ''; continue; }

    /* a continuation of the why block: any `#` line while collecting */
    if (whyLines && t.startsWith('#')) {
      whyLines.push(t.replace(/^#\s?/, ''));
      if (cur) cur.note = whyLines.join(' ').trim();
      continue;
    }
    whyLines = null;

    /* ── tags ── */
    if (t.startsWith('@')) {
      pendingTags = {};
      t.split(/\s+/).forEach((tag) => {
        const m = tag.match(/^@([a-z]+):(.+)$/i);
        /* ⚠️ ONLY the fields we declare. A foreign @smoke or @wip is not silently turned into one of ours. */
        if (m && TAG_FIELDS.indexOf(m[1].toLowerCase()) >= 0) pendingTags[m[1].toLowerCase()] = m[2].replace(/-/g, ' ');
      });
      continue;
    }

    /* ── Feature ── */
    if (/^Feature:/i.test(t)) {
      push();
      const title = t.replace(/^Feature:\s*/i, '').trim();
      /* `CTR — Counter, what the screen says about money` → key + name. An em dash, an en dash or a hyphen. */
      const m = title.match(/^([A-Z][A-Z0-9]{1,7})\s*[—–-]\s*(.+)$/);
      if (m) { out.key = m[1]; out.name = m[2].trim(); } else { out.name = title; }
      inIntro = true;
      continue;
    }

    /* ── Scenario ── */
    if (/^Scenario(\s+Outline)?:/i.test(t)) {
      push();
      inIntro = false;
      if (/^Scenario\s+Outline:/i.test(t)) {
        /* ⚠️ NOT SUPPORTED, AND SAID SO. An Outline is a template over an Examples table; reading one as a plain
           scenario would import a case full of unfilled <placeholders> that no tester can follow. */
        out.problems.push('Scenario Outline is not supported (it needs an Examples table): ' + t);
      }
      const title = t.replace(/^Scenario(\s+Outline)?:\s*/i, '').trim();
      const m = title.match(/^([A-Z][A-Z0-9]{1,7}-\d{1,3})\s+(.+)$/);
      cur = {
        case_key: m ? m[1] : '',
        title: m ? m[2].trim() : title,
        priority: pendingTags.priority || 'Medium',
        layer: pendingTags.layer || null,
        pre: '', data: '', steps: [], note: '',
      };
      if (!m) out.problems.push('no case key in: ' + title);
      pendingTags = {};
      continue;
    }

    /* ── steps ── */
    const step = t.match(/^(Given|When|Then|And|But|\*)\s+(.*)$/i);
    if (step && cur) {
      const kw = step[1].toLowerCase(), body = step[2].trim();
      if (kw === 'given') {
        /* ⚠️ `And` after a Given belongs to the Given — joined, not dropped */
        cur.pre = cur.pre ? (cur.pre + ' ' + body) : body;
        cur._last = 'given';
      } else if (kw === 'when') {
        cur.steps.push([body, '']); cur._last = 'when';
      } else if (kw === 'then') {
        if (!cur.steps.length) { cur.steps.push(['', body]); }
        else {
          const last = cur.steps[cur.steps.length - 1];
          /* a second Then on one When is an extra expectation — joined rather than lost */
          last[1] = last[1] ? (last[1] + ' ' + body) : body;
        }
        cur._last = 'then';
      } else {              // And / But / *
        if (cur._last === 'given') cur.pre += ' ' + body;
        else if (cur._last === 'then' && cur.steps.length) {
          /* ⭐ `And` after a Then is a NEW When in our shape — which is what toFeature emits */
          cur.steps.push([body, '']); cur._last = 'when';
        } else if (cur.steps.length) {
          const last = cur.steps[cur.steps.length - 1];
          last[0] = last[0] ? (last[0] + ' ' + body) : body;
        }
      }
      continue;
    }
    if (step && !cur) { out.problems.push('a step before any Scenario: ' + t); continue; }

    /* ── the Feature description, i.e. the spec clause ── */
    if (inIntro && !t.startsWith('#')) {
      out.intro = out.intro ? (out.intro + ' ' + t) : t;
      continue;
    }

    if (/^(Background|Examples|Rule):/i.test(t)) {
      out.problems.push('not supported and ignored: ' + t);
      inIntro = false;
    }
  }
  push();

  out.cases.forEach((c) => { delete c._last; c.pre = c.pre.trim(); });
  return out;
}

/** ⭐ a whole board as one file per module, joined — what a download gives you */
function toFeatures(groups) {
  return (groups || []).map((g) => toFeature(g.module, g.cases)).join('\n');
}

/** ⚠️ a file holding several Features is split BEFORE parsing; parseFeature reads exactly one. */
function splitFeatures(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const chunks = []; let cur = [];
  lines.forEach((l) => {
    if (/^\s*(#\s*spec:|Feature:)/i.test(l) && cur.some((x) => /^\s*Feature:/i.test(x))) { chunks.push(cur); cur = []; }
    cur.push(l);
  });
  if (cur.length) chunks.push(cur);
  return chunks.map((c) => c.join('\n')).filter((c) => /Feature:/i.test(c));
}

module.exports = { toFeature, toFeatures, parseFeature, splitFeatures, TAG_FIELDS, META_PREFIX };
