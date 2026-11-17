'use strict';
// @type: unit
/**
 * ui-script-loaded.cjs — UX-137: a page that runs a file calling ui.action( / ui.dialog( must load public/app/ui.js before it.
 *
 * Why (web #501, walk-policy-card): cap-settings.js moved to ui.action, settings.html loaded ui.js, but app.html loads cap-settings.js
 * LAZILY (ensureCap('admin') pulls 'settings'), did not load ui.js, and the Policy card did not draw. Rules, read from source:
 *   1. a page that loads a file with `ui.action(` / `ui.dialog(` by <script src> loads ui.js, and loads it first;
 *   2. a page that defines ensureCap( (it can load any cap-*.js on demand) loads ui.js when ANY app/cap-*.js calls ui.
 *   3. the same for ui.field( and app/ui-field.js (UX-137 R2: cap-readiness.js and cap-definitions.js draw inputs with it, loaded lazily by app.html).
 * The guard proves itself: app.html with its ui.js tag removed must FAIL.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * Run: node e2e/ui-script-loaded.cjs
 */
const fs = require('fs'), path = require('path');
const publicDir = path.join(__dirname, '..', 'public');
/* a call written root.ui.action( is the OPTIONAL use: the file checks for ui first (screen-id.js: no ui.js on the page, no notes, no button), so it needs no tag */
const callsUi = /(?<!root\.)\bui\.(?:action|dialog)\(/;
const scriptTag = /<script[^>]*\bsrc="\/?(app\/[\w.-]+\.js)"/g;

const callsField = /(?<!root\.)\bui\.field\(/;
const appFiles = fs.readdirSync(path.join(publicDir, 'app')).filter((file) => /\.js$/.test(file) && file !== 'ui.js');
const usersOfUi = appFiles.filter((file) => callsUi.test(fs.readFileSync(path.join(publicDir, 'app', file), 'utf8'))).map((file) => 'app/' + file);

/** the sentences that fail for one page's HTML */
function failuresOf(page, html) {
  const failures = [];
  const loaded = [];
  let match;
  scriptTag.lastIndex = 0;
  while ((match = scriptTag.exec(html))) loaded.push(match[1]);
  const uiAt = loaded.indexOf('app/ui.js');
  loaded.forEach((file, at) => {
    if (usersOfUi.indexOf(file) < 0) return;
    if (uiAt < 0) failures.push(page + ' loads ' + file + ' (calls ui.action) but does not load app/ui.js');
    else if (uiAt > at) failures.push(page + ' loads app/ui.js after ' + file);
  });
  const loadsOnDemand = /function ensureCap\(/.test(html);
  const lazyUsers = usersOfUi.filter((file) => /^app\/cap-/.test(file));
  if (loadsOnDemand && lazyUsers.length && uiAt < 0) failures.push(page + ' loads caps on demand (ensureCap) and ' + lazyUsers.join(', ') + ' call ui.action, but it does not load app/ui.js');
  return failures.concat(fieldFailures(page, html, loaded, loadsOnDemand));
}
/** rule 3: ui.field( callers load app/ui-field.js, after ui.js (ui-field reads ui.words, ui.escape and ui.style) */
function fieldFailures(page, html, loaded, loadsOnDemand) {
  const users = appFiles.filter((file) => file !== 'ui-field.js' && callsField.test(fs.readFileSync(path.join(publicDir, 'app', file), 'utf8'))).map((file) => 'app/' + file);
  const fieldAt = loaded.indexOf('app/ui-field.js');
  const lazy = users.filter((file) => /^app\/cap-/.test(file));
  const failures = [];
  loaded.forEach((file, at) => {
    if (users.indexOf(file) >= 0 && (fieldAt < 0 || fieldAt > at)) failures.push(page + ' loads ' + file + ' (calls ui.field) but not app/ui-field.js before it');
  });
  if (loadsOnDemand && lazy.length && fieldAt < 0) failures.push(page + ' loads caps on demand (ensureCap) and ' + lazy.join(', ') + ' call ui.field, but it does not load app/ui-field.js');
  if (fieldAt >= 0 && loaded.indexOf('app/ui.js') > fieldAt) failures.push(page + ' loads app/ui-field.js before app/ui.js');
  return failures;
}

let failed = 0;
const ok = (what, condition) => { console.log((condition ? '  ok   ' : '  FAIL ') + what); if (!condition) failed++; };
const pages = fs.readdirSync(publicDir).filter((file) => /\.html$/.test(file));
const real = [];
pages.forEach((page) => failuresOf(page, fs.readFileSync(path.join(publicDir, page), 'utf8')).forEach((line) => real.push(line)));
real.forEach((line) => console.log('       ' + line));
ok('files calling ui.action: ' + usersOfUi.join(', '), usersOfUi.length > 0);
ok('every page that runs them loads app/ui.js first (' + pages.length + ' pages read)', real.length === 0);
const appHtml = fs.readFileSync(path.join(publicDir, 'app.html'), 'utf8');
const withoutTag = appHtml.replace(/<script src="\/app\/ui\.js"><\/script>/, '');
ok('self-test: app.html without its ui.js tag FAILS the guard', withoutTag !== appHtml && failuresOf('app.html', withoutTag).length > 0);
const withoutField = appHtml.replace(/<script src="\/app\/ui-field\.js"><\/script>/, '');
ok('self-test: app.html without its ui-field.js tag FAILS the guard', withoutField !== appHtml && failuresOf('app.html', withoutField).length > 0);
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
