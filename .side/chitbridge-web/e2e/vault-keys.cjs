#!/usr/bin/env node
/**
 * e2e/vault-keys.cjs — SET-WALK1 · W25 (2026-10-15): the vault's KEY RULE is the same on both sides, pinned to the same examples.
 *
 * cap-shop.js vaultKeys / vaultPatch build the merge-patch the api applies over ITS keyed view (chitbridge-api lib/vault-patch.js keyed):
 * sections `type|label` (a repeat gets #2), rows `t:<tag>` else `n:<name>`. tests/vault-patch.test.cjs in the api pins the same three
 * examples — a key rule that drifts on one side writes a patch the other side cannot address. Offline: the functions are read out of the
 * file and run in a bare vm (no page). Run: node e2e/vault-keys.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-shop.js'), 'utf8');
const lift = (name) => { const m = src.match(new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n}\\n')); if (!m) throw new Error(name + ' not found in cap-shop.js'); return m[0]; };
const ctx = { UI: {}, console };
vm.createContext(ctx);
vm.runInContext(['vaultUniqueKey', 'vaultKeys', 'vaultRowBody', 'vaultRowSame', 'vaultNewSectionPatch', 'vaultRowsPatch', 'vaultPatch'] /* vaultPatch was split into these two (MNT) */.map(lift).join('\n'), ctx);

let pass = 0, fail = 0;
const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(80) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want))); };
const VAULT = [
  { type: 'identity', label: '', rows: [{ name: 'Legal name', tag: 'legal_name', value: 'Fixture Pty Ltd' }, { name: 'Phone', tag: 'phone', value: '02 9000 0000' }, { name: 'Shop colour', value: 'green' }] },
  { type: 'bank', label: 'Export receipts', rows: [{ name: 'IBAN', tag: 'iban', value: 'AU11' }] },
  { type: 'bank', label: 'Export receipts', rows: [{ name: 'IBAN', tag: 'iban', value: 'AU22' }] },
];
console.log('\n-- W25: the key rule, the api\'s twin --\n');
const K = ctx.vaultKeys(VAULT);
t('sections keyed type|label; a repeat gets #2', Object.keys(K), ['identity|', 'bank|Export receipts', 'bank|Export receipts#2']);
t('rows keyed t:<tag>, else n:<name>', Object.keys(K['identity|'].rows), ['t:legal_name', 't:phone', 'n:Shop colour']);
console.log('\n-- W25: the patch carries only what moved --\n');
const now = JSON.parse(JSON.stringify(VAULT)); now[0].rows[0].value = 'Austore One Pty Ltd';
t('one changed row → one section, one row, the version-less body the page then wraps', ctx.vaultPatch(VAULT, now), { sections: { 'identity|': { rows: { 't:legal_name': { name: 'Legal name', value: 'Austore One Pty Ltd', tag: 'legal_name' } } } } });
t('nothing moved → null (the page says "Nothing to save.")', ctx.vaultPatch(VAULT, JSON.parse(JSON.stringify(VAULT))), null);
const less = JSON.parse(JSON.stringify(VAULT)); less[0].rows.splice(2, 1); less.splice(2, 1);
t('a removed row and a removed section travel as null', ctx.vaultPatch(VAULT, less), { sections: { 'bank|Export receipts#2': null, 'identity|': { rows: { 'n:Shop colour': null } } } });
const more = JSON.parse(JSON.stringify(VAULT)); more.push({ type: 'licence', label: '', rows: [{ name: 'ABN', tag: 'abn', value: '51 824 753 556' }] });
t('a new section travels whole', ctx.vaultPatch(VAULT, more), { sections: { 'licence|': { type: 'licence', label: '', rows: { 't:abn': { name: 'ABN', value: '51 824 753 556', tag: 'abn' } } } } });
console.log('\n  ' + (pass + fail) + ' checks · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
