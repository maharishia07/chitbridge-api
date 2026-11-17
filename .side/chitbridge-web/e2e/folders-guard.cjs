/* folders-guard.cjs (MNT-59, pin leg i) — static, no browser: the Folders capability keeps loading however its file is cut up.
 * OWNS      the five facts a split of public/app/cap-folders.js must keep true: every one of its 48 names lives in exactly one file of the
 *           cap-folders*.js family · accounts/crm/finance load each family file once · app.html's CAP_WITH.folders names every part ·
 *           cb-sw.js PRECACHE lists every file · CB_BUILD and CB_SW_VERSION move once the family has more than one file.
 * CALLED BY .github/workflows/ci.yml (offline guards) · the move-only PR of the split (plan docs/maintainability/SPLIT-PLAN-folders.md, in the docs repo).
 * FLOW      read the family + pages + app.html + cb-sw.js ──▶ check() ──▶ failures · the self-tests run check() on a broken copy of each leg and demand red.
 * The 48 names are not typed here: e2e/fixtures/folders-names.json was generated from the base blob (79efe87f) of cap-folders.js.
 * Green on the one-file base; the same run is the proof of the split. */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'public');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'folders-names.json'), 'utf8'));
const PAGES = ['accounts.html', 'crm.html', 'finance.html'];
const familyFiles = () => fs.readdirSync(path.join(root, 'app')).filter((file) => /^cap-folders(-[a-z]+)?\.js$/.test(file)).sort();
const urlOf = (file) => '/app/' + file;
const topNames = (text) => [...text.matchAll(/^(?:(?:async )?function (\w+)|(?:var|const|let) (\w+))/gm)].map((hit) => hit[1] || hit[2]);
const countOf = (text, needle) => text.split(needle).length - 1;

/** every failure of the five facts, given the texts: { family: {file: text}, pages: {page: text}, app, sw } */
function check(world) {
  const fails = [], files = Object.keys(world.family);
  for (const name of snapshot.names) {
    const homes = files.filter((file) => topNames(world.family[file]).includes(name));
    if (homes.length !== 1) fails.push('name ' + name + ' must live in exactly one cap-folders file, found in ' + (homes.join(', ') || 'none'));
  }
  for (const [page, text] of Object.entries(world.pages)) {
    for (const file of files) {
      const tags = countOf(text, '<script src="' + urlOf(file) + '"></script>');
      if (tags !== 1) fails.push(page + ' must carry the tag for ' + file + ' exactly once, has ' + tags);
    }
  }
  const row = (world.app.match(/const CAP_WITH = \{([^}]*)\}/) || [])[1] || '';
  const folders = (row.match(/\bfolders:\s*\[([^\]]*)\]/) || [])[1] || '';
  const parts = files.filter((file) => file !== 'cap-folders.js');
  for (const file of parts) if (!folders.includes("'" + file.replace(/^cap-|\.js$/g, '') + "'")) fails.push('CAP_WITH.folders must name ' + file.replace(/^cap-|\.js$/g, ''));
  const precache = (world.sw.match(/const PRECACHE = \[([^\]]*)\]/) || [])[1] || '';
  for (const file of files) if (!precache.includes("'" + urlOf(file) + "'")) fails.push('cb-sw.js PRECACHE must list ' + urlOf(file));
  const build = (world.app.match(/const CB_BUILD =\s*'([^']+)'/) || [])[1], version = (world.sw.match(/CB_SW_VERSION = '([^']+)'/) || [])[1];
  if (!/^\d{4}-\d\d-\d\d[a-z]?$/.test(build || '')) fails.push('CB_BUILD not found in app.html');
  if (!/^v\d+$/.test(version || '')) fails.push('CB_SW_VERSION not found in cb-sw.js');
  if (parts.length && build === snapshot.cbBuild) fails.push('the file was split but CB_BUILD is still ' + build + ': a browser would pair a cached base with the new parts');
  if (parts.length && version === snapshot.swVersion) fails.push('the file was split but CB_SW_VERSION is still ' + version + ': the offline cache keeps the old shell');
  return fails;
}

