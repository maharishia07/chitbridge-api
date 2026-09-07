/**
 * THE KIT SHIPS BLANKS, NOT PLACEHOLDERS (2026-09-07, Athi's first live Zoho run).
 * connector.json used to ship zoho.org = "YOUR ORGANISATION ID". A placeholder is truthy, so setup's "which organisation?" question
 * never ran and every Zoho call came back `Invalid value passed for organization_id` — the connector read nothing, wrote nothing, and
 * could not even auto-approve (no organisation → no GSTIN → no facts to match). Source-level, no DB, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0; const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— the downloaded kit —');

it('the shipped connector.json carries no "YOUR …" placeholder in any adapter block', () => {
  const s = read('routes/integrations.js');
  const i = s.indexOf('const cfg = { api: base'); assert.ok(i > 0, 'the kit config literal moved');
  const block = s.slice(i, s.indexOf('const files =', i));
  const bad = block.split('\n').filter((l) => /:\s*'YOUR /.test(l));
  assert.deepStrictEqual(bad, [], 'placeholder value(s) in the kit config: ' + bad.join(' | '));
});

it('setup keeps an organisation id only when Zoho itself listed it', () => {
  const s = read('tools/tally-connector/setup.js');
  assert.ok(s.includes('const listed = (id) => orgs.some('), 'the organisation picker no longer checks the id against the list');
  assert.ok(!s.includes("let org = zo.org || (orgs.length === 1"), 'the old "any stored value wins" line is back');
});

it('a failed "Checking Zoho Books" stops setup instead of saving settings that cannot work', () => {
  const s = read('tools/tally-connector/setup.js');
  const i = s.indexOf('Checking Zoho Books');
  assert.ok(i > 0 && s.slice(i, i + 1400).includes('Save the settings anyway and try later?'), 'the check failure is still silent');
});

it('the Zoho profile reads the GSTIN where Zoho India keeps it (tax_settings.tax_reg_no)', () => {
  const s = read('tools/tally-connector/adapters/zoho.js');
  assert.ok(/tax_settings && \(o\.tax_settings\.tax_reg_no/.test(s), 'readProfile does not read tax_reg_no — the handshake will have no GSTIN to match');
});

it('the Zoho failure table names the organisation_id error', () => {
  assert.ok(read('tools/tally-connector/docs/zoho.md').includes('Invalid value passed for organization_id'), 'docs/zoho.md has no row for it');
});

console.log(pass + ' checks');
