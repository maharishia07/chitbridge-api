'use strict';
// seed-catalogue-veg.js — a real vegetable/provisions catalogue, in the languages people actually type.
//
// Athi, 2026-08-13: *"create a price list for these items in english, tamil and few other language combination…
// so I can test the catalogue price pick… add few more items and do not add price for few, so we can test both."*
//
// ── ⚠️ THE SYNONYMS ARE THE PRODUCT, NOT THE NAMES ──────────────────────────────────────────────────────────────
// A catalogue with one English name per item matches nothing a customer writes. The value is entirely in the
// alternatives: Tamil script, Tanglish, English, and Hindi — because a supplier in the same market may well type
// `aloo` or `dhania`, and the reader has no way to know which language today's message is in.
//
// ⚠️ SEVERAL ROMANISATIONS EACH, ON PURPOSE. `irupadhu` cost us a real bug: I wrote three spellings of "twenty"
// and missed the one Athi types. Tamil has no single correct romanisation, so every item here carries the
// spellings people actually use rather than the one a dictionary would pick.
//
// ⚠️ SOME ITEMS HAVE NO PRICE, DELIBERATELY. Athi asked for both paths: a priced item proves the catalogue pull,
// an unpriced one proves that "needs a price from you" is reported rather than silently left at zero.
//
// Run: node scripts/seed-catalogue-veg.js --entity mytest@example.com [--name "My Test"]

const { j, signIn } = require('./_proof');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const EMAIL = arg('entity');
const NAME = arg('name', 'My Test');

/* variant → a genuinely different product, priced and sourced separately (nattu vs hybrid tomato).
   synonyms → the same product spelled the way people write it, in any script or language.
   NO price key at all → deliberately unpriced, to prove the needs-a-price path. */
const ITEMS = [
  // ── the list Athi gave, with his variants ──────────────────────────────────────────────────────────────────
  /**
   * ⚠️ GENERIC TERMS GO ON *BOTH* VARIANTS; SPECIFIC ONES ON EXACTLY ONE. This is not tidiness — it is what
   * makes the never-auto-pick rule work in a second language.
   *
   * A synonym carried by only ONE variant means the customer named that variant, so it prices. A synonym on
   * SEVERAL means they did not, so it flags. Put plain `thakkali` on the nattu row alone and a bare "thakkali
   * 2 crate" would silently be priced as nattu — inventing the grade. Put `nattu thakkali` on both and a
   * customer who said exactly which one gets asked again for no reason.
   */
  { name: 'Tomato', variant: 'nattu', unit: 'crate', price: 474,
    synonyms: ['தக்காளி', 'thakkali', 'thakali', 'takkali', 'thakkaali', 'tamatar', 'टमाटर',   // generic — on both
               'நாட்டு தக்காளி', 'nattu thakkali', 'nattu', 'country tomato', 'local tomato'] },  // specific
  { name: 'Tomato', variant: 'hybrid', unit: 'crate', price: 395,
    synonyms: ['தக்காளி', 'thakkali', 'thakali', 'takkali', 'thakkaali', 'tamatar', 'टमाटर',   // generic — on both
               'ஹைப்ரிட் தக்காளி', 'hybrid thakkali', 'hybrid tomato', 'hybrid'] },              // specific

  { name: 'Onion', variant: 'big', unit: 'kg', price: 40,
    synonyms: ['வெங்காயம்', 'vengayam', 'vengaayam', 'venkayam', 'pyaz', 'प्याज',               // generic — on both
               'பெரிய வெங்காயம்', 'periya vengayam', 'periya', 'big onion', 'bombay onion'] },   // specific
  { name: 'Onion', variant: 'small', unit: 'kg', price: 68,
    synonyms: ['வெங்காயம்', 'vengayam', 'vengaayam', 'venkayam', 'pyaz', 'प्याज',               // generic — on both
               'சின்ன வெங்காயம்', 'chinna vengayam', 'sinna vengayam', 'chinna',
               'small onion', 'shallot', 'sambar onion', 'chhota pyaz'] },                       // specific

  { name: 'Potato', unit: 'kg', price: 30,
    synonyms: ['உருளைக்கிழங்கு', 'urulaikizhangu', 'urulai kizhangu', 'urulai', 'urulaikilangu',
               'potato', 'aloo', 'आलू'] },

  { name: 'Carrot', variant: 'ooty', unit: 'kg', price: 70,
    synonyms: ['கேரட்', 'ஊட்டி கேரட்', 'carrot', 'kerat', 'ooty carrot', 'gajar', 'गाजर'] },

  { name: 'Beans', unit: 'kg', price: 60,
    synonyms: ['பீன்ஸ்', 'beans', 'avarai', 'அவரை', 'french beans', 'phali'] },

  { name: 'Drumstick', unit: 'kg', price: 85,
    synonyms: ['முருங்கைக்காய்', 'murungakkai', 'murungai kai', 'murungaikai', 'drumstick', 'moringa', 'sahjan'] },

  { name: 'Coriander leaves', unit: 'bundle', price: 12,
    synonyms: ['கொத்தமல்லி', 'kothamalli', 'kotthamalli', 'kothamali', 'coriander', 'cilantro', 'dhania', 'धनिया'] },

  { name: 'Curry leaves', unit: 'bundle', price: 8,
    synonyms: ['கறிவேப்பிலை', 'karuveppilai', 'kariveppilai', 'karuvepillai', 'curry leaf', 'curry leaves',
               'kadipatta', 'कढ़ी पत्ता'] },

  { name: 'Mint leaves', unit: 'bundle', price: 10,
    synonyms: ['புதினா', 'pudina', 'pudhina', 'putina', 'mint', 'mint leaves', 'पुदीना'] },

  { name: 'Rice', variant: 'ponni', unit: 'kg', price: 58,
    synonyms: ['அரிசி', 'பொன்னி அரிசி', 'arisi', 'ponni arisi', 'ponni rice', 'ponni', 'chawal', 'चावल'] },

  { name: 'Toor dal', unit: 'kg', price: 145,
    synonyms: ['துவரம் பருப்பு', 'thuvaram paruppu', 'thuvaram parupu', 'thuvarai', 'toor dal', 'tur dal',
               'arhar dal', 'अरहर दाल'] },

  { name: 'Groundnut oil', unit: 'litre', price: 195,
    synonyms: ['கடலை எண்ணெய்', 'kadalai ennai', 'kadalai yennai', 'groundnut oil', 'peanut oil',
               'moongphali tel', 'मूंगफली तेल'] },

  // ── a few more, so the list is not exactly the test message ────────────────────────────────────────────────
  { name: 'Ginger', unit: 'kg', price: 120,
    synonyms: ['இஞ்சி', 'inji', 'ingi', 'ginger', 'adrak', 'अदरक'] },
  { name: 'Garlic', unit: 'kg', price: 210,
    synonyms: ['பூண்டு', 'poondu', 'pundu', 'garlic', 'lehsun', 'लहसुन'] },
  { name: 'Green chilli', unit: 'kg', price: 90,
    synonyms: ['பச்சை மிளகாய்', 'pachai milagai', 'pachcha milagai', 'green chilli', 'hari mirch', 'हरी मिर्च'] },
  { name: 'Lemon', unit: 'box', price: 340,
    synonyms: ['எலுமிச்சை', 'elumichai', 'elumichchai', 'lemon', 'lime', 'nimbu', 'नींबू'] },

  // ── ⚠️ DELIBERATELY UNPRICED — these prove the "needs a price from you" path ───────────────────────────────
  { name: 'Sugar', unit: 'kg',
    synonyms: ['சர்க்கரை', 'sarkarai', 'sakkarai', 'sugar', 'cheeni', 'चीनी'] },
  { name: 'Wheat flour', unit: 'kg',
    synonyms: ['கோதுமை மாவு', 'gothumai maavu', 'godhumai mavu', 'wheat flour', 'atta', 'आटा'] },
  { name: 'Coconut oil', unit: 'litre',
    synonyms: ['தேங்காய் எண்ணெய்', 'thengai ennai', 'thengaai yennai', 'coconut oil', 'nariyal tel'] },
  { name: 'Tamarind', unit: 'kg',
    synonyms: ['புளி', 'puli', 'pulli', 'tamarind', 'imli', 'इमली'] },
];

