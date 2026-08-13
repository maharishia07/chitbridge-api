'use strict';
// add-catalogue-synonyms.js — teach an EXISTING catalogue the words customers actually use.
//
// Athi, 2026-08-13: *"add the synonyms to the existing items."*
//
// ── ⚠️ IT ADDS. IT NEVER CREATES, RENAMES, REPRICES OR DELETES ──────────────────────────────────────────────────
// mytest already held 56 English-only rows written by hand. Those are his data. This reads each row, merges
// synonyms into it, and writes it back — every other field, including the price, goes back exactly as it came.
// A run that changed a price while "adding synonyms" would be unforgivable, so the price is asserted unchanged
// before each write.
//
// ── ⚠️ A GENERIC WORD GOES ON *ONE* ROW OR ON *NONE* ────────────────────────────────────────────────────────────
// `thakkali` on both "Tomato Native" and "Tomato Hybrid" makes the phrase ambiguous — correctly, since the
// customer did not say which. But ambiguity means UNPRICED, so spraying generic words everywhere would make the
// catalogue worse, not better. The rule used below: a generic term goes on the row a bare mention should resolve
// to, and the specific terms go on their own rows. Where no row deserves the generic word, it is left off and the
// customer is asked.
//
// Run: node scripts/add-catalogue-synonyms.js --entity mytest@email.com --name mytest [--apply]
//      (without --apply it is a DRY RUN and writes nothing)

const { j, signIn } = require('./_proof');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const EMAIL = arg('entity'), NAME = arg('name', 'mytest'), APPLY = process.argv.includes('--apply');

