// CALLED BY lib/db-role.js (bootCheck), tests/capabilities.test.cjs (CI resolve guard), routes/health.js (counts)
// @stage tested
// @stage-note ERR-2/6/9/11a: the ONE manifest of what this api needs to run — files, adopted engines, database doors and optional tables.
'use strict';
/**
 * CARD 28-platform-and-operations/capability-manifest
 * lib/capabilities.js — what this api REQUIRES, in one place, so a missing part is named at boot and in CI, never found by a user's click.
 * OWNER     cb-platform
 * RISK      plain
 * OWNS  MANIFEST (the lists), checkFiles / checkEngines / checkTables / checkBodies (each returns a verdict {level,msg,reason} like lib/db-role), unresolvedRequires (the CI scan), counts() (what /health shows)
 * FLOW  boot → db-role.bootCheck → these checks → a log line each (fatal off a local stack for files and engines) · CI → tests/capabilities.test.cjs → unresolvedRequires + every hasTable literal listed
 * The doors themselves (sign-in, entity_schemas) stay in lib/db-role.js; MANIFEST.doors only NAMES them, so there is one list.
 * A lib that is ALLOWED to be absent (a `try { require } catch` on the same line, lib/workflow.js:63) is neither required nor a CI failure; an optional table absent is a count, never a refusal.
 */
const fs = require('fs'),
  path = require('path');
const ROOT = path.join(__dirname, '..');

const MANIFEST = {
  /* files a boot or a first request loads with no fallback: a missing one is a 502 or a crash loop (walk 2026-11-20 case 1a, 1c) */
  files: ['lib/tax.js', 'lib/country-setup.js', 'lib/books-nightly.js', 'lib/books-reconcile.js', 'lib/crm-followups.js', 'lib/identity-secret.js', 'lib/dev-otp.js', 'lib/public-base.js', 'lib/send-money.js', 'lib/output-allowlist.js', 'lib/person-session.js', 'lib/money-check.js', 'lib/access-events.js', 'lib/dbwatch.js', 'lib/db-role.js', 'lib/problem.js'],
  doors: ['ops.signin_candidates(text,text)', 'ops.shop_has_catalogue(uuid)', 'ops.shop_default_schema(uuid)'] /* asked by lib/db-role.js; named here so the list is in one file */,
  /* a trigger whose BODY must carry a door: the b890 body lets the network re-root through cb.net_reroot; the b889 body refuses it with 23514 (walk case 4a) */
  bodies: [{ fn: 'cb_entity_root_is_immutable', must_contain: 'cb.net_reroot', name: 'network re-root door' }],
  /* tables a route checks with schema.hasTable and answers without: absent is a count, not a refusal */
  tables: ['identity_documents', 'books_action_step', 'year_carry', 'stock_movement', 'supplier_readiness_acceptance', 'stock_balance', 'review_mark', 'register_template', 'journal_entry', 'chit_proposal', 'books_outbox', 'till_invoice_lease', 'register_subject', 'register_entry', 'party_interaction', 'party_contact', 'network_revoked', 'memberships', 'membership_certificate', 'media_blobs', 'fx_rate', 'entity_actor_settings', 'ctp_event_out', 'chit_line_raida', 'chit_line_delivery', 'chit_line_assignment', 'chit_line', 'chit_disputes', 'cb_attachment', 'books_payment', 'bank_rec_log', 'bank_statement_file', 'bank_statement_file_event', 'books_compare_part']
};

/** a verdict that passed */
const ok = (msg, reason) => ({ level: 'ok', msg, reason });
/** a verdict for a lost part: fatal off a local stack, a warning on one (the same rule as lib/db-role) */
const gone = (isLocalStack, what, reason) => ({ level: isLocalStack ? 'warn' : 'fatal', msg: isLocalStack ? what + ' (local stack: warning only)' : 'boot aborted: ' + what, reason });

/** the manifest files that are not on disk (names only, never an absolute path) */
const missingFiles = (root = ROOT, files = MANIFEST.files) => files.filter((f) => !fs.existsSync(path.join(root, f)));

/** { level, msg, reason } — every required file is present, or the missing ones by name */
function checkFiles(isLocalStack, root = ROOT, files = MANIFEST.files) {
  const lost = missingFiles(root, files);
  if (!lost.length) return ok('capability files present', files.length + ' required files found');
  return gone(isLocalStack, 'required capability files missing', 'not found: ' + lost.join(', ') + ' — restore them from the deployed commit; a restart does not bring them back');
}

/** adopted engine files (header "ADOPTED from chitbridge-engines vX · name") against engines.lock.json pins: [{ name, file, found, pinned }] for each that disagrees */
function engineDrift(root = ROOT) {
  const pins = JSON.parse(fs.readFileSync(path.join(root, 'engines.lock.json'), 'utf8')).pins || {};
  const drift = [];
  for (const dir of ['lib', 'app']) {
    const folder = path.join(root, dir);
    if (!fs.existsSync(folder)) continue;
    for (const f of fs.readdirSync(folder).filter((name) => name.endsWith('.js'))) {
      const head = fs.readFileSync(path.join(folder, f), 'utf8').slice(0, 300);
      const stamp = /ADOPTED from chitbridge-engines v([\d.]+) · ([\w-]+)/.exec(head);
      if (stamp && pins[stamp[2]] && pins[stamp[2]] !== stamp[1]) drift.push({ name: stamp[2], file: dir + '/' + f, found: stamp[1], pinned: pins[stamp[2]] });
    }
  }
  return drift;
}

