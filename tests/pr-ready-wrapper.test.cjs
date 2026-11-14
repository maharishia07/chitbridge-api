#!/usr/bin/env node
// @type: unit
/**
 * pr-ready-wrapper.test.cjs - LEVER 6 (Athi 12 Nov): tools/pr-ready.cjs only hands over to the web tool; it must find it through CB_WEB_DIR,
 * say how to fix a missing one, and carry the web tool's exit code.
 * CALLED BY scripts/guards.cjs (GUARDS)
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const WRAPPER = path.join(__dirname, '..', 'tools', 'pr-ready.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-ready-web-'));
fs.mkdirSync(path.join(dir, 'tools'));
fs.writeFileSync(path.join(dir, 'tools', 'pr-ready.cjs'), "console.log('stub ' + process.argv.slice(2).join(' ')); process.exit(3);\n");

const found = spawnSync(process.execPath, [WRAPPER, '--fast'], { encoding: 'utf8', env: Object.assign({}, process.env, { CB_WEB_DIR: dir }) });
assert.strictEqual(found.status, 3, 'the web tool exit code is the wrapper exit code');
assert(/stub --repo api --root .*--fast/.test(found.stdout), 'the web tool gets --repo api, the api root and the caller arguments: ' + found.stdout);

const wrapper = require(WRAPPER);
process.env.CB_WEB_DIR = path.join(dir, 'nowhere');
const fallback = wrapper.webToolPath();
assert(fallback === null || fallback.endsWith(path.join('tools', 'pr-ready.cjs')), 'a missing CB_WEB_DIR falls back to the sibling or answers null');
fs.rmSync(dir, { recursive: true, force: true });
console.log('pr-ready-wrapper: 3 checks ok');