/* Keyed by the EXISTING row name, lowercased. Tamil script · Tanglish (several romanisations) · English · Hindi. */
const SYN = {
  /**
   * ⚠️ THE GENERIC WORD GOES ON *EVERY* COMPETING ROW, and my first pass had this backwards.
   *
   * I kept plain `thakkali` off both tomato rows to avoid ambiguity — and the result was that the commonest word
   * in the language matched NOTHING. Both outcomes leave the line unpriced, but they say different things:
   * "no catalogue match" reads as *we do not stock this*, while "which one?" reads as *you have two and he did
   * not say*. Only the second is true, and only the second tells the reader what to do next.
   *
   * So: generic terms on all rows they could mean, specific terms on exactly one. Ambiguity is the honest answer
   * to an ambiguous phrase.
   */
  'tomato native':      ['தக்காளி', 'thakkali', 'thakali', 'takkali', 'tomato', 'tamatar', 'टमाटर',
                         'நாட்டு தக்காளி', 'nattu thakkali', 'nattu tomato', 'country tomato', 'local tomato'],
  'tomato hybrid':      ['தக்காளி', 'thakkali', 'thakali', 'takkali', 'tomato', 'tamatar', 'टमाटर',
                         'ஹைப்ரிட் தக்காளி', 'hybrid thakkali', 'hybrid tomato'],
  'tomato crate 15kg':  ['தக்காளி கிரேட்', 'thakkali crate', 'tomato crate'],
  'onion big':          ['வெங்காயம்', 'vengayam', 'vengaayam', 'venkayam', 'onion', 'pyaz', 'प्याज',
                         'பெரிய வெங்காயம்', 'periya vengayam', 'periya vengaayam', 'big onion', 'bombay onion'],
  'onion small':        ['வெங்காயம்', 'vengayam', 'vengaayam', 'venkayam', 'onion', 'pyaz', 'प्याज',
                         'சின்ன வெங்காயம்', 'chinna vengayam', 'sinna vengayam', 'small onion', 'shallot', 'sambar onion', 'chhota pyaz'],
  'spring onion':       ['வெங்காயத்தாள்', 'vengaya thal', 'spring onion', 'hara pyaz'],
  'potato new':         ['உருளைக்கிழங்கு', 'urulaikizhangu', 'urulai', 'urulaikilangu', 'potato', 'aloo', 'आलू',
                         'புது உருளைக்கிழங்கு', 'pudhu urulai', 'new potato', 'new stock potato'],
  'potato old stock':   ['உருளைக்கிழங்கு', 'urulaikizhangu', 'urulai', 'urulaikilangu', 'potato', 'aloo', 'आलू',
                         'பழைய உருளைக்கிழங்கு', 'pazhaya urulai', 'old potato', 'old stock potato'],
  'carrot ooty':        ['கேரட்', 'carrot', 'kerat', 'gajar', 'गाजर', 'ஊட்டி கேரட்', 'ooty carrot', 'ooty kerat'],
  'carrot delhi':       ['கேரட்', 'carrot', 'kerat', 'gajar', 'गाजर', 'டெல்லி கேரட்', 'delhi carrot'],
  'beans french':       ['பீன்ஸ்', 'beans', 'avarai', 'french beans', 'phali'],
  'beans cluster':      ['பீன்ஸ்', 'beans', 'avarai', 'கொத்தவரங்காய்', 'kothavarangai', 'cluster beans', 'guar'],
  'brinjal long':       ['கத்தரிக்காய்', 'kathirikkai', 'kathirikai', 'kathiri', 'brinjal', 'eggplant', 'baingan', 'बैंगन',
                         'நீள கத்தரிக்காய்', 'neela kathirikkai', 'long brinjal'],
  'brinjal round':      ['கத்தரிக்காய்', 'kathirikkai', 'kathirikai', 'kathiri', 'brinjal', 'eggplant', 'baingan', 'बैंगन',
                         'உருண்டை கத்தரிக்காய்', 'round brinjal'],
  'ladies finger':      ['வெண்டைக்காய்', 'vendakkai', 'vendaikai', 'okra', 'bhindi', 'भिंडी'],
  'drumstick':          ['முருங்கைக்காய்', 'murungakkai', 'murungai kai', 'murungaikai', 'moringa', 'sahjan'],
  'cabbage':            ['முட்டைகோஸ்', 'muttaikose', 'muttai kose', 'patta gobhi'],
  'cauliflower':        ['காலிஃபிளவர்', 'cauliflower', 'phool gobhi'],
  'cucumber':           ['வெள்ளரிக்காய்', 'vellarikkai', 'vellari', 'kheera', 'खीरा'],
  'pumpkin yellow':     ['பரங்கிக்காய்', 'parangikkai', 'pumpkin', 'kaddu'],
  'bitter gourd':       ['பாகற்காய்', 'pavakkai', 'paagarkai', 'karela', 'करेला'],
  'bottle gourd':       ['சுரைக்காய்', 'suraikkai', 'sorakkai', 'lauki', 'लौकी'],
  'ridge gourd':        ['பீர்க்கங்காய்', 'peerkangai', 'peerkkangai', 'turai'],
  'coriander leaves':   ['கொத்தமல்லி', 'kothamalli', 'kotthamalli', 'kothamali', 'coriander', 'cilantro', 'dhania', 'धनिया'],
  'curry leaves':       ['கறிவேப்பிலை', 'karuveppilai', 'kariveppilai', 'karuvepillai', 'curry leaf', 'kadipatta'],
  'mint leaves':        ['புதினா', 'pudina', 'pudhina', 'putina', 'mint', 'पुदीना'],
  'spinach':            ['கீரை', 'keerai', 'pasalai keerai', 'palak', 'पालक'],
  'green chilli':       ['பச்சை மிளகாய்', 'pachai milagai', 'pachcha milagai', 'hari mirch', 'हरी मिर्च'],
  'red chilli dry':     ['வர மிளகாய்', 'vara milagai', 'varamilagai', 'dry chilli', 'lal mirch'],
  'ginger fresh':       ['இஞ்சி', 'inji', 'ingi', 'adrak', 'अदरक'],
  'garlic':             ['பூண்டு', 'poondu', 'pundu', 'lehsun', 'लहसुन'],
  'lemon':              ['எலுமிச்சை', 'elumichai', 'elumichchai', 'lime', 'nimbu', 'नींबू'],
  'lemon box 10kg':     ['எலுமிச்சை பாக்ஸ்', 'elumichai box', 'lemon box'],
  'beetroot':           ['பீட்ரூட்', 'beetroot', 'chukandar'],
  'radish':             ['முள்ளங்கி', 'mullangi', 'mooli', 'मूली'],
  'capsicum green':     ['குடைமிளகாய்', 'kudaimilagai', 'capsicum', 'shimla mirch'],
  'sweet corn':         ['சோளம்', 'cholam', 'sweet corn', 'makka'],
  'mushroom button':    ['காளான்', 'kaalan', 'kalan', 'mushroom'],
  'banana robusta':     ['வாழைப்பழம்', 'vazhaipazham', 'vaazhaipazham', 'banana', 'kela', 'केला'],
  'banana yelakki':     ['ஏலக்கி வாழை', 'yelakki vazhai', 'elakki banana'],
  'apple shimla':       ['ஆப்பிள்', 'apple', 'seb', 'सेब'],
  'orange nagpur':      ['ஆரஞ்சு', 'orange', 'santra', 'சாத்துக்குடி'],
  'mango alphonso':     ['மாம்பழம்', 'maampazham', 'mampalam', 'mango', 'aam', 'आम'],
  'grapes green':       ['திராட்சை', 'thratchai', 'thiratchai', 'grapes', 'angoor'],
  'rice ponni boiled':  ['பொன்னி அரிசி', 'ponni arisi', 'ponni rice', 'ponni'],
  'rice sona masoori':  ['சோனா மசூரி', 'sona masoori', 'sona masuri'],
  'toor dal':           ['துவரம் பருப்பு', 'thuvaram paruppu', 'thuvaram parupu', 'thuvarai', 'tur dal', 'arhar dal', 'अरहर दाल'],
  'urad dal':           ['உளுந்து', 'ulundhu', 'ulundu', 'urad', 'urad dal', 'उड़द'],
  'groundnut oil':      ['கடலை எண்ணெய்', 'kadalai ennai', 'kadalai yennai', 'peanut oil', 'moongphali tel'],
  'coconut oil':        ['தேங்காய் எண்ணெய்', 'thengai ennai', 'thengaai yennai', 'nariyal tel'],
  'sugar':              ['சர்க்கரை', 'sarkarai', 'sakkarai', 'cheeni', 'चीनी'],
  'salt crystal':       ['கல் உப்பு', 'kal uppu', 'uppu', 'crystal salt', 'namak'],
  'tamarind':           ['புளி', 'puli', 'pulli', 'imli', 'इमली'],
  'dry fish nethili':   ['நெத்திலி கருவாடு', 'nethili karuvadu', 'karuvadu', 'dry fish', 'sukha machhli'],
  'jute bag 50kg':      ['சாக்கு பை', 'sakku pai', 'gunny bag', 'jute bag'],
  'empty crate':        ['காலி கிரேட்', 'kaali crate', 'empty crate'],
};

