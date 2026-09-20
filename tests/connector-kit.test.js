/**
 * connector-kit.test.js — THE KIT SHIPS BLANKS, NOT PLACEHOLDERS (2026-09-07, Athi's first live Zoho run).
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

/**
 * ⭐ IGST OR CGST+SGST (2026-09-07, the first live invoice: "Zoho 400 IGST has to be applied as this is an interstate transaction").
 * A Zoho India organisation carries both — tax GROUPS GST5…GST40 for a supply inside the state, single taxes IGST5…IGST40 for one that
 * leaves it — and asking by rate alone picks whichever comes first. The adapter is driven here against a stubbed Zoho.
 */
const TAXES = { taxes: [{ tax_id: 'g18', tax_name: 'GST18', tax_percentage: 18, tax_type: 'tax_group' }, { tax_id: 'i18', tax_name: 'IGST18', tax_percentage: 18, tax_type: 'tax', tax_specific_type: 'igst' }] };
const ORG = { organization: { name: 'Seller', tax_settings: { tax_reg_no: '33AABCK1234F1Z6' } } };   /* Tamil Nadu */
function stubZoho(seen) {
  return async (url, opt) => {
    const u = String(url), body = opt && opt.body ? JSON.parse(opt.body) : null;
    const j = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
    if (u.includes('/settings/taxes')) return j(TAXES);
    if (u.includes('/organizations/')) return j(ORG);
    if (u.includes('/contacts') && (!opt || opt.method !== 'POST')) return j({ contacts: [{ contact_id: 'c1', contact_name: body ? '' : 'x' }] });
    if (u.includes('/contacts')) return j({ contact: { contact_id: 'c1' } });
    if (u.includes('/invoices')) { seen.push(body); return j({ invoice: { invoice_number: 'INV-1', invoice_id: 'iv1' } }); }
    return j({});
  };
}
const order = (state_code) => ({ chit_id: 'aaaaaaaa-bbbb', buyer: 'Buyer', at: '2026-09-07T00:00:00Z', total: 118,
  lines: [{ name: 'Thing', qty: 1, price: 100, total: 100, gst_rate: 18 }],
  b2b: { buyer: { name: 'Buyer', gstin: state_code + 'ABCDE1234F1Z5', state_code }, place_of_supply: state_code,
         taxes: state_code === '33' ? { cgst: 9, sgst: 9, igst: 0 } : { cgst: 0, sgst: 0, igst: 18 }, items: [] } });

/**
 * ── ⚠️⚠️⚠️ THE ZIP MUST CARRY WHAT THE ZIP'S PROGRAMS NEED ([TILL-126]) ───────────────────
 *
 * Two files were missing from KIT_NAMES and both were INVISIBLE from a developer's machine, because the files
 * sit in this repo whether or not the download carries them. The counter ran perfectly here and a fresh
 * download would not have started at all:
 *
 *   · rollup.js   — till.js has required it since [TILL-122]. "Cannot find module './rollup'", on line one.
 *   · counter.cmd — [TILL-118]'s double-click launcher, and the target of the desktop shortcut it installs.
 *                   Shipped as a shortcut pointing at a file that was never in the zip.
 *
 * ⚠️ A HAND-KEPT LIST IS HOW BOTH HAPPENED, so this does not check a list against another list — it reads
 * what the kit's programs ACTUALLY require and insists the zip carries each one.
 */
{
  const KIT = path.join(__dirname, '..', 'tools', 'tally-connector');
  const NAMES = (function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'integrations.js'), 'utf8');
    const m = /const KIT_NAMES = \[([\s\S]*?)\]/.exec(src);
    assert.ok(m, 'KIT_NAMES is gone from routes/integrations.js — this guard is measuring nothing');
    return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  })();

  /* ⚠️ every LOCAL require in each program the kit ships must name a file the kit also ships */
  for (const prog of ['till.js', 'index.js', 'setup.js', 'core.js']) {
    if (NAMES.indexOf(prog) < 0) continue;
    const src = fs.readFileSync(path.join(KIT, prog), 'utf8');
    /* ⚠️ comments stripped first — a guard that reads prose as code has bitten this codebase four times */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const m of code.matchAll(/require\(\s*'\.\/([A-Za-z0-9_.-]+)'\s*\)/g)) {
      const want = m[1].endsWith('.js') ? m[1] : m[1] + '.js';
      try {
        assert.ok(NAMES.indexOf(want) >= 0,
          prog + " requires './" + m[1] + "' and the kit does not ship " + want
          + ' — a downloaded kit would die with "Cannot find module". Add it to KIT_NAMES.');
        pass++; console.log('  ok  the kit ships ' + want + ', which ' + prog + ' requires');
      } catch (e) { console.log('  FAIL ' + e.message); process.exitCode = 1; }
    }
  }

  /* ⚠️ and the launcher the installed shortcut points AT ([TILL-118]) */
  for (const need of ['counter.cmd', 'start.cmd']) {
    try {
      assert.ok(NAMES.indexOf(need) >= 0, 'the kit does not ship ' + need + ' — the desktop shortcut points at it');
      pass++; console.log('  ok  the kit ships ' + need);
    } catch (e) { console.log('  FAIL ' + e.message); process.exitCode = 1; }
  }

  /* ⚠️ and nothing on the list may be missing from disk, or the zip is quietly short a file */
  for (const n of NAMES) {
    try {
      assert.ok(fs.existsSync(path.join(KIT, n)), 'KIT_NAMES lists ' + n + ' and it is not on disk — kitFiles() skips it in silence');
      pass++;
    } catch (e) { console.log('  FAIL ' + e.message); process.exitCode = 1; }
  }
  console.log('  ok  all ' + NAMES.length + ' kit files exist on disk');
}

(async () => {
  const make = require('../tools/tally-connector/adapters/zoho.js');
  const real = global.fetch;
  for (const [what, code, want] of [['a buyer in another state gets the IGST tax', '29', 'i18'], ['a buyer in the same state gets the CGST+SGST group', '33', 'g18']]) {
    const seen = []; global.fetch = stubZoho(seen);
    const ad = make({ zoho: { base: 'https://www.zohoapis.com', org: '1', token: 't' }, log: () => {} });
    await ad.pushOrder(order(code));
    try { assert.strictEqual(seen[0].line_items[0].tax_id, want); pass++; console.log('  ok  ' + what); }
    catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; }
  }
  global.fetch = real;
  console.log(pass + ' checks');
})();
