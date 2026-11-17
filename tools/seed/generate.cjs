/**
 * generate.cjs — A SHOP AT SCALE, NOT A PILE OF ROWS (2026-09-08).
 *
 * Athi: *"i want 10000 and more items with different tax rates and offer sizes"* — after the last 10,000 (BULKSKU…) turned out to
 * be worthless for judging anything: every row the same shape, one price band, no slab, no words anyone would type.
 *
 * ⚠️ THE POINT OF SCALE DATA IS THE SPREAD, NOT THE COUNT. What makes 10,000 rows useful is that they disagree with each other —
 * five GST rates, five units, thirteen categories, prices from ₹2 to ₹2,400, some unavailable, and names people actually say out
 * loud in a Tamil Nadu shop. A counter that is fast on 10,000 identical rows has proved nothing about a real shelf.
 *
 * Every row is composed BRAND × ITEM × PACK, the way a real shelf is:
 *   "Aachi Sambar powder 100 g"   "Idhayam Gingelly oil 500 ml"   "Aavin Curd 400 g"
 * so search, quick keys, offers and the three-column row all get something to chew on. The slab follows the CATEGORY, which is how
 * GST actually works — fresh produce nil, staples 5%, dairy fats and namkeen 12%, processed and personal care 18%, aerated 28%.
 *
 * Run:  node tools/seed/generate.cjs [count] > /dev/null   (it writes the JSON itself)
 */
'use strict';
const fs = require('fs'), path = require('path');

const WANT = Number(process.argv[2]) || 10400;

