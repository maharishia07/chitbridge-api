'use strict';
/**
 * tests/lib/money-scan.cjs — the ONE list of shapes a second money calculation takes (ACC-206 G2).
 *
 * OWNS      SUSPECTS (the regexes), code() (a file's code, comments out), bodyOf(), hitsIn(). Moved here unchanged from money-no-arithmetic.test.cjs
 *           so every guard that scans for money arithmetic reads ONE list; a new shape is added here and nowhere else (the web twin imports it too).
 * CALLED BY tests/money-no-arithmetic.test.cjs
 * CARD      14-accounting/README
 */
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', '..');

/** a file's code with its comments taken out (a comment may name arithmetic; only code is judged) */
const code = (file) => fs.readFileSync(path.join(API, file), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** a top-level function's text: from its signature to the first line that is a lone closing brace */
const bodyOf = (text, signature) => {
  const at = text.indexOf(signature);
  if (at < 0) return null;
  const rest = text.slice(at);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
};

const MONEY = '(?:total|net|gross|tax|amount|price|taxable|savings|discount|value|sum|paid|due|money)';
/** the shapes a second calculation takes */
const SUSPECTS = [
  { name: 'reduce()', re: /\.reduce\(/ },
  { name: 'hand rounding', re: new RegExp('\\bMath\\.(?:round|floor|ceil)\\(.*' + MONEY + '|' + MONEY + '.*\\bMath\\.(?:round|floor|ceil)\\(', 'i') },
  { name: 'toFixed', re: /\.toFixed\(/ },
  { name: 'percent', re: /[*/]\s*100\b/ },
  { name: 'money operator', re: new RegExp('\\b\\w*' + MONEY + '\\w*\\s*[-+*/]\\s*(?:\\(?\\s*Number\\()?\\s*[\\w.]*' + MONEY, 'i') },
  { name: 'money operator (qty x price)', re: new RegExp('\\b\\w*(?:qty|quantity)\\w*\\)?\\s*\\*|\\*\\s*\\(?\\s*(?:Number\\()?\\s*\\w*(?:qty|quantity)', 'i') }
];

/** the suspect hits in a body, minus the named exceptions ({ file, line }) → [{ pattern, text }] */
function hitsIn(file, body, exceptions) {
  const hits = [];
  for (const text of body.split('\n')) {
    if ((exceptions || []).some((ex) => ex.file === file && text.includes(ex.line))) continue;
    for (const s of SUSPECTS) if (s.re.test(text)) hits.push({ pattern: s.name, text: text.trim().slice(0, 160) });
  }
  return hits;
}

/** the files a tree scan reads: every top-level lib/*.js and routes/*.js */
const treeFiles = () => ['lib', 'routes'].flatMap((dir) => fs.readdirSync(path.join(API, dir)).filter((name) => name.endsWith('.js')).map((name) => dir + '/' + name));

/** hit count per file over a set of files; read(file) is injectable so a guard test can plant a file that is not on disk → { file: count } (files with 0 hits left out) */
function countsOver(files, read) {
  const counts = {};
  for (const file of files) {
    const n = hitsIn(file, read(file)).length;
    if (n) counts[file] = n;
  }
  return counts;
}

module.exports = { SUSPECTS, code, bodyOf, hitsIn, treeFiles, countsOver };
