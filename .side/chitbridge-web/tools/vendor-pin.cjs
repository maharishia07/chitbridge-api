/**
 * vendor-pin.cjs — WHICH API COMMIT THE TILL'S COPIES ARE JUDGED AGAINST (2026-11-11, root cause of the till-vendor / pages-parse reds).
 *
 * The till master lives in chitbridge-api (tools/tally-connector/till.html, promo.html); public/till.html, promo.html, till-sw.js, the
 * manifest, engine/qr.js, engine/versions.json and app/their-bill.js here are GENERATED from it (api scripts/vendor-till.cjs). The api CI used
 * to compare them with web MAIN, so whichever repo landed first reddened the other until a twin branch was pushed. Now each repo checks what
 * it owns: the api checks its kit (--kit-only); THIS repo's CI checks its copies against the api commit named in vendor.lock.json
 * (--web-only). The follower pins the leader: an api change never reds this repo, a bump is one command and one web PR.
 *
 * OWNS      vendor.lock.json {api:{repo, sha, pinnedAt}}: read · bump (re-vendor from an api checkout, then write) · drift report
 * CALLED BY .github/workflows/ci.yml job till-copies; a person after an api till change
 * FLOW      api till change lands on api main ──▶ node tools/vendor-pin.cjs bump <api checkout at that main commit> ──▶ web PR (copies + lock)
 *           CI: api @ lock sha ──▶ vendor-till.cjs --check --web-only with CB_WEB_DIR=this repo ──▶ red only if a copy was hand-edited or the pin forgotten
 * CARD      09-counter/README
 *
 * Usage:  node tools/vendor-pin.cjs bump <api-checkout-dir>   (the checkout's HEAD must be an ancestor of origin/main, tree clean)
 *         node tools/vendor-pin.cjs drift <api-main-checkout> (warns: has api main changed a master since the pin? never fails)
 */
'use strict';
const fs = require('fs'),
  path = require('path'),
  { execFileSync, spawnSync } = require('child_process');

const WEB_ROOT = path.join(__dirname, '..');
const LOCK = path.join(WEB_ROOT, 'vendor.lock.json');
const API_REPO = 'maharishia07/chitbridge-api';
/* a pin older than this while api main has changed a master is called stale in the CI warning */
const STALE_DAYS = 7;
const DAY_MS = 86400000;
/* the api files the web's copies come from; a change to any of them makes the pin behind */
const MASTERS = ['tools/tally-connector/till.html', 'tools/tally-connector/promo.html', 'lib/their-bill.js', 'scripts/vendor-till.cjs'];

const gitOut = (dirArg, args) => execFileSync('git', ['-C', dirArg].concat(args), { encoding: 'utf8' }).trim();

/** the pin must name a commit that is on api main: a branch head can vanish, a merged commit never does */
const bump = (apiDir) => {
  const commit = gitOut(apiDir, ['rev-parse', 'HEAD']);
  if (gitOut(apiDir, ['status', '--porcelain'])) throw new Error(apiDir + ' has uncommitted changes — pin a clean checkout');
  const onMain = spawnSync('git', ['-C', apiDir, 'merge-base', '--is-ancestor', commit, 'origin/main']);
  if (onMain.status !== 0) throw new Error(commit.slice(0, 10) + ' is not on api origin/main — pin a merged commit (git fetch origin first)');
  const vend = spawnSync(process.execPath, [path.join(apiDir, 'scripts', 'vendor-till.cjs')], { env: Object.assign({}, process.env, { CB_WEB_DIR: WEB_ROOT }), encoding: 'utf8' });
  if (vend.status !== 0) throw new Error('vendor-till.cjs failed:\n' + vend.stdout + vend.stderr);
  const lock = { api: { repo: API_REPO, sha: commit, pinnedAt: new Date().toISOString().slice(0, 10) } };
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log('re-vendored from api ' + commit + ' and wrote vendor.lock.json — commit public/ and the lock together');
};

/** CI: api main against the pin. ::warning:: only — an api master change is normal, a pin left behind is what we want to see */
const drift = (apiMain) => {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  const ageDays = Math.floor((Date.now() - Date.parse(lock.api.pinnedAt)) / DAY_MS);
  const changed = gitOut(apiMain, ['diff', '--name-only', lock.api.sha, 'HEAD', '--'].concat(MASTERS)).split('\n').filter(Boolean);
  if (!changed.length) return console.log('the pin ' + lock.api.sha.slice(0, 10) + ' still matches api main for the till masters');
  console.log('::warning::api main changed ' + changed.join(', ') + ' since the pin (' + ageDays + ' day(s) ago' + (ageDays > STALE_DAYS ? ', STALE' : '') + ') — bump: node tools/vendor-pin.cjs bump <api checkout>');
};

if (require.main === module) {
  const [command, dirArg] = process.argv.slice(2);
  if (command === 'bump' && dirArg) bump(path.resolve(dirArg));
  else if (command === 'drift' && dirArg) drift(path.resolve(dirArg));
  else {
    console.log('usage: node tools/vendor-pin.cjs bump|drift <api checkout>');
    process.exitCode = 2;
  }
}

module.exports = { bump, drift };
