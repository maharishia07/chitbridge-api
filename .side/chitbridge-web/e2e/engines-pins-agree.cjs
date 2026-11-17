#!/usr/bin/env node
'use strict';
/**
 * e2e/engines-pins-agree.cjs — THE WEB AND THE API RUN THE SAME ENGINES (T1-TAX, 2026-10-14).
 *
 * adopt.cjs --check proves each platform's copies are exactly the release IT pins — not that the two platforms pin the same
 * release. They drifted: web's packs sat at v1.42 while the api moved to v1.45 (4260 fx_gain_loss and pack.fx missing on the web,
 * so Country Lab drew another chart than the server books to), and the till's day count (rollup 1.5) still counted a despatch note
 * as a bill the api (rollup 1.32) does not. This check reads the two engines.lock.json files: every engine BOTH pin must be at
 * the same version.
 *
 *   node e2e/engines-pins-agree.cjs          exit 1 on any pair that differs, or when the api is not beside this repo
 *
 * ⚠️ The api must be checked out beside this repo (../chitbridge-api, or CB_API_REPO). Missing = FAIL — a check that quietly
 * skips is how the drift came back. Web CI checks it out (ci.yml), the way walks.yml does.
 */
const fs = require('fs'), path = require('path');

/* ⭐ the ONE known difference, by name, with why. The check fails when a pair differs and is not here, AND when a pair listed here
   agrees again (a stale exception hides the next drift). Move the api in its own round, then delete the line. */
const KNOWN = {
  screen: 'web 1.15.0 carries the theme library (additive, v1.13–1.15); the api\'s lib/screen-kit.js is still 1.5.0 — an api round moves it',
};

const WEB = path.join(__dirname, '..');
const API = process.env.CB_API_REPO || path.join(WEB, '..', 'chitbridge-api');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const pinsOf = (repo) => (JSON.parse(fs.readFileSync(path.join(repo, 'engines.lock.json'), 'utf8')).pins || {});

if (!fs.existsSync(path.join(API, 'engines.lock.json'))) {
  console.log('  XX  chitbridge-api is not beside this repo (' + API + ') — clone maharishia07/chitbridge-api there, or set CB_API_REPO');
  process.exit(1);
}
const web = pinsOf(WEB), api = pinsOf(API);
const both = Object.keys(web).filter((n) => Object.prototype.hasOwnProperty.call(api, n)).sort();
ok(both.length > 0, both.length + ' engines pinned by both the web and the api');
const differ = both.filter((n) => web[n] !== api[n]);
const unknown = differ.filter((n) => !KNOWN[n]);
ok(!unknown.length, 'every engine both pin is at the same version' + (unknown.length ? ' — differ: ' + unknown.map((n) => n + ' web ' + web[n] + ' · api ' + api[n]).join(', ')
  + ' (move the behind side: change its pin, then node ../chitbridge-engines/tools/adopt.cjs <repo>)' : ''));
const stale = Object.keys(KNOWN).filter((n) => differ.indexOf(n) < 0);
ok(!stale.length, 'every named exception still differs' + (stale.length ? ' — agree again, delete from KNOWN: ' + stale.join(', ') : ''));
differ.filter((n) => KNOWN[n]).forEach((n) => console.log('  --  ' + n + ': web ' + web[n] + ' · api ' + api[n] + ' — ' + KNOWN[n]));
/* the tax half, by name: the country packs and the registry are what Country Lab and the books must read alike */
const TAX = ['reg-in', 'reg-au', 'reg-ae', 'regulation', 'tax-packs', 'tax-slab', 'tax'];
ok(TAX.every((n) => web[n] && web[n] === api[n]), 'the tax bundle (' + TAX.join(' · ') + ') is pinned by both, at one version each');
console.log(pass + ' ok · ' + fail + ' failed');
process.exit(fail ? 1 : 0);
