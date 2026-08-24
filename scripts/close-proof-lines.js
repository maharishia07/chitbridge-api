/**
 * scripts/close-proof-lines.js — CLOSE THE LINES MY PROOF RUNS LEFT OPEN.
 *
 * Athi, 2026-08-24: *"close the leftover lines from the proof runs."*
 *
 * ⚠️⚠️ IT WILL ONLY EVER TOUCH THE THREE SUBJECTS `prove-usecases.js` CREATES. Everything else in that
 * account is his — the WhatsApp captures especially, which are real inbound messages with real outstanding
 * work on them. Closing a line says the work is done; saying that about someone's actual job is worse than
 * leaving a test chit untidy, so the match is on an exact subject and nothing else.
 *
 *     node scripts/close-proof-lines.js            ← DRY RUN. Prints what it would close, changes nothing.
 *     node scripts/close-proof-lines.js --apply    ← does it
 *
 * ⭐ It closes a line the way a person does: `deliver-lines` with the outstanding quantity, which is the same
 * call the Delivered button makes. Nothing is deleted and nothing is back-dated — the events say what they
 * are, recorded now.
 */
const P = require('./_proof');

const EMAIL = process.env.CB_SHOP_EMAIL || 'cholaauto@email.com';
const SHOP = process.env.CB_SHOP_NAME || 'Chola Auto Care';
const APPLY = process.argv.includes('--apply');

/* The exact subjects prove-usecases.js sends. Substring matching would sweep up his WhatsApp chits. */
const PROOF_SUBJECTS = new Set(['Parts order', 'Inspection', 'Job card — TN 09 BX 4471']);

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

(async () => {
  console.log('\n══ CLOSING PROOF-RUN LINES ' + (APPLY ? '· APPLYING' : '· DRY RUN (nothing will change)') + ' ══\n');
  const token = await P.signIn(EMAIL, SHOP);
  if (!token) { console.log('sign-in failed for ' + SHOP); process.exit(1); }
  const auth = { token };

  const list = await P.j('/api/chits/inbox?limit=100', auth);
  const rows = (list.b && (list.b.chits || list.b.items || list.b)) || [];
  const mine = rows.filter((c) => PROOF_SUBJECTS.has(String(c.manual_subject || c.auto_subject || '').trim()));
  console.log(rows.length + ' chit(s) in the inbox · ' + mine.length + ' from the proof runs\n');
  if (!mine.length) { console.log('  nothing to close\n'); return; }

  let planned = 0;
  let closed = 0;
  let failed = 0;

  for (const c of mine) {
    const id = c.chit_id || c.id;
    const det = await P.j('/api/chits/' + id, auth);
    const d = det.b || {};
    const prog = d.line_delivery || {};
    const lines = (d.live_set || []).filter((e) => !e.removed);
    const open = lines
      .map((e) => ({ e, p: prog[e.line_id] || {}, l: e.live || e.original || {} }))
      .filter((x) => !x.p.complete && Number(x.p.pending || 0) > 0);

    const subj = String(c.manual_subject || c.auto_subject || id);
    if (!open.length) { console.log('  ' + subj.padEnd(28) + '  already fully closed'); continue; }

    console.log('  ' + subj);
    const rowsToSend = [];
    for (const x of open) {
      const qty = Number(x.p.pending);
      console.log('      ' + String(x.l.particulars || '').slice(0, 34).padEnd(36)
        + String(qty) + ' ' + (x.l.unit || '') + ' outstanding'
        + (x.p.charged ? '   (' + inr(x.p.charged) + ' recorded)' : ''));
      rowsToSend.push({ line_id: x.e.line_id, quantity: qty, unit: x.l.unit || null,
        reference: 'closed: leftover from a proof run' });
      planned++;
    }
    if (!APPLY) continue;

    /* ⭐ One call for the whole chit — the same reason the picker records several parts at once. */
    const r = await P.j('/api/chits/' + id + '/deliver-lines', { method: 'POST', ...auth, body: { rows: rowsToSend } });
    if (r.status >= 200 && r.status < 300) {
      closed += rowsToSend.length;
      const s = (r.b && r.b.summary) || null;
      console.log('      → closed ' + rowsToSend.length + ' line(s)' + (s ? '   now ' + s.complete + ' of ' + s.lines : ''));
    } else {
      failed += rowsToSend.length;
      console.log('      → FAILED ' + r.status + ' ' + JSON.stringify(r.b || {}).slice(0, 120));
    }
  }

  console.log('\n  ' + planned + ' line(s) outstanding across ' + mine.length + ' proof chit(s)');
  if (!APPLY) console.log('  DRY RUN — re-run with --apply to close them\n');
  else console.log('  closed ' + closed + ' · failed ' + failed + '\n');
  process.exitCode = failed ? 1 : 0;
})();
