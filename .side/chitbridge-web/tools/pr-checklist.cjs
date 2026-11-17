#!/usr/bin/env node
/* tools/pr-checklist.cjs — a PR body must carry the §6 checklist WITH NUMBERS (READ-GUARD, DISCIPLINES §6 · 15 Oct).
 *
 * OWNS      the one reading of a PR body: are the five checklist lines there, are the numbers filled, is any placeholder left;
 *           and the two skips the brief allows — a dependency bot's PR and a docs-only PR.
 * CALLED BY .github/workflows/ci.yml `pr-checklist` job in the web AND the api (the api runs this file from its web checkout:
 *           one reader, never a copy).
 * FLOW      body (PR_BODY env | --body-file) + author + changed files (git diff --name-only base...HEAD | --files-file)
 *           ──▶ skip? ──▶ findLines ──▶ missing · placeholders ──▶ exit 1 with the words, else 0
 * CARD      qa/readability-guard
 *
 *   node tools/pr-checklist.cjs --author LOGIN --base SHA|REF [--root DIR]        (PR_BODY in the environment)
 *   node tools/pr-checklist.cjs --body-file body.md --files-file files.txt --author LOGIN
 */
'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');

const DEPENDENCY_BOTS = /^(dependabot|renovate|github-actions)(\[bot\])?$/i;
const DOCS_ONLY = /^(docs\/|.*\.md$|\.github\/pull_request_template\.md$)/i;
/** a checklist LINE starts its line (after a bullet and a checkbox): a sentence that only mentions "Pass 3" is not it */
const lineOf = (label) => new RegExp('^[ \\t]*(?:[-*][ \\t]*)?(?:\\[[ xX]\\][ \\t]*)?' + label + '[^\\n]*', 'im');
/** the five lines, and what each must carry to count as filled */
const LINES = [
  {
    name: 'Pass 0 · seams',
    find: lineOf('pass 0'),
    filled: /(`[^`<]+`|nothing exists)/i,
    hint: 'the seams word and what was reused / widened, or "nothing exists"'
  },
  {
    name: 'Pass 1 · shrink',
    find: lineOf('pass 1'),
    filled: /lines\s*`?\d+\s*(→|->)\s*\d+`?[^\n]*complexity\s*`?\d+\s*(→|->)\s*\d+/i,
    hint: 'lines N → N · complexity N → N'
  },
  {
    name: 'Pass 2 · humanify',
    find: lineOf('pass 2'),
    filled: /cryptic names\s*`?\d+\s*(→|->)\s*\d+`?[^\n]*empty catches\s*`?\d+\s*(→|->)\s*\d+/i,
    hint: 'cryptic names N → N · empty catches N → N'
  },
  { name: 'Pass 3 · structure', find: lineOf('pass 3'), filled: /module header[^\n]*CARD/i, hint: 'module header · CARD line · TRACE row' },
  {
    name: 'Guard green',
    find: lineOf('guard green'),
    filled: /readability --changed/i,
    hint: 'the guard line, from `node tools/readability.cjs --changed --ratchet --md`'
  }
];
const PLACEHOLDER = /<(before → after[^>]*|word|name|doc|file|files|n)>/i;
const EXIT_FAIL = 1;

const args = process.argv.slice(2);
function flag(name) {
  const at = args.indexOf('--' + name);
  return at < 0 ? null : args[at + 1];
}

function readBody() {
  const file = flag('body-file');
  if (file) return fs.readFileSync(file, 'utf8');
  return process.env.PR_BODY || '';
}

/** the files this PR changes: --files-file, else git diff --name-only <base>...HEAD */
function changedFiles(root) {
  const listed = flag('files-file');
  if (listed) return fs.readFileSync(listed, 'utf8').split('\n').filter(Boolean);
  const base = flag('base');
  if (!base) return null;
  const diff = spawnSync('git', ['-C', root, 'diff', '--name-only', base + '...HEAD'], { encoding: 'utf8' });
  return diff.status === 0 ? diff.stdout.split('\n').filter(Boolean) : null;
}

/** why this PR is exempt (a dependency bot · docs only), or null */
function skipReason(author, files) {
  if (author && DEPENDENCY_BOTS.test(author)) return 'a dependency bot (' + author + ')';
  if (files && files.length && files.every((file) => DOCS_ONLY.test(file))) return 'docs-only (' + files.length + ' file(s), all docs/ or *.md)';
  return null;
}

/** the §6 checklist block: its heading to the next heading of the same or a higher level; no such heading = the whole body (older PRs) */
function checklistBlock(body) {
  const heading = /^(#{1,6})[ \t]*§\s*6[^\n]*$/im.exec(body);
  if (!heading) return body;
  const rest = body.slice(heading.index + heading[0].length);
  const next = new RegExp('^#{1,' + heading[1].length + '}[ \\t]+\\S', 'm').exec(rest);
  return heading[0] + (next ? rest.slice(0, next.index) : rest);
}

/** every checklist line that is missing, unfilled or still carries a <placeholder> */
function problems(body) {
  const found = [];
  const block = checklistBlock(body);
  for (const line of LINES) {
    const match = line.find.exec(block);
    if (!match) {
      found.push(line.name + ': the line is missing (' + line.hint + ')');
      continue;
    }
    const text = match[0];
    if (PLACEHOLDER.test(text)) found.push(line.name + ': a placeholder is still there — ' + PLACEHOLDER.exec(text)[0] + ' (fill it, or write n/a)');
    else if (!line.filled.test(text)) found.push(line.name + ': not filled — needs ' + line.hint);
  }
  return found;
}

/** read the body, decide the skips, print the problems; the exit code is the verdict */
function main() {
  const body = readBody(),
    author = flag('author') || process.env.PR_AUTHOR || '';
  const files = changedFiles(flag('root') || process.cwd());
  const skip = skipReason(author, files);
  if (skip) {
    console.log('  pr-checklist: skipped — ' + skip);
    return 0;
  }
  const found = problems(body);
  if (!found.length) {
    console.log('  pr-checklist: the §6 checklist is there with its numbers' + (files ? ' (' + files.length + ' file(s) changed)' : ''));
    return 0;
  }
  console.log('  ✗ pr-checklist: the PR body lacks the §6 checklist with numbers (DISCIPLINES §6; template: .github/pull_request_template.md)');
  found.forEach((problem) => console.log('    · ' + problem));
  console.log(
    '  fill it from: node tools/readability.cjs --changed --ratchet --md   (api: node ../chitbridge-web/tools/readability.cjs --changed --repo api --root . --ratchet --md)'
  );
  return EXIT_FAIL;
}

if (require.main === module) process.exit(main());
module.exports = { problems, checklistBlock, skipReason, LINES, DEPENDENCY_BOTS, DOCS_ONLY };