/** { level, msg, reason } — each adopted engine runs the version engines.lock.json pins */
function checkEngines(isLocalStack, root = ROOT) {
  let drift;
  try {
    drift = engineDrift(root);
  } catch (e) {
    return { level: 'warn', msg: 'engine pins not read', reason: e.message };
  }
  if (!drift.length) return ok('adopted engines match their pins', 'engines.lock.json agrees with every adopted file');
  return gone(isLocalStack, 'adopted engine differs from its pin', drift.map((item) => item.name + ' ' + item.file + ' is v' + item.found + ', pinned v' + item.pinned).join('; '));
}

/** the optional tables this database lacks, in ONE read: runQuery(sql, params) → { rows } */
async function absentTables(runQuery, tables = MANIFEST.tables) {
  const r = await runQuery("SELECT t FROM unnest($1::text[]) AS t WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t)", [tables]);
  return ((r && r.rows) || []).map((row) => row.t);
}

/** an absent optional table is information (warn), never a refusal */
async function checkTables(runQuery) {
  const lost = await absentTables(runQuery);
  if (!lost.length) return ok('optional tables present', MANIFEST.tables.length + ' of ' + MANIFEST.tables.length);
  return { level: 'warn', msg: 'optional tables absent: ' + lost.length, reason: lost.join(', ') + ' — the routes that need them answer without (a migration has not been run here)' };
}

/** the trigger bodies that must carry a door; a wrong body is a warning that names it (prod may legitimately lag until its SQL is run) */
async function checkBodies(runQuery) {
  const wrong = [];
  for (const b of MANIFEST.bodies) {
    const r = await runQuery('SELECT prosrc FROM pg_proc WHERE proname = $1', [b.fn]);
    const rows = (r && r.rows) || [];
    if (rows.length && !rows.some((x) => String(x.prosrc).includes(b.must_contain))) wrong.push(b.name);
  }
  if (!wrong.length) return ok('trigger bodies carry their doors', MANIFEST.bodies.length + ' checked');
  return { level: 'warn', msg: 'trigger body lacks its door', reason: wrong.join(', ') + ' — run the held migration; until then the matching action answers a refusal' };
}

/** what the PUBLIC /health shows: counts only, no names (names stay in the boot log and behind the operator key) */
function counts(root = ROOT) {
  let drift = 0;
  try {
    drift = engineDrift(root).length;
  } catch (err) {
    require('./logger').fellBack('capabilities: engine pins not read for the health count', err, 'debug');
  }
  return { required: MANIFEST.files.length, missing: missingFiles(root).length, engine_drift: drift };
}

/** the steps lib/db-role.bootCheck runs for the manifest: { before: [files, engines], after: [optional tables, trigger bodies] } — one boot check, widened */
const bootSteps = (runQuery, isLocalStack) => ({
  before: [async () => checkFiles(isLocalStack), async () => checkEngines(isLocalStack)],
  after: [() => checkTables(runQuery), () => checkBodies(runQuery)]
});

/**
 * CI scan: every relative require('./x') in code that is not allowed to be absent must resolve. A line with `try` is allowed (lib/workflow.js:63);
 * comment lines are not code. Returns ['file:line target'] for each that does not resolve.
 */
function unresolvedRequires(root = ROOT, dirs = ['lib', 'routes', 'middleware', 'src', 'governance'], extra = ['server.js', 'db.js']) {
  const out = [];
  /** one file: each non-comment, non-try relative require that does not resolve is added to out */
  const scan = (filePath) => {
    fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || /\btry\b/.test(line)) return;
        const code = line.replace(/\/\*.*?\*\//g, '').replace(/\s\/\/.*$/, '');
        for (const hit of code.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
          const target = path.resolve(path.dirname(filePath), hit[1]);
          const found = [target, target + '.js', target + '.cjs', target + '.json', path.join(target, 'index.js')].some((x) => fs.existsSync(x) && fs.statSync(x).isFile());
          if (!found) out.push(path.relative(root, filePath).replace(/\\/g, '/') + ':' + (i + 1) + ' ' + hit[1]);
        }
      });
  };
  /** every .js/.cjs file under a folder, depth first */
  const walk = (folder) => {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const filePath = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (/\.c?js$/.test(entry.name)) scan(filePath);
    }
  };
  dirs.forEach((folder) => walk(path.join(root, folder)));
  extra.forEach((f) => fs.existsSync(path.join(root, f)) && scan(path.join(root, f)));
  return out;
}

module.exports = { MANIFEST, missingFiles, checkFiles, engineDrift, checkEngines, absentTables, checkTables, checkBodies, bootSteps, counts, unresolvedRequires };
