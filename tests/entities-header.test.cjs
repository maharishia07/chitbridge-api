'use strict';
/**
 * entities-header.test.cjs — N19: GET /api/entities/header is ONE read, bands and words come from data.
 *  - planted entity_compliance rows -> bands (ok / due / soon / gone); a licence with no rule -> days only, never a penalty
 *  - an unverified PHONE document -> the "Phone verified" check is false; verified -> true
 *  - the FSSAI fee rule is marked verified:false with an empty source and carries no amount
 *  - X-DB-Trips <= 3 through the real route (db stubbed: counts trips, readBatch = one)
    const warm = await get(); t("a warm read (probes cached) is ONE trip", warm.trips === 1, warm.trips + " used");
 * Run: node tests/entities-header.test.cjs   · no DB, no network.
 */
const path = require('path');
const fs = require('fs');
const API = path.join(__dirname, '..');
const DAY = 86400000, iso = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

let trips = 0, planted = {};
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);
const rowsFor = (sql) => {
  if (/FROM information_schema/.test(sql)) return [{ column_name: 'policy_flags' }, { '?column?': 1 }];
  if (/FROM identities WHERE identity_id/.test(sql)) return [planted.me];
  if (/FROM entity_profile/.test(sql)) return [{ sectors: planted.sectors || [], vault: null }];
  if (/FROM entity_compliance/.test(sql)) return planted.compliance;
  if (/FROM identity_documents/.test(sql)) return planted.docs;
  return [];
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql) => { trips += 1; const r = rowsFor(String(sql)); return { rows: r, rowCount: r.length }; },
  readBatch: async (id, actor, stmts) => { stmts.forEach((s) => realDb.inlineSql(s.text, s.params)); trips += 1; return stmts.map((s) => ({ rows: rowsFor(s.text) })); },
}) };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (r) => r.identity, forgetKey: () => {}, keyAlive: async () => true }) };

let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name + (extra ? '   ' + extra : '')); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };

const comp = (std, doc, days) => ({ standard_key: std, doc_key: doc, status: 'gathered', evidence_ref: null, valid_until: days == null ? null : iso(days), verification: {} });
const base = () => ({
  me: { display_name: 'Kumar Stores', address: '12 Mill Rd', phone: '+919800000001', gstn: '33ABCDE1234F1Z5', country: 'IN', vertical: 'general', policy_flags: {} },
  sectors: ['stationery'],
  compliance: [comp('IN-FSSAI', 'licence', 200), comp('IN-DRUG', 'licence', 100), comp('IN-SHOPS-ACT', 'registration', 40), comp('IN-OLD-FSSAI', 'fssai_licence', -5), comp('VILLAGE-NOC', 'noc', 10)],
  docs: [{ scheme: 'PHONE', status: 'pending', verified_at: null }],
});

