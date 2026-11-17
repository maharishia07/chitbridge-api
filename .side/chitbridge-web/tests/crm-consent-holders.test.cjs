'use strict';
/* CRM-38 (P1-3, 6 Nov 2026): a party record's Consent block says who holds the data and where, from GET /api/privacy/facts
   (crmPrivFacts). public/app/cap-crm-privacy.js crmConsentHolders run in node with a stub page: a listed processor prints with its
   region; a region the server does not state says "region not stated"; a processor that is off is not listed; a failed read says so
   in words (silence is the bug) and opening the block again retries; a loaded block does not read twice. Run: node tests/crm-consent-holders.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

function page(answer) {
  const attrs = {}, node = { textContent: '', getAttribute: (k) => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
  const calls = [];
  const cx = vm.createContext({
    console,
    document: { getElementById: (id) => (id === 'crm_consent_holders' ? node : null), querySelector: () => null, querySelectorAll: () => [] },
    window: {},
    tx: (s) => s,
    esc: (s) => String(s),
    api: async (name) => { calls.push(name); if (answer instanceof Error) throw answer; return answer; }
  });
  cx.window = cx;
  vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cap-crm-privacy.js', 'utf8'), cx);
  return { cx, node, calls };
}

(async () => {
  const held = page({ processors: [{ name: 'Railway', region: 'Singapore', on: true }, { name: 'Resend', on: true }, { name: 'Twilio', region: 'US', on: false }] });
  await held.cx.crmConsentHolders();
  ok(held.calls.length === 1 && held.calls[0] === 'crmPrivFacts', 'opening the block reads GET /api/privacy/facts once, through crmPrivFacts');
  ok(held.node.textContent === 'Your data is held by: Railway (Singapore), Resend (region not stated)', 'listed processors print with their region; an unstated region says so (' + held.node.textContent + ')');
  ok(!/Twilio/.test(held.node.textContent), 'a processor that is off is not listed');
  await held.cx.crmConsentHolders();
  ok(held.calls.length === 1, 'a loaded block does not read again');

  const failed = page(new Error('network'));
  await failed.cx.crmConsentHolders();
  ok(failed.node.textContent === "Couldn't read who holds the data.", 'a failed read says so in words, never a blank');
  ok(failed.node.getAttribute('data-loaded') === null, 'and opening the block again retries');

  const none = page({ processors: [] });
  await none.cx.crmConsentHolders();
  ok(none.node.textContent === '', 'no processors listed → the line stays empty');

  console.log(n + ' checks, all ok');
})().catch((e) => { console.error('  FAIL ' + e.message); process.exit(1); });
