#!/usr/bin/env node
/* scripts/action-state-sweep.cjs — EVERY WRITING CONTROL, AND WHETHER IT GOES THROUGH CBAction (M64, 2026-10-07).
 *
 * A "writing control" = a button / form / field whose handler reaches a write: api('<key>') where the key's endpoint is
 * POST · PATCH · PUT · DELETE (every EP table in the site), or a fetch() with such a method — followed through the
 * functions the handler calls (two levels). Static and heuristic, said plainly: a handler built from a variable name,
 * or a write reached through more than two calls, is not seen. It is a WORK LIST, not a proof.
 *
 * Columns: file:line · the control (data-testid when the tag has one) · the handler · what it writes · irreversible? (a
 * DELETE, or a name that says delete / purge / close for good / void / reverse …) · asks first? (confirmAsk / CBConfirm /
 * CBAction confirm on the path) · helper (run = CBAction.run · once = CBAction.once or bkOnce · no).
 *
 *   node scripts/action-state-sweep.cjs            → writes docs/ACTION-STATE-SWEEP.md
 *   node scripts/action-state-sweep.cjs --check    → prints the totals only
 */
/*
 * OWNS      the sweep of writing controls and whether each goes through CBAction (docs/ACTION-STATE-SWEEP.md)
 * CALLED BY package.json:72 (npm run sweep:actions)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 */
'use strict';
const fs = require('fs'),
  path = require('path');
const ROOT = path.join(__dirname, '..'),
  PUB = path.join(ROOT, 'public');
const files = fs
  .readdirSync(PUB)
  .filter((item) => /\.html$/.test(item))
  .map((item) => 'public/' + item)
  .concat(
    fs
      .readdirSync(path.join(PUB, 'app'))
      .filter((item) => /\.js$/.test(item))
      .map((item) => 'public/app/' + item)
  )
  .sort();
const SRC = {};
files.forEach((item) => {
  SRC[item] = fs.readFileSync(path.join(ROOT, item), 'utf8').replace(/\r\n/g, '\n');
});
const VENDORED = /^public\/till\.html$/;

