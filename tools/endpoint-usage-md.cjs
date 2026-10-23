/*
 * OWNS      the output of the wide endpoint run: JSON rows, the markdown page, and the dead-or-planned reading of bucket D.
 * CALLED BY tools/endpoint-usage.cjs (--buckets · --md)
 * FLOW      emit(wide, opts) -> [history for D] -> JSON | markdown -> stdout or --out
 * CARD      janitor/endpoint-usage
 */
'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');

const MECHANICAL_COMMIT = new RegExp('mechanical pass|prettier|reformat', 'i');
const BUCKET_NAME = {
  A: 'A LIVE (a shop screen or the till)',
  B: 'B INTERNAL (our own tooling)',
  C: 'C EXTERNAL (outside caller, by call or declaration)',
  D: 'D NO CALLER FOUND'
};

/** Count rows by a key function into { key: n }. */
function tally(rows, keyOf) {
  const out = {};
  for (const row of rows) out[keyOf(row)] = (out[keyOf(row)] || 0) + 1;
  return out;
}

/** The static head of a route, to look for in client history (cut at its first :param). */
function headOf(full) {
  const cutAt = full.indexOf('/:');
  return { text: cutAt < 0 ? full : full.slice(0, cutAt), params: cutAt >= 0 };
}

/** Was there ever a call-shaped client line for this D route? One git pass over the web's public/ history. */
function readHistory(webRoot, dRows) {
  const gitLog = spawnSync(
    'git',
    [
      '-C',
      webRoot,
      'log',
      '-p',
      '-U0',
      '--no-color',
      '--no-renames',
      '--no-ext-diff',
      '--date=short',
      '--format=CBCOMMIT %h %ad %s',
      'HEAD',
      '--',
      'public',
      'index.html'
    ],
    { encoding: 'utf8', maxBuffer: 1 << 30, timeout: 170000 }
  );
  if (gitLog.error || gitLog.status !== 0) return { error: gitLog.error ? gitLog.error.message : 'git exit ' + gitLog.status };
  const found = new Map();
  const needles = dRows.map((row) => {
    const head = headOf(row.full);
    const tail = head.params ? '(?:/[\'"`$]|/\\$\\{)' : '[\'"`?#]';
    return {
      row,
      path: new RegExp(head.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + tail),
      keys: (row.keys || []).map((key) => new RegExp('(?:api|testEvery)\\(\\s*[\'"]' + key + '[\'"]'))
    };
  });
  let commit = '';
  let mechanical = false; /* a bulk reformat re-adds every line: it says nothing about when a call was written */
  for (const line of gitLog.stdout.split('\n')) {
    if (line.startsWith('CBCOMMIT ')) {
      commit = line.slice(9).split(' ').slice(0, 2).join(' ');
      mechanical = MECHANICAL_COMMIT.test(line);
    } else if (
      !mechanical &&
      line.charAt(0) === '+' &&
      /api\(|fetch\(|testEvery\(|call\(|post\(|get\(|request\(|\/api\//.test(line) &&
      !/\{\s*m:\s*["']/.test(line)
    )
      noteHit(needles, found, line, commit);
  }
  return { found };
}

/** Record the first call-shaped addition per D route. */
function noteHit(needles, found, line, commit) {
  for (const needle of needles) {
    if (found.has(needle.row.route)) continue;
    if (needle.keys.some((pattern) => pattern.test(line)) || needle.path.test(line)) found.set(needle.row.route, commit);
  }
}

/** Summary counts by bucket and area. */
function summarize(rows) {
  const areas = [...new Set(rows.map((row) => row.area))].sort();
  const table = areas.map((area) => {
    const mine = rows.filter((row) => row.area === area);
    const count = (bucket) => mine.filter((row) => row.bucket === bucket).length;
    const called = mine.filter((row) => row.bucket !== 'D');
    return { area, total: mine.length, A: count('A'), B: count('B'), C: count('C'), D: count('D'), calledGap: called.filter((row) => row.tests.gap).length };
  });
  return { areas: table, buckets: tally(rows, (row) => row.bucket), weak: rows.filter((row) => row.weak).length };
}

/** The group a gap sits in: its screens, else the screen module that calls it, else (B) the kind of tooling that calls it. */
function gapName(row) {
  if (row.tests.screens.length) return row.tests.screens.slice(0, 2).join(' / ');
  const webCaller = row.callers.filter((caller) => caller.label.startsWith('web:') && caller.cls !== 'B')[0];
  if (webCaller) return 'module ' + webCaller.label.split('/').pop().replace(/:.*/, '') + ' (screen not in the graph)';
  return row.bucket === 'C'
    ? 'outside callers (' + (row.callers[0] ? row.callers[0].kind : 'declared') + ')'
    : 'internal only (' + (row.callers[0] ? row.callers[0].kind : 'none') + ')';
}

/** The headline: called endpoints with no walk and no board case, by screen then area. */
function gapGroups(rows) {
  const groups = new Map();
  for (const row of rows.filter((item) => item.bucket !== 'D' && item.tests.gap)) {
    const name = gapName(row);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return [...groups.entries()].sort((first, second) => second[1].length - first[1].length);
}

/** Emit JSON or markdown. */
function emit(wide, opts) {
  const rows = wide.rows;
  if (opts.history) {
    const history = readHistory(
      opts.webRoot,
      rows.filter((row) => row.bucket === 'D')
    );
    wide.meta.history = history.error ? 'not read: ' + history.error : 'read';
    for (const row of rows.filter((item) => item.bucket === 'D'))
      row.history = history.found
        ? history.found.has(row.route)
          ? 'dead (client call added in ' + history.found.get(row.route) + ', none now)'
          : 'planned (no client call ever)'
        : 'unknown';
  }
  const text = opts.json
    ? JSON.stringify({ meta: wide.meta, summary: summarize(rows), rows }, null, 1)
    : require('./endpoint-usage-page.cjs').page(wide, summarize(rows), gapGroups(rows), BUCKET_NAME);
  if (opts.out) fs.writeFileSync(opts.out, text);
  else process.stdout.write(text + '\n');
}

module.exports = { emit, summarize, gapGroups };
