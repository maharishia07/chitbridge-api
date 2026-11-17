// UNIT      29/Arabic / RTL
/**
 * arabic-catalogue.test.cjs — prove the Arabic catalogue RESOLVES, including all six plural categories.
 *
 * ⚠️ A CATALOGUE THAT PARSES IS NOT A CATALOGUE THAT RESOLVES. The keys carry a U+0005 separator and are built by
 * a loop; a single wrong separator or a mistyped English base would leave every lookup silently falling through to
 * English — which is exactly the failure that looks like "not translated yet" rather than "broken".
 *
 * So this pulls the real functions out of app.html and calls them with the language forced to Arabic.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
const blocks = [];
const RE = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = RE.exec(src))) blocks.push(m[1]);
const all = blocks.join('\n;\n');

/* the string layer only — from the named-key catalogue down to the end of txn() */
const from = all.indexOf('var CBI18N');
const to = all.indexOf('function menuBtn');
if (from < 0 || to < 0) { console.log('could not locate the string layer'); process.exit(1); }
/* the string layer is now in two homes: the named-key rail t() + the Arabic pack literal stay in app.html (CBI18N..menuBtn),
   while cbLang · CBSTR · tx · txf · txn · bidiWrap moved to app/accounts-shell.js ("the string door" .. "a failure's words"):
   both are lifted from real source and joined, never stubbed. */
const SHELL = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'accounts-shell.js'), 'utf8');
const sf = SHELL.indexOf('/* ── the string door ── */');
const st = SHELL.indexOf("/* ── a failure's words, and the toast ── */");
if (sf < 0 || st < sf) { console.log('could not locate the string door in accounts-shell.js'); process.exit(1); }
const layer = SHELL.slice(sf, st) + '\n;\n' + all.slice(from, to);

/**
 * ⚠️ STUB THE SEAM THAT ACTUALLY DECIDES, NOT THE ONE THAT LOOKS LIKE IT DOES. cbLang() is defined INSIDE this
 * block, so a `cbLang` parameter is shadowed and silently ignored — the first run of this test reported eleven
 * failures for that reason alone, and every one of them looked exactly like a broken catalogue.
 *
 * cbLang() reads localStorage, so localStorage is the seam. CBLocale is genuinely external and is stubbed.
 */
const harness = new Function(
  'document', 'CBLocale', 'localStorage',
  layer + '\n;return { t:t, tx:tx, txf:txf, txn:txn, CBSTR:CBSTR, CBI18N:CBI18N };'
);
const api = harness(
  { documentElement: { getAttribute: () => 'rtl' } },
  { locale: () => 'ar-AE', number: (n) => String(n) },
  { getItem: (k) => (k === 'cb_lang' ? 'ar' : null) }
);

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(38) + got + (ok ? '' : '   want ' + want));
};

console.log('\n-- the rail (named keys) --\n');
t('nav.suppliers', api.t('nav.suppliers', 'Suppliers'), 'الموردون');
t('nav.disputes', api.t('nav.disputes', 'Disputes'), 'النزاعات');
t('nav.messages', api.t('nav.messages', 'Messages'), 'الرسائل');

console.log('\n-- prose (English as key) --\n');
t('a plain label', api.tx('Every line is its own product.'), 'كل بند منتج قائم بذاته.');
t('an untranslated key falls back', api.tx('No such string anywhere'), 'No such string anywhere');

console.log('\n-- ALL SIX Arabic plural categories --\n');
/**
 * ⚠️ THE COUNT IS ISOLATED TOO, and it should be. zero/one/two carry no {count} at all — Arabic says "سجلين",
 * not "2 records" — so those three come back bare. few/many/other interpolate the number, and a number is a
 * substituted value like any other, so bidiWrap puts FSI/PDI around it.
 *
 * This is where I had the expectation wrong on the first run and the code right: it read as three failures.
 */
const I = (v) => String.fromCharCode(0x2068) + v + String.fromCharCode(0x2069);
const forms = [
  [0, 'أرشفة لا سجلات…'],
  [1, 'أرشفة سجل واحد…'],
  [2, 'أرشفة سجلين…'],
  [3, 'أرشفة ' + I(3) + ' سجلات…'],
  [11, 'أرشفة ' + I(11) + ' سجلًا…'],
  [100, 'أرشفة ' + I(100) + ' سجل…'],
];
for (const [n, want] of forms) {
  t('n=' + n, api.txn('Archiving {count} record…', 'Archiving {count} records…', n), want);
}

console.log('\n-- bidi isolation of substituted values --\n');
const out = api.txf('Remove {name} from your supplier list?', { name: 'Alpha Timers, Pvt' });
const FSI = String.fromCharCode(0x2068), PDI = String.fromCharCode(0x2069);
t('value is wrapped in FSI/PDI', out.indexOf(FSI) >= 0 && out.indexOf(PDI) >= 0, 'true');
t('the sentence is Arabic', out.indexOf('قائمة الموردين') >= 0, 'true');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
