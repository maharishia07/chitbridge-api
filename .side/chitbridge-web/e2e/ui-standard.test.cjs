'use strict';
// @type: unit
/**
 * ui-standard.test.cjs — the UI standard page (public/ui-standard.html, screen UIS001), offline: no browser.
 * Cases: the page is public and mock-only (no api, session, shell, storage or fetch in the page or its script; a CSP that refuses every
 * connection); every component of the action set (CMP001..CMP019, CMP020..CMP027) has a row; the nine action labels are in all four packs; the page's own
 * labels are in all four packs; the census rows name real components. The browser half (render, language switch, scroll) is e2e/walk-ui-standard.cjs.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * Run: node e2e/ui-standard.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^[ \t]*\/\/.*$/gm, '');

console.log('public and mock-only');
const html = read('ui-standard.html'), page = strip(read('app/ui-standard.js')), pageHtml = strip(html);
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
check(scripts.every((src) => src.charAt(0) === '/' && !/^https?:/.test(src)), 'only same-origin scripts: ' + scripts.length);
/* the standard frame (CBFrame.lab, public, signin false) is loaded; nothing that holds an api address, a session or a sign-in is */
['/app/shell.js', '/app/page-frame.js', '/app/lab-kit.js', '/app/screen-id.js'].forEach((src) => check(scripts.indexOf(src) >= 0, 'wears the standard frame: loads ' + src));
['core.js', 'one-person.js', 'rail-bell.js', 'signin-ui.js', 'kural.js'].forEach((name) => check(scripts.indexOf('/app/' + name) < 0 && scripts.indexOf('/' + name) < 0, 'does not load ' + name));
check(/CBFrame\.lab\(\{\s*app:\s*'ui-standard'/.test(html) && /CBFrame\.lab\([\s\S]*?avatar:/.test(html), 'mounts CBFrame.lab (the Country lab way) with its own avatar options');
/* device-id.js loads first, as on every page with a session reader (e2e/device-id.cjs, 8 Nov); no script on this page calls CBDevice, so no id is made and nothing is stored */
check(scripts.indexOf('/app/device-id.js') >= 0 && scripts.indexOf('/app/device-id.js') < scripts.indexOf('/app/helpers.js'), 'loads device-id.js before any other script');
/* every script the page loads (the frame's too), bar device-id.js itself: none asks for the id, so none is made. device-id.js still wraps fetch on load; nothing is sent because the page sends nothing */
scripts.filter((src) => src !== '/app/device-id.js').forEach((src) => check(!/CBDevice/.test(fs.readFileSync(path.join(__dirname, '..', 'public', src), 'utf8')), src + ' never asks for the device id, so none is made here'));
/* the narrowest CSP the frame needs: its only request is the shell's own /app/manifest.json, so connect-src 'self' (no api, no third party); the one inline script is named by its hash */
const csp = (/Content-Security-Policy" content="([^"]*)"/.exec(html) || [])[1] || '';
check(/connect-src 'self';/.test(csp) && /default-src 'none'/.test(csp) && !/unsafe-eval|script-src[^;]*unsafe-inline|connect-src[^;]*https?:/.test(csp), "a CSP of its own: default-src 'none', connect-src 'self' only, no unsafe-eval or inline-script allowance");
{
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const hashes = [...html.matchAll(/'sha256-([^']+)'/g)].map((match) => match[1]);
  const digest = (text) => require('crypto').createHash('sha256').update(text, 'utf8').digest('base64');
  check(inline.length === 1 && hashes.length === 1 && digest(inline[0]) === hashes[0], 'the one inline script (the frame call) is named in the CSP by its sha256 (recompute it when the script changes)');
}
check((pageHtml.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || []).length === 1, 'exactly one inline script: the frame call');
check(/<html[^>]*data-appearance-fixed/.test(html) && scripts.indexOf('/app/avatar.js') > 0 && scripts.indexOf('/engine/screen.js') > 0 && scripts.indexOf('/engine/screen.js') < scripts.indexOf('/app/avatar.js'), 'the avatar look is applied through avatar.js on a fixed-look page (no storage), after the theme library');
const fetches = page.match(/\bfetch\(([^)]*)\)/g) || [];
check(fetches.length === 1 && fetches[0] === "fetch('/app/ui-waves.json')", 'the one read is the static waves data file of this site: ' + fetches.join(' '));
check(!/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|cb_sess|cb_lang|document\.cookie|api\()/.test(page.replace(/the page's own[^\n]*/g, '').replace(/window\.fetch\('\/app\/ui-waves\.json'\)/g, '')), 'the page script never fetches, stores or reads a session');
check(!/https?:\/\/(?!fonts\.(googleapis|gstatic)\.com)/.test(pageHtml.replace(/http-equiv[^>]*>/, '')), 'no external address in the page');

console.log('every component has a row');
const ctx = { console, window: {}, document: { addEventListener() {} }, esc: (s) => String(s), tx: (s) => s, txf: (s) => s, fmtMoney: String, toast() {}, CBAction: { run() {} }, CBStr: 0 };
ctx.CBSTR = { en: {}, ta: {}, hi: {}, ar: {}, fr: {} };
ctx.window = ctx;
vm.createContext(ctx);
['app/ui.js', 'app/strings-ta.js', 'app/strings-hi.js', 'app/strings-ar.js', 'app/strings-fr.js', 'app/strings-ui-standard.js', 'app/ui-standard.js'].forEach((file) => vm.runInContext(read(file), ctx, { filename: file }));
const model = vm.runInContext('CBUiStandard', ctx), components = ctx.ui.components;
const used = new Set(model.ROWS.concat(model.SHELL_ROWS).map((row) => row.name).concat('dialog', 'progress', 'progressbar', 'spinner', 'choice', 'batch', 'batchtray', 'listfield', 'listopener', 'listtoggle', 'listselect', 'listtab', 'listcommand', 'listrowaction', 'listcolumn', 'batchnote', 'bookfield', 'bookselect', 'bookaction', 'booktab', 'booklink', 'field', 'select', 'figure', 'badge', 'statusicon', 'bankband')); /* CMP060, CMP061, CMP064, CMP065 (figure card, initials badge, status icon, bank band) are drawn by lab-kit.js and bank-band.js, not by ui.action: the page's own-code rows (ui-standard.js) show them (LIST_ROWS); this list names them so a NEW component with no row still fails */ /* CMP045..CMP039 are drawn by the list row (listRows), the list control writes the elements itself */ /* CMP020..CMP027 are drawn by their own rows, not by ui.action */
check(Object.keys(components).every((name) => used.has(name)), 'rows cover all ' + Object.keys(components).length + ' components (CMP001..CMP010)');
check(model.CENSUS.every((entry) => components[entry.name]), 'every census entry names a real component');

console.log('batch progress showcase (CMP026, CMP027)');
check(/gal-progress-batch-panel/.test(page) && /gal-progress-batch-tray/.test(page) && /gal-row-CMP026/.test(page), 'a separate row with two buttons: Try 8 items (panel) and Try 40 items (tray)');
check(/gal-row-CMP032/.test(page) && /gal-note-/.test(page), 'CMP032 has its own row: every state of a saved job in words (gal-note-<state>)');
['Try 8 items', 'Try 40 items', 'Tray class: 3 items, always the tray', 'Assigning chits', 'assigned', 'Chit {n}', 'No reply from the demo'].forEach((key) => check(model.translatedIn(key).length === 4, 'batch demo text "' + key + '" is in all four packs'));
['Batch progress', 'Batch tray'].forEach((key) => check(model.translatedIn(key).length === 4, 'component label "' + key + '" is in all four packs'));

console.log('language');
const actions = Object.keys(components).filter((name) => name !== 'dialog');
actions.forEach((name) => check(model.translatedIn(components[name].label).length === 4, name + ': label "' + components[name].label + '" is in all four packs'));
const gaps = actions.filter((name) => model.coverageOf(components[name]).missing.length).map((name) => components[name].code + ' ' + components[name].shown);
console.log('  note  not keyed or not translated today (visible text): ' + (gaps.join(', ') || 'none'));
const chrome = ['UI standard', 'Components', 'Popups', 'Icons', 'Tokens', 'Before and after', 'Light', 'Dark', 'Language', 'Screen', 'Desktop', 'Mobile', 'Size', '24 px target', 'Default', 'Hover', 'Focus', 'Pressed', 'Disabled', 'Busy', 'Example dialog', 'Post this bill?', 'Post bill', 'Post this bill for {amount} to {count} recipients?', 'Remove this supplier?'];
chrome.forEach((key) => check(model.translatedIn(key).length === 4, 'page label "' + key + '" is in ta hi ar fr'));
check(model.translatedIn('A label no pack has').length === 0 && model.coverageOf({ label: 'A label no pack has', code: 'CMP000' }).missing.length > 0, 'a label no pack could read is not shown as translated: the page fell back to the English text and the coverage note says so in words');
check(model.LANGS.map((lang) => lang[0]).join() === 'en,ta,hi,ar,fr' && model.LANGS.filter((lang) => lang[2] === 'rtl').length === 1, 'five languages, one right-to-left (ar)');
check(model.contrastRatio('rgb(0,0,0)', 'rgb(255,255,255)') > 20.9 && model.contrastRatio('rgb(22,105,63)', 'rgb(255,255,255)') >= 4.5, 'the contrast helper: black on white 21:1, the accent on white AA');
console.log('waves: one row per wave, from public/app/ui-waves.json');
{
  const data = JSON.parse(read('app/ui-waves.json'));
  const drawn = model.wavesHTML(data);
  const rows = [...drawn.matchAll(/data-testid="gal-wave-([0-9][0-9a-z]*)"/g)].map((match) => match[1]);
  check(rows.join() === data.waves.map((wave) => wave.id).join() && rows.join() === '0,1a,1b,2,3', 'one row per wave, in the order of the file: ' + rows.join(' '));
  check((drawn.match(/role="progressbar"/g) || []).length === data.waves.length, 'each wave row carries a progress bar (CMP021)');
  check(data.waves.every((wave) => ['done', 'in progress', 'landed, measuring', 'next'].indexOf(wave.status) >= 0), 'every status is done, in progress, landed measuring or next');
  check(data.waves.every((wave) => wave.progress.value === null || (wave.progress.value >= 0 && wave.progress.value <= wave.progress.total)), 'no progress value is above its total');
  // 11 Nov (web #551): a number on this page is a measure with its source, never a hope
  check(data.waves.every((wave) => wave.pairs.every((pair) => pair.after === null || pair.of == null || (pair.after >= 0 && pair.after <= pair.of))), 'no after value is above its of');
  check(data.waves.filter((wave) => wave.status === 'done').every((wave) => wave.progress.value !== null), 'a wave marked done has a measured progress number');
  check(/\b20\d\d\b/.test(data.measured || '') && /\b[0-9a-f]{7,40}\b/.test(data.measured || ''), 'the measured line names a date and the commit it was measured on');
  const unmeasured = data.waves.reduce((sum, wave) => sum + wave.pairs.filter((pair) => pair.after === null).length + (wave.progress.value === null ? 1 : 0), 0);
  check(unmeasured > 0 && (drawn.match(/>measuring</g) || []).length === unmeasured, 'each number not measured yet (null) says measuring, and nothing else does: ' + unmeasured);
  const wave0 = data.waves[0].progress;
  check(drawn.indexOf('aria-valuemax="' + wave0.total + '" aria-valuenow="' + wave0.value + '"') > 0, 'Wave 0 draws ' + wave0.value + ' of ' + wave0.total + ' from the file, not from the page');
  check(model.wavesHTML(null).indexOf('gal-waves-wait') > 0 && model.wavesHTML(null).indexOf('gal-wave-0') < 0, 'before the file arrives the section says measuring and draws no rows');
  check(model.sections().some((section) => section.k === 'waves'), 'Waves is a section of the page');
  const keys = ['Waves', 'Wave {id}', 'In progress', 'Landed, measuring', 'Next', 'measuring', 'Measured {date}', 'of {total}'];
  data.waves.forEach((wave) => { keys.push(wave.title, wave.progress.label); wave.pairs.forEach((pair) => keys.push(pair.label)); });
  keys.forEach((key) => check(model.translatedIn(key).length === 4, 'waves label "' + key + '" is in ta hi ar fr'));
}
console.log('Meets the standard: the six keyboard and focus rules (live probes, never a written result)');
{
  const rows = model.KEY_ROWS;
  check(rows.length === 6 && rows.every((row) => row.sources.length >= 1 && row.sources.every((link) => /^https:[/][/]/.test(link[1]))), 'six rules, each with its source links');
  const drawn = rows.map((row) => model.meetsRowHTML(row, []));
  check(drawn.every((html) => html.indexOf('gal-meets-row') > 0), 'each rule draws through the one meetsRowHTML');
  check(drawn.filter((html) => /data-live="/.test(html)).length === 5 && drawn.filter((html) => /gal-meetlive-walk/.test(html)).length === 1, 'five rules wait for a measure; the opacity rule says the walk checks it');
  check(!/data-live="[^"]*"[^>]*class="pass"|PASS/.test(drawn.join('')), 'no row is drawn with a result: the result comes from paintLive after the page is read');
  const fail = { focusIn: false, tabStays: false, escCloses: true, focusBack: false }, good = { focusIn: true, tabStays: true, escCloses: true, focusBack: true };
  check(!model.judge.focusIn(fail).ok && model.judge.focusIn(good).ok && /^FAIL/.test(model.judge.focusIn(fail).text) && /^PASS/.test(model.judge.focusIn(good).text), 'focus into the popup: the verdict follows what was read');
  check(!model.judge.trap(fail).ok && !model.judge.trap({ focusIn: true, tabStays: true, escCloses: true, focusBack: false }).ok && model.judge.trap(good).ok && /Esc closes yes/.test(model.judge.trap(fail).text) && /Tab stays no/.test(model.judge.trap(fail).text), 'Tab, Esc and focus back: one miss fails the row and the chip names which');
  check(model.judge.keys({ total: 45, out: 0 }).ok && !model.judge.keys({ total: 45, out: 2 }).ok && /2 of 45/.test(model.judge.keys({ total: 45, out: 2 }).text), 'every control by keyboard: counts the controls Tab cannot reach');
  check(model.judge.names({ total: 9, unnamed: 0, titleOnly: 0 }).ok && !model.judge.names({ total: 9, unnamed: 3, titleOnly: 2 }).ok && /2 only a title/.test(model.judge.names({ total: 9, unnamed: 3, titleOnly: 2 }).text), 'every control named: a title alone is counted as no name');
  check(model.judge.scroll({ total: 0, cannotReach: 0, unnamed: 0 }).ok && !model.judge.scroll({ total: 2, cannotReach: 0, unnamed: 1 }).ok && !model.judge.scroll({ total: 2, cannotReach: 1, unnamed: 0 }).ok, 'scrolling areas: unreachable or unnamed fails');
  check(/function paintLive[^]*?judgeFocusIn[(]dialog[)]/.test(page) && /paintOverlay[(][)];[^p]*paintLive[(][)];/.test(page), 'paint() calls paintLive after the page is drawn');
}
console.log('the Standards page links here');
const register = read('app/cap-standards.js'), standardsPage = read('standards.html');
check(register.indexOf("['web', 'Web design']") >= 0, "the register has the Web design subject (STD_AREAS 'web')");
const linked = register.split(/\n  \{\n/).map((block) => [/id: '([^']+)'/.exec(block), /go: '([^']*)'/.exec(block)]).filter((pair) => pair[0] && pair[1] && pair[1][1] === 'ui-standard').map((pair) => pair[0][1]);
check(linked.length >= 5 && ['wcag-1.4.3', 'wcag-1.4.11', 'wcag-2.4.7', 'ui-action-set'].every((id) => linked.indexOf(id) >= 0), 'rows that open this page (go: ui-standard): ' + linked.join(' '));
check(standardsPage.indexOf("'ui-standard': '/ui-standard.html'") >= 0, "standards.html maps the go key 'ui-standard' to /ui-standard.html");
console.log('where-used: every mount argument is a literal, or the call declares itself out of scope (docs ui-where-used.cjs reads the same rule)');
/* the components-tab dialogRow is the 61st counter mount (19 rows x 6 states first); written as a literal it must stay UIS001-U115 */
const rowsBlock = /var ROWS = \[([\s\S]*?)\n  \];/.exec(page), rowCount = rowsBlock ? (rowsBlock[1].match(/\{ name: /g) || []).length : -1;
check(/ui\.action\('open', \{ mount: SCREEN \+ '-U115', object: 'dialog'/.test(page), "dialogRow mount is the literal SCREEN + '-U115' (the code the counter gave it)");
check(/var SCREEN = 'UIS001'/.test(page) && rowCount === 19, 'SCREEN is UIS001 and 19 rows x 6 states precede dialogRow, so U115 is unchanged (rows ' + rowCount + ')');
const appDir = path.join(__dirname, '..', 'public', 'app'), literalMount = /^(?:'[^'\\]*'|"[^"\\]*"|SCREEN\s*\+\s*'[^'\\]*')$/;
let callCount = 0;
const blank = (source) => source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length)); /* comments blanked, line numbers kept */
fs.readdirSync(appDir).filter((name) => /\.js$/.test(name)).forEach((name) => {
  const raw = fs.readFileSync(path.join(appDir, name), 'utf8').split('\r\n').join('\n'), lines = raw.split('\n'), text = blank(raw);
  for (const call of text.matchAll(/(?<![\w.'"])ui\.(action|dialog)\((?!\))/g)) {
    const start = call.index + call[0].length, line = text.slice(0, call.index).split('\n').length;
    let depth = 1, end = start;
    while (end < text.length && depth > 0) { if (text[end] === '(') depth++; else if (text[end] === ')') depth--; end++; }
    const mounts = [...text.slice(start, end).matchAll(/\bmount:\s*([^,}\n]+?)\s*(?=[,}\n])/g)].map((m) => m[1]);
    const declared = /where-used:\s*out-of-scope/.test((lines[line - 1] || '') + '\n' + (lines[line - 2] || ''));
    callCount++;
    check(declared || (mounts.length > 0 && mounts.every((m) => literalMount.test(m))), name + ':' + line + ' ui.' + call[1] + ' mount is a literal or SCREEN + literal, or says where-used: out-of-scope');
  }
});
check(callCount >= 15, 'the scan saw the call sites (' + callCount + ')');
console.log(failures ? failures + ' FAILED' : 'all ok');
process.exit(failures ? 1 : 0);