/* ── the shelf, by category: slab, unit, HSN, the brands that sell it, and the things themselves ────────────── */
const SHELF = [
  { cat: 'Vegetables', slab: 'IN-GST-0', unit: 'kg', hsn: '0709', band: [18, 90],
    brands: ['Local', 'Farm fresh', 'Nature', 'Daily', 'Green valley'],
    items: [['Tomato', ['thakkali', 'தக்காளி']], ['Onion big', ['vengayam', 'வெங்காயம்']], ['Onion small', ['chinna vengayam', 'சின்ன வெங்காயம்']],
            ['Potato', ['urulaikizhangu', 'உருளைக்கிழங்கு']], ['Carrot', ['carrot']], ['Beans', ['beans', 'பீன்ஸ்']],
            ['Brinjal', ['kathirikkai', 'கத்தரிக்காய்']], ['Ladies finger', ['vendaikkai', 'வெண்டைக்காய்']],
            ['Cabbage', ['muttaikose', 'முட்டைகோஸ்']], ['Cauliflower', ['cauliflower']], ['Green chilli', ['pachai milagai', 'பச்சை மிளகாய்']],
            ['Ginger', ['inji', 'இஞ்சி']], ['Garlic', ['poondu', 'பூண்டு']], ['Drumstick', ['murungakkai', 'முருங்கைக்காய்']],
            ['Coriander leaf', ['kothamalli', 'கொத்தமல்லி']], ['Curry leaf', ['karuveppilai', 'கருவேப்பிலை']]],
    packs: [['', 1, 'kg'], ['500 g', 0.5, 'kg'], ['250 g', 0.25, 'kg']] },

  { cat: 'Fruit', slab: 'IN-GST-0', unit: 'kg', hsn: '0810', band: [40, 260],
    brands: ['Local', 'Farm fresh', 'Nature', 'Hill'],
    items: [['Banana yelakki', ['vazhaipazham', 'வாழைப்பழம்']], ['Banana nendran', ['nendran']], ['Apple shimla', ['apple']],
            ['Orange', ['orange', 'ஆரஞ்சு']], ['Grapes', ['thiratchai', 'திராட்சை']], ['Sapota', ['sapota']],
            ['Guava', ['koyya', 'கொய்யா']], ['Papaya', ['pappali', 'பப்பாளி']], ['Mango banganapalli', ['mambazham', 'மாம்பழம்']],
            ['Pomegranate', ['mathulai', 'மாதுளை']], ['Watermelon', ['tharbusani']]],
    packs: [['', 1, 'kg'], ['500 g', 0.5, 'kg']] },

  { cat: 'Rice & grains', slab: 'IN-GST-5', unit: 'bag', hsn: '1006', band: [42, 115],
    brands: ['Ponni', 'Anil', 'Manna', 'Double Horse', 'Aachi', 'Local', 'Sakthi', 'Udhayam'],
    items: [['Ponni raw rice', ['ponni arisi', 'பொன்னி அரிசி', 'rice']], ['Ponni boiled rice', ['puzhungal arisi', 'புழுங்கல் அரிசி']],
            ['Idli rice', ['idli arisi', 'இட்லி அரிசி']], ['Basmati rice', ['basmati']], ['Sona masoori rice', ['sona masoori']],
            ['Wheat atta', ['godhumai maavu', 'கோதுமை மாவு', 'atta']], ['Rava', ['ravai', 'ரவை', 'sooji']],
            ['Maida', ['maida', 'மைதா']], ['Ragi flour', ['kezhvaragu', 'கேழ்வரகு']], ['Corn flour', ['corn flour']]],
    packs: [['1 kg', 1, 'packet'], ['5 kg', 5, 'bag'], ['10 kg', 10, 'bag'], ['25 kg', 25, 'bag']] },

  { cat: 'Pulses', slab: 'IN-GST-5', unit: 'packet', hsn: '0713', band: [95, 260],
    brands: ['Anil', 'Manna', 'Aachi', 'Local', 'Tata', 'Udhayam'],
    items: [['Toor dal', ['thuvaram paruppu', 'துவரம் பருப்பு', 'tur dal']], ['Urad dal', ['ulundhu', 'உளுந்து']],
            ['Moong dal', ['pasi paruppu', 'பாசி பருப்பு']], ['Channa dal', ['kadalai paruppu', 'கடலை பருப்பு']],
            ['Masoor dal', ['masoor']], ['Green gram', ['pachai payaru', 'பச்சை பயறு']],
            ['Black chana', ['karuppu kondakadalai']], ['Rajma', ['rajma'] ], ['Groundnut', ['verkadalai', 'வேர்க்கடலை']]],
    packs: [['500 g', 0.5, 'packet'], ['1 kg', 1, 'packet'], ['2 kg', 2, 'packet']] },

  { cat: 'Staples', slab: 'IN-GST-5', unit: 'packet', hsn: '1701', band: [22, 95],
    brands: ['Tata', 'Local', 'Aachi', 'Madhu', 'Parry'],
    items: [['Sugar', ['sarkkarai', 'சர்க்கரை']], ['Jaggery', ['vellam', 'வெல்லம்']], ['Iodised salt', ['uppu', 'உப்பு']],
            ['Rock salt', ['kal uppu']], ['Vermicelli', ['semiya', 'சேமியா']], ['Poha', ['aval', 'அவல்']],
            ['Sago', ['javvarisi', 'ஜவ்வரிசி']]],
    packs: [['500 g', 0.5, 'packet'], ['1 kg', 1, 'packet']] },

  { cat: 'Edible oil', slab: 'IN-GST-5', unit: 'litre', hsn: '1512', band: [140, 420],
    brands: ['Idhayam', 'Fortune', 'Saffola', 'Gold Winner', 'Sunpure', 'Local'],
    items: [['Sunflower oil', ['sunflower ennai', 'சூரியகாந்தி எண்ணெய்']], ['Gingelly oil', ['nallennai', 'நல்லெண்ணெய்', 'sesame oil']],
            ['Groundnut oil', ['kadalai ennai', 'கடலை எண்ணெய்']], ['Coconut oil', ['thengai ennai', 'தேங்காய் எண்ணெய்']],
            ['Rice bran oil', ['rice bran']], ['Mustard oil', ['kadugu ennai']], ['Palm oil', ['palm oil']]],
    packs: [['500 ml', 0.5, 'litre'], ['1 L pouch', 1, 'litre'], ['5 L can', 5, 'litre']] },

  { cat: 'Dairy', slab: 'IN-GST-12', unit: 'piece', hsn: '0405', band: [300, 900],
    brands: ['Aavin', 'Nandini', 'Amul', 'Hatsun', 'Arokya', 'Local'],
    items: [['Ghee', ['nei', 'நெய்']], ['Butter', ['vennai', 'வெண்ணெய்']], ['Cheese slice', ['cheese']],
            ['Paneer', ['paneer']], ['Khoa', ['khoa']]],
    packs: [['100 g', 0.1, 'piece'], ['200 g', 0.2, 'piece'], ['500 ml', 0.5, 'piece'], ['1 L jar', 1, 'piece']] },

  { cat: 'Milk & curd', slab: 'IN-GST-0', unit: 'litre', hsn: '0401', band: [26, 70],
    brands: ['Aavin', 'Nandini', 'Hatsun', 'Arokya', 'Amul'],
    items: [['Milk toned', ['paal', 'பால்', 'milk']], ['Milk full cream', ['full cream paal']], ['Curd', ['thayir', 'தயிர்']],
            ['Buttermilk', ['moru', 'மோர்']], ['Lassi', ['lassi']]],
    packs: [['200 ml', 0.2, 'piece'], ['500 ml', 0.5, 'litre'], ['1 L', 1, 'litre']] },

  { cat: 'Spices', slab: 'IN-GST-5', unit: 'packet', hsn: '0910', band: [200, 900],
    brands: ['Aachi', 'Sakthi', 'Everest', 'Catch', 'MTR', 'Priya', 'Local'],
    items: [['Sambar powder', ['sambar podi', 'சாம்பார் பொடி', 'aachi masala', 'achi massala']],
            ['Rasam powder', ['rasam podi', 'ரசம் பொடி']], ['Chilli powder', ['milagai thool', 'மிளகாய் தூள்']],
            ['Turmeric powder', ['manjal thool', 'மஞ்சள் தூள்']], ['Coriander powder', ['malli thool', 'மல்லி தூள்']],
            ['Cumin seed', ['jeeragam', 'சீரகம்', 'jeera']], ['Mustard', ['kadugu', 'கடுகு']],
            ['Fenugreek', ['vendhayam', 'வெந்தயம்']], ['Pepper', ['milagu', 'மிளகு']], ['Cardamom', ['elakkai', 'ஏலக்காய்']],
            ['Chicken masala', ['chicken masala']], ['Biryani masala', ['biryani masala']], ['Garam masala', ['garam masala']]],
    packs: [['50 g', 0.05, 'packet'], ['100 g', 0.1, 'packet'], ['200 g', 0.2, 'packet'], ['500 g', 0.5, 'packet']] },

  { cat: 'Beverages', slab: 'IN-GST-5', unit: 'packet', hsn: '0902', band: [300, 1200],
    brands: ['Tata', 'Red Label', 'Bru', 'Narasus', 'Leo', 'Local'],
    items: [['Tea dust', ['tea podi', 'டீ தூள்', 'chai']], ['Green tea', ['green tea']],
            ['Filter coffee', ['kaapi', 'காபி', 'coffee']], ['Instant coffee', ['instant coffee']],
            ['Health drink', ['health mix', 'sathu maavu']]],
    packs: [['100 g', 0.1, 'packet'], ['250 g', 0.25, 'packet'], ['500 g', 0.5, 'packet']] },

  { cat: 'Cold drinks', slab: 'IN-GST-28', unit: 'piece', hsn: '2202', band: [40, 95],
    brands: ['Bovonto', 'Kali Mark', 'Coca Cola', 'Pepsi', 'Sprite', 'Local'],
    items: [['Soft drink', ['cool drink', 'soda']], ['Soda', ['soda']], ['Energy drink', ['energy drink']]],
    packs: [['200 ml', 0.2, 'piece'], ['600 ml', 0.6, 'piece'], ['750 ml', 0.75, 'piece'], ['1.25 L', 1.25, 'piece'], ['2 L', 2, 'piece']] },

  { cat: 'Snacks', slab: 'IN-GST-12', unit: 'packet', hsn: '2106', band: [150, 500],
    brands: ['Haldiram', 'Aachi', 'Local', 'Grand Sweets', 'Bikano', 'A1'],
    items: [['Mixture', ['mixture', 'kaara boondhi']], ['Murukku', ['murukku', 'முறுக்கு']],
            ['Banana chips', ['vazhaikkai chips', 'வாழைக்காய் சிப்ஸ்']], ['Ribbon pakoda', ['ribbon pakoda']],
            ['Thattai', ['thattai', 'தட்டை']], ['Sev', ['sev']], ['Peanut candy', ['kadalai mittai']]],
    packs: [['100 g', 0.1, 'packet'], ['200 g', 0.2, 'packet'], ['400 g', 0.4, 'packet']] },

  { cat: 'Biscuits', slab: 'IN-GST-18', unit: 'packet', hsn: '1905', band: [110, 350],
    brands: ['Britannia', 'Parle', 'Sunfeast', 'Unibic', 'Local'],
    items: [['Marie biscuit', ['biscuit', 'biskoth']], ['Glucose biscuit', ['glucose']], ['Cream biscuit', ['cream biscuit']],
            ['Rusk', ['rusk']], ['Cookies', ['cookies']]],
    packs: [['75 g', 0.075, 'packet'], ['150 g', 0.15, 'packet'], ['250 g', 0.25, 'packet'], ['family pack', 1, 'packet']] },

  { cat: 'Personal care', slab: 'IN-GST-18', unit: 'piece', hsn: '3401', band: [400, 1200],
    brands: ['Santoor', 'Lifebuoy', 'Colgate', 'Clinic Plus', 'Dabur', 'Patanjali', 'Medimix'],
    items: [['Bath soap', ['soap', 'sabun']], ['Toothpaste', ['paste', 'pal podi']], ['Tooth powder', ['pal podi']],
            ['Shampoo sachet', ['shampoo']], ['Shampoo bottle', ['shampoo']], ['Hair oil', ['thalai ennai', 'தலை எண்ணெய்']],
            ['Talcum powder', ['powder']], ['Face wash', ['face wash']]],
    packs: [['6 ml', 0.006, 'piece'], ['50 g', 0.05, 'piece'], ['100 g', 0.1, 'piece'], ['150 g', 0.15, 'piece'], ['200 ml', 0.2, 'piece']] },

  { cat: 'Cleaning', slab: 'IN-GST-18', unit: 'piece', hsn: '3402', band: [80, 400],
    brands: ['Surf', 'Rin', 'Vim', 'Harpic', 'Lizol', 'Local', 'Ujala'],
    items: [['Detergent bar', ['soap bar', 'washing soap']], ['Detergent powder', ['washing powder']],
            ['Dishwash liquid', ['dishwash', 'vessel wash']], ['Dishwash bar', ['vim bar']],
            ['Floor cleaner', ['phenyl']], ['Toilet cleaner', ['toilet cleaner']], ['Bleach', ['bleach']]],
    packs: [['200 g', 0.2, 'piece'], ['500 g', 0.5, 'piece'], ['500 ml', 0.5, 'piece'], ['1 kg', 1, 'piece'], ['1 L', 1, 'litre']] },

  { cat: 'Home', slab: 'IN-GST-12', unit: 'packet', hsn: '3406', band: [20, 95],
    brands: ['Cycle', 'Mangaldeep', 'Local', 'Sri', 'Moksh'],
    items: [['Agarbatti', ['ஊதுபத்தி', 'incense', 'sambrani']], ['Camphor', ['pachai karpooram', 'கற்பூரம்']],
            ['Match box', ['theepetti', 'தீப்பெட்டி', 'matches']], ['Candle', ['candle', 'mezhuguvarthi']],
            ['Cotton wick', ['thiri', 'திரி']], ['Pooja oil', ['vilakku ennai', 'விளக்கு எண்ணெய்']]],
    /* ⚠️ HOME IS THE ONE HETEROGENEOUS SHELF: a match box and a litre of lamp oil are both "Home" and are not within an order of
       magnitude of each other. One per-unit band cannot serve both, so the PACK carries the difference — a match box is a fifth
       of a notional unit, a pack of six candles a little over one. Without this a match box priced at Rs 32.50, which is the
       kind of number that makes a shopkeeper stop believing the whole screen. */
    packs: [['small', 0.2, 'packet'], ['20 sticks', 0.5, 'packet'], ['pack of 6', 1.2, 'packet'], ['100 g', 0.4, 'packet']] },
];

