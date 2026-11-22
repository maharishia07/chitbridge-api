'use strict';
/* WALK I I-F-06 (21 Nov 2026): a VAT-registered AE shop must inherit the UAE's standard-rate slab (Federal Decree-Law 8/2017 Art. 3: 5%) from the regional
   layer, as IN does (b201), instead of having none and billing at 0%. The migration b892 carries the layer block; this test reads it exactly as the
   server reads region_layer, through lib/tax-governance.slabsFromLayer, and checks it against the pack's own standard_rate. Run: node tests/walki-ae-vat-slab.test.cjs */
const fs = require('fs'), path = require('path'), assert = require('assert');
const HERE = path.join(__dirname, '..');
const TG = require(path.join(HERE, 'lib', 'tax-governance'));
const sql = fs.readFileSync(path.join(HERE, 'migrations', 'b892_ae_vat_standard_slab.sql'), 'utf8');
const m = /\$json\$([\s\S]*?)\$json\$/.exec(sql);
let n = 0; const ok = (c, msg) => { assert(c, msg); n++; console.log('  ok  ' + msg); };
ok(!!m, 'the migration carries one jsonb block');
const jurisdiction = JSON.parse(m[1]);
const rows = TG.slabsFromLayer({ region_code: 'AE', jurisdiction }, 'AE');
ok(rows.length === 1, 'one governed slab for AE');
ok(rows[0].definition_id === 'AE-VAT-5' && TG.isGovernedId('AE-VAT-5'), 'id AE-VAT-5 is a governed id (never a uuid)');
ok(rows[0].rules.rate === 5 && rows[0].rules.scheme === 'VAT' && rows[0].name === 'VAT 5%', 'rate 5, scheme VAT, name "VAT 5%"');
/* hand figure in fils: AED 100.00 incl. VAT 5% -> 10000 * 5 / 105 = 476.19 -> 476 fils VAT, 9524 net */
const gross = 10000, vat = Math.round((gross * rows[0].rules.rate) / (100 + rows[0].rules.rate));
ok(vat === 476 && gross - vat === 9524, 'AED 100.00 inclusive -> VAT 476 fils, net 9524 fils');
const packs = require(path.join(HERE, 'lib', 'tax-packs'));
const pack = (packs.packFor && packs.packFor('AE')) || null;
ok(pack && Number(pack.standard_rate) === rows[0].rules.rate, 'the slab equals the AE pack standard_rate (' + (pack && pack.standard_rate) + ')');
ok(/ROLL BACK/.test(sql) && /NOT RUN anywhere/.test(sql), 'the file says it is not run and how to roll back');
console.log(n + ' passed');
