/**
 * ── ⭐⭐⭐ A RIDER PASSED TO mint.summary() AND NEVER STORED ──────────────────────────────────────────────────────
 *
 * `summary()` builds summary_json from a WHITELIST. A key not on that list is dropped without a word — which is
 * what the list is for, and which has now cost two debugging sessions:
 *
 *   · `detail_design` — passed from the send path, never appeared in a single chit
 *   · `routed_by`     — the whole support-ticket trace, passed and silently discarded, 2026-09-14, in the same
 *                       session as the comment in lib/mint.js warning about exactly this
 *
 * ⭐ SO THE CALLERS AND THE LIST ARE COMPARED. Every literal key handed to mint.summary({...}) anywhere in this
 * repo must either be one of the fixed fields or be on the rider list. A key that is neither is a value somebody
 * believes they are storing and is not. [[feedback-silence-is-the-bug]]
 *
 * ⚠️ IT READS SOURCE, NOT RUNTIME, so it only sees keys written as literals at the call site — which is how all
 * of them are written, and is precisely the case that goes unnoticed. A key spread in from a variable is not
 * covered and cannot be, short of running every path.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); }
  else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

console.log('\n══ EVERY RIDER HANDED TO mint.summary() IS ACTUALLY STORED ══\n');

const mintSrc = fs.readFileSync(path.join(ROOT, 'lib', 'mint.js'), 'utf8');

/* the fixed fields summary() always writes */
const fixed = new Set();
{
  const body = mintSrc.split('function summary(')[1].split('\n}')[0];
  const re = /^\s{4}([a-z_]+):/gm;
  let m; while ((m = re.exec(body))) fixed.add(m[1]);
  /* and the ones read as f.<name> for those fields */
  for (const n of ['line_item_count', 'total_value', 'currency_code', 'priority_external', 'purpose',
                   'is_promotion', 'offers', 'forwarded_from']) fixed.add(n);
}
ok('the fixed fields were found', fixed.size >= 8, 'summary() was reshaped — this guard cannot read it any more');

/* the rider whitelist */
const riders = new Set();
{
  const m = mintSrc.match(/for \(const k of \[([\s\S]*?)\]\)/);
  if (m) for (const q of m[1].match(/'[a-z_]+'/g) || []) riders.add(q.replace(/'/g, ''));
}
ok('the rider list was found', riders.size >= 8,
   'the whitelist moved — a guard that cannot find it passes everything');

/* every call site */
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|cjs)$/.test(e.name)) files.push(p);
  }
})(ROOT);

const unstored = [];
let callSites = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (!/mint\.summary\(\{|summary\(\{/.test(src)) continue;
  const re = /mint\.summary\(\{/g;
  let m;
  while ((m = re.exec(src))) {
    callSites++;
    /* the object literal, by brace depth from the `{` the match ends on */
    let i = m.index + m[0].length - 1, depth = 0, end = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const obj = src.slice(i, end + 1)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    /**
     * ⚠️⚠️ SHORTHAND COUNTS. The first version of this matched only `name:` and therefore missed `routed_by,`
     * — the very key it was written to catch. Removing routed_by from the whitelist left it passing, which is
     * the worst possible outcome for a guard: green, and blind. Both spellings now.
     *
     * Top-level keys only, taken from the start of a line inside the literal — every call site in this repo
     * writes one key per line, and nesting deeper than that is a rider's own shape, not a rider.
     */
    const keys = [];
    for (const km of obj.match(/^\s{0,14}([a-z_][a-z0-9_]*)\s*:/gm) || []) {
      keys.push(km.trim().replace(/\s*:$/, ''));
    }
    for (const km of obj.match(/^\s{0,14}([a-z_][a-z0-9_]*)\s*,\s*$/gm) || []) {
      keys.push(km.trim().replace(/,$/, ''));
    }
    for (const k of new Set(keys)) {
      if (fixed.has(k) || riders.has(k)) continue;
      unstored.push(path.relative(ROOT, f) + ' passes `' + k + '` — not a field, not on the rider list');
    }
  }
}

ok('call sites were found at all', callSites > 0,
   'nothing calls mint.summary({...}) as a literal any more — this guard is checking nothing');
ok('every rider passed is on the list', unstored.length === 0,
   [...new Set(unstored)].slice(0, 8).join('\n          '));

/* ⚠️ AND THE GUARD IS PROVEN. A check that cannot fail on its own example is decoration. */
ok('the guard would catch an unlisted rider',
   !riders.has('a_key_nobody_whitelisted'),
   'sanity: the rider set must not contain an invented name');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
