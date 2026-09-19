/**
 * guards.cjs — RUN THE CHECKS THAT NEED NOTHING, AND SAY ONE NUMBER.
 *
 * `npm test` needs a server running; these do not. They are what must pass before anything is pushed — no database, no network,
 * a few seconds — and until now the way to run them was to remember nine filenames.
 *
 * ⚠️ WHY A SCRIPT AND NOT A SHELL LOOP. The VS Code task was first written as a cmd.exe `for %t in (…)` loop, and VS Code's
 * terminal on Windows is PowerShell, where that is a syntax error. A task nobody can run is a task nobody runs. One node script
 * behaves the same from PowerShell, cmd, Git Bash and CI.
 *
 * ⚠️⚠️ AND WHY A DECLARED LIST RATHER THAN A GLOB. The first version ran everything matching tests/*.test.js — 95 files — and
 * reported 13 failures. Most were not failures at all: traceability needs a live server ("fetch failed"), several need a
 * database. A runner that reports red for the wrong reason gets ignored within a week, and then it is reporting nothing.
 * So GUARDS is a list somebody chose. `--all` runs the rest and is honest that some of it needs a server.
 *
 *   node scripts/guards.cjs         the offline set — safe anywhere, seconds
 *   node scripts/guards.cjs --all   every test file, including the ones that need a server or a database
 */
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const TESTS = path.join(__dirname, '..', 'tests');

