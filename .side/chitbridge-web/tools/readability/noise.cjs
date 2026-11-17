/* tools/readability/noise.cjs — is a file's change only NOISE: comments and data-cbsid attributes? (MNT, 2026-11-13)
 *
 * OWNS      sameCode(file, headText, baseText): true when the head and the base carry the same code once comments and data-cbsid
 *           attributes are removed from both (the token streams are compared, so a one-character code change is never noise).
 * CALLED BY tools/readability/guard.cjs (judgeFile: a comment-only or id-only diff warns on the test-layer rules, it does not fail them),
 *           e2e/readability-guard.cjs (the fixtures).
 * FLOW      text ──▶ .js/.cjs/.mjs: acorn tokens (comments are never tokens) · .html: comments cut, script bodies tokenised, style
 *           comments cut ──▶ data-cbsid attributes cut ──▶ one string per version ──▶ equal?   Anything it cannot read is NOT noise.
 * CARD      qa/readability-guard
 */
'use strict';
const path = require('path');

function loadAcorn() {
  try {
    return require('acorn');
  } catch (_) {
    return require(path.join(__dirname, '..', 'vendor', 'acorn.cjs'));
  }
}
const acorn = loadAcorn();

/** ` data-cbsid="X"` in any form it takes in markup or inside a JS string (plain, single-quoted, backslash-escaped quotes, bare) */
const CBSID_ATTRIBUTE = /\s*data-cbsid=(?:\\?"[^"\\]*\\?"|\\?'[^'\\]*\\?'|[^\s>"'\\]+)/g;
const withoutIds = (text) => text.replace(CBSID_ATTRIBUTE, '');

