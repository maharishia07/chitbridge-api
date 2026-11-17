/* e2e/lib/break-run.cjs — the ONE way a *-breaks harness runs its paired check (2026-11-13, QA red-60 groups D/E).
 *
 * Why it exists. A *-breaks harness damages the product once per break and runs the paired check to see it go red. Two things went wrong:
 *   1  every break paid for the paired check's FULL run (crm.cjs 72 s x 22 breaks, one-person.cjs 69 s, ...): no verdict inside the
 *      150 s a runner gave it. A break needs only the FIRST red line, so this runner stops the check (whole process tree) the moment it
 *      prints an XX line the unbroken check does not already print, and reports it.
 *   2  when the paired check is ALREADY red on main, "exit != 0 and some XX" proves nothing: the break is "caught" by the old red.
 *      So a break counts only for an XX line that is NEW against the baseline (or a crash when the baseline ran clean).
 * It never weakens a check: a break that adds no new red line is NOT caught, and the harness exits non-zero.
 *
 * API   baseline(script, opts)       full unbroken run  → { status, xx: [normalised XX lines], secs }
 *       verdict(script, base, opts)  broken run, stops at the first new XX → { status, xx: [new lines], early, secs, stderr }
 *       caught(v, base)              true when the break added a red line (or crashed a clean check)
 *       opts: { cwd, env, timeout (ms, default 600000), re (the red-line pattern, default /^\s+XX/) }
 * CLI   node e2e/lib/break-run.cjs <script> — used by the two functions above (they spawn this file), prints one BREAKRUN {json} line. */
'use strict';
const cp = require('child_process'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
/* a red line without the parts that move between runs (the list of routes it names) */
const norm = (l) => l.replace(/\s+—\s+not:.*$/, '').trim();

function child(script, opts) {
  const re = opts.re || /^\s+XX/, base = opts.base ? new Set(opts.base) : null, t0 = Date.now(), seen = []; // clock-ok: elapsed-time timer for the run, not a business date
  let summed = false;   /* the check printed its "N passed" summary: it ran to the end */
  const p = cp.spawn(process.execPath, [script], { cwd: opts.cwd || ROOT, env: opts.env || process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let buf = '', err = '', early = false, done = false;
  const killTree = () => { try { if (process.platform === 'win32') cp.spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-p.pid, 'SIGKILL'); } catch (_) {} };
  const finish = (status) => { if (done) return; done = true; clearTimeout(timer); console.log('BREAKRUN ' + JSON.stringify({ status, summed, xx: seen, early, secs: Math.round((Date.now() - t0) / 1000), stderr: err.split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 300) })); process.exit(0); }; // clock-ok: elapsed time in the result line
  const timer = setTimeout(() => { killTree(); finish(-1); }, opts.timeout || 600000);
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (/[0-9]+ passed/.test(line)) summed = true;
      if (re.test(line)) { const n = norm(line); if (!base || !base.has(n)) { seen.push(n); if (base) { early = true; killTree(); finish(null); } } }
    }
  });
  p.stderr.on('data', (d) => { err += d; });
  p.on('exit', (code) => finish(code));
}

function spawnSelf(script, opts) {
  const env = Object.assign({}, opts.env || process.env, { BREAKRUN_OPTS: JSON.stringify({ base: opts.base || null, timeout: opts.timeout, cwd: opts.cwd, re: opts.re && opts.re.source }) });
  const r = cp.spawnSync(process.execPath, [__filename, script], { cwd: opts.cwd || ROOT, encoding: 'utf8', env, timeout: (opts.timeout || 600000) + 30000, maxBuffer: 1 << 26 });
  const m = /^BREAKRUN (.*)$/m.exec(r.stdout || '');
  return m ? JSON.parse(m[1]) : { status: -1, xx: [], early: false, secs: 0, stderr: 'break-run produced no verdict: ' + (r.stderr || '').slice(0, 200) };
}
/* The baseline is only what the UNBROKEN check printed in runs we actually made. A check can be red in a different place on a loaded machine
   (one-person.cjs printed 2 red lines in one run and 4 in the next), so it runs TWICE (a third time when either was red) and the red lines are the UNION. */
const baseline = (script, opts) => {
  const runs = [spawnSelf(script, Object.assign({}, opts, { base: null })), spawnSelf(script, Object.assign({}, opts, { base: null }))];
  if (runs.some((r) => r.xx.length || r.status !== 0)) runs.push(spawnSelf(script, Object.assign({}, opts, { base: null })));
  const bad = runs.find((r) => r.status !== 0);
  return { status: bad ? bad.status : 0, summed: runs.every((r) => r.summed), xx: [...new Set([].concat(...runs.map((r) => r.xx)))], early: false, secs: runs.reduce((t, r) => t + r.secs, 0), runs: runs.length, stderr: runs[0].stderr };
};
const crashOnly = (v, base) => !v.xx.length && v.status !== -1 && v.status !== 0 && (base.status === 0 || (base.summed && !v.summed));
/* a break that is only "caught" by a crash can be load noise (a locator timeout on a busy machine): run it once more, and count it only if it crashes again */
const verdict = (script, base, opts) => {
  const v = spawnSelf(script, Object.assign({}, opts, { base: base.xx }));
  if (!crashOnly(v, base)) return v;
  const again = spawnSelf(script, Object.assign({}, opts, { base: base.xx }));
  return crashOnly(again, base) || again.xx.length ? Object.assign(again, { rechecked: true }) : again;
};
const caught = (v, base) => v.xx.length > 0 || crashOnly(v, base);   /* a crash caught the break when the unbroken check ran to its summary and this one did not; -1 = no verdict in time, reported, not counted */

