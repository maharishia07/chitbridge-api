'use strict';
/**
 * tests/settings-truth.realstack.cjs — SETTINGS TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §14 "Settings").
 *
 * SET-2. Principles: GOV layers are tighten-only · a refused value says so in words (never "Profile updated" over a value that was dropped) ·
 * the server decides country and vertical, a screen never sends a guess · a shop sees the choices its country pack has, in its words.
 * SE-02 a shop tries to LOOSEN what the base constitution bounds (a time zone outside allowed.timezones): refused with a sentence, or at least not a "saved" answer ·
 * SE-06 the KYB / readiness screen sends no vertical or origin of its own making (a static scan of the web files) ·
 * SE-08a an AU shop is offered the AU registration kinds, in the AU pack's words · SE-08b an India-only kind (composition) is refused with a sentence and a code ·
 * SE-08c no India-only word (GSTIN, PAN, CGST, composition, rupee) in the whole policy schema an AU shop is served.
 * SE-08d an AU shop's own kinds are accepted and stored, both ways (regular, then unregistered) ·
 * SE-09a the units a shop chooses are what the policy read offers every picker (policy.units, and the stored flag on /me) ·
 * SE-09b a junk unit is dropped, an empty choice is refused so the chosen set stands (400, in words) ·
 * SE-10a the resolved governance names where it came from (entity_stamp, not a fallback) and every basic sits inside the constitution's allowed envelope ·
 * SE-10b a malformed currency is refused in words and a currency outside allowed.currencies is refused 422 CURRENCY_NOT_ALLOWED with the allowed list; nothing is stored.
 * Not here: SE-04 leave without Save, SE-05 review-and-confirm, SE-07 no dev toolbar (all screens: they need a walk) ·
 *   SE-01 (a scan: policy-one-writer.test.cjs) · SE-03 (needs a co-assist SIGN-IN, not provable offline: settings-owner-gate.test.cjs holds it) ·
 *   SE-10 "cached" (the memo is internal and flipping the constitution needs a database write: conf-cache.test.cjs, govresolve-ctp.test.cjs).
 * A `gap:` FAIL is a RECORDED finding (SETTINGS-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY; the database is only read.
 * Break-tested 2026-10-19: each passing case was run once with its expectation flipped and went red.
 * Run: node tests/settings-truth.realstack.cjs   (one realstack file at a time on :3100; CB_WEB_DIR for SE-06, default C:/dev/chitbridge-web)
 * CARD 20-settings-governance-and-plan/README
 */
const fs = require('fs'), path = require('path');
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'setx' + (Date.now() % 1e8).toString(36);
const WEB = process.env.CB_WEB_DIR || 'C:/dev/chitbridge-web';
const UNITS_CHOSEN = ['kg', 'gram', 'litre'];          /* three of lib/policy.js FLAGS.units.options */
const UNIT_JUNK = 'not-a-unit';
const CURRENCY_MALFORMED = 'zz9';                       /* three characters, not letters: refused whatever the constitution says */
const CURRENCY_CANDIDATES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'NZD'];   /* the first one outside allowed.currencies is asked for */
const INDIA_ONLY = /GSTIN|\bPAN\b|CGST|SGST|IGST|composition|\bSEZ\b|India|\u20b9|\bINR\b/i;