/** the offline set: no DB, no network, no server. Add one here the day it becomes true, not before. */
const GUARDS = [
  'pages-parse.test.js',      // every inline script in app.html, till.html and promo.html parses
  'till-vendor.test.js',      // the counter and its vendored engines agree, byte for byte
  'till-shippable.test.cjs',  // the installable till carries only modules with no database behind them
  'catalogue-blueprint.test.js', // two trades, one axiom, and a product sequence that cannot collide
  'xlsx-read.test.js',        // an Excel file read into the shape a CSV makes, and refused in words otherwise
  'write-limits.test.js',     // a door that writes many records per request is rate-limited, and keyed by the key
  'categories.test.js',       // a product CITES its category; nothing writes the legacy single-category key
  'snapshot-wire.test.js',    // what a counter receives AFTER JSON — the Map that cost the shop its tax
  'one-name-one-function.test.cjs', // two functions, one name: the loser hoists away in silence
  'docnumber-scheme.test.cjs',// the bill number's shape: what the date says vs when the run restarts
  'bell-param.test.cjs',      // every page opens the bell with the name the stream reads (2026-09-17: counters never heard it)
  'network-storefront.test.cjs', // a member storefront shows its network's offers and its checkout charges them — one key
  'network-catalogue.test.cjs',  // a brand publishes product changes; a store's own price is only ever suggested to
  'screen-kit.test.cjs',        // the screen library: every layout places every part; presets resolve; tiles fall back
  'no-tax-reformula.test.cjs',  // the counter calls CBTax.splitLineTax() — no page re-derives the tax split itself
  'network-authority.test.cjs',  // who may act on a network edge — from the token, never the body (ATH-86)
  /* ⭐ what the application can work out about a shop without asking it — country decides tax, money and every
     format, so the rule that it must return UNKNOWN rather than guess is a guarded one (registration) */
  'govcontext.test.js',
  /* ⚠️ the INSERT and b264 must agree about the columns — a misspelt one is invisible offline and surfaces
     on a real shop's first sign-up, as a failed audit row on the one event it exists to record */
  'signup-context.test.js',
  /* ⚠️ the same set of choices must always make the same line, and a different set never the same one —
     both failures are silent, and the bill stays arithmetically correct while being wrong */
  'variant.test.js',
  'rewards.test.js',          // what a point is worth, and what a ledger may do — it touches money
  'reward-cycle.test.js',     // the SEQUENCE: earn, come back, encash, expire, register — against the real store
  'sql-runner.test.js',       // a tool that runs SQL at production: its WITH/WITHOUT RLS line must be true
  'stock-cycle.test.js',      // the log and the cache must stay in step — through a replay, a minus, and a corrupted balance
  /* ⚠️⚠️ IT WAS NOT IN THIS LIST until 2026-09-10, so the one guard that asks 'is every module classified,
     and does everything unreachable say so' only ran when somebody remembered to. It caught an unclassified
     lib the same minute it was added here. A guard outside the suite is a guard nobody runs. */
  'item-kind.test.cjs',        // a supply is never counted as a product — one column carries the whole split
  'root-link.test.cjs',        // the values rootlink writes must be values the CHECK constraints accept
  'entity-kind.test.cjs',      // every identity mint declares WHAT it is — a DELETE predicate depends on it
  'board-kinds.test.cjs',      // the shared board carries CASES and nothing else — findings stay with the raiser
  'engine-boundary.test.js',  // every lib declared engine or not; anything unreachable carries an @stage
  'adopt.test.js',            // what one shop may take into its catalogue from another's delivery
  'local-supplier.test.js',   // ~<user id>.sup-nnnn — one row per shop, never a recipient, never in the search
  'money-language.test.js',   // the currency and language CONVENTIONS, as assertions — a capability, not advice
  'search-engine.test.js',    // one search, three copies
  'lotfields.test.js',        // what a vertical must capture about a consignment
  'printer.test.js',          // the slip bytes
  'kit-update.test.js',       // a kit that does not parse is never swapped in
  'speech.test.js',           // the seam, not the vendor
  'key-scopes.test.js',       // what every API key may reach — the authorisation matrix
  'column-home.test.cjs',     // where a column actually lives
  'connector-kit.test.js',
  'tax-vendor.test.js',
  /* ⭐ a migration that says 'idempotent' has to be. Every file from b240 ends in PROOFS, and those are only
     reachable by re-running it — so one that errors on a second run is one nobody can re-verify. */
  'migration-rerunnable.test.cjs',
  /* ⭐ three desks × routed/unrouted × network/no-network is twelve paths through ONE function, and eleven are
     the ones nobody will ever click. Athi: *"if we can figure out all the combination and a single helpdesk
     works for all, nothing like it."* This is what keeps it single. */
  'support-desks.test.cjs',
  /* ⭐ node -c parses, it does not resolve: a const declared in one function and read in the next compiles
     perfectly and throws on the first real request. Three times in one day's work. */
  'scope-leak.test.cjs',
  /* ⚠️ summary_json is built from a WHITELIST and drops anything else in silence. It has eaten two riders:
     detail_design, then routed_by - the whole support-ticket trace, passed and never stored, in the same
     session as the comment in lib/mint.js warning about it. */
  'mint-riders.test.cjs',
  /* ⚠⚠ 55 tables are FORCE RLS. Read one with no app.current_entity and you get an empty set - not an
     error. Three near-misses in one day, and one reached a commit message asserting a function was lying
     when the function was right and the check was blind. */
  'rls-context.test.cjs',
  /* ⭐ CTP step 2: the address seam. Every address local, no wire - and the test asserts the two claims that
     matter: ONE query for five copies (it costs nothing while nothing is remote), and a remote copy refused
     BEFORE any write rather than half a chit delivered. */
  'ctp-address.test.cjs',
  /* ⭐⭐ THE CONFORMANCE RULE. Athi: "the behaviour should be the same" whether a world is a row here or its
     own machine. open(sign(build(copy))) must deep-equal copy, or the two transports write different rows and
     lifting a world silently changes behaviour. Also holds the population boundary, which across a wire is a
     PROTOCOL rule because b247 cannot see the far entity. */
  'ctp-conformance.test.cjs',
  /* ⭐ Athi’s test: two shops with the SAME user id, display name AND bridge id, in two countries. The
     collision is expected — bridge ids are minted per installation — and the address carries the namespace,
     so CBAAAAAAAA@in.example is not CBAAAAAAAA@ae.example. The dangerous case it holds: a QUALIFIED address
     must never resolve locally just because we hold that id. */
  'ctp-collision.test.cjs',
  /* ⭐⭐ THE SOFTWARE ASSETS. Athi: "each capability has to be proven without the concept of chit… that will
     be our software asset." Ten modules, each proven ALONE (its require() list is empty or a language
     builtin) and proven to ANSWER something, with no database, no network and no chit. */
  'bare-slate.test.cjs',
  /* ⭐ the conversion engine: currency, and what a QUANTITY is worth at a market price. A rate is EVIDENCE
     — it carries where it came from and when — and the engine refuses rather than guessing: no unit factor
     it was not given, no inverted rate unless permitted, and a line it cannot value never vanishes from a
     total. No database, no network, no chit. */
  'convert.test.cjs',
  /* ⭐⭐ THE NAMESPACE REGISTER — docs/namespace.yaml checked against the code that enforces it. Every kind of
     id, its shape, its separator, whether it can be sent to, and where the rule lives. It exists because the
     grammar used to live only in one file’s comments, and a document nothing checks becomes fiction. */
  'namespace.test.cjs',
  /* ⭐⭐ MINT a user id and RESOLVE one — every combination in one place (lib/mintuserid.js), every reading in
     another (lib/resolveuserid.js). § 0 holds the customer form byte-identical to what production already
     stores: one character of drift and every returning customer becomes a second identity. */
  'userid.test.cjs',
  /* ⭐⭐ THE CONSTITUTION MATRIX — one cascade, two doors. A party arriving over CTP has no entity row here, so
     it used to resolve, silently, as base @ platform-0. Now it resolves from ITS installation (the b254 rule)
     and every answer says resolved_from + fallback. Also: in lib/, only govresolve may resolve a constitution. */
  'govresolve-ctp.test.cjs',
  /* ⭐⭐ CTP QUERY — the READ verb (Athi: catalogue PULL, by store id, same as local). A signed question,
     refused when stale/tampered/unpaired, answered with the SAME public view an anonymous visitor gets. */
  'ctp-query.test.cjs',
];

