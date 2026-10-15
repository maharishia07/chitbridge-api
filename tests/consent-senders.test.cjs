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
/**
 * T3-P3-CONSENT: the guard's blind spot was the WRAPPER — a route that calls lib/notify's sendEmail / sendOtp* never holds a provider line, so
 * it was never scanned. Now every file that CALLS a wrapper is held to the same two lists (a caller of whatsapp-out.notify is gated inside the
 * sender itself and needs no entry). A new caller that mails or messages a PARTY: gate it, or say here why it never does.
 */
const WRAP = /\bsend(OtpEmail|OtpSms|Otp|Email)\s*\(/;
const GATED = { 'lib/whatsapp-out.js': 'notify() asks privacy.gate (by party id, else by the number) before anything is posted' };
const EXEMPT = {
  'lib/notify.js': 'sign-in codes go to the person who just asked for one; sendEmail is the connector notice to an address the SHOP configured — neither is a party',
  'routes/simulator.js': 'the /tour page mails OUR OWN leads inbox (LEADS_EMAIL), never a shop’s party',
  /* wrapper callers — each sends to the PERSON WHO ASKED (a code), or to the shop's own address */
  'routes/signin.js': 'sign-in codes to the e-mail or phone the person just typed; the magic-link mail to the same',
  'routes/identity-docs.js': 'a code to the person whose own document is being verified',
  'routes/catalogue.js': 'the order code to the shopper placing the order right now (their own phone or e-mail; the code IS the sign-in)',
  'routes/connectors.js': 'sendOtpEmail: the connector claim code to the shop owner\u2019s own e-mail; sendEmail: the connector notice to the address the SHOP configured',
};
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (why ? '\n       ' + why : '')); } };

const files = [];
for (const dir of ['lib', 'routes']) for (const f of fs.readdirSync(path.join(API, dir))) if (/\.(c?js)$/.test(f)) files.push(dir + '/' + f);
const senders = files.filter((f) => { const src = fs.readFileSync(path.join(API, f), 'utf8'); return SEND.test(src) || (f !== 'lib/notify.js' && WRAP.test(src)); });
ok('the scan finds the senders it knows (it is not blind)', senders.indexOf('lib/whatsapp-out.js') >= 0 && senders.indexOf('lib/notify.js') >= 0 && senders.indexOf('routes/catalogue.js') >= 0, senders.join(', '));
for (const f of senders) {
  const src = fs.readFileSync(path.join(API, f), 'utf8');
  if (GATED[f]) ok(f + ' asks the consent gate — ' + GATED[f], /privacy'\)\.gate\(|PV\.gate\(/.test(src));
  else ok(f + ' is exempt for a stated reason', !!EXEMPT[f], 'a NEW provider send: call lib/privacy.gate before it, or add it to EXEMPT with why it never messages a party');
}
Object.keys(GATED).concat(Object.keys(EXEMPT)).forEach((f) => ok(f + ' still exists and still sends (no stale entry)', senders.indexOf(f) >= 0));
console.log('\n  ' + (pass + fail) + ' checks · ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