/* ── barcodes: real EAN-13, check digit and all, so a scanner has something honest to read ─────────────────── */
function ean13(n) {
  const body = ('890' + String(n).padStart(9, '0')).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  return body + String((10 - (sum % 10)) % 10);
}

/**
 * ⚠️⚠️ THE BAND IS A PRICE PER UNIT, AND THE PACK MULTIPLIES IT. Two wrong answers preceded this one, and the second was worse
 * than the first because it looked plausible:
 *   1st  base × mult^0.72 with no bound → a 25 kg bag of rice at Rs 30,214.
 *   2nd  the same, clamped to the band's top → no absurd numbers, but 804 of 1,279 rice products priced IDENTICALLY at the
 *        ceiling, 145 of 558 oils, 107 of 650 pulses. A whole category sharing one price is not scale data; it is one row
 *        repeated, which is exactly what made the last 10,000 worthless.
 * The mistake both times was treating the band as "what this category costs", which is not a thing a category has. Rice costs
 * about Rs 90 A KILO; a 25 kg bag is 25 of those. So the band is per unit, the pack multiplies it linearly, and a small
 * per-product jitter keeps two shops' worth of rows from landing on the same number. Nothing needs clamping, because nothing
 * compounds.
 */
function priceFor(band, mult, salt) {
  const perUnit = band[0] + ((salt * 37) % Math.max(1, band[1] - band[0]));
  const jitter = 0.92 + ((salt * 13) % 17) / 100;          /* ±8%, so a shelf is not an arithmetic sequence */
  const p = perUnit * Math.max(mult, 0.001) * jitter;
  /* to the nearest 50 paise under Rs 100, the nearest rupee above it — the way prices are actually written on a shelf */
  return p < 100 ? Math.max(2, Math.round(p * 2) / 2) : Math.round(p);
}