const all = process.argv.indexOf('--all') >= 0;
const files = all
  ? fs.readdirSync(TESTS).filter((f) => /\.test\.(js|cjs)$/.test(f)).sort()
  : GUARDS.filter((f) => { if (fs.existsSync(path.join(TESTS, f))) return true;
      console.log('  ⚠️  ' + f + ' is listed but missing — renamed, or deleted without updating this list'); return false; });

let total = 0, failed = [], started = Date.now();
console.log(all ? '— every test file (some need a server) —' : '— the guards —');

for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(TESTS, f)], { encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  /* every guard ends with "<n> checks"; take the LAST one, because a stray warning can print after it */
  const m = out.match(/(\d+)\s+checks/g);
  const n = m ? Number(String(m[m.length - 1]).match(/\d+/)[0]) : 0;
  /* ⚠️ A GUARD THAT COUNTED NOTHING PROVED NOTHING (2026-09-17: three guards ended without "<n> checks" and read "ok · 0") */
  const bad = (r.status !== 0) || /\bFAIL\b/.test(out) || n === 0;
  total += n;
  if (bad) failed.push(f);
  console.log('  ' + (bad ? 'FAIL' : ' ok ') + '  ' + f.replace(/\.test\.(js|cjs)$/, '').padEnd(22) + String(n).padStart(4) + ' checks');
  if (bad) console.log(out.split('\n').filter((l) => /FAIL|Error|expected/i.test(l)).slice(0, 5)
    .map((l) => '          ' + l.trim()).join('\n'));
}

console.log('  ' + '─'.repeat(40));
console.log('  ' + total + ' checks · ' + files.length + ' files · ' + (Math.round((Date.now() - started) / 100) / 10) + 's · '
  + (failed.length ? failed.length + ' FAILED: ' + failed.join(', ') : 'all passed'));
process.exit(failed.length ? 1 : 0);
