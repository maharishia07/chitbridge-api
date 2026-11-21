/**
 * startfix-one-shop-name.test.cjs — A-F-66 (Walk A 21 Nov): the business name typed in Print setup (the vault's signature trade_name) IS the shop's
 * display_name — one name for the header, Home and the bill. profile.mirrorIdentity_ writes it through; nothing else changes.
 * No database (db.query is stubbed). Run: node tests/startfix-one-shop-name.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const db = require(path.join(API, 'db'));
const P = require(path.join(API, 'lib', 'profile'));
const sig = (v) => ({ sections: [{ type: 'signature', rows: [{ tag: 'trade_name', value: v }, { tag: 'footer', value: 'Thanks' }] }] });

(async () => {
  console.log('\n══ A-F-66 · one shop name ══\n');
  eq('the printed name is read from the signature section', P.signatureNameOf(sig('  Walk A Coffee Supplies ')), 'Walk A Coffee Supplies');
  eq('one letter is no name', P.signatureNameOf(sig('W')), '');
  eq('no signature: no name', P.signatureNameOf({ sections: [] }), '');
  const ran = [];
  db.query = async (text, params) => { ran.push([String(text), params]); return /^SELECT/.test(text) ? { rows: [{ country: 'AU', gstn: null, address: null, display_name: 'cbt-wka-au-xokt9' }] } : { rows: [], rowCount: 1 }; };
  await P.mirrorIdentity_('e1', sig('Walk A Coffee Supplies'));
  const upd = ran.filter((r) => /UPDATE identities SET display_name/.test(r[0]));
  eq('a typed Print-setup name is written to display_name', upd.map((r) => r[1]), [['Walk A Coffee Supplies', 'e1']]);
  ran.length = 0;
  db.query = async (text) => { ran.push(String(text)); return /^SELECT/.test(text) ? { rows: [{ country: 'AU', gstn: null, address: null, display_name: 'Walk A Coffee Supplies' }] } : { rows: [] }; };
  await P.mirrorIdentity_('e1', sig('Walk A Coffee Supplies'));
  eq('the same name is not written again', ran.filter((r) => /UPDATE/.test(r)).length, 0);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
