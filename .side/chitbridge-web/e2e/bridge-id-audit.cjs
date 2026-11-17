/**
 * e2e/bridge-id-audit.cjs — where does the Bridge ID reach a person's eyes?
 *
 * Athi, 2026-08-20: *"in the storefront we should show with user id, not with bridge id. That is for our
 * internal purposes for referential integrity — if anywhere outside we have to showcase, that is not the one
 * to mention at all… assume if the entire logic is based on bridge id, then we need to convert internally, or
 * keep it internally and use it for our logic purpose."*
 *
 * ⭐⭐ THE RULE: bridge_id is a PRIMARY KEY, and a primary key is not a name. It exists so rows can reference
 * each other without depending on anything a person may change. user_id is the name — chosen once, unique,
 * typed by other businesses to find you. Showing the key where the name belongs asks a person to know and
 * quote an implementation detail.
 *
 * ⚠️ THIS AUDIT SEPARATES TWO THINGS THAT LOOK IDENTICAL IN A GREP. A bridge_id inside markup is a leak; a
 * bridge_id in a lookup, a comparison or a session field is the design working correctly. Deleting the second
 * kind would break referential integrity to fix a label.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const files = [];
for (const f of ['app.html', 'shop.html', 'index.html']) if (fs.existsSync(path.join(ROOT, f))) files.push(f);
for (const f of fs.readdirSync(path.join(ROOT, 'app')))
  if (f.endsWith('.js') && !f.startsWith('strings-')) files.push('app/' + f);

const isComment = (l) => /^\s*(\*|\/\/|\/\*)/.test(l);

/**
 * ⚠️ TWO SIGNALS, AND ONLY THESE TWO. An earlier version matched any line mentioning bridge_id inside anything
 * tag-shaped, which swept in the endpoint map, the SESSION declaration and half of cap-network — 38 hits, most
 * of them the design working. A check that reports correct code as a leak gets ignored, and then the one real
 * leak is ignored with it.
 *
 *   1. the LABEL "Bridge ID" appearing as visible text
 *   2. a bridge_id passed through esc() — escaping exists only to put a value into markup
 *
 * ⭐ AND A FALLBACK IS NOT A LEAK. `x.user_id || x.bridge_id` is the honest thing to render for the many
 * entities minted before handles existed: showing a dash there would hide a real identifier from someone who
 * needs it. Those are excluded, so the guard measures intent rather than spelling.
 */
/* ⚠️ A SEPARATOR IS REQUIRED, OR THIS MATCHES THE VARIABLE. /Bridge\s?ID/i also matches `bridgeId`, so the
   first run of this guard reported the endpoint map, the SESSION declaration and every network lookup as
   leaks — 38 of them, none real. A label a person reads has a space in it; an identifier does not. */
const LABEL = /Bridge ID/i;   // a SPACE only: [ _] matched bridge_id itself, the second own-goal in this guard
const ESCAPED = /esc\s*\(\s*[A-Za-z0-9_$]+\.bridge_id/;
const FALLBACK = /user_id\s*\|\|\s*[A-Za-z0-9_$]+\.bridge_id/;

/**
 * onclickSpans — per line, the character range that sits inside an open onclick="..." call, or null.
 * The call opens at `onclick=` and closes at the first `)"` (or a backslash-escaped one) after it, on this line or a later one.
 */
function onclickSpans(lines) {
  const CLOSE = /\)\\?"/;
  let open = false;
  return lines.map((line) => {
    let from = open ? 0 : line.indexOf('onclick=');
    if (from < 0) return null;
    open = true;
    const close = CLOSE.exec(line.slice(from));
    if (close) open = false;
    return { from, to: close ? from + close.index : line.length };
  });
}

const displayed = [], logic = [];
for (const f of files) {
  const all = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
  /**
   * ⭐ THE OPERATOR'S OWN SCREEN IS NOT A PERSON'S (2026-09-27). The Platform screen (platRowHTML · platTabBodyHTML ·
   * platColumns) exists to show an operator — cbincroot — every identifier side by side: User ID, bridge id, UUID. That
   * is its job, and a shop never sees it. So a bridge id inside a function named plat… is operator detail, not a leak;
   * everywhere else is still checked. Tracked by the enclosing `function plat…(` a line sits in.
   */
  let fn = '';
  const spans = onclickSpans(all);
  all.forEach((l, i) => {
    const fm = l.match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (fm) fn = fm[1];
    if (!/bridge_?[Ii]d/.test(l) || isComment(l)) return;
    if (/^plat[A-Z]/.test(fn)) { logic.push({ where: f + ':' + (i + 1), text: '(operator screen) ' + l.trim().slice(0, 80) }); return; }
    const entry = { where: f + ':' + (i + 1), text: l.trim().slice(0, 96) };
    /* ⚠️ esc() INSIDE AN onclick IS AN ARGUMENT, NOT A DISPLAY. netAskFor(esc(x.bridge_id)) escapes the key so
       it survives an attribute; a person never reads it. The span is tracked from the line that opens
       onclick= to the line that closes the call (see onclickSpans), so a call built over any number of
       continuation lines is covered, and a bridge_id printed after the attribute closes is still a leak. */
    const match = ESCAPED.exec(l);
    const span = spans[i];
    const isArg = !!(match && span && match.index >= span.from && match.index <= span.to);
    const leak = (LABEL.test(l) || ESCAPED.test(l)) && !FALLBACK.test(l) && !isArg;
    (leak ? displayed : logic).push(entry);
  });
}

/* QA-154: known findings live in e2e/scanner-known.json; only a NEW one fails */
const R = require('./lib/known-findings.cjs').ratchet('bridge-id-audit',
  displayed.map((d) => ({ key: d.where.split(':')[0] + '  ' + d.text, show: d })), { owner: 'network' });
if (R.known) console.log(R.line);
const fresh = R.fresh.map((r) => r.show);
if (fresh.length) {
  console.error('\n✗ Bridge ID reaches a person here (NEW) — show user_id instead (bridge_id is the internal key):\n');
  fresh.forEach((d) => console.error('   ' + d.where.padEnd(26) + d.text));
  console.error('\n  A primary key is not a name. If the entity may have no handle yet, write');
  console.error('  `x.user_id || x.bridge_id` — a fallback is honest and this guard allows it.\n');
}
console.log((fresh.length ? '' : '✓ ') + 'Bridge ID — ' + displayed.length + ' displayed (' + fresh.length + ' new) · '
  + logic.length + ' internal (keys, lookups, session) across '
  + [...new Set(logic.map((l) => l.where.split(':')[0]))].length + ' files');

process.exit(fresh.length ? 1 : 0);
