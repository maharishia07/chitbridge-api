#!/usr/bin/env node
/* tools/pr-ready.cjs — the api's door to the ONE pre-push check (LEVER 6, Athi 12 Nov): runs the web repo's tools/pr-ready.cjs with --repo api on this checkout.
 *
 * OWNS      finding that tool (CB_WEB_DIR, else the sibling ../chitbridge-web, else C:/dev/chitbridge-web) and handing over the arguments. No check lives here:
 *           the checks are in the web tool, as the §6 reader and the readability tool are (one reader, never a copy).
 * CALLED BY every api builder before `git push`: `node tools/pr-ready.cjs --body-file body.md` · tests/pr-ready-wrapper.test.cjs
 * FLOW      args ──▶ find the web checkout ──▶ spawn its pr-ready --repo api --root <this checkout> ──▶ its exit code
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const API_ROOT = path.join(__dirname, '..');
const WEB_TOOL = path.join('tools', 'pr-ready.cjs');

/** the first web checkout that has the tool: CB_WEB_DIR, the sibling, the shared C:/dev one */
function webToolPath() {
  const homes = [process.env.CB_WEB_DIR, path.join(API_ROOT, '..', 'chitbridge-web'), 'C:/dev/chitbridge-web'].filter(Boolean);
  const home = homes.find((dir) => fs.existsSync(path.join(dir, WEB_TOOL)));
  return home ? path.join(home, WEB_TOOL) : null;
}

function main() {
  const tool = webToolPath();
  if (!tool) {
    console.log('  ✗ pr-ready: no web checkout with tools/pr-ready.cjs (set CB_WEB_DIR to a current chitbridge-web checkout: git -C <web> pull)');
    return 1;
  }
  const done = spawnSync(process.execPath, [tool, '--repo', 'api', '--root', API_ROOT].concat(process.argv.slice(2)), { stdio: 'inherit' });
  return done.status === null ? 1 : done.status;
}

if (require.main === module) process.exit(main());
module.exports = { webToolPath };