const out = [];
let seq = 0, made = 0;

/* round-robin the categories so 10,000 rows are not 10,000 vegetables */
outer:
for (let round = 0; made < WANT; round++) {
  let addedThisRound = 0;
  for (const g of SHELF) {
    for (const brand of g.brands) {
      for (const [item, syn] of g.items) {
        for (const [packLabel, mult, unit] of g.packs) {
          if (made >= WANT) break outer;
          const r = round;                             /* later rounds become variants, so names stay unique */
          const variant = r === 0 ? '' : (r === 1 ? ' (economy)' : r === 2 ? ' (premium)' : ' (pack ' + r + ')');
          const name = (brand === 'Local' ? '' : brand + ' ') + item + (packLabel ? ' ' + packLabel : '') + variant;
          seq++;
          const price = priceFor(g.band, mult * (r === 2 ? 1.35 : r === 1 ? 0.85 : 1), seq);
          const mrp = Math.round(price * (1.08 + ((seq % 17) / 100)) * 2) / 2;
          out.push({
            name,
            code: g.cat.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, '') + '-' + String(seq).padStart(5, '0'),
            unit,
            price,
            mrp,
            hsn: g.hsn,
            tax_slab: g.slab,
            category: g.cat,
            brand: brand === 'Local' ? 'Local' : brand,
            barcode: ean13(seq),
            synonyms: syn.concat(brand === 'Local' ? [] : [brand.toLowerCase() + ' ' + item.toLowerCase()]),
            /* ⚠️ a real shelf is not all in stock — roughly one in fourteen is out, so short-pick and the health
               check have something true to report instead of a screen that always looks perfect */
            avail: (seq % 14 === 0) ? 'unavailable' : 'available',
          });
          made++; addedThisRound++;
        }
      }
    }
  }
  if (!addedThisRound) break;
}

const F = path.join(__dirname, 'tallytest-10k.json');
fs.writeFileSync(F, JSON.stringify(out));
const slabs = {}, cats = {}, units = {};
out.forEach((p) => { slabs[p.tax_slab] = (slabs[p.tax_slab] || 0) + 1; cats[p.category] = (cats[p.category] || 0) + 1; units[p.unit] = (units[p.unit] || 0) + 1; });
console.log(out.length + ' products → ' + F);
console.log('  slabs      :', JSON.stringify(slabs));
console.log('  categories :', Object.keys(cats).length);
console.log('  units      :', JSON.stringify(units));
console.log('  unavailable:', out.filter((p) => p.avail !== 'available').length);
console.log('  names uniq :', new Set(out.map((p) => p.name)).size);
console.log('  codes uniq :', new Set(out.map((p) => p.code)).size);
console.log('  barcodes   :', new Set(out.map((p) => p.barcode)).size);
console.log('  price range: Rs ' + Math.min(...out.map((p) => p.price)) + ' – Rs ' + Math.max(...out.map((p) => p.price)));
