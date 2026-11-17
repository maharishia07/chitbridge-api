#!/usr/bin/env node
/**
 * check-app-parses.js — does app.html actually RUN?
 *
 * 2026-08-06: a missing comma after an endpoint in the EP registry ran the object literal into the next line, the
 * whole inline <script> failed to parse, and every screen in the app went blank. It shipped because I had
 * parse-checked each new FUNCTION on its own and they were all individually fine — the break was BETWEEN them, in
 * the one place a per-function check cannot look.
 *
 * A syntax error in one inline script takes down everything in that block. There is no partial failure and no
 * console warning a person would see before the deploy: the page is simply empty. So this runs the whole of each
 * inline block through the parser, which finds it in under a second.
 *
 * NOTE .cjs: this package is "type": "module", so a .js file here is an ES module and cannot require().
 * Usage:  node scripts/check-app-parses.cjs [file ...]     (defaults to public/app.html and public/app/*.js)
 * Exit 1 on any parse failure, so it can gate a commit.
 */
/*
 * OWNS      the parse check that app.html's inline script and the app modules actually run
 * CALLED BY package.json:37 (parsecheck); .github/workflows/ci.yml:35
 * FLOW      read app.html and app/*.js -> extract the inline scripts -> compile each -> exit 1 on a failure
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/walks-and-the-e2e-harness
 */
'use strict';
const fs = require('fs');
const path = require('path');
const scriptVm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function inlineScripts(html) {
  // Inline blocks only — a `src=` script is a separate file and is checked as one.
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({ code: m[1], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** parse every inline script of one page; returns how many failed */
function checkHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  const blocks = inlineScripts(html);
  let count = 0;
  blocks.forEach((item, index) => {
    try {
      new scriptVm.Script(item.code, { filename: file });
    } catch (e) {
      count++;
      // The offset makes the message point at a line in the FILE, not in the extracted fragment.
      const at = (e.stack && /:(\d+)/.exec(e.stack.split('\n')[0])) || null;
      console.log(`  ✗ ${path.relative(ROOT, file)} · inline block ${index + 1} (from line ${item.line}): ${e.message}`);
    }
  });
  if (!count) console.log(`  ✓ ${path.relative(ROOT, file)} — ${blocks.length} inline block(s)`);
  return count;
}

function checkJs(file) {
  try {
    new scriptVm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
    console.log(`  ✓ ${path.relative(ROOT, file)}`);
    return 0;
  } catch (e) {
    console.log(`  ✗ ${path.relative(ROOT, file)}: ${e.message}`);
    return 1;
  }
}

const files = args.length
  ? args
  : [
      path.join(ROOT, 'public', 'app.html'),
      ...fs
        .readdirSync(path.join(ROOT, 'public', 'app'))
        .filter((item) => item.endsWith('.js'))
        .map((item) => path.join(ROOT, 'public', 'app', item))
    ];

console.log('\nparse check');
let failedFiles = 0;
for (const text of files) {
  if (!fs.existsSync(text)) {
    console.log(`  ? ${text} — not found`);
    continue;
  }
  failedFiles += text.endsWith('.html') ? checkHtml(text) : checkJs(text);
}
console.log(failedFiles ? `\n  ${failedFiles} FAILED — this would be a blank page\n` : '\n  all parse\n');
process.exit(failedFiles ? 1 : 0);
