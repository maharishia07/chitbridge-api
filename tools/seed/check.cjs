/*
 * OWNS      the slab and category spread count of the Tally test catalogue
 * CALLED BY by hand (node tools/seed/check.cjs); nothing in the repo requires it
 * FLOW      reads tallytest-catalogue.json, counts the products per tax slab and per category and the Tamil names, prints the tallies
 * CARD      06-catalogue-pim/README
 */
const a = require('./tallytest-catalogue.json');
const s = {}; a.forEach(p => s[p.tax_slab] = (s[p.tax_slab] || 0) + 1);
const c = {}; a.forEach(p => c[p.category] = (c[p.category] || 0) + 1);
const TAMIL = /[஀-௿]/;
console.log(a.length + ' products');
console.log('slabs      :', JSON.stringify(s));
console.log('categories :', Object.keys(c).length, '→', Object.keys(c).join(', '));
console.log('units      :', [...new Set(a.map(p => p.unit))].join(', '));
console.log('Tamil words:', a.filter(p => p.synonyms.some(x => TAMIL.test(x))).length);
console.log('barcodes   :', new Set(a.map(p => p.barcode)).size, 'unique');
console.log('codes      :', new Set(a.map(p => p.code)).size, 'unique');
console.log('unavailable:', a.filter(p => p.avail !== 'available').length);
