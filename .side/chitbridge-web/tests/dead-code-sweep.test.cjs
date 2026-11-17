/* tests/dead-code-sweep.test.cjs: the dead-code sweep of 2026-11-09 (PR 512) removed code on the proof that nothing calls it.
 * This keeps that proof true: (1) package.json no longer lists the four removed dependencies and no source file imports them;
 * (2) the CSS classes whose rules were removed from public/*.html are named by no page, script or tool any more.
 * OWNS: the guard for that one removal. CALLED BY: .github/workflows/ci.yml (node tests/dead-code-sweep.test.cjs). */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');

const ROOT = path.join(__dirname, '..');
const REMOVED_DEPENDENCIES = ['axios', 'react-dom', 'react-router-dom', 'react-swipeable'];
const REMOVED_CSS_CLASSES = [
  'bellslot', 'bkparty', 'chlabel', 'chtoggle', 'composeov', 'composeov-bar', 'composeov-card', 'composeov-x', 'modhead', 'modn',
  'msgfbtn', 'msgfilter', 'msgfilters', 'msglist', 'namebody', 'namebox', 'namefield', 'namegrp', 'namehd', 'namehead', 'namemust',
  'namerow', 'namerule', 'namewhat', 'namewhy', 'offbadge', 'pbadges', 'pmore-t', 'ptags', 'pthumb', 'raidbody', 'rbarfill', 'rowacts',
  'rowclip', 'rowmsg', 'tdclear', 'tdrop', 'tdrow', 'tdwrap', 'typesel', 'unreaddot', 'welhero-cta', 'welhero-cta-sub',
];
let pass = 0;
const ok = (message) => { pass++; console.log('  ok  ' + message); };

/* every page, script and tool that could name a class or import a package (vendored and installed code is skipped) */
const SKIPPED_FOLDERS = ['node_modules', 'vendor', 'engine'];
const sourceFiles = (folder) => (fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }) : []).flatMap((entry) => {
  const full = path.join(folder, entry.name);
  if (entry.isDirectory()) return SKIPPED_FOLDERS.includes(entry.name) ? [] : sourceFiles(full);
  return /\.(html|js|cjs|mjs)$/.test(entry.name) && full !== __filename ? [full] : [];
});
const allText = ['public', 'src', 'tools', 'scripts', 'e2e'].flatMap((folder) => sourceFiles(path.join(ROOT, folder)))
  .map((file) => fs.readFileSync(file, 'utf8')).join('\n');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = Object.keys(Object.assign({}, manifest.dependencies, manifest.devDependencies));
assert.deepStrictEqual(REMOVED_DEPENDENCIES.filter((name) => declared.includes(name)), [], 'a removed dependency is back in package.json');
ok('the four removed dependencies are not in package.json');

const importPattern = (name) => new RegExp('(?:from|require\\()\\s*[\'"]' + name + '(?:/[^\'"]*)?[\'"]');
assert.deepStrictEqual(REMOVED_DEPENDENCIES.filter((name) => importPattern(name).test(allText)), [], 'a source file still imports a removed dependency');
ok('no source file imports them');

const classPattern = (name) => new RegExp('(^|[^\\w-])' + name.replace(/-/g, '\\-') + '(?![\\w-])');
const stillNamed = REMOVED_CSS_CLASSES.filter((name) => classPattern(name).test(allText));
assert.deepStrictEqual(stillNamed, [], 'a class whose CSS rule was removed is named again: ' + stillNamed.join(', '));
ok(REMOVED_CSS_CLASSES.length + ' removed CSS classes are named by no page, script or tool');

console.log('\n' + pass + ' checks passed\n');
