'use strict';
/**
 * junitresults.js — READ A JUNIT REPORT INTO BOARD RESULTS, AND FOLD THEM TO ONE PER CASE.
 *
 * ⭐ Moved out of routes/testing.js (N01, 2026-10-07) so the reading and the folding can be tested without a
 * database. The route still owns the HTTP and the one recorder; this owns only "what does this report say".
 *
 * ── ⚠️⚠️ WHAT WAS BROKEN (N01) ───────────────────────────────────────────────────────────────────────────────
 *
 * 1 · A Playwright run never reached the board's cases. The board keys a spec by its FILE
 *     (`chitbridge-web/e2e/tests/one-board.spec.js` — 393 of them), and post-results.cjs posted the bracket
 *     tag in the title (`BOARD-01`), which is a case nowhere on the board. The rows were written and nothing
 *     showed them. ⭐ `key_from: 'file'` + `key_prefix` keys a result by the file the board already lists.
 *
 * 2 · A report names one case many times — every test in a spec file, or one test under several projects —
 *     and uq_test_result_once is ONE row per (run, case, layer). ON CONFLICT DO NOTHING kept whichever came
 *     first and dropped the rest without a word, so a fail after a pass was simply lost. ⭐ `fold()` makes one
 *     result per (case, layer) BEFORE the insert: any fail is a fail, and the note says how many.
 */

/** the value of one attribute — ⚠️ WITH a boundary, or `name=` matches inside `classname=` (2026-09-11) */
function attr(s, k) {
  const m = String(s || '').match(new RegExp('(?:^|\\s)' + k + '="([^"]*)"'));
  return m ? m[1] : '';
}

const unxml = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** a prefix is a repo path, nothing else — it becomes part of a case key */
const PREFIX_RE = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

/**
 * read(xml, opts) → { results, unmatched }   one entry per <testcase>, NOT yet folded.
 *   opts.keyFrom   'bracket' (default: `[CTR-05] title`) · 'name' (the name IS the key: a guard's path)
 *                  · 'file' (the classname is the spec file; key = key_prefix + '/' + file)
 *   opts.keyPrefix for 'file': e.g. 'chitbridge-web/e2e/tests'
 *   opts.layerOf   (key) → layer or null; opts.layer the fallback; opts.runKind
 */
function read(xml, opts) {
  const o = opts || {};
  const keyFrom = o.keyFrom || 'bracket';
  const prefix = String(o.keyPrefix || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (keyFrom === 'file' && (!PREFIX_RE.test(prefix) || prefix.split('/').indexOf('..') >= 0)) {
    throw new Error('key_from "file" needs key_prefix, a repo path such as chitbridge-web/e2e/tests');
  }
  /* ⚠️ a regex, not an XML parser — JUnit is flat, and the unmatched list is what says so if it ever is not */
  const cases = [...String(xml || '').matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g)];
  const results = [], unmatched = [];
  for (const c of cases) {
    const head = c[1] || c[3] || '', body = c[2] || '';
    const name = unxml(attr(head, 'name'));
    let key;
    if (keyFrom === 'name') key = name.trim().slice(0, 120);
    else if (keyFrom === 'file') {
      const file = unxml(attr(head, 'classname')).replace(/\\/g, '/').replace(/^\.\//, '');
      key = file && file.split('/').indexOf('..') < 0 ? (prefix + '/' + file).slice(0, 120) : '';
    } else key = (name.match(/\[([A-Z]{2,6}-\d{1,3})\]/) || [])[1];
    if (!key) { unmatched.push(name); continue; }
    const failed = /<failure|<error/.test(body);
    const skipped = /<skipped/.test(body);
    const why = unxml((body.match(/message="([^"]*)"/) || [])[1] || '');
    results.push({
      case_key: key, run_kind: o.runKind,
      layer: (o.layerOf && o.layerOf(key)) || o.layer,
      /* a path-named case groups by its first two directories — where the files already are */
      module_key: keyFrom === 'bracket' ? undefined : String(key).split('/').slice(0, 2).join('/').slice(0, 40),
      status: failed ? 'fail' : (skipped ? 'skipped' : 'pass'),
      note: failed ? why.slice(0, 500) : null,
      evidence: name.slice(0, 200),
    });
  }
  return { results, unmatched };
}

/**
 * ⭐⭐ ONE RESULT PER (case, layer) — the ledger's own shape, made BEFORE the insert so nothing is dropped by it.
 *
 * Worst wins: fail › blocked › pass › skipped. A spec with five passes and one skip PASSED; a spec where one of
 * six failed FAILED. ⚠️ A single result passes through untouched — a person's tap keeps its own note.
 */
const RANK = { fail: 4, blocked: 3, pass: 2, skipped: 1 };
function fold(list) {
  const groups = new Map();
  (list || []).forEach((r) => {
    const k = String(r.case_key).trim() + '\u0000' + (r.layer || '');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const out = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const worst = g.reduce((a, b) => ((RANK[b.status] || 0) > (RANK[a.status] || 0) ? b : a));
    const n = (s) => g.filter((r) => r.status === s).length;
    const bad = g.filter((r) => r.status === 'fail' || r.status === 'blocked');
    const tally = n('pass') + ' of ' + g.length + ' passed'
      + (n('fail') ? ' · ' + n('fail') + ' failed' : '') + (n('blocked') ? ' · ' + n('blocked') + ' blocked' : '')
      + (n('skipped') ? ' · ' + n('skipped') + ' skipped' : '');
    const detail = bad.map((r) => (r.evidence || '') + (r.note ? ': ' + r.note : '')).join(' | ');
    out.push(Object.assign({}, worst, {
      note: (tally + (detail ? ' — ' + detail : '')).slice(0, 500),
      evidence: (bad.length ? bad : g).map((r) => r.evidence).filter(Boolean).join(' | ').slice(0, 200) || null,
    }));
  }
  return out;
}

module.exports = { read, fold, attr };