/* site(W) — a throw-away copy of the web checkout the break is made in, so the REAL public/ and index.html are never edited (a hard kill, a Ctrl-C or a
   vanished .bak can no longer leave a broken product behind; signal handlers are not enough on Windows). A sibling of W, so the checks still find
   ../chitbridge-api and ../chitbridge-engines. public/, index.html, e2e/ and package.json are copied (the breaks edit public/ and index.html; the
   checks write e2e/shots into the copy, not the repo); every other top-level folder is a read-only junction to W. dispose() removes the junctions
   first (rmdir, never recursive), then the copy. Stale copies of a killed run (older than 3 h) are swept when the next one starts. */
function disposeDir(dir) {
  const fs = require('fs');
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    try { if (fs.lstatSync(p).isSymbolicLink() || (fs.lstatSync(p).isDirectory() && fs.realpathSync(p) !== p)) fs.rmdirSync(p); } catch (_) {}
  }
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }); } catch (_) { /* a Windows handle still open: the next run's sweep removes it */ }
}
function site(W) {
  const fs = require('fs');
  const root = path.dirname(W), dir = path.join(root, 'web-brk-' + process.pid + '-' + Date.now().toString(36)); // clock-ok: unique temp folder name
  for (const n of fs.readdirSync(root)) {
    if (!/^web-brk-/.test(n)) continue;
    try { const d = path.join(root, n); if (Date.now() - fs.statSync(d).mtimeMs > 3 * 3600e3) disposeDir(d); } catch (_) {} // clock-ok: age of an old temp folder for cleanup
  }
  fs.mkdirSync(dir);
  const COPY = new Set(['public', 'index.html', 'e2e', 'package.json']);
  for (const n of fs.readdirSync(W)) {
    if (n === '.git') continue;
    const from = path.join(W, n), to = path.join(dir, n);
    if (COPY.has(n)) {
      fs.cpSync(from, to, { recursive: true, filter: (p) => !/e2e[\\/](shots|\.auth)([\\/]|$)/.test(p) });
      if (n === 'e2e') fs.mkdirSync(path.join(to, 'shots'), { recursive: true });
    } else if (fs.statSync(from).isDirectory()) { if (process.platform === 'win32') cp.spawnSync('cmd', ['/c', 'mklink', '/J', to, from], { stdio: 'ignore' }); else fs.symlinkSync(from, to, 'dir'); }
    else fs.copyFileSync(from, to);
  }
  return { dir, dispose: () => disposeDir(dir) };
}
module.exports = { baseline, verdict, caught, site };

if (require.main === module) {
  const o = JSON.parse(process.env.BREAKRUN_OPTS || '{}'); if (o.re) o.re = new RegExp(o.re);
  child(process.argv[2], o);
}

/* locate(src, a) — find an anchor even when a formatter (prettier) has moved its spaces, line breaks and quote marks: exact text first, else the same
   TOKENS in the same order with any whitespace between them and either quote mark around a string. n = how many places match; apply(b) swaps the
   one match for b. A changed word, name or number still fails to match, so a break never lands on code that really changed. */
function locate(src, a) {
  let n = src.split(a).length - 1;
  if (n >= 1) { const i = src.indexOf(a); return { n, apply: (b) => (n === 1 ? src.split(a).join(b) : null), start: i, end: i + a.length }; }
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\\/]/g, (m) => '\\' + m);
  const toks = a.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[A-Za-z_$][\w$]*|\d+|\s+|[^\sA-Za-z_$\d'"]/g) || [];
  const real = toks.filter((t) => !/^\s+$/.test(t));
  let re = '';
  real.forEach((t, k) => {
    if (k > 0) re += (/[\w$]$/.test(real[k - 1]) && /^[\w$]/.test(t)) ? '\\s+' : '\\s*';
    if (/^['"]/.test(t) && !/['"]/.test(t.slice(1, -1))) { const body = esc(t.slice(1, -1)); re += '(?:\'' + body + '\'|"' + body + '")'; } else re += esc(t);
  });
  const all = [...src.matchAll(new RegExp(re, 'g'))];
  return { n: all.length, apply: (b) => (all.length === 1 ? src.slice(0, all[0].index) + b + src.slice(all[0].index + all[0][0].length) : null), start: all[0] && all[0].index, end: all[0] && all[0].index + all[0][0].length };
}
module.exports.locate = locate;