(async () => {
  console.log('\n── settings truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const IN = await freshShop(RUN + 'a', 'Settings IN');

  await kase('SE-02', 'the base constitution bounds the time zones; a shop that asks for one outside them is told no (a sentence), not "Profile updated"', async () => {
    const me = ok(await j('/api/entities/me', { token: IN.token }), 'me').b, allowed = me.governance.allowed.timezones;
    expect(Array.isArray(allowed) && allowed.length && !allowed.includes('Asia/Tokyo'), 'premise: the active constitution (' + me.governance.constitution + ') should bound timezones without Tokyo, saw ' + JSON.stringify(allowed));
    const r = await j('/api/entities/profile', { method: 'PATCH', token: IN.token, body: { timezone: 'Asia/Tokyo' } });
    const after = ok(await j('/api/entities/me', { token: IN.token }), 'me again').b.entity.timezone;
    expect(after !== 'Asia/Tokyo', 'LOOSENED: the stored zone is now ' + after);
    expect(r.status >= 400 && r.status < 500 && /\w{4,}/.test(r.b.message || r.b.error || ''), 'the value was not stored (zone is still ' + after + ') but the answer was ' + r.status + ' ' + JSON.stringify(r.b) + ' — a screen shows "saved"');
  }, 'PATCH /api/entities/profile drops a timezone outside allowed.timezones and answers 200 "Profile updated" (whitelist drops silently); country-setup refuses a zone in words (COUNTRY_SETUP_ZONE), the profile door does not');

  await kase('SE-06', 'the KYB / readiness screen sends no vertical or origin of its own making: no `||\'paint\'` / `||\'IN\'` fallback in its request', async () => {
    const file = path.join(WEB, 'public', 'app', 'cap-readiness.js');
    expect(fs.existsSync(file), 'no web checkout at ' + WEB + ' (set CB_WEB_DIR)');
    const guesses = fs.readFileSync(file, 'utf8').split('\n').map((t, i) => [i + 1, t]).filter(([, t]) => /\|\|\s*'(paint|IN)'/.test(t));
    expect(guesses.length === 0, guesses.length + ' lines of public/app/cap-readiness.js invent a vertical or origin (lines ' + guesses.map(([n]) => n).slice(0, 8).join(', ') + ')');
  }, 'VB4: cap-readiness.js defaults the sector to paint and the origin to IN in lanes / readinessOwn / standards-suggest requests; the server should answer from the constitution and country');

  const AU = await freshShop(RUN + 'c', 'Settings AU');
  ok(await j('/api/governance/country-setup', { method: 'PUT', token: AU.token, body: { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } } }), 'AU country');
  const policy = ok(await j('/api/entities/policy', { token: AU.token }), 'policy').b;

  await kase('SE-08a', 'an AU shop is offered the AU registration kinds only, in the AU words (GST registered · Not registered)', async () => {
    const ui = policy.schema.gst_registration.ui;
    expect(JSON.stringify(ui.options) === '["regular","unregistered"]' && /GST registered/.test(ui.labels.regular) && /Not registered/.test(ui.labels.unregistered), 'offered ' + JSON.stringify(ui.options) + ' labels ' + JSON.stringify(ui.labels));
  });
  await kase('SE-08b', 'India\'s "composition" is refused for an AU shop with a code and a sentence that says what to choose', async () => {
    const r = await j('/api/entities/policy', { method: 'PATCH', token: AU.token, body: { gst_registration: 'composition' } });
    expect(r.status === 400 && r.b.code === 'REG_KIND_NOT_OFFERED' && /GST registered/.test(r.b.message || ''), 'answered ' + r.status + ' ' + JSON.stringify(r.b));
  });
  await kase('SE-08c', 'the policy schema an AU shop is served carries no India-only word, in any label, help or option', async () => {
    const inPolicy = ok(await j('/api/entities/policy', { token: IN.token }), 'IN policy').b;
    expect(INDIA_ONLY.test(JSON.stringify(inPolicy.schema.gst_registration.ui)), 'premise: the same words must be found in an India shop schema, or the scan proves nothing');
    const s = JSON.stringify({ schema: policy.schema, country: policy.country });
    const hits = [...new Set((s.match(new RegExp(INDIA_ONLY, 'gi')) || []).map((x) => x.toLowerCase()))];
    const where = Object.entries(policy.schema).filter(([, v]) => INDIA_ONLY.test(JSON.stringify(v && v.ui ? [v.ui.label, v.ui.help, v.ui.labels, v.ui.options] : ''))).map(([k]) => k);
    expect(!hits.length || !where.length, 'India-only words ' + JSON.stringify(hits) + ' in the UI text of: ' + where.join(', '));
  });

  await kase('SE-08d', 'an AU shop\'s own registration kinds are accepted and stored, both ways', async () => {
    for (const kind of ['regular', 'unregistered']) {
      const r = await j('/api/entities/policy', { method: 'PATCH', token: AU.token, body: { gst_registration: kind } });
      const stored = ok(await j('/api/entities/policy', { token: AU.token }), 'policy again').b.flags.gst_registration;
      expect(r.status === 200 && r.b.flags.gst_registration === kind && stored === kind, kind + ' answered ' + r.status + ' ' + JSON.stringify(r.b) + ' and the read says ' + stored);
    }
  });

  await kase('SE-09a', 'the units a shop chooses are what the policy read offers: the same set, on the policy and on /me', async () => {
    const r = await j('/api/entities/policy', { method: 'PATCH', token: IN.token, body: { units: UNITS_CHOSEN } });
    const read = ok(await j('/api/entities/policy', { token: IN.token }), 'policy').b.flags.units;
    const onMe = ok(await j('/api/entities/me', { token: IN.token }), 'me').b.entity.policy_flags.units;
    const want = JSON.stringify(UNITS_CHOSEN);
    expect(r.status === 200 && JSON.stringify(r.b.flags.units) === want && JSON.stringify(read) === want && JSON.stringify(onMe) === want,
      'asked ' + want + ' · patch ' + r.status + ' ' + JSON.stringify(r.b.flags && r.b.flags.units) + ' · policy ' + JSON.stringify(read) + ' · /me ' + JSON.stringify(onMe));
  });
  await kase('SE-09b', 'a junk unit is dropped from the choice, and an empty choice is refused in words so the chosen set stands', async () => {
    const mixed = await j('/api/entities/policy', { method: 'PATCH', token: IN.token, body: { units: [UNIT_JUNK, 'kg', 'litre', 'kg'] } });
    expect(mixed.status === 200 && JSON.stringify(mixed.b.flags.units) === JSON.stringify(['kg', 'litre']), 'junk and a repeat should leave ["kg","litre"], saw ' + mixed.status + ' ' + JSON.stringify(mixed.b));
    const empty = await j('/api/entities/policy', { method: 'PATCH', token: IN.token, body: { units: [] } });
    const after = ok(await j('/api/entities/policy', { token: IN.token }), 'policy').b.flags.units;
    expect(empty.status === 400 && /\w{4,}/.test(empty.b.message || ''), 'an empty choice answered ' + empty.status + ' ' + JSON.stringify(empty.b));
    expect(JSON.stringify(after) === JSON.stringify(['kg', 'litre']), 'the set after the refusal is ' + JSON.stringify(after));
  });

  await kase('SE-10a', 'the resolved governance says where it came from and every basic sits inside the constitution\'s envelope', async () => {
    const g = ok(await j('/api/entities/me', { token: IN.token }), 'me').b.entity.governance;
    expect(g && g.resolved_from === 'entity_stamp' && g.fallback === false, 'a shop that did country-setup is stamped; saw ' + JSON.stringify(g && [g.resolved_from, g.fallback]));
    for (const [basic, list] of [['currency', g.allowed.currencies], ['timezone', g.allowed.timezones], ['region', g.allowed.regions]]) {
      expect(!Array.isArray(list) || !list.length || list.includes(g.basics[basic]), basic + ' ' + g.basics[basic] + ' is outside allowed ' + JSON.stringify(list));
    }
  });
  await kase('SE-10b', 'a malformed currency is refused in words; a currency outside allowed.currencies is refused 422 with the allowed list; the stored currency never moves', async () => {
    const meNow = async () => ok(await j('/api/entities/me', { token: IN.token }), 'me').b;
    const before = await meNow();
    const bad = await j('/api/entities/profile', { method: 'PATCH', token: IN.token, body: { currency_code: CURRENCY_MALFORMED } });
    expect(bad.status === 400 && /\w{4,}/.test(bad.b.message || ''), 'a malformed currency answered ' + bad.status + ' ' + JSON.stringify(bad.b));
    const allowed = before.entity.governance.allowed.currencies, outside = CURRENCY_CANDIDATES.find((c) => !(allowed || []).includes(c));
    if (!Array.isArray(allowed) || !allowed.length || !outside) return 'no currency envelope on this constitution: the 422 half is not provable here';
    const r = await j('/api/entities/profile', { method: 'PATCH', token: IN.token, body: { currency_code: outside } });
    const after = await meNow();
    expect(r.status === 422 && r.b.code === 'CURRENCY_NOT_ALLOWED' && JSON.stringify(r.b.allowed) === JSON.stringify(allowed), outside + ' answered ' + r.status + ' ' + JSON.stringify(r.b));
    expect(after.entity.currency_code === before.entity.currency_code, 'the stored currency moved from ' + before.entity.currency_code + ' to ' + after.entity.currency_code);
  });

  finish('settings-truth', process.env.SETTINGS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('settings truth could not run:', e && e.message); process.exit(2); });
