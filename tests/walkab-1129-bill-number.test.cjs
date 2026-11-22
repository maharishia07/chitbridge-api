/**
 * tests/walkab-1129-bill-number.test.cjs - AB-F-06 (walk AB, 21 Nov 2026): a shop's bill number belongs to ONE bill.
 *   two sales, one bill_no, different client_ref: the second is refused 409 BILL_NUMBER_TAKEN naming the bill that holds it (it was taken before, and the day sheet counted one of the two)
 *   the SAME client_ref is a replay, never refused here
 *   two staff at once: the number's lock makes the second wait and see the first (a fake db with real waiting, run in parallel)
 *   the migration file and the read-only duplicate check exist, and the route is wired
 * Run: node tests/walkab-1129-bill-number.test.cjs   (no DB, no network)
 */
'use strict';
const path = require('path'), fs = require('fs');
const HERE = path.join(__dirname, '..');
const taken = require(path.join(HERE, 'lib', 'bill-number-taken.js'));
const knownerr = require(path.join(HERE, 'lib', 'knownerr.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/* a fake shop database: chit_header rows in one list, advisory locks that really make a second holder wait until the first transaction ends */
function makeDb() {
  const rows = [], waiting = {};
  const lockHeld = new Set();
  const tx = () => {
    const mine = [];
    return {
      async query(sql, params) {
        if (/pg_advisory_xact_lock/.test(sql)) {
          const key = params.join('|');
          while (lockHeld.has(key)) await new Promise((resolve) => (waiting[key] = (waiting[key] || []).concat(resolve)));
          lockHeld.add(key); mine.push(key);
          return { rows: [] };
        }
        if (/FROM chit_header/.test(sql)) {
          const [shop, number, ref] = params;
          const hit = rows.find((r) => r.entity_id === shop && String(r.business_json.bill_no).trim() === number && (r.business_json.client_ref || null) !== ref);
          return { rows: hit ? [{ chit_id: hit.chit_id, client_ref: hit.business_json.client_ref || null }] : [] };
        }
        throw new Error('unexpected sql ' + sql);
      },
      end() { for (const key of mine) { lockHeld.delete(key); (waiting[key] || []).splice(0).forEach((go) => go()); } }
    };
  };
  return { rows, tx };
}
const bill = (no, ref, extra) => Object.assign({ sender_id: 'SHOP', client_ref: ref, purpose: 'order', business_json: { till: { id: 'C1' }, bill_no: no, client_ref: ref } }, extra || {});
/** one send as the route does it: the early look, then the write transaction (lock, look again, insert, commit) */
async function send(db, state, delay) {
  try { const early = db.tx(); await taken.judge(early, state, { locked: false }); } catch (e) { return { refused: e }; }
  const write = db.tx();
  try {
    await taken.judge(write, state, { locked: true });
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    db.rows.push({ chit_id: 'chit-' + state.client_ref, entity_id: state.sender_id, business_json: state.business_json });
    return { ok: true };
  } catch (e) { return { refused: e }; } finally { write.end(); }
}

(async () => {
  console.log('\n== AB-F-06 · one bill number, one bill ==\n');
  const db = makeDb();
  const first = await send(db, bill('C3/0050', 'C3/0050'));
  ok('the first bill is taken', first.ok === true);
  const second = await send(db, bill('C3/0050', 'REF-OTHER'));
  const answer = second.refused && knownerr.known(second.refused);
  ok('a second bill with the same bill_no and another client_ref is refused 409 BILL_NUMBER_TAKEN', answer && answer.status === 409 && answer.body.code === 'BILL_NUMBER_TAKEN', JSON.stringify(answer));
  ok('...in words naming the number and the bill that holds it', answer && /C3\/0050/.test(answer.body.message) && /already on another bill/.test(answer.body.message) && second.refused.holder_chit_id === 'chit-C3/0050', answer && answer.body.message);
  ok('the refused bill wrote nothing', db.rows.length === 1);
  const replay = await send(db, bill('C3/0050', 'C3/0050'));
  ok('the SAME client_ref is a replay, not refused by this check', replay.ok === true);
  ok('another number is taken', (await send(db, bill('C3/0051', 'C3/0051'))).ok === true);
  ok('a draft is never judged', (await send(db, bill('C3/0050', 'D1', { is_draft: true }))).ok === true);
  ok('a document with no till stamp (a supplier bill) is not judged', (await send(db, { sender_id: 'SHOP', client_ref: 'X', business_json: { bill_no: 'C3/0050' } })).ok === true);
  ok('the same number in ANOTHER shop is not a clash', (await send(db, bill('C3/0050', 'Z9', { sender_id: 'OTHER' }))).ok === true);
  ok('an empty number is not judged here (BILL_NO_BAD refuses it before)', (await send(db, bill('  ', 'E1'))).ok === true);

  console.log('\n== AB-F-06 · two staff at once ==\n');
  const race = makeDb();
  const both = await Promise.all([send(race, bill('C4/0001', 'REF-A'), 25), send(race, bill('C4/0001', 'REF-B'), 25)]);
  ok('exactly one of two parallel sends passes', both.filter((r) => r.ok).length === 1 && both.filter((r) => r.refused).length === 1, JSON.stringify(both.map((r) => !!r.ok)));
  ok('...and only one chit is written', race.rows.length === 1);
  const loser = both.find((r) => r.refused);
  ok('...the loser is told in words (409, naming the holder)', loser && knownerr.known(loser.refused).status === 409 && /already on another bill/.test(loser.refused.message));

  console.log('\n== wiring and files ==\n');
  const route = require('../tools/chits-files.cjs').read(HERE); /* the chits route's code through the one list (chits-files.test) */
  ok('the route has the early step, in the step list after the bill-number rule', /sendBillNumber,\s*sendBillTaken,/.test(route));
  ok('both write transactions ask again under the number\'s lock', (route.match(/bill-number-taken'\)\.judge\([a-zA-Z]+, sendState, \{ locked: true \}\)/g) || []).length === 2);
  ok('the index\'s own refusal (23505 on bill_no) answers the same 409', /\/bill_no\/\.test\(String\(err\.constraint/.test(route));
  const mig = fs.readFileSync(path.join(HERE, 'migrations', 'b907_chit_bill_no_unique.sql'), 'utf8');
  ok('b907 builds a partial unique index and stops on existing duplicates', /CREATE UNIQUE INDEX IF NOT EXISTS ux_chit_bill_no_per_entity/.test(mig) && /RAISE EXCEPTION 'b907 not built/.test(mig));
  const read = fs.readFileSync(path.join(HERE, 'migrations', 'READ-2026-11-21-1-bill-no-duplicates.sql'), 'utf8');
  ok('the read-only check lists duplicates and writes nothing', /HAVING count\(\*\) > 1/.test(read) && !/(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/.test(read.replace(/--.*$/gm, '')));
  const codes = JSON.parse(fs.readFileSync(path.join(HERE, 'docs', 'error-codes.json'), 'utf8'));
  ok('BILL_NUMBER_TAKEN is in the error register', (Array.isArray(codes) ? codes : codes.codes || []).some((c) => c.code === 'BILL_NUMBER_TAKEN' && String(c.status) === '409'));

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