(async () => {
  if (!EMAIL) {
    console.log('\n  Which entity? Re-run with the login email:\n');
    console.log('    node scripts/seed-catalogue-veg.js --entity <email> --name "My Test"\n');
    console.log('  ⚠️ The email must be the EXISTING mytest login. Registering an unknown address CREATES a new,');
    console.log('     empty entity — that has happened once already and left junk behind.\n');
    process.exit(2);
  }
  const T = await signIn(EMAIL, NAME);
  if (!T) { console.log('could not sign in as ' + EMAIL); process.exit(1); }

  /* ⚠️ READ FIRST, so a second run does not double the catalogue. Matching on name+variant because that pair is
     what makes two rows different products. */
  const existing = await j('/api/products?limit=300', { token: T });
  const have = new Set(((existing.b && (existing.b.items || existing.b.products || existing.b)) || [])
    .map((x) => { const d = x.item_data || x; return String(d.name || '').toLowerCase() + '|' + String(d.variant || '').toLowerCase(); }));

  let added = 0, skipped = 0, failed = 0, unpriced = 0;
  for (const it of ITEMS) {
    const key = it.name.toLowerCase() + '|' + String(it.variant || '').toLowerCase();
    if (have.has(key)) { skipped++; continue; }
    const item_data = { name: it.name, unit: it.unit, synonyms: it.synonyms };
    if (it.variant) item_data.variant = it.variant;
    if (it.price !== undefined) item_data.price = it.price; else unpriced++;
    const r = await j('/api/products', { method: 'POST', token: T, body: { item_data } });
    if (r.status === 200) { added++; }
    else { failed++; console.log('  ✗ ' + it.name + (it.variant ? ' · ' + it.variant : '') + ' → ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 140)); }
  }

  console.log('\n── catalogue seeded into ' + EMAIL + ' ──────────────────────────────────────\n');
  console.log('  added   : ' + added);
  console.log('  skipped : ' + skipped + ' (already there)');
  if (failed) console.log('  failed  : ' + failed);
  console.log('  of the added, ' + unpriced + ' carry NO price on purpose — Sugar, Wheat flour, Coconut oil, Tamarind.');
  console.log('\n  Test the pull: send a chit with those items unpriced, open it → ⧉ Lines → Order →');
  console.log('  "₹ Price from catalogue". Priced items fill in; the four above come back as "needs a price from you".');
  console.log('\n  Test the languages: any of these should resolve to the same item —');
  console.log('    தக்காளி · thakkali · takkali · nattu thakkali · tamatar');
  console.log('    உருளைக்கிழங்கு · urulaikizhangu · urulai · aloo');
  console.log('    கொத்தமல்லி · kothamalli · dhania · cilantro\n');
})().catch((e) => { console.error('SEED ERROR', e); process.exit(1); });