const express = require('express');
const app = express();
app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
const srv = app.listen(0, '127.0.0.1', async () => {
  try {
    const get = async () => { trips = 0; const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/entities/header`); const j = await r.json(); return { status: r.status, j, trips }; };
    const ck = (r, k) => r.j.trade_ready.checks.find((c) => c.key === k).done;

    planted = base();
    const a = await get();
    t('answers 200 with business, licences, trade_ready', a.status === 200 && a.j.business && Array.isArray(a.j.licences) && a.j.trade_ready, String(a.status));
    t('business: name, legal_name, address, phone', a.j.business.name === 'Kumar Stores' && 'legal_name' in a.j.business && a.j.business.address === '12 Mill Rd' && a.j.business.phone === '+919800000001');
    const by = (s) => a.j.licences.find((l) => l.scheme === s);
    t('every licence has the shell keys', a.j.licences.every((l) => ['scheme', 'label', 'number_masked', 'valid_until', 'days_left', 'band', 'core', 'renew_url'].every((k) => k in l)));
    t('band ok beyond 120 days', by('FSSAI').band === 'ok' && by('FSSAI').days_left >= 199, String(by('FSSAI').days_left));
    t('band due at 91..120 days', by('DRUG').band === 'due', String(by('DRUG').days_left));
    t('band soon at 0..90 days', by('SHOP').band === 'soon', String(by('SHOP').days_left));
    const gone = a.j.licences.find((l) => l.days_left < 0);
    t('band gone when expired, with the fee sentence and no amount', gone.band === 'gone' && /late fee/i.test(gone.note) && !/\d/.test(gone.note) && !/₹|Rs/i.test(gone.note), gone.note);
    const noRule = by('VILLAGE-NOC');
    t('a licence with no rule shows days only: no band, no note, no renew', noRule.days_left <= 10 && noRule.band === null && noRule.note === null && noRule.renew_url === null && noRule.rule_verified === null);
    t('a soon licence carries no penalty sentence (only the rule says when)', by('SHOP').note === null);
    t('a general-trade shop has no core licence', a.j.licences.every((l) => l.core === false));
    t('trade_ready has the four checks', a.j.trade_ready.checks.length === 4 && a.j.trade_ready.checks.map((c) => c.key).join() === 'address,phone,pan,gstin');
    t('PHONE document unverified -> Phone verified is false', ck(a, 'phone') === false);
    t('GSTIN present -> GSTIN true; PAN read from it -> PAN on file true', ck(a, 'gstin') === true && ck(a, 'pan') === true);
    t('address only declared -> Address proven false; done false', ck(a, 'address') === false && a.j.trade_ready.done === false);
    t('X-DB-Trips <= 3', a.trips <= 3, a.trips + ' used');
    const warm = await get(); t("a warm read (probes cached) is ONE trip", warm.trips === 1, warm.trips + " used");

    planted = base();
    planted.docs = [{ scheme: 'PHONE', status: 'verified', verified_at: '2026-10-07T00:00:00Z' }, { scheme: 'PAN', status: 'verified', verified_at: '2026-10-07T00:00:00Z' }];
    planted.me.policy_flags = { profile_provenance: { address: { value: '12 Mill Rd', rung: 'checked' } } };
    const b = await get();
    t('PHONE verified -> true', ck(b, 'phone') === true);
    t('address with a checked rung -> proven; all four -> done', ck(b, 'address') === true && b.j.trade_ready.done === true);

    planted = base(); planted.docs = [{ scheme: 'PHONE', status: 'verified', verified_at: null }];
    const c = await get();
    t('a verified-status row WITHOUT a stamp is not verified', ck(c, 'phone') === false);

    /* the vertical decides core: a food shop expects FSSAI */
    planted = base(); planted.sectors = ['grocery'];
    const d = await get();
    const f = d.j.licences.find((l) => l.scheme === 'FSSAI');
    t('food vertical: a held FSSAI is core', f.core === true && f.band === 'ok');
    planted = base(); planted.sectors = ['grocery']; planted.compliance = [];
    const e = await get();
    const nf = e.j.licences.find((l) => l.scheme === 'FSSAI');
    t('food shop holding none: core FSSAI listed with no date', !!nf && nf.core === true && nf.days_left === null && nf.band === null && nf.valid_until === null);
    planted = base(); planted.sectors = ['textile']; planted.compliance = [];
    const g = await get();
    t('nothing held, nothing core -> an empty list, not an error', g.status === 200 && g.j.licences.length === 0);

    /* the rule file: country-keyed, nothing cited -> verify */
    const rules = require(path.join(API, 'lib', 'licence-rules'));
    t('rules are keyed by country', !!rules.RULES.IN && Array.isArray(rules.RULES.IN.schemes));
    const fssai = rules.RULES.IN.schemes.find((r) => r.scheme === 'FSSAI');
    t('FSSAI rule: verified:false and the source is empty', fssai.verified === false && fssai.source === '');
    t('every rule is marked verify (nothing is cited yet)', rules.RULES.IN.schemes.every((r) => r.verified === false && r.source === ''));
    const code = fs.readFileSync(path.join(API, 'lib', 'licence-rules.js'), 'utf8').split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n');
    t('no fee amount is hard-coded in the rules', !/₹|\bRs\b|\b100\b/.test(code.replace(/bands: DEFAULT_BANDS|due: 120|soon: 90/g, '')));
  } catch (e) { fail++; console.log('  FAIL the test ran   ' + (e && e.stack)); }
  console.log(`\n  ${pass} checks · ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
  srv.close();
});
