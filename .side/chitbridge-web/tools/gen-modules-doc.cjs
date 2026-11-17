/**
 * tools/gen-modules-doc.cjs — writes public/app/MODULES.md from the files that are actually there: public/app/*.js, the other
 * public/ scripts (public/*.js, public/lab/*.js) and every page (public/*.html, public/cmdb, public/docs).
 *
 * ⚠️⚠️ THE DOCUMENT THIS REPLACES SAT NEXT TO THE CODE SAYING "in progress" FOR WEEKS, describing a
 * `panel-*.js` split that was never built. The first thing anyone reads beside the source was an architecture
 * that does not exist. Retired as RETIRED-2026-08-21-MODULES-panel-split.md.
 *
 * ⭐ SO THIS ONE IS GENERATED. A hand-written map of a directory is a promise to update it every time the
 * directory changes, and that promise is the thing that keeps breaking. Re-run this and the map is true again;
 * `e2e/docs-guard.cjs` fails the build if it has drifted.
 *
 *   node tools/gen-modules-doc.cjs           writes the file
 *   node tools/gen-modules-doc.cjs --check   exits 1 if the file on disk differs
 */
/*
 * OWNS      the writer of public/app/MODULES.md from the files that are actually there: app modules, the other public/ scripts, the pages
 *           (adopted engine copies under public/engine/, vendor/ and generated files are left out: they are edited elsewhere)
 * CALLED BY e2e/docs-guard.cjs:19 (--check); tools/pr-ready.cjs:134
 * FLOW      read each module -> one row per module (header OWNS, else first comment line or title) -> MODULES.md (--check exits 1 on drift)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/seams-index
 */
const fs = require('fs');
const path = require('path');
const grammar = require('./readability/header-grammar.cjs');

const W = path.join(__dirname, '..', 'public');
const OUT = path.join(W, 'app', 'MODULES.md');

const files = fs
  .readdirSync(path.join(W, 'app'))
  .filter((item) => item.endsWith('.js'))
  .sort();
const shell = fs.readFileSync(path.join(W, 'app.html'), 'utf8');

