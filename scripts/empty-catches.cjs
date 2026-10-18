/**
 * empty-catches.cjs — HOW MANY CATCHES STILL SWALLOW A FAILURE IN SILENCE (round T2-HONEST, 14 Oct; the MAINT-1 count for the api).
 *
 * A catch is SILENT when its handler does nothing but carry on: an empty block, or one that only returns / assigns a literal
 * (null · [] · {} · { rows: [] } · false · 0 · '' …) — `catch (_) {}`, `.catch(() => ({ rows: [] }))`, `catch (e) { return null; }`.
 * A catch that logs (lib/logger: `log.fellBack(what, e)` · `.catch(log.orElse(what, value))`), rethrows, or answers is not counted.
 *
 *   node scripts/empty-catches.cjs                 the count over lib/ + routes/ (the guard's scope)
 *   node scripts/empty-catches.cjs --list          … and where, file by file
 *   node scripts/empty-catches.cjs <dir|file> …    any other scope (e.g. ../chitbridge-web/public for the web's count)
 *
 * The guard (tests/honest-failures.test.cjs) holds the count at or under its ratchet; lower the ratchet when you lower the count.
 * ⚠️ A text scan, not a parser: braces inside strings in a catch body could fool it — none do today.
 */
'use strict';
const fs = require('fs'), path = require('path');

const LITERAL = /^(null|undefined|true|false|-?\d+|''|""|``|\[\]|\{\}|\(\{\s*rows\s*:\s*\[\]\s*\}\)|\{\s*rows\s*:\s*\[\]\s*\}|\(\{\}\)|new Set\(\)|new Map\(\))$/;
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();

/** a handler body that only carries on: nothing, or return/assign of a literal */
function silent(body) {
  const text = stripComments(body).replace(/;+\s*$/, '').trim();
  if (!text) return true;
  return text.split(';').map((item) => item.trim()).filter(Boolean).every((item) =>
    (/^return(\s+.*)?$/.test(item) && (item === 'return' || LITERAL.test(item.slice(6).trim())))
    || (/^[A-Za-z_$][\w$.]*\s*=\s*(.*)$/.test(item) && LITERAL.test(item.replace(/^[^=]*=\s*/, '').trim())));
}
function closing(src, i, open, close) {
  let count = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === open) count++; else if (src[j] === close && --count === 0) return j; }
  return -1;
}
/** the line numbers of every silent catch in one source text */
function silentCatches(src) {
  const at = [];
  const block = /\bcatch\s*(\(\s*[\w$]*\s*\))?\s*\{/g;
  for (let m; (m = block.exec(src));) {
    if (src[m.index - 1] === '.') continue;
    const o = m.index + m[0].length - 1, c = closing(src, o, '{', '}');
    if (c > 0 && silent(src.slice(o + 1, c))) at.push(m.index);
  }
  const handler = /\.catch\(\s*(?:\(\s*[\w$]*\s*\)|[\w$]+|function\s*\(\s*[\w$]*\s*\))\s*(=>)?\s*/g;
  for (let m; (m = handler.exec(src));) {
    const pc = closing(src, m.index + 6, '(', ')');
    if (pc < 0) continue;
    const body = src.slice(m.index + m[0].length, pc).trim();
    if (body.startsWith('{') && body.endsWith('}') ? silent(body.slice(1, -1)) : silent('return ' + body)) at.push(m.index);
  }
  return at.map((item) => src.slice(0, item).split('\n').length).sort((first, second) => first - second);
}
function files(p, out) {
  if (fs.statSync(p).isFile()) { out.push(p); return out; }
  for (const f of fs.readdirSync(p, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name.startsWith('.')) continue;
    const q = path.join(p, f.name);
    if (f.isDirectory()) files(q, out); else if (/\.(c?js|html)$/.test(f.name)) out.push(q);
  }
  return out;
}
/** count(roots) → { total, where: { file: [lines] } } */
function count(roots) {
  const where = {}; let total = 0;
  for (const r of roots) for (const f of files(r, [])) {
    const lines = silentCatches(fs.readFileSync(f, 'utf8'));
    if (lines.length) { where[path.relative(process.cwd(), f)] = lines; total += lines.length; }
  }
  return { total, where };
}
const API = path.join(__dirname, '..');
const SCOPE = [path.join(API, 'lib'), path.join(API, 'routes')];

module.exports = { count, silentCatches, SCOPE };

if (require.main === module) {
  const args = process.argv.slice(2), list = args.includes('--list');
  const roots = args.filter((item) => item !== '--list');
  const out = count(roots.length ? roots : SCOPE);
  if (list) Object.entries(out.where).sort((first, second) => second[1].length - first[1].length)
    .forEach(([f, l]) => console.log(String(l.length).padStart(4) + '  ' + f + ':' + l.join(',')));
  console.log('silent catches: ' + out.total);
}