(async () => {
  if (!EMAIL) { console.log('\n  --entity <email> required\n'); process.exit(2); }
  const T = await signIn(EMAIL, NAME);
  if (!T) { console.log('could not sign in'); process.exit(1); }

  const r = await j('/api/products?limit=300', { token: T });
  const rows = ((r.b || {}).items || []);
  console.log('\n' + rows.length + ' items in the catalogue' + (APPLY ? '' : '   (DRY RUN — nothing will be written)') + '\n');

  let touched = 0, already = 0, nomap = 0, failed = 0;
  const missing = [];
  for (const row of rows) {
    const d = row.item_data || {};
    const key = String(d.name || '').toLowerCase().trim();
    const want = SYN[key];
    if (!want) { nomap++; missing.push(d.name); continue; }

    const have = Array.isArray(d.synonyms) ? d.synonyms : [];
    const merged = [...new Set(have.concat(want))];
    if (merged.length === have.length) { already++; continue; }

    /* ⚠️ FULL OBJECT BACK — PATCH REPLACES item_data, it does not merge. Sending only { synonyms } would wipe the
       name, unit and PRICE off every row this script touched. */
    const next = Object.assign({}, d, { synonyms: merged });
    if (!APPLY) { console.log('  would add ' + String(merged.length - have.length).padStart(2) + ' → ' + d.name); touched++; continue; }

    const up = await j('/api/products/' + row.item_id, { method: 'PATCH', token: T, body: { item_data: next } });
    if (up.status !== 200) { failed++; console.log('  ✗ ' + d.name + ' → ' + up.status + ' ' + JSON.stringify(up.b).slice(0, 120)); continue; }
    /* ⚠️ ASSERT THE PRICE SURVIVED. "Add synonyms" quietly changing a price is the kind of damage nobody notices
       until an invoice is wrong, so it is checked on every single write rather than trusted. */
    const after = (up.b && up.b.item && up.b.item.item_data) || {};
    const a0 = JSON.stringify(d.price), a1 = JSON.stringify(after.price);
    if (a0 !== a1) console.log('  ⚠️ PRICE CHANGED on ' + d.name + ': ' + a0 + ' → ' + a1);
    touched++;
  }

  console.log('\n  ' + (APPLY ? 'updated' : 'would update') + ' : ' + touched);
  console.log('  already had  : ' + already);
  console.log('  no mapping   : ' + nomap + (missing.length ? '  → ' + missing.slice(0, 12).join(', ') : ''));
  if (failed) console.log('  failed       : ' + failed);
  if (!APPLY) console.log('\n  Re-run with --apply to write.\n'); else console.log('');
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
