'use strict';
/* tools/graph/entries.cjs — the ways a module is USED that a call edge cannot see: it is an ENTRY POINT somebody runs, or a file NAMES it by path.
 *
 * OWNER     cb-maintainability
 * OWNS      importedByOf(root, files) (ES `from './x'` and a dir loaded by `require('./dir/' + name)`) · entryKindsOf(root, files) → { file: 'cli' | 'ci' }
 *           (a script run by package.json "scripts", a ci.yml `node X` line, or a CLI by shape: shebang, require.main, process.argv, a `node <itself>`
 *           usage line, or a scripts/ tools/ file that exports nothing) · namedByOf(root, files) → { file: [referrer…] } (a web page or script that
 *           writes the file's path as a string: <script src>, '/till-sw.js', '/app/units.js').
 * CALLED BY tools/graph/trace.cjs traceOf (calledBy gets the namers; `entry` gets the kind); C:/dev/toolset/coverage/chain.cjs R6 counts both as "used".
 * FLOW      root files ──▶ package.json + .github/workflows/*.yml ──▶ node-run paths ──▶ entry kind per file; sources ──▶ import / path strings ──▶ referrers
 * CARD      qa/readability-guard
 */
const fs = require('fs');
const path = require('path');

const NODE_RUN = /\bnode\s+(?:--?[\w=.-]+\s+)*['"]?(\.?\/?[\w./-]+\.(?:c?js|mjs))\b/g;
const CLI_SHAPE = /^#!|require\.main\s*===\s*module|process\.argv/m;
const EXPORTS = /\bmodule\.exports\b|\bexports\.\w|^export\s/m;
const IMPORT_SPEC = /(?:\bfrom\s+|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
const DIR_REQUIRE = /\brequire\s*\(\s*['"](\.{1,2}\/[\w./-]*\/)['"]\s*\+/g;
const PATH_STRING = /['"`(=]\s*(\.{0,2}\/?(?:[\w.-]+\/)*[\w.-]+\.(?:js|html))\b/g;

const readQuiet = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''); /* a file that is not there names nothing */
const sortedLists = (found) => Object.fromEntries(Object.entries(found).map(([file, referrers]) => [file, [...referrers].sort()]));

/** remember that `referrer` names `target` (never itself) */
function noteReferrer(found, target, referrer) {
  if (target !== referrer) (found[target] = found[target] || new Set()).add(referrer);
}

/** every path after `node ` in a text, root-relative */
function nodeRunPaths(text) {
  const found = new Set();
  for (const hit of text.matchAll(NODE_RUN)) found.add(hit[1].replace(/^\.\//, ''));
  return found;
}

/** a scripts/ or tools/ file is a CLI by its shape, or by a `node <itself>` usage line in its own header */
const isCliShaped = (file, text) => CLI_SHAPE.test(text) || text.includes('node ' + file) || !EXPORTS.test(text);

/** the files a package.json script runs ('cli') and a workflow runs ('ci') */
function runLinesOf(root) {
  const kinds = {};
  for (const file of nodeRunPaths(readQuiet(path.join(root, 'package.json')))) kinds[file] = 'cli';
  const flowDir = path.join(root, '.github', 'workflows');
  const flowNames = fs.existsSync(flowDir) ? fs.readdirSync(flowDir).filter((name) => /\.ya?ml$/.test(name)) : [];
  for (const name of flowNames) for (const file of nodeRunPaths(readQuiet(path.join(flowDir, name)))) kinds[file] = kinds[file] || 'ci';
  return kinds;
}

/** { file: 'cli' | 'ci' } for the files that are run, not required */
function entryKindsOf(root, files) {
  const kinds = runLinesOf(root);
  for (const file of files) {
    if (!kinds[file] && /^(scripts|tools)\//.test(file) && isCliShaped(file, readQuiet(path.join(root, file)))) kinds[file] = 'cli';
  }
  const ownFiles = new Set(files);
  return Object.fromEntries(Object.entries(kinds).filter(([file]) => ownFiles.has(file)));
}

/** the files directly inside a folder (not its sub-folders) */
const filesInFolder = (files, folder) => files.filter((file) => file.startsWith(folder) && !file.slice(folder.length).includes('/'));

/** the own files an ES import spec can mean (the way Node resolves: exact, extensions, directory index) */
function importCandidates(folder, spec, ownFiles) {
  const base = path.posix.normalize(path.posix.join(folder, spec));
  return [base, base + '.js', base + '.mjs', base + '.cjs', base + '/index.js'].filter((candidate) => ownFiles.has(candidate));
}

/** { file: [referrer…] } for ES imports of a file and for files in a directory a referrer requires by a built name */
function importedByOf(root, files) {
  const ownFiles = new Set(files);
  const found = {};
  for (const referrer of files) {
    const text = readQuiet(path.join(root, referrer));
    const folder = path.posix.dirname(referrer);
    const imported = [...text.matchAll(IMPORT_SPEC)].flatMap((hit) => importCandidates(folder, hit[1], ownFiles));
    const loaded = [...text.matchAll(DIR_REQUIRE)].flatMap((hit) => filesInFolder(files, path.posix.normalize(path.posix.join(folder, hit[1])).replace(/\/?$/, '/')));
    for (const target of imported.concat(loaded)) noteReferrer(found, target, referrer);
  }
  return sortedLists(found);
}

/** every .js / .html under a folder of the root, root-relative */
function* webFilesOf(root, folder) {
  const here = path.join(root, folder);
  if (!fs.existsSync(here)) return;
  for (const item of fs.readdirSync(here, { withFileTypes: true })) {
    const relPath = folder + '/' + item.name;
    if (item.isDirectory()) yield* webFilesOf(root, relPath);
    else if (/\.(js|html)$/.test(item.name)) yield relPath;
  }
}

/** the own file a quoted path means: from public/ when it starts with a slash, else from the writer's folder */
function targetOfPath(referrer, spec, ownFiles) {
  const relPath = spec.startsWith('/') ? 'public' + spec : path.posix.normalize(path.posix.join(path.posix.dirname(referrer), spec));
  if (ownFiles.has(relPath)) return relPath;
  return ownFiles.has('public/' + relPath) ? 'public/' + relPath : null;
}

/** { file: [referrer…] } among the web's public/ files: who writes this file's path (a script tag, a service-worker register, a lazy loader) */
function namedByOf(root, files) {
  const ownFiles = new Set(files);
  const named = {};
  for (const referrer of webFilesOf(root, 'public')) {
    for (const hit of readQuiet(path.join(root, referrer)).matchAll(PATH_STRING)) {
      const target = targetOfPath(referrer, hit[1].split('?')[0], ownFiles);
      if (target) noteReferrer(named, target, referrer);
    }
  }
  return sortedLists(named);
}

module.exports = { entryKindsOf, namedByOf, importedByOf, nodeRunPaths };
