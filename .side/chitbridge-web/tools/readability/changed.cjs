/* tools/readability/changed.cjs — what a change touched: the files, their changed line ranges, and each file's base text.
 *
 * OWNS      the git reads of the guard: merge-base with --base, `git diff --unified=0` → touched files + new-side ranges,
 *           `git show <base>:<file>` → the text the before-numbers are measured on.
 * CALLED BY tools/readability/guard.cjs. Same diff grammar as tools/graph/graph.cjs `changed` (new-side @@ ranges).
 * FLOW      mergeBase(root, baseRef) ──▶ touched(root, mergeBase) → [{ file, status, ranges[[a,b]] }] ──▶ baseText(root, mergeBase, file)
 * CARD      qa/readability-guard
 */
'use strict';
const { spawnSync } = require('child_process');

const MAX_DIFF_BYTES = 64 << 20;

function runGit(root, args) {
  const result = spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8', maxBuffer: MAX_DIFF_BYTES });
  return { ok: result.status === 0, out: result.stdout || '', err: (result.stderr || '').trim() };
}

/** the commit the change is judged against: merge-base(baseRef, HEAD), so a branch is compared with where it left main */
function mergeBase(root, baseRef) {
  const base = runGit(root, ['merge-base', baseRef, 'HEAD']);
  if (base.ok) return { sha: base.out.trim(), why: null };
  return { sha: null, why: 'git merge-base ' + baseRef + ' HEAD failed: ' + base.err };
}

/** the `--- a/` · `+++ b/` · `/dev/null` lines: which file a section is about and whether it was added, deleted or modified */
function noteFileLine(line, state) {
  let match;
  if (/^diff --git /.test(line)) {
    state.current = null;
    state.oldPath = null;
    return true;
  }
  if ((match = /^--- a\/(.+)$/.exec(line))) {
    state.oldPath = match[1];
    return true;
  }
  if (/^--- \/dev\/null/.test(line)) {
    state.oldPath = null;
    return true;
  }
  if ((match = /^\+\+\+ b\/(.+)$/.exec(line))) {
    state.current = { file: match[1], status: state.oldPath ? 'modified' : 'added', ranges: [] };
    state.touched.push(state.current);
    return true;
  }
  if (/^\+\+\+ \/dev\/null/.test(line)) {
    if (state.oldPath) state.touched.push({ file: state.oldPath, status: 'deleted', ranges: [] });
    state.current = null;
    return true;
  }
  return false;
}

/** one `diff --git` section → { file, status, ranges } — ranges are NEW-side line spans, as the graph tool reads them */
function parseDiff(text) {
  const state = { touched: [], current: null, oldPath: null };
  for (const line of text.split('\n')) {
    if (noteFileLine(line, state)) continue;
    const hunk = state.current && /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;
    const start = Number(hunk[1]),
      count = hunk[2] == null ? 1 : Number(hunk[2]);
    state.current.ranges.push([start, start + Math.max(count, 1) - 1]);
  }
  return state.touched;
}

/** the files the working tree changed since the base commit (committed or not), with their new-side ranges;
 *  a file git does not track yet is an added file too (so a local run sees the module you just wrote) */
function touched(root, baseSha) {
  const diff = runGit(root, ['diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames', baseSha, '--']);
  if (!diff.ok) return { files: null, why: 'git diff failed: ' + diff.err };
  const files = parseDiff(diff.out);
  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard']);
  if (untracked.ok) for (const file of untracked.out.split('\n').filter(Boolean)) files.push({ file, status: 'added', ranges: [] });
  return { files, why: null };
}

/** the paths a rename (git -M, content similarity) delivered since the base: an added file in this set is an OLD file that moved, never a new one */
function renamedTo(root, baseSha) {
  const listed = runGit(root, ['diff', '-M', '--name-status', '--diff-filter=R', '--no-color', '--no-ext-diff', baseSha, '--']);
  const paths = new Set();
  if (!listed.ok) return paths;
  for (const line of listed.out.split('\n')) {
    const cells = line.split('	');
    if (cells[0] && cells[0][0] === 'R' && cells[2]) paths.add(cells[2]);
  }
  return paths;
}

/** the file as it was at the base commit, or null when it did not exist there */
function baseText(root, baseSha, file) {
  const shown = runGit(root, ['show', baseSha + ':' + file]);
  return shown.ok ? shown.out : null;
}

function shortSha(commitSha) {
  return String(commitSha || '').slice(0, 7);
}

module.exports = { mergeBase, touched, renamedTo, baseText, parseDiff, shortSha };
