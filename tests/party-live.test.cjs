'use strict';
/**
 * tests/party-live.test.cjs — CRM-247/248: what "deleted" means, in ONE place (lib/party-live.js), and what reads it.
 * A party is deleted when its list row has hidden_at set; partyOn answers customer / supplier for LIVE rows and `removed` for rows-but-none-live;
 * a lead import never matches a deleted party's phone (a new party) and never merges into a deleted party's name (skipped, in words).
 * Run: node tests/party-live.test.cjs · MIN unit-per-rule · refusal-path · fail-closed (an unknown party and a deleted party are refused the same way; nothing is let through when unsure)
 * CARD 11-crm-and-marketing/crm-parties
 */
const assert = require('assert');
const { liveSql } = require('../lib/party-live');
const S = require('../lib/books-store');
const leads = require('../lib/crm-leads');
let pass = 0;
const t = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const E = 'e0000000-0000-4000-8000-000000000001', P = 'a0000000-0000-4000-8000-000000000001';
const dbSays = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });

(async () => {
  await t('liveSql reads hidden_at through to_jsonb (a missing column is a NULL, never a 42703)', async () => {
    assert.strictEqual(liveSql('cl'), "to_jsonb(cl)->>'hidden_at' IS NULL");
  });
  await t('partyOn: a live row is a customer, not removed', async () => {
    const on = await S.partyOn(dbSays({ customer: true, supplier: false, listed: true, ledgered: false }), E, P);
    assert.deepStrictEqual([on.customer, on.supplier, on.removed], [true, false, false]);
  });
  await t('partyOn: rows but none live = removed, on neither list, history still named (reads stay)', async () => {
    const on = await S.partyOn(dbSays({ customer: false, supplier: false, listed: true, ledgered: true }), E, P);
    assert.deepStrictEqual([on.customer, on.supplier, on.removed, on.ledgered], [false, false, true, true]);
  });
  await t('partyOn: a stranger is on neither list and not removed (the refusal is the same 404 either way)', async () => {
    const on = await S.partyOn(dbSays({ customer: false, supplier: false, listed: false, ledgered: false }), E, P);
    assert.deepStrictEqual([on.customer, on.supplier, on.removed], [false, false, false]);
  });
  await t('partyOn: live on the supplier list only is live (a deleted customer row does not hide a live supplier)', async () => {
    const on = await S.partyOn(dbSays({ customer: false, supplier: true, listed: true, ledgered: false }), E, P);
    assert.deepStrictEqual([on.customer, on.supplier, on.removed], [false, true, false]);
  });
  const known = { identity_id: 'k1', digits: '9876543210', name_fold: 'old name', minted: true, on_customer: true, added_via: 'manual', txn_count: 0, supplier: false };
  await t('import plan: a deleted party\'s phone matches nobody — the row is ADDED as a new party', async () => {
    const rows = leads.plan([{ row: 1, name: 'Newcomer', digits: '9876543210' }], [Object.assign({}, known, { removed: true })]);
    assert.deepStrictEqual([rows[0].outcome, rows[0].party_id], ['add', undefined]);
  });
  await t('import plan: a deleted party\'s NAME is skipped in words and never merged (party_id not exposed)', async () => {
    const rows = leads.plan([{ row: 1, name: 'Old Name', digits: '9000000000' }], [Object.assign({}, known, { digits: null, removed: true })]);
    assert.deepStrictEqual([rows[0].outcome, rows[0].why, rows[0].party_id], ['skip', 'Same name as a deleted party', undefined]);
  });
  await t('import plan: a LIVE party with the same phone still merges as before (a live twin wins over a deleted one)', async () => {
    const live = Object.assign({}, known, { identity_id: 'k2', removed: false });
    const rows = leads.plan([{ row: 1, name: 'Newcomer', digits: '9876543210' }], [Object.assign({}, known, { removed: true }), live]);
    assert.deepStrictEqual([rows[0].outcome, rows[0].party_id], ['merge', 'k2']);
  });
  console.log(pass + ' passed');
  process.exit(process.exitCode || 0);
})();
