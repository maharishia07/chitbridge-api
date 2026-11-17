'use strict';
/**
 * cb-build-guard.cjs — A CAPABILITY CHANGED AND THE CACHE-BUSTER DID NOT. THE FIX CANNOT REACH ANYBODY.
 *
 * ── ⚠️⚠️ THE DAY THIS COST ─────────────────────────────────────────────────────────────────────────────────
 *
 * 2026-09-12. The test lab gained a menu tree, a full-screen size, two rewritten empty states and a fixed
 * refresh. All of them shipped. None of them could reach a browser, because every lazily-loaded file is fetched
 * as `/app/cap-<name>.js?v=' + CB_BUILD` and CB_BUILD still said `2026-09-11b` — so every browser that had
 * already seen that version kept serving yesterday's file.
 *
 * ⭐ It was found by testing the PRODUCT rather than the code: a fix was applied, the page reloaded, the button
 * pressed, and nothing happened — because the browser was running the old file. Nothing in the build said a
 * word. A fix that cannot be fetched is not a fix.
 *
 * ── ⭐ WHAT THIS ASKS ───────────────────────────────────────────────────────────────────────────────────────
 *
 * For every file fetched with `?v=CB_BUILD`: was it changed AFTER the commit that last set the current
 * CB_BUILD? And is it changed right now in the working tree while CB_BUILD is not? Either way the answer is a
 * red, and the fix is one line.
 *
 * ⚠️ THE EAGER FILES ARE DELIBERATELY OUT OF SCOPE. `core.js`, `cart.js` and their siblings are loaded by plain
 * `<script src="/app/core.js">` with no version at all — they are a different caching question (HTTP
 * revalidation), and pretending this guard covers them would be worse than saying so.
 *
 * Run: node e2e/cb-build-guard.cjs        exit 1 when the cache-buster is stale
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// CB_BUILD_GUARD_ROOT lets e2e/cb-build-guard-selftest.cjs aim this guard at a scratch repo; unset = this checkout
const WEB = process.env.CB_BUILD_GUARD_ROOT || path.join(__dirname, '..');
const PUB = path.join(WEB, 'public');
const APPDIR = path.join(PUB, 'app');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  XX  ' + name + '\n      ' + e.message); fail++; }
};

const git = (args) => {
  try { return execFileSync('git', ['-C', WEB].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim(); }
  catch (_) { return ''; }
};

/** a git read whose answer is judged: a failure THROWS with git's own message, it never becomes '' (an empty text made cbBuild read the working file) */
const gitOrThrow = (args) => {
  try { return execFileSync('git', ['-C', WEB].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { throw new Error('git ' + args.join(' ') + ' failed: ' + String((e.stderr || e.message || e)).trim().slice(0, 300)); }
};

/** the declared value, read from the shell that declares it */
function cbBuild(text) {
  const src = text || fs.readFileSync(path.join(PUB, 'app.html'), 'utf8');
  const m = /const\s+CB_BUILD\s*=\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('app.html no longer declares CB_BUILD — this guard no longer knows what it guards');
  return m[1];
}

/**
 * ⭐ EVERY FILE THAT RIDES ON THE CACHE-BUSTER, derived rather than listed:
 *   · every cap-*.js, which ensureCap() fetches as `/app/cap-<name>.js?v=` + CB_BUILD
 *   · every `/app/<file>.js` named as a STRING inside app/*.js — that is how the shared files are loaded
 *     (testEnsureFile('/app/test-verdict.js')), and a hard-coded list here would go stale the first time
 *     somebody adds one.
 * ⚠️ A file that is only ever loaded by a <script src> tag in app.html is NOT in this set — see the header.
 */
function versioned() {
  const out = new Set();
  fs.readdirSync(APPDIR).filter((f) => /^cap-.*\.js$/.test(f)).forEach((f) => out.add('public/app/' + f));

  fs.readdirSync(APPDIR).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(path.join(APPDIR, f), 'utf8');
    const re = /['"]\/app\/([A-Za-z0-9._-]+\.js)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      if (fs.existsSync(path.join(APPDIR, m[1]))) out.add('public/app/' + m[1]);
    }
  });
  return [...out].sort();
}

/**
 * When the CB_BUILD LINE last changed — the moment the cache was actually busted.
 *
 * ⚠️⚠️ NOT `git log -S`. The pickaxe reports every commit where the COUNT of a string changed, INCLUDING the
 * one that removed it — so asking when the old value was set returned the commit that replaced it, and the
 * guard cheerfully concluded that nothing was stale. `-L line,line:file` asks when this line last changed,
 * which is the question.
 * ⭐ The line number is read from the file, never hard-coded: a line number in a fifteen-thousand-line shell
 * is a fact with a very short shelf life.
 */
function bustedAt() {
  const src = fs.readFileSync(path.join(PUB, 'app.html'), 'utf8').split('\n');
  const ln = src.findIndex((l) => /const\s+CB_BUILD\s*=/.test(l)) + 1;
  if (!ln) return 0;
  const out = git(['log', '-1', '--format=%ct', '-L', ln + ',' + (ln + 1) + ':public/app.html']);
  const first = String(out).split('\n')[0].trim();
  return /^\d+$/.test(first) ? Number(first) : 0;
}

const FILES = versioned();
const VALUE = cbBuild();