/** ` data-pop="POPnnn"` (a dialog's code, any quoting) */
const POP_ATTRIBUTE = /\s*data-pop=\\?(["'])POP\d+\\?\1/g;
const POP_TAG_REACH = 1500;

/** the code with the data-pop codes cut that no shortcut reads: shortcuts.js openPopup() finds only ".mhd[data-pop]", so a data-pop on any other
 *  element is a label; the tag is read from its "<" to its ">" in the raw source (string pieces and all), and a tag that is not seen whole, or says mhd, keeps its code */
function withoutPopLabels(text) {
  return text.replace(POP_ATTRIBUTE, (found, _quote, offset) => {
    const open = text.lastIndexOf('<', offset), close = text.indexOf('>', offset);
    const whole = open >= 0 && close > open && close - open < POP_TAG_REACH;
    return whole && !/\bmhd\b/.test(text.slice(open, close)) ? '' : found;
  });
}
const collapse = (text) => text.replace(/\s+/g, ' ').trim();

/** the opening and closing brackets of the token stream (a template substitution closes with a plain brace) */
const OPENERS = new Set(['(', '[', '{', '\${']);
const CLOSERS = new Set([')', ']', '}']);

/** a dialog's own name: { pop: 'POPnnn' } alone, one property, a POP code. shortcuts.js reads it only on a .mhd head; modalStamp only paints it. */
const isPopObject = (arg) =>
  arg.length === 5 && arg.map((item) => item.label).join(' ') === '{ name : string }' && arg[1].text === 'pop' && /^(['"])POP\d+\1$/.test(arg[3].text);

/** the token ranges of the arguments of a call whose "(" sits at open: [[from, to)...] and the index of its ")" */
function argumentsOf(items, open) {
  const ranges = [];
  let depth = 0, from = open + 1;
  for (let at = open; at < items.length; at++) {
    if (OPENERS.has(items[at].label)) depth++;
    else if (CLOSERS.has(items[at].label)) depth--;
    else if (items[at].label === ',' && depth === 1) { ranges.push([from, at]); from = at + 1; }
    if (depth === 0) { ranges.push([from, at]); return { ranges, close: at }; }
  }
  return null;
}

/** one modal(html, wide, opt) call with its arguments already normalised: the identity stamp (the pop object as the THIRD argument, nothing after it)
 *  is cut, and a literal false in the wide slot is the same as no wide (the dialog tests it for truthiness) whether or not a stamp was cut */
function modalArguments(args) {
  let kept = args;
  if (kept.length === 3 && isPopObject(kept[2])) kept = kept.slice(0, 2);
  if (kept.length === 2 && kept[1].length === 1 && kept[1][0].label === 'false') kept = kept.slice(0, 1);
  return kept;
}

/** the stream with every modal( call normalised (innermost first) */
function withoutDialogStamps(items) {
  const out = [];
  for (let at = 0; at < items.length; at++) {
    const isModalCall = items[at].text === 'modal' && items[at].label === 'name' && items[at + 1] && items[at + 1].label === '(';
    const found = isModalCall ? argumentsOf(items, at + 1) : null;
    if (!found) { out.push(items[at]); continue; }
    const args = modalArguments(found.ranges.map(([from, to]) => withoutDialogStamps(items.slice(from, to))));
    out.push(items[at], items[at + 1]);
    args.forEach((arg, index) => { if (index) out.push({ label: ',', text: ',', joined: ',\u0001,' }); out.push(...arg); });
    out.push(items[found.close]);
    at = found.close;
  }
  return out;
}

/** the tokens of JS code (comments are not tokens), each as its own text with ids removed from strings and templates, plus an N flag when a
 *  line break sits before it: a return-newline-x and a newline-before-parenthesis change behaviour (automatic semicolon insertion). The first
 *  token carries no flag, so a header comment added at the top is noise; a line break inside a comment counts, as it does for the language. */
function codeStream(code) {
  const items = [];
  let previousEnd = null;
  code = withoutPopLabels(code);
  for (const token of acorn.tokenizer(code, { ecmaVersion: 'latest', allowHashBang: true })) {
    const lineBreak = previousEnd !== null && code.slice(previousEnd, token.start).includes('\n') ? 'N' : '';
    const tokenText = code.slice(token.start, token.end);
    items.push({ label: token.type.label, text: tokenText, joined: lineBreak + token.type.label + '\u0001' + withoutIds(tokenText) });
    previousEnd = token.end;
  }
  return withoutDialogStamps(items).map((item) => item.joined).join('\u0002');
}

const SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
const STYLE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

/** a page: script bodies as token streams, style comments and html comments cut, the rest compared as text */
function pageStream(html) {
  const bodies = [];
  const holder = (body) => {
    bodies.push(body);
    return '<script-body ' + (bodies.length - 1) + '>';
  };
  const shell = html
    .replace(SCRIPT, (_all, open, body, close) => open + holder(body) + close)
    .replace(STYLE, (_all, open, body, close) => open + body.replace(CSS_COMMENT, '') + close)
    .replace(HTML_COMMENT, '');
  const scripts = bodies.map(safeCode);
  return collapse(withoutIds(withoutPopLabels(shell))) + '\u0003' + scripts.join('\u0003');
}

/** a script body's token stream; a body acorn cannot read stays as its own whitespace-collapsed text (so its comments count) */
function safeCode(body) {
  try {
    return codeStream(body);
  } catch (_) {
    return 'RAW' + collapse(withoutIds(body));
  }
}

/** a file acorn cannot read is never noise: the finding stays as it was (null = no comparable form) */
const unreadable = (_error) => null;

/** the comparable form of one version of a file, or null when it cannot be read */
function streamOf(file, text) {
  try {
    if (/\.html?$/i.test(file)) return pageStream(text);
    if (/\.(c|m)?js$/i.test(file)) return codeStream(text);
  } catch (error) {
    return unreadable(error);
  }
  return null;
}

/** true when head and base differ only in comments and data-cbsid attributes (and at least one version could be read) */
function sameCode(file, headText, baseText) {
  if (headText == null || baseText == null) return false;
  const head = streamOf(file, headText),
    base = streamOf(file, baseText);
  return head !== null && base !== null && head === base;
}

module.exports = { sameCode, streamOf };