/* which capabilities the shell lazy-loads, and under which nav key */
const capOf = {};
const m = shell.match(/CAP_OF\s*=\s*\{([^}]*)\}/);
if (m)
  for (const pair of m[1].split(',')) {
    const kv = pair.split(':').map((item) => item.trim().replace(/['"]/g, ''));
    if (kv.length === 2 && kv[0] && kv[1]) (capOf[kv[1]] = capOf[kv[1]] || []).push(kv[0]);
  }

/* a module's first line of comment is its own description — the file says what it is, not this script */
const firstLine = (f) => {
  const text = fs
    .readFileSync(path.join(W, 'app', f), 'utf8')
    .split('\n')
    .slice(0, 6)
    .join(' ');
  const c = text.match(/\/\*+\s*(?:app\/[a-z0-9-]+\.js\s*[—-]\s*)?([^*\n]{10,150})/i);
  return c ? c[1].trim().replace(/\s+/g, ' ').replace(/\.$/, '') : '';
};

/* eagerly loaded = named in a <script src> in the shell */
const eager = new Set([...shell.matchAll(/<script[^>]+src="\/app\/([a-z0-9-]+\.js)"/g)].map((x) => x[1]));

/**
 * ⚠️ SOME CAPABILITIES ARE LAZY WITHOUT BEING IN CAP_OF — cap-chit2 and cap-iddocs are fetched by an explicit
 * ensureCap('…') from a click handler rather than by the router. Reading only the table reported them as
 * neither eager nor lazy, which is the one answer that is certainly wrong.
 */
const called = new Set();
for (const f of ['app.html', ...files.map((x) => 'app/' + x)]) {
  const src = fs.readFileSync(path.join(W, f), 'utf8');
  for (const c of src.matchAll(/ensureCap\(\s*['"]([a-z0-9-]+)['"]/g)) called.add(c[1]);
}

const caps = files.filter((item) => item.startsWith('cap-'));
const rest = files.filter((item) => !item.startsWith('cap-'));

const rows = (list) =>
  list
    .map((item) => {
      const key = item.replace(/^cap-|\.js$/g, '');
      const navs = capOf[key];
      /* ⚠️ EAGER IS CHECKED FIRST, and that ordering is what caught cap-catalogue: it is named `cap-` and its own
     header claimed "lazy-loaded", while the shell has a <script src> for it. Trust the shell over the name. */
      const how = eager.has(item) ? 'eager' : navs ? 'lazy · ' + navs.join(', ') : called.has(key) ? 'lazy · on demand' : '—';
      return '| `' + item + '` | ' + how + ' | ' + firstLine(item) + ' |';
    })
    .join('\n');

/* the other public/ scripts and the pages: the file's own OWNS line says what it is (header-grammar.cjs is the one reader), else its title or first comment */
const HEAD_LINES = 90;
const listFiles = (dir, ext) =>
  fs.existsSync(path.join(W, dir))
    ? fs
        .readdirSync(path.join(W, dir))
        .filter((item) => item.endsWith(ext))
        .map((item) => (dir ? dir + '/' : '') + item)
        .sort()
    : [];
/* a GENERATED file (api vendor-till writes till-sw.js) is edited at its master, so it is not a module of this repo */
const isGenerated = (rel) => /GENERATED/.test(fs.readFileSync(path.join(W, rel), 'utf8').split('\n').slice(0, 4).join(' '));
const otherScripts = [...listFiles('', '.js'), ...listFiles('lab', '.js')].filter((rel) => !isGenerated(rel));
const pages = [...listFiles('', '.html'), ...listFiles('cmdb', '.html'), ...listFiles('docs', '.html')];
const readText = (rel) => fs.readFileSync(path.join(W, rel), 'utf8');
const readHead = (rel) => readText(rel).split(grammar.LINE_BREAK).slice(0, HEAD_LINES).join('\n');
const cell = (s) => s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, 170);
const ownsOf = (rel) => cell(grammar.parseFields(readHead(rel), rel).fields.OWNS || '');
const titleOf = (rel) => {
  const found = readText(rel).match(/<title>([^<]*)<\/title>/i);
  return found ? cell(found[1].replace(/&amp;/g, '&')) : '';
};
const commentOf = (rel) => {
  const found = readHead(rel).match(/^\s*(?:\/\/|\/\*+)\s*(?:public\/[a-z/.-]+\s*[—-]\s*)?([^\n]{10,170})/);
  return found ? cell(found[1]) : '';
};
/* the pages that name a script in a <script src>, by the script's path under public/ */
const loadedBy = (rel) => {
  const tag = new RegExp('(?:<script[^>]+src=|register\\()\\s*["\']/?' + rel.replace(/\./g, '\\.') + '["\']');
  const hit = pages.filter((page) => tag.test(readText(page)));
  return hit.length ? hit.join(', ') : '—';
};
const otherRows = otherScripts.map((rel) => '| `' + rel + '` | ' + loadedBy(rel) + ' | ' + (ownsOf(rel) || commentOf(rel)) + ' |').join('\n');
const appScriptCount = (rel) => (readText(rel).match(/<script[^>]+src="\/app\/[a-z0-9-]+\.js"/g) || []).length;
const pageRows = pages.map((rel) => '| `' + rel + '` | ' + appScriptCount(rel) + ' | ' + (ownsOf(rel) || titleOf(rel)) + ' |').join('\n');

const doc = `# public/ — the module map

<!-- GENERATED by tools/gen-modules-doc.cjs. Do not hand-edit: run the script.
     e2e/docs-guard.cjs fails the build when this file no longer matches the directory. -->

\`app.html\` is the shell. It holds the router, the session, the theme and the shared
helpers, and it loads everything below. There is no framework and no build step —
classic scripts sharing one global scope, so inline \`onclick="…"\` keeps working.

**Lazy** modules are fetched by \`ensureCap(name)\` the first time their nav key is
opened, and never again. **Eager** ones are in a \`<script src>\` in the shell because
something needs them before any navigation happens.

⚠️ A capability that is lazy must not be called from the shell at load time — the
router renders a placeholder until \`_capLoading\` clears, which is the only reason the
old duplicate \`networkScreen()\` in app.html was safe to delete.

## Capabilities (${caps.length})

| file | loading · nav key | what it is |
|---|---|---|
${rows(caps)}

## Shared (${rest.length})

| file | loading | what it is |
|---|---|---|
${rows(rest)}

## Other scripts under public/ (${otherScripts.length})

Scripts beside the pages, not in app/. Adopted engine copies in \`public/engine/\` are not listed: they are edited only in the engines repo.

| file | loaded by | what it is |
|---|---|---|
${otherRows}

## Pages (${pages.length})

Each page is a module of its own (its inline script and header). The count is the \`/app/*.js\` files it loads with a \`<script src>\`.

| page | app/ scripts | what it is |
|---|---|---|
${pageRows}

---

*${files.length} app modules, ${otherScripts.length} other scripts, ${pages.length} pages. Regenerate with \`node tools/gen-modules-doc.cjs\`.*
`;

if (process.argv.indexOf('--check') >= 0) {
  const on = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (on.replace(/\r\n/g, '\n') === doc) {
    console.log('  MODULES.md matches the directory');
    process.exit(0);
  }
  console.error('  ✗ MODULES.md has drifted from public/ — run: node tools/gen-modules-doc.cjs');
  process.exit(1);
}
fs.writeFileSync(OUT, doc);
console.log('  MODULES.md written — ' + caps.length + ' capabilities, ' + rest.length + ' shared');