const live = () => ({
  family: Object.fromEntries(familyFiles().map((file) => [file, read('app/' + file)])),
  pages: Object.fromEntries(PAGES.map((page) => [page, read(page)])),
  app: read('app.html'), sw: read('cb-sw.js'),
});
const copy = (world) => JSON.parse(JSON.stringify(world));
const swap = (text, from, to) => { if (!text.includes(from)) throw new Error('self-test anchor missing: ' + from); return text.replace(from, to); };

/** each leg shown red on a broken copy of the real files; the split state is simulated by a part that moves two real units out of the base */
function selfTests(world) {
  const tests = [];
  const red = (why, mutate, pattern) => tests.push({ why, mutate, pattern });
  const split = (made) => {
    const base = world.family['cap-folders.js'].replace(/^(?:async )?function ruleDraftCancel[^]*?^\}\n/m, '');
    made.family['cap-folders.js'] = base;
    made.family['cap-folders-rules.js'] = world.family['cap-folders.js'].match(/^function ruleDraftCancel[^]*?^\}\n/m)[0];
    PAGES.forEach((page) => { made.pages[page] = swap(made.pages[page], '<script src="/app/cap-folders.js"></script>', '<script src="/app/cap-folders.js"></script>\n<script src="/app/cap-folders-rules.js"></script>'); });
    made.app = swap(made.app, 'const CAP_WITH = {', "const CAP_WITH = {\n  folders: ['folders-rules'],").replace(/(const CB_BUILD =\s*')[^']+/, '$12099-01-01a');
    made.sw = swap(made.sw, "'/app/cap-folders.js',", "'/app/cap-folders.js',\n  '/app/cap-folders-rules.js',").replace(/CB_SW_VERSION = '[^']+'/, "CB_SW_VERSION = 'v9'");
    return made;
  };
  red('one tag removed from a page', (made) => { made.pages['crm.html'] = swap(made.pages['crm.html'], '<script src="/app/cap-folders.js"></script>', ''); }, /crm\.html must carry the tag/);
  red('a name defined in two files', (made) => { made.family['cap-folders-x.js'] = 'function loadFolders() {}\n'; }, /name loadFolders .*exactly one/);
  red('PRECACHE URL dropped', (made) => { made.sw = swap(made.sw, "'/app/cap-folders.js',", ''); }, /PRECACHE must list/);
  tests.push({ why: 'the simulated split is green', mutate: (made) => { Object.assign(made, split(made)); }, pattern: null });
  red('CAP_WITH.folders dropped on a split', (made) => { split(made); made.app = swap(made.app, "folders: ['folders-rules'],", ''); }, /CAP_WITH\.folders must name folders-rules/);
  red('a part tag removed on a split page', (made) => { split(made); made.pages['finance.html'] = swap(made.pages['finance.html'], '<script src="/app/cap-folders-rules.js"></script>', ''); }, /finance\.html must carry the tag for cap-folders-rules/);
  red('CB_BUILD not bumped on a split', (made) => { split(made); made.app = made.app.replace(/(const CB_BUILD =\s*')[^']+/, '$1' + snapshot.cbBuild); }, /CB_BUILD is still/);
  red('CB_SW_VERSION not bumped on a split', (made) => { split(made); made.sw = made.sw.replace(/CB_SW_VERSION = '[^']+'/, "CB_SW_VERSION = '" + snapshot.swVersion + "'"); }, /CB_SW_VERSION is still/);
  return tests.map((test) => {
    const made = copy(world);
    test.mutate(made);
    const fails = check(made);
    return { why: test.why, ok: test.pattern ? fails.some((line) => test.pattern.test(line)) : fails.length === 0, fails };
  });
}

const world = live(), fails = check(world);
console.log('  cap-folders family: ' + Object.keys(world.family).join(', ') + ' · ' + snapshot.names.length + ' names · ' + PAGES.length + ' pages');
fails.forEach((line) => console.log('FAIL ' + line));
const bad = (fails.length ? [] : selfTests(world)).filter((test) => !test.ok);
bad.forEach((test) => console.log('FAIL self-test: ' + test.why + (test.fails.length ? ' -> ' + test.fails.join(' | ') : ' -> not red')));
const total = fails.length + bad.length;
console.log(total ? '\nfolders-guard: ' + total + ' FAILED' : '\nfolders-guard: all passed (names in one file each, tags, CAP_WITH, PRECACHE, stamps; 8 self-tests red or green as expected)');
process.exit(total ? 1 : 0);