t('CB_BUILD was bumped after the last capability change', () => {
  const busted = bustedAt();
  if (!busted) {
    /**
     * ⚠️ NOT AN ERROR. The value is declared and not yet committed — which is exactly what a correct bump looks
     * like in the moment before it is pushed. Reported as passing, with the reason said out loud.
     */
    console.log('      ⭐ CB_BUILD is ' + VALUE + ' and not yet committed — that is a bump in progress.');
    return;
  }

  const stale = [];
  FILES.forEach((f) => {
    const ts = Number(git(['log', '-1', '--format=%ct', '--', f]) || 0);
    if (ts && ts > busted) stale.push({ f: f, ts: ts });
  });

  /* QA-154: the stale files are recorded in e2e/scanner-known.json, keyed by CB_BUILD value + file, so a bump makes every key
     stale at once (the real fix) and a file changed after the next bump is new. Only a NEW stale file fails. */
  const RK = require('./lib/known-findings.cjs').ratchet('cb-build-guard',
    stale.map((s) => ({ key: VALUE + '  ' + s.f, show: s })), { owner: 'release' });
  console.log(RK.line);
  const fresh = RK.fresh.map((i) => i.show);

  if (fresh.length) {
    const when = (s) => new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ');
    throw new Error(fresh.length + ' NEW versioned file(s) changed AFTER CB_BUILD was last bumped (' + VALUE
      + ', ' + when(busted) + '). Every browser that has seen ' + VALUE + ' is still being served the OLD copy:'
      + '\n      ' + fresh.slice(0, 8).map((s) => s.f + '  (' + when(s.ts) + ')').join('\n      ')
      + '\n      ⭐ THE FIX IS ONE LINE: bump CB_BUILD in public/app.html.');
  }
});

t('a capability edited right now is shipping with a bumped CB_BUILD', () => {
  /**
   * ⚠️⚠️ NOT `git status --porcelain`. Its lines begin with a two-character status and a space, and the
   * helper above trims — so " M public/app/x.js" arrived as "M public/app/x.js" and slice(3) ate a character
   * of the path. The guard then matched nothing and stayed GREEN with a capability modified and no bump,
   * which is the exact failure it exists to catch. A guard that has only ever been green proves nothing.
   * ⭐ `diff --name-only` returns paths and nothing else; `ls-files --others` adds the new ones.
   */
  const dirty = (git(['diff', '--name-only', 'HEAD', '--', 'public/app', 'public/app.html']) + '\n'
    + git(['ls-files', '--others', '--exclude-standard', '--', 'public/app']))
    .split('\n').map((l) => l.trim()).filter(Boolean);
  if (!dirty.length) return;

  const touched = FILES.filter((f) => dirty.indexOf(f) > -1);
  if (!touched.length) return;

  /**
   * ⭐ IS app.html ITSELF CHANGED, AND IS THE CHANGE THE CACHE-BUSTER? A modified app.html is not enough — it
   * is edited for a hundred reasons a day. The diff has to actually touch the CB_BUILD line.
   */
  const diff = git(['diff', '--', 'public/app.html']) + git(['diff', '--cached', '--', 'public/app.html']);
  const bumped = /^\+.*const\s+CB_BUILD\s*=/m.test(diff);

  if (!bumped) {
    throw new Error(touched.length + ' versioned file(s) are changed in the working tree and CB_BUILD is NOT:'
      + '\n      ' + touched.slice(0, 8).join('\n      ')
      + '\n      ⭐ Bump CB_BUILD in public/app.html before pushing, or these changes reach nobody who has '
      + 'already loaded the app.');
  }
});

t('a capability changed against main is shipping with a CB_BUILD different from main\'s', () => {
  /**
   * ⭐ REL-24 (13 Nov): the two tests above compare COMMIT TIMES, so a branch cut before the last bump and merged
   * after it (every batch) carries a cap-*.js commit older than the bump and passes with no bump of its own.
   * This asks the question by ANCESTRY instead: against the merge-base with origin/main, did a versioned file
   * change, and is CB_BUILD the same as on main (or as at the merge-base)? On main itself HEAD IS the merge-base,
   * nothing differs, and the two time-based tests above stay the judge.
   */
  const main = git(['rev-parse', '--verify', '-q', 'origin/main']);
  const base = main ? git(['merge-base', 'HEAD', 'origin/main']) : '';
  if (!base) {
    // CI always has origin/main (fetch-depth 0): a missing one there means the check did not run, which must not look green
    if (process.env.CI === 'true') throw new Error('CI=true and there is no origin/main to compare with, so the ancestry check cannot run. Fetch it (fetch-depth: 0).');
    console.log('      (no origin/main to compare with, skipped)');
    return;
  }
  const changed = git(['diff', '--name-only', base, '--']).split('\n').map((l) => l.trim()).filter(Boolean);
  const touched = FILES.filter((f) => changed.indexOf(f) > -1);
  if (!touched.length) { console.log('      no versioned file differs from origin/main: nothing to bump'); return; }
  const mainValue = cbBuild(gitOrThrow(['show', 'origin/main:public/app.html']));
  const baseValue = cbBuild(gitOrThrow(['show', base + ':public/app.html']));
  if (VALUE === mainValue || VALUE === baseValue) {
    throw new Error(touched.length + ' versioned file(s) differ from main and CB_BUILD (' + VALUE + ') is the same as '
      + (VALUE === mainValue ? 'main\'s' : 'the merge-base\'s') + ':'
      + '\n      ' + touched.slice(0, 8).join('\n      ')
      + '\n      ⭐ THE FIX IS ONE LINE: bump CB_BUILD in public/app.html in this PR.');
  }
  console.log('      ' + touched.length + ' versioned file(s) differ from origin/main and CB_BUILD ' + VALUE + ' is bumped');
});

console.log('\n  ' + FILES.length + ' versioned file(s) · CB_BUILD ' + VALUE
  + ' · ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
