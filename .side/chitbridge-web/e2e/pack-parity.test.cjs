/**
 * pack-parity.test.cjs — every language pack must carry the SAME key set.
 *
 * ⚠️⚠️ A HALF-FILLED MAP IS WORSE THAN AN EMPTY ONE. The string layer's own comment says it: a language with no
 * entries renders English, which is honest; a language with some entries renders a screen in two languages at
 * once and reads as a broken product rather than an untranslated one. Nothing enforced that until now — packs
 * are separate files, and the only thing keeping them in step was me remembering.
 *
 * ⚠️ AND THE COUNT MUST COME FROM THE LOADED OBJECT, NOT FROM THE TEXT. My first coverage check tested
 * `file.indexOf(label) >= 0`, so the key "Profile" counted as present because the file contained "👤 Profile".
 * It reported 635/643 against a pack that actually had 596. A verification that shares an assumption with the
 * thing it verifies is not a verification.
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public', 'app');
const KEYS = require('./labels.covered.json');
const LANGS = ['ar', 'fr', 'hi', 'ta'];

function load(lang) {
  const file = path.join(PUB, 'strings-' + lang + '.js');
  if (!fs.existsSync(file)) return null;
  const CBSTR = {};
  CBSTR[lang] = {};
  new Function('CBSTR', 'renderApp', fs.readFileSync(file, 'utf8'))(CBSTR, function () {});
  return CBSTR[lang];
}

let fail = 0;
console.log('\n  LANG   COVERED        SIZE   STATE');
console.log('  ' + '-'.repeat(52));

const missingBy = {};
for (const lang of LANGS) {
  const map = load(lang);
  if (!map) { console.log('  ' + lang + '     — no pack —'); fail++; continue; }
  const have = KEYS.filter((k) => Object.prototype.hasOwnProperty.call(map, k));
  const missing = KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(map, k));
  missingBy[lang] = missing;
  const kb = (fs.statSync(path.join(PUB, 'strings-' + lang + '.js')).size / 1024).toFixed(1);
  const ok = missing.length === 0;
  if (!ok) fail++;
  console.log('  ' + lang + '     ' + String(have.length).padStart(3) + ' / ' + KEYS.length
    + '   ' + kb.padStart(6) + ' KB   ' + (ok ? 'complete' : missing.length + ' MISSING'));
}

for (const lang of LANGS) {
  const m = missingBy[lang];
  if (m && m.length) {
    console.log('\n  ' + lang + ' is missing:');
    m.slice(0, 12).forEach((k) => console.log('     ' + JSON.stringify(k)));
    if (m.length > 12) console.log('     … and ' + (m.length - 12) + ' more');
  }
}

/**
 * ⚠️ A TRANSLATION THAT EQUALS THE ENGLISH IS USUALLY A PLACEHOLDER SOMEONE FORGOT. Not always — "WhatsApp",
 * "ERP", "IoT" are correct untranslated in every language here — so this WARNS and does not fail.
 */
console.log('\n  identical-to-English (usually intentional for product names):');
for (const lang of LANGS) {
  const map = load(lang);
  if (!map) continue;
  const same = KEYS.filter((k) => map[k] === k);
  console.log('    ' + lang + ': ' + same.length + (same.length ? '  e.g. ' + same.slice(0, 4).map((s) => JSON.stringify(s)).join(', ') : ''));
}

console.log('\n== PACK PARITY ==  ' + fail + ' failure(s)\n');
process.exit(fail ? 1 : 0);
