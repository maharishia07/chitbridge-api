/**
 * backup-guard.test.cjs — ⭐⭐⭐ NO PLAINTEXT BACKUP LEAVES A RUNNER (BKP1, 2026-10-14). Offline: no database, no network.
 *
 * Found by the platform reconciliation (14 Oct): backup-restore.yml uploaded an UNENCRYPTED production dump as an artifact of this
 * PUBLIC repo — anyone signed in to GitHub can download those. The nightly now lives in the PRIVATE chitbridge-engines repo and both
 * workflows run deploy/backup.sh (the one path). Fails when:
 *   1. any workflow's upload-artifact path looks like a dump (.dump .sql .gz .bak .tar …), or a workflow that backs up uploads
 *      anything that is not `.enc`;
 *   2. a workflow runs pg_dump itself instead of deploy/backup.sh (a second backup path, and one that skips the encryption);
 *   3. a workflow of THIS public repo reads the backup secrets (the real nightly belongs in the private repo);
 *   4. deploy/backup.sh dumps without the passphrase check first, or lets pg_dump write anywhere but into openssl;
 *   5. `backup.sh take` without a passphrase (or with a short one) does not refuse, or leaves a file behind.
 * Run: node tests/backup-guard.test.cjs [workflows-dir]   (the engines nightly runs it over its own .github/workflows)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const OWN = path.join(ROOT, '.github', 'workflows');
const DIR = process.argv[2] ? path.resolve(process.argv[2]) : OWN;
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

console.log('\n══ backups: encrypted before they leave, never in the public repo ══\n');

/** every upload-artifact step's path entries, from the raw YAML (no parser dependency) */
function uploadPaths(yml) {
  const out = [];
  const steps = yml.split(/\n(?=\s*-\s+(?:name|uses):)/);
  for (const s of steps) {
    if (!/uses:\s*actions\/upload-artifact/.test(s)) continue;
    const m = s.match(/\n(\s*)path:\s*(.*)/);
    if (!m) { out.push('(no path)'); continue; }
    if (m[2].trim() && !/^[|>]/.test(m[2].trim())) { out.push(m[2].trim()); continue; }
    const rest = s.slice(s.indexOf(m[0]) + m[0].length).split('\n').slice(1);
    for (const l of rest) { if (!l.trim()) continue; if (l.search(/\S/) <= m[1].length) break; out.push(l.trim()); }
  }
  return out;
}
const DUMPISH = /\.(dump|sql|gz|tgz|tar|bak|backup|pgdump|zip)\b|\bcb-\*/i;
function check(name, yml, isPublic) {
  const bad = [];
  const paths = uploadPaths(yml);
  const backsUp = /\bpg_dump\b|deploy\/backup\.sh/.test(yml);
  for (const p of paths) {
    if (backsUp && !/\.enc['"]?$/.test(p)) bad.push('backs up but uploads a non-.enc path: ' + p);
    else if (!backsUp && DUMPISH.test(p) && !/\.enc['"]?$/.test(p)) bad.push('uploads a dump-like path: ' + p);
  }
  if (/\bpg_dump\s+(-|"|\$)/.test(yml.replace(/^\s*#.*$/gm, ''))) bad.push('runs pg_dump itself — use deploy/backup.sh (the one path, encrypted)');
  if (isPublic && /secrets\.(BACKUP_DATABASE_URL|BACKUP_PASSPHRASE)/.test(yml)) bad.push('reads a backup secret in the PUBLIC repo');
  return bad;
}

/* 0 · the checker catches the workflow that leaked (the 10 Oct shape) */
const LEAKED = [
  'jobs:', '  b:', '    steps:',
  '      - name: Take the dump', '        env:', '          URL: ${{ secrets.BACKUP_DATABASE_URL }}',
  '        run: pg_dump --format=custom --file="cb-$stamp.dump" "$URL"',
  '      - name: Keep the dump off-platform', '        uses: actions/upload-artifact@v4', '        with:',
  '          name: cb-backup', '          path: cb-*.dump', '          retention-days: 30'].join('\n');
const caught = check('leaked', LEAKED, true);
ok('the checker refuses the 10 Oct workflow (plaintext dump upload, own pg_dump, secret in public)', caught.length === 3, caught.join(' | '));
ok('the checker reads a block path list', uploadPaths('      - uses: actions/upload-artifact@v4\n        with:\n          path: |\n            a.enc\n            b.dump\n      - name: x').join(',') === 'a.enc,b.dump');

/* 1-3 · every workflow in the directory */
const isPublic = DIR === OWN;
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)) : [];
ok('workflows found in ' + path.relative(process.cwd(), DIR || '.'), files.length > 0);
for (const f of files) {
  const bad = check(f, fs.readFileSync(path.join(DIR, f), 'utf8'), isPublic);
  ok(f + ': no plaintext backup leaves the runner', bad.length === 0, bad.join(' | '));
}

/* 4 · the script: passphrase first, pg_dump only into openssl */
const sh = fs.readFileSync(path.join(ROOT, 'deploy', 'backup.sh'), 'utf8');
const take = sh.slice(sh.indexOf('take() {'), sh.indexOf('\n}', sh.indexOf('take() {')));
ok('backup.sh take checks the passphrase before pg_dump', take.indexOf('need_passphrase') > -1 && take.indexOf('need_passphrase') < take.indexOf('pg_dump'));
const dumpCmd = take.slice(take.indexOf('pg_dump'), take.indexOf('||', take.indexOf('openssl enc')));
ok('backup.sh pipes pg_dump straight into openssl enc (no --file, no redirect)', /\|\s*openssl enc/.test(dumpCmd) && !/--file|-f\s|>\s*\S/.test(dumpCmd.split('|')[0]), dumpCmd);
ok('backup.sh restores by piping openssl -d into pg_restore (the plaintext never touches a disk)', /openssl enc -d [^\n]*\|\s*pg_restore/.test(sh));

/* 5 · and it refuses when run */
const probe = spawnSync('bash', ['--version'], { encoding: 'utf8' });
if (probe.status !== 0) console.log('   skip running backup.sh — no bash on this machine (Windows without Git Bash); CI runs it');
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bkp-'));
  const run = (pw) => spawnSync('bash', [path.join(ROOT, 'deploy', 'backup.sh'), 'take', path.join(tmp, 'x.enc')],
    { encoding: 'utf8', env: Object.assign({}, process.env, { BACKUP_DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none', BACKUP_PASSPHRASE: pw }) });
  for (const [label, p] of [['no passphrase', ''], ['a short passphrase', 'short']]) {
    const r = run(p);
    ok('backup.sh take refuses with ' + label + ' and leaves no file', r.status !== 0 && /refusing/.test(r.stderr) && fs.readdirSync(tmp).length === 0, r.stderr);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