/* 1 · the write endpoints, from every EP table */
const WRITE = Object.create(null);
for (const f of files) {
  const re = /([A-Za-z_$][\w$]*)\s*:\s*\{\s*m\s*:\s*["'](POST|PATCH|PUT|DELETE)["']\s*,\s*p\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(SRC[f]))) WRITE[m[1]] = { m: m[2], p: m[3] };
}

/* 2 · functions and their bodies. A declaration at the start of a line (top level) runs to the next line that closes it
   at column 0 or starts the next declaration — a brace counter is fooled by regex literals like /["']/ and by template
   text, and that once credited one function with its neighbours' writes. A nested one is brace-matched, capped. */
function bodyFrom(s, i) {
  let count = 0,
    q = null;
  for (let j = i; j < s.length && j < i + 3000; j++) {
    const c = s[j];
    if (q) {
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === q || c === '\n') q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === '{') count++;
    else if (c === '}') {
      count--;
      if (count === 0) return s.slice(i, j + 1);
    }
  }
  return s.slice(i, i + 3000);
}
const TOP_END = /^(\}|(async\s+)?function\s|(var|let|const)\s|\/\*\*?|<\/script)/;
function topBody(lines, i) {
  const first = lines[i],
    open = (first.match(/\{/g) || []).length - (first.match(/\}/g) || []).length;
  if (open <= 0) return first;
  const out = [first];
  for (let j = i + 1; j < lines.length && j < i + 1500; j++) {
    if (TOP_END.test(lines[j])) {
      if (/^\}/.test(lines[j])) out.push(lines[j]);
      break;
    }
    out.push(lines[j]);
  }
  return out.join('\n');
}
const FN = Object.create(null); /* name → [{ file, body }] */
for (const f of files) {
  const text = SRC[f],
    lines = text.split('\n'),
    starts = [0];
  for (let index = 0; index < lines.length; index++) starts.push(starts[index] + lines[index].length + 1);
  const re =
    /(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{)|(?:\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?function\s*[\w$]*\s*\([^)]*\)\s*\{)|(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{)/g;
  let m,
    li = 0;
  while ((m = re.exec(text))) {
    const name = m[1] || m[2] || m[3];
    if (!name || /^(if|for|while|switch|catch|function)$/.test(name)) continue;
    while (starts[li + 1] <= m.index) li++;
    const atLineStart = m.index === starts[li] || (/^(async\s+)?function\s/.test(lines[li]) && starts[li] === m.index);
    const body = atLineStart ? topBody(lines, li) : bodyFrom(text, text.indexOf('{', m.index + m[0].length - 1));
    (FN[name] = FN[name] || []).push({ file: f, body: body });
  }
}
const CALL = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g; /* a bare call — obj.run( is a method, not the function run() */
/* scope: app.html and app/*.js share one global scope; every other page sees itself + app/*.js. A name defined in the
   calling file wins — so the counter's submit() is never mistaken for the app's. */
const shared = (from, def) => def === from || /^public\/app\//.test(def) || (def === 'public/app.html' && /^public\/app\//.test(from));
function defsOf(name, from) {
  const all = FN[name] || [];
  const own = all.filter((item) => item.file === from);
  return own.length ? own : all.filter((item) => shared(from, item.file));
}
/* ⚠️ a body that PAINTS a button carries that button's onclick as text — that is another control's call, not this one's */
const ATTR = /\bon(click|change|submit|input|keydown|mousedown|touchstart)\s*=\s*\\?["'][^"'\\]*(?:\\.[^"'\\]*)*/g;
function callees(text) {
  const out = new Set();
  let m;
  const t = text.replace(ATTR, '');
  CALL.lastIndex = 0;
  while ((m = CALL.exec(t))) if (FN[m[1]]) out.add(m[1]);
  return out;
}
function directWrites(text) {
  const seen = new Set();
  let m;
  const re = /\bapi(?:Once)?\(([^,{]{0,120})/g;
  while ((m = re.exec(text))) {
    const list = m[1].match(/["']([\w$]+)["']/g) || [];
    list.forEach((item) => {
      item = item.slice(1, -1);
      if (WRITE[item]) seen.add(item);
    });
  }
  const rf = /fetch\([^;]{0,300}?method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']/g;
  while ((m = rf.exec(text))) seen.add('fetch ' + m[1]);
  return seen;
}
/* ⚠️ not followed: painters, loaders and navigation (they READ, and a write reached through one is another control's write),
   and the orchestrators too big to be one action — following them made every button "write" thirty endpoints */
const NOFOLLOW =
  /^(render|paint|repaint|load|show|open|close|go|nav|refresh|ensure|init|boot|select|set[A-Z]|toggle|modal|api|apiOnce|toast|confirmAsk|CBConfirm)/;
const memo = Object.create(null);
/** what a function reaches, `depth` calls deep: writes · asks first · helper (the helper and the ask count only one call deep) */
function reach(name, from, depth, seen) {
  const mk = name + '|' + from + '|' + depth;
  if (memo[mk]) return memo[mk];
  const r = { writes: new Set(), asks: false, run: false, once: false };
  if (seen.has(name) || depth < 0) return r;
  seen = new Set(seen).add(name);
  for (const d of defsOf(name, from)) {
    directWrites(d.body).forEach((x) => r.writes.add(x));
    const near = depth >= 1;
    if (near && /\b(confirmAsk|CBConfirm)\s*\(|confirm\s*:\s*(?!null)[^,}]/.test(d.body)) r.asks = true;
    if (near && /CBAction\.run\s*\(/.test(d.body)) r.run = true;
    if (near && /CBAction\.once\s*\(|\bbkOnce\s*\(/.test(d.body)) r.once = true;
    if (depth > 0 && d.body.length < 8000)
      callees(d.body).forEach((item) => {
        if (item === name || NOFOLLOW.test(item)) return;
        const x = reach(item, d.file, depth - 1, seen);
        x.writes.forEach((entry) => r.writes.add(entry));
        if (depth >= 2) {
          r.asks = r.asks || x.asks;
          r.run = r.run || x.run;
          r.once = r.once || x.once;
        }
      });
  }
  return (memo[mk] = r);
}

/* 3 · the controls */
const HANDLER =
  /(?:\bon(click|submit|change)\s*=\s*(\\?["'`]))|(?:\.on(click|submit|change)\s*=\s*)|(?:addEventListener\(\s*["'](click|submit|change)["']\s*,)|(?:\bon(Send|Draft|Save|Submit|Confirm)\s*:\s*)|(?:\b(\w*Btn)\(\s*['"])/g; /* the last: a button maker handed its handler as text — peBtn('id', 'Save', 'peStockSave(this)') */
const IRREV = /purge|delete|remove|forever|hard|void|revoke|reverse|bounce|disconnect|terminat|retire|wipe|reject|cancelChit|close(Year|Month|ForGood)|year/i;
const IRREV_CASED = /\bdel[A-Z_]|Del\b|Del[A-Z]/; /* delProduct · prodDel — but not "deliver" */
const rows = [];
for (const f of files) {
  const text = SRC[f],
    lines = text.split('\n');
  let off = 0;
  lines.forEach((item, i) => {
    let m;
    HANDLER.lastIndex = 0;
    while ((m = HANDLER.exec(item))) {
      let h;
      if (m[2]) {
        const q = m[2].slice(-1),
          st = m.index + m[0].length,
          e = item.indexOf(q, st);
        h = item.slice(st, e < 0 ? st + 240 : e);
      } else h = item.slice(m.index + m[0].length, m.index + m[0].length + 400);
      const names = [...callees(h)].filter((entry) => !/^(event|closeModal|toast|esc|tx|txf|go|navTo|stopPropagation)$/.test(entry) && defsOf(entry, f).length);
      const r = { writes: new Set(), asks: /confirmAsk|CBConfirm/.test(h), run: /CBAction\.run/.test(h), once: /CBAction\.once|bkOnce/.test(h) };
      names.forEach((entry) => {
        const x = reach(entry, f, 2, new Set());
        x.writes.forEach((element) => r.writes.add(element));
        r.asks = r.asks || x.asks;
        r.run = r.run || x.run;
        r.once = r.once || x.once;
      });
      directWrites(h).forEach((entry) => r.writes.add(entry));
      if (!r.writes.size) continue;
      const tagStart = item.lastIndexOf('<', m.index),
        tagEnd = item.indexOf('>', m.index);
      const tag = tagStart >= 0 ? item.slice(tagStart, tagEnd < 0 ? undefined : tagEnd) : '';
      const tid = (/data-testid=\\?["']([^"'\\]+)/.exec(tag) || [])[1] || '';
      const list = [...r.writes].sort();
      const methods = list.map((entry) => (WRITE[entry] ? WRITE[entry].m : entry.split(' ')[1]));
      const irrev =
        methods.includes('DELETE') ||
        IRREV.test(names.join(' ') + ' ' + list.join(' ') + ' ' + tid) ||
        IRREV_CASED.test(names.join(' ') + ' ' + list.join(' '));
      rows.push({
        f,
        line: i + 1,
        ev: m[1] || m[3] || m[4] || (m[5] ? 'on' + m[5] : 'click via ' + m[6]),
        tid,
        handler: names.slice(0, 2).join(', ') || '(inline)',
        writes: list,
        methods,
        irrev,
        asks: r.asks,
        helper: r.run ? 'run' : r.once ? 'once' : 'no',
        vendored: VENDORED.test(f)
      });
    }
    off += item.length + 1;
  });
}

/* 4 · the report */
const tot = rows.length,
  run = rows.filter((item) => item.helper === 'run').length,
  once = rows.filter((item) => item.helper === 'once').length;
const irr = rows.filter((item) => item.irrev),
  irrNoAsk = irr.filter((item) => !item.asks);
const summary = {
  writingControls: tot,
  usingRun: run,
  usingOnce: once,
  usingHelper: run + once,
  notYet: tot - run - once,
  irreversible: irr.length,
  irreversibleWithoutAsk: irrNoAsk.length
};
if (process.argv.includes('--check')) {
  console.log(JSON.stringify(summary, null, 1));
  process.exit(0);
}
const fmtW = (r) =>
  r.writes
    .map((item) => (WRITE[item] ? WRITE[item].m + ' ' + WRITE[item].p : item))
    .slice(0, 3)
    .join('<br>') + (r.writes.length > 3 ? '<br>+' + (r.writes.length - 3) + ' more' : '');
const tbl = (list) =>
  ['| file:line | control | handler | writes | irreversible? | asks first? | helper |', '|---|---|---|---|---|---|---|']
    .concat(
      list.map(
        (item) =>
          '| ' +
          item.f.replace(/^public\//, '') +
          ':' +
          item.line +
          (item.vendored ? ' (vendored)' : '') +
          ' | ' +
          item.ev +
          (item.tid ? ' `' + item.tid + '`' : '') +
          ' | `' +
          item.handler.replace(/\|/g, '\\|') +
          '` | ' +
          fmtW(item) +
          ' | ' +
          (item.irrev ? '**yes**' : 'no') +
          ' | ' +
          (item.asks ? 'yes' : item.irrev ? '**no**' : '—') +
          ' | ' +
          item.helper +
          ' |'
      )
    )
    .join('\n');
const perFile = {};
rows.forEach((item) => {
  const k = item.f.replace(/^public\//, '');
  perFile[k] = perFile[k] || { n: 0, h: 0 };
  perFile[k].n++;
  if (item.helper !== 'no') perFile[k].h++;
});
const md = `# Action-state sweep — every writing control

_Generated by \`node scripts/action-state-sweep.cjs\` (M64). Do not edit by hand: change the code, run the script, commit both._

The rule (M64 invariants): **no writing control fires twice on a double press · every irreversible write confirms first ·
the outcome is said where the action happened.** The one helper is \`CBAction\` in \`public/app/accounts-shell.js\`:
\`CBAction.run(button, fn, { key, confirm, out, done, outcome, failed, onFail, busy })\` — and \`CBAction.once\` (the busy half;
\`bkOnce\` in cap-books.js is now this).

## Totals

| | count |
|---|---|
| writing controls found | **${tot}** |
| through \`CBAction.run\` (busy · confirm · outcome) | **${run}** |
| through \`CBAction.once\` / \`bkOnce\` (busy only) | ${once} |
| not yet on the helper (**next**) | ${tot - run - once} |
| irreversible (heuristic) | ${irr.length} |
| irreversible with no confirm found on the path | ${irrNoAsk.length} |

How a control is found, and what this misses: a handler attribute (\`onclick\` · \`onsubmit\` · \`onchange\`), a \`.onclick =\`, an
\`addEventListener('click'…)\`, a step-flow \`onSend\`/\`onDraft\`/\`onSave\`, or a button maker handed its handler as text (\`peBtn(…, 'peStockSave(this)')\`), whose calls reach — within two calls — an
\`api('<key>')\` on a POST/PATCH/PUT/DELETE endpoint or a \`fetch\` with such a method. A handler built from a variable, or a
write deeper than two calls, is not seen. "Irreversible" is read from the method (DELETE) and the names; check it by eye.
\`till.html\` is vendored from chitbridge-api — its rows are fixed there, not here.

## Adopted in M64 (driven by \`e2e/action-state.cjs\`)

| control | file | kind |
|---|---|---|
| Record a payment — \`pay_record\` (Next) | app/cap-books.js \`payRecord\` | money record · POST /api/books/payments |
| Lock a month — \`lk-lock-N\` | app/cap-books.js \`bkLockDo\` | state change, reversible · POST …/lock |
| Close a month for good — \`lk-hard-N\` | app/cap-books.js \`bkLockDo\` | **irreversible** · asks first · POST …/lock {hard:true} |

## Next — irreversible writes with no confirm found

${irrNoAsk.length ? tbl(irrNoAsk) : '_none_'}

## By file

| file | writing controls | on the helper |
|---|---|---|
${Object.keys(perFile)
  .sort()
  .map((item) => '| ' + item + ' | ' + perFile[item].n + ' | ' + perFile[item].h + ' |')
  .join('\n')}

## Every writing control

${tbl(rows)}
`;
fs.writeFileSync(path.join(ROOT, 'docs', 'ACTION-STATE-SWEEP.md'), md);
console.log(JSON.stringify(summary));
