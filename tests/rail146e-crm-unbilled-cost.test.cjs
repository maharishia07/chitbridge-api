/**
 * tests/rail146e-crm-unbilled-cost.test.cjs — RAIL-146e: the Parties list never carries what the shop owes a supplier on open purchase orders to a cost-blind co-assist.
 *
 * OWNS      the proof that GET /api/crm/parties gives an actor without can_see_costs no purchase money in the per-party "not billed yet" figure: lib/work-rows
 *           unbilledByParty applies the RAIL-146b partial rule PER PARTY (the sum stands only when every order of that party is a sale; else minor null + cost_hidden:true),
 *           fails closed on a party on no list and on a failed side read, keeps a sales party priced, and leaves the owner and a cost-allowed actor byte-identical;
 *           and that the route reads can_see_costs ONCE and hands it down. The parties list takes no amount filter or sort (nothing to strip), asserted too.
 * CALLED BY scripts/guards.cjs · CI. No database, no network. Part 1: the real lib/work-rows over tests/support/work-stub.cjs. Part 2 (a child process, the two stubs
 *           cannot share one module cache): the real routes/crm.js and lib/crm over tests/support/crm-stub.cjs.
 * FLOW      world (orders · roles · flag) → unbilledByParty / GET /parties → whole-body scan (money keys, planted figures, ₹) → the sales party and the owner untouched
 * CARD      11-crm-and-marketing/crm-routes
 *
 * Run: node tests/rail146e-crm-unbilled-cost.test.cjs
 */
'use strict';
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(100) + (ok ? '' : JSON.stringify(got).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};
const SECRET = { sup1: 4242.5, sup2: 3131.25, stranger: 4646.5 }; /* purchase figures no other field could carry */
const shapes = (n) => [String(n), n.toFixed(2), String(Math.round(n * 100))];
const SECRET_FIG = Object.values(SECRET).flatMap(shapes);
const leaked = (raw) => SECRET_FIG.filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));
const MONEY_KEY = /(_minor|^minor$|^total$|^price$|^amount$|^value$)/;
/** every money-looking key holding a real number, at any depth; the sales party is priced on purpose, so callers pass only what must be money-free */
const moneyKeys = (v) => (v && typeof v === 'object' ? Object.keys(v).flatMap((k) => (MONEY_KEY.test(k) && typeof v[k] === 'number' ? [k] : moneyKeys(v[k]))) : []);
/** THE WHOLE-BODY SCAN: the blind answer holds no money key with a figure, no planted purchase figure and no ₹ */
const noLeak = (label, body) => { const raw = JSON.stringify(body); t(label + ' | whole-body scan: no money key, no planted figure, no ₹', [moneyKeys(body), leaked(raw), /₹/.test(raw)], [[], [], false]); };

async function partOne() {
  const S = require('./support/work-stub.cjs');
  const { D, E1, copy, seed } = S;
  const W = require('../lib/work-rows');
  const SUP = '33333333-3333-4333-8333-333333333333', CUS = '55555555-5555-4555-8555-555555555555', STRANGER = '66666666-6666-4666-8666-666666666666';
  const world = () => {
    seed();
    D.copies = [
      copy(1, { sender_entity_id: SUP, counterparty_id: SUP, value: String(SECRET.sup1) }),
      copy(2, { sender_entity_id: SUP, counterparty_id: SUP, value: String(SECRET.sup2) }),
      copy(3, { sender_entity_id: CUS, counterparty_id: CUS, value: '1200.50' }),
      copy(4, { sender_entity_id: CUS, counterparty_id: CUS, value: '300.00' }),
      copy(5, { sender_entity_id: STRANGER, counterparty_id: STRANGER, value: String(SECRET.stranger) })
    ];
    D.detail = {}; D.marks = []; D.progress = []; D.assign = [];
    D.roles = { [SUP]: { supplier: true }, [CUS]: { customer: true } };
    D.bj = Object.fromEntries(D.copies.map((c) => [c.chit_id, {}]));
  };
  const asObj = (m) => Object.fromEntries(m);
  const withoutSales = (m) => { const o = asObj(m); delete o[CUS]; return o; };
  console.log('\n== RAIL-146e part 1 · unbilledByParty, per party ==\n');

  world(); D.canSeeCosts = false;
  const blind = await W.unbilledByParty({ entity: E1, actor: 'A7', blind: true });
  t('blind | a supplier party: n stands, minor null, cost_hidden:true', blind.get(SUP), { n: 2, minor: null, currency: 'INR', cost_hidden: true });
  t('blind | a party on no list fails closed: minor null, cost_hidden:true', blind.get(STRANGER), { n: 1, minor: null, currency: 'INR', cost_hidden: true });
  t('blind | a sales party keeps its sum (1200.50 + 300.00), no marker', blind.get(CUS), { n: 2, minor: 150050, currency: 'INR' });
  noLeak('blind | every party but the sales one', withoutSales(blind));

  world(); D.canSeeCosts = false;
  const owner = await W.unbilledByParty({ entity: E1, actor: 'A7' });
  const allowed = await W.unbilledByParty({ entity: E1, actor: 'A7', blind: false });
  t('owner / cost-allowed | the supplier party keeps its sum, byte for byte', owner.get(SUP), { n: 2, minor: 737375, currency: 'INR' });
  t('owner and cost-allowed answer the same bytes', JSON.stringify([...allowed]), JSON.stringify([...owner]));
  t('owner | no marker anywhere', JSON.stringify([...owner]).includes('cost_hidden'), false);

  world(); D.canSeeCosts = false; /* a failed side read: every party unknown */
  D.bj = new Proxy({}, { get() { throw new Error('side read down'); } });
  const down = await W.unbilledByParty({ entity: E1, actor: 'A7', blind: true });
  t('blind | a failed side read hides every party (fail closed, never a wrong sum)', [...down].every(([, v]) => v.minor === null && v.cost_hidden === true), true);
  noLeak('blind | failed side read', asObj(down));

  world(); D.canSeeCosts = false; D.statements.length = 0; D.batches = 0;
  await W.unbilledByParty({ entity: E1, actor: 'A7', blind: true });
  t('blind | ONE select + marks batch and ONE side read for the whole list, never one per party', [D.batches, D.statements.filter((s) => /FROM chit_header h WHERE/.test(s)).length], [1, 1]);
}

