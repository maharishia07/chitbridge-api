/**
 * consent-senders.test.cjs — ⭐⭐ CO1-GATE (MKT-SRV1, 2026-10-14): EVERY PROVIDER SEND ASKS THE ONE CONSENT GATE, OR SAYS WHY IT NEED NOT.
 *
 * lib/privacy.mayMessage existed from CO1 (13 Oct) and nothing called it — a gate nobody walks through. This scans lib/ and routes/ for
 * the lines that hand a message to a provider (an e-mail through Resend, a WhatsApp through Meta's Graph API, an SMS / Twilio client)
 * and holds each file to one of two lists:
 *   GATED   it calls lib/privacy.gate before the send (the send itself is refused with the gate's code when the answer is no)
 *   EXEMPT  it never messages a PARTY of the shop, with the reason in words — a new sender is neither, and fails here
 * Run: node tests/consent-senders.test.cjs · no DB, no network.
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const SEND = /emails\.send\(|GRAPH[^\n]*\/messages['"`]|messages\.create\(|graph\.facebook\.com[^\n]*\/messages/;
const GATED = { 'lib/whatsapp-out.js': 'notify() asks privacy.gate (by party id, else by the number) before anything is posted' };
const EXEMPT = {
  'lib/notify.js': 'sign-in codes go to the person who just asked for one; sendEmail is the connector notice to an address the SHOP configured — neither is a party',
  'routes/simulator.js': 'the /tour page mails OUR OWN leads inbox (LEADS_EMAIL), never a shop’s party',
};
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (why ? '\n       ' + why : '')); } };

const files = [];
for (const dir of ['lib', 'routes']) for (const f of fs.readdirSync(path.join(API, dir))) if (/\.(c?js)$/.test(f)) files.push(dir + '/' + f);
const senders = files.filter((f) => SEND.test(fs.readFileSync(path.join(API, f), 'utf8')));
ok('the scan finds the senders it knows (it is not blind)', senders.indexOf('lib/whatsapp-out.js') >= 0 && senders.indexOf('lib/notify.js') >= 0, senders.join(', '));
for (const f of senders) {
  const src = fs.readFileSync(path.join(API, f), 'utf8');
  if (GATED[f]) ok(f + ' asks the consent gate — ' + GATED[f], /privacy'\)\.gate\(|PV\.gate\(/.test(src));
  else ok(f + ' is exempt for a stated reason', !!EXEMPT[f], 'a NEW provider send: call lib/privacy.gate before it, or add it to EXEMPT with why it never messages a party');
}
Object.keys(GATED).concat(Object.keys(EXEMPT)).forEach((f) => ok(f + ' still exists and still sends (no stale entry)', senders.indexOf(f) >= 0));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
