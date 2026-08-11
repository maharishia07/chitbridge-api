'use strict';
// check-screw-message.js — did b136 fix the line that lost three facts?
//
// Athi's real message, 2026-08-11:
//     "screw black color 5 inch + type 2 box, hammer periya size 1, fevicol bottle 3,
//      dr fix oru 4 packet, velachery situku anupunga"
//
// Before b136 the first line came back as { particulars:"screw", qty:5, unit:"box", comment:"black color, type 2" }
// — the SIZE taken as the quantity, "5 inch" gone entirely, "+ type" (a Phillips head) fused with the quantity into
// "type 2", which is neither fact. And `unplaced` was EMPTY, so the silent-loss detector called it clean.
//
// ⚠️ THIS IS A LOOK, NOT A PROOF. It prints what the reader now produces and asserts the three facts that were
// destroyed. It costs one AI call. It does NOT prove parsing in general — prove-message-to-chit.js does that.
const crypto = require('crypto');
const { j, signIn } = require('./_proof');

const SECRET = process.env.WHATSAPP_APP_SECRET, ADMIN = process.env.CB_ADMIN_KEY;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  \x1b[32mok\x1b[0m  ' + n); pass++; } else { console.log('  \x1b[31mXX\x1b[0m  ' + n + (x ? ' — ' + x : '')); fail++; } };

const TEXT = (s) => 'screw black color 5 inch + type 2 box, hammer periya size 1, fevicol bottle 3, dr fix oru 4 packet, velachery situku anupunga (ref ' + s + ')';

async function deliver(to, from, text) {
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: to, phone_number_id: '000' },
    contacts: [{ wa_id: from, profile: { name: 'Athi (screw test)' } }],
    messages: [{ from, id: 'wamid.' + Date.now() + Math.random(), type: 'text', text: { body: text } }],
  } }] }] });
  return j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload,
    headers: { 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex') } });
}

(async () => {
  if (!SECRET || !ADMIN) { console.log('\n  Missing WHATSAPP_APP_SECRET / CB_ADMIN_KEY.\n'); process.exitCode = 2; return; }
  const stamp = Date.now().toString().slice(-6);
  const NUM = '+9155' + stamp + '1', CUST = '+9191' + stamp + '8';
  const A = await signIn('beta@test-cb.com', 'Beta Fresh');

  const bind = await j('/api/channels', { method: 'POST', token: A, body: { channel: 'whatsapp', address: NUM, label: 'screw check' } });
  await j('/api/channels/' + bind.b.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });
  await deliver(NUM, CUST, TEXT(stamp));

  const caps = ((await j('/api/capture/pending', { token: A })).b || {}).captures || [];
  const cap = caps.find((c) => String(c.raw_text || '').includes(stamp));
  if (!cap) { console.log('  capture not found'); process.exitCode = 1; return; }

  const st = await j('/api/capture/' + cap.id + '/structure', { method: 'POST', token: A, body: {} });
  const s = (st.b && st.b.structured) || {};
  const lines = s.line_items || [];

  console.log('\n── what the reader produced ────────────────────────────────────────────────\n');
  console.log(JSON.stringify(lines, null, 2));
  if (s.unplaced) console.log('\nunplaced: ' + JSON.stringify(s.unplaced));
  if (s.delivery_address) console.log('delivery_address: ' + s.delivery_address);
  if (s.notes) console.log('notes: ' + s.notes);

  console.log('\n── the three facts b136 was written to save ────────────────────────────────\n');
  const screw = lines.find((l) => /screw/i.test(l.particulars || ''));
  ok('there is a screw line at all', !!screw);
  if (screw) {
    /* THE HEADLINE FIX: the quantity is the number BOUND TO THE UNIT ("2 box"), not the measurement ("5 inch"). */
    ok('★★ qty is 2 (the number bound to the unit), NOT 5 (the size)', Number(screw.qty) === 2, 'qty=' + screw.qty + ' unit=' + screw.unit);
    /* "5 inch" must survive SOMEWHERE — unit_size is the right home, a comment is acceptable, gone is not. */
    const blob = JSON.stringify(screw).toLowerCase();
    ok('★★ "5 inch" survived somewhere on the line', /5\s*(inch|")/.test(blob), JSON.stringify(screw));
    ok('★★ "+ type" is kept as a specification, not fused into the quantity',
       /\+\s*type|phillips/i.test(blob) && !/type 2/i.test(String(screw.comment || '')), 'comment=' + JSON.stringify(screw.comment));
    ok('the colour is carried as a qualifier', /black/i.test(blob), JSON.stringify(screw));
  }
  const cnt = lines.length;
  ok('all four items were read (screw · hammer · fevicol · dr fix)', cnt >= 4, cnt + ' lines');
  ok('the delivery instruction did not become a line item', !lines.some((l) => /velachery|anupunga/i.test(l.particulars || '')));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + pass + ' passed, ' + fail + ' failed\x1b[0m');
  console.log('⚠️  one AI call was made; a capture + channel binding were created on beta and left for inspection.\n');
  process.exit(fail ? 1 : 0);
})();