async function partTwo() {
  const { make, row } = require('./support/crm-stub.cjs');
  const stub = make(), D = stub.data;
  const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const WR = require('../lib/work-rows');
  console.log('\n== RAIL-146e part 2 · GET /api/crm/parties, the route ==\n');
  D.cust = [Object.assign(row({ party_id: P(2), display_name: 'Mill', user_id: 'mill', party_no: 'P-0002' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, last_txn_at: '2026-09-30T10:00:00Z', groups: [], segment: 'regular' })];
  D.stored.customer[P(2)] = { party_no: 'P-0002', balance_minor: 0 };
  let flagReads = 0, flag = false, seen = [];
  D.pre = async (sql) => { if (/SELECT can_see_costs FROM identities/.test(sql)) { flagReads++; return { rows: [{ can_see_costs: flag }] }; } return null; };
  /* the real unbilledByParty is part 1's; here a stand-in answers by the ctx it is handed, so what is proved is that the route hands the right flag down */
  WR.unbilledByParty = async (ctx) => { seen.push(!!ctx.blind); return new Map([[P(2), ctx.blind ? { n: 1, minor: null, currency: 'INR', cost_hidden: true } : { n: 1, minor: Math.round(SECRET.sup1 * 100), currency: 'INR' }]]); };
  const unbilledOf = (r) => r.body.parties.find((p) => p.party_id === P(2)).unbilled;

  stub.as('E1', { identity: { identity_id: 'A7', identity_type: 'actor', parent_entity_id: 'E1' } });
  flag = false; flagReads = 0; seen = [];
  let r = await stub.get('/parties');
  t('blind actor | 200, unbilled is the hidden shape', [r.status, unbilledOf(r)], [200, { n: 1, minor: null, currency: 'INR', cost_hidden: true }]);
  t('blind actor | the route read can_see_costs ONCE and handed blind:true down', [flagReads, seen], [1, [true]]);
  noLeak('blind actor | unbilled of every party', r.body.parties.map((p) => ({ unbilled: p.unbilled })));
  r = await stub.get('/parties?sort=amount&amount_min=1&amount_max=9999999');
  t('blind actor | an amount sort or filter is no parameter of this list: nothing honoured, still hidden', [r.status, unbilledOf(r).minor], [200, null]);

  flag = true; flagReads = 0; seen = [];
  r = await stub.get('/parties');
  t('cost-allowed actor | the full sum, no marker, blind:false', [unbilledOf(r), seen], [{ n: 1, minor: 424250, currency: 'INR' }, [false]]);

  stub.as('E1'); flagReads = 0; seen = [];
  r = await stub.get('/parties');
  t('owner | the full sum, no can_see_costs read at all', [unbilledOf(r).minor, flagReads, seen], [424250, 0, [false]]);
  stub.close();
}

(async () => {
  if (process.argv[2] === 'route') { await partTwo(); console.log('  ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  await partOne();
  const { spawnSync } = require('child_process');
  const child = spawnSync(process.execPath, [__filename, 'route'], { encoding: 'utf8' });
  process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
  const m = /(\d+) passed, (\d+) failed/.exec(child.stdout || '');
  if (!m) { fail++; console.log('  FAIL  part 2 did not report'); } else { pass += Number(m[1]); fail += Number(m[2]); }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
