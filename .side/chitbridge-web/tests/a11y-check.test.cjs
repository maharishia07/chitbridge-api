/* tests/a11y-check.test.cjs: the vendored axe-core is only ever run if it is the file VERSION.json names (no browser needed).
 * Runs in `npm run check` (check:axe-vendor). Proves: the clean copy loads; one changed byte, a changed VERSION hash, and a missing file are refused;
 * the WCAG criterion reader gives 2.4.11 for axe's tag wcag2411 and nothing for the level tags. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const A = require('../e2e/lib/a11y-check.cjs');
const VENDOR = path.join(__dirname, '..', 'e2e', 'vendor', 'axe-core');
let pass = 0;
const ok = (m) => { pass++; console.log('  ok  ' + m); };
const copy = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'axe-vendor-')); for (const f of fs.readdirSync(VENDOR)) fs.copyFileSync(path.join(VENDOR, f), path.join(d, f)); return d; };

const clean = copy();
const got = A.source(clean);
assert.ok(got.src.length > 100000 && got.meta.version, 'clean copy loads'); ok('the clean copy loads (axe-core ' + got.meta.version + ')');
assert.strictEqual(A.source().meta.version, got.meta.version); ok('the shipped copy loads and matches');

const tampered = copy();
fs.appendFileSync(path.join(tampered, 'axe.min.js'), ' ');
assert.throws(() => A.source(tampered), /refusing to run a changed copy/); ok('one appended byte: source() throws');

const wrongMeta = copy();
const m = JSON.parse(fs.readFileSync(path.join(wrongMeta, 'VERSION.json'), 'utf8')); m.sha256 = '0'.repeat(64);
fs.writeFileSync(path.join(wrongMeta, 'VERSION.json'), JSON.stringify(m));
assert.throws(() => A.source(wrongMeta), /refusing to run a changed copy/); ok('a VERSION.json hash that does not match: source() throws');

const missing = copy(); fs.unlinkSync(path.join(missing, 'axe.min.js'));
assert.throws(() => A.source(missing)); ok('a missing axe.min.js: source() throws');

assert.strictEqual(A.criterion('wcag2411'), '2.4.11');
assert.strictEqual(A.criterion('wcag143'), '1.4.3');
assert.strictEqual(A.criterion('wcag2aa'), null);
assert.strictEqual(A.criterion('wcag21aa'), null);
assert.strictEqual(A.criterion('cat.color'), null); ok('criterion(): wcag2411 -> 2.4.11, wcag143 -> 1.4.3, level tags -> null');

for (const d of [clean, tampered, wrongMeta, missing]) fs.rmSync(d, { recursive: true, force: true });
console.log('a11y-check: ' + pass + ' passed');
