'use strict';
/**
 * tests/definitions-shelf-truth.realstack.cjs — the catalogue's Definitions shelf on a REAL Postgres, the api running as cb_app (RLS on).
 *
 * OWNS     the card's named gap ("No enrolled test of the shelf's CRUD of templates, variants, order models"): create writes the definition AND version 1,
 *          a rule without its value is refused 422, an offer cannot be born or turned live without the shop's yes (428), a changed rule writes version 2
 *          while a rename writes none, a stale expected_version is refused 409, a retire sets status (nothing is deleted: the definition and all its
 *          versions stay and still read), a name already on the shelf is refused, and another shop sees none of it (404 on read, edit, retire).
 * FLOW     fresh shops S and X → every door is a route (POST / · GET / · GET /:id · PUT /:id · DELETE /:id); the database is read with SELECT only
 *          (definition, definition_version, definition_status_log).
 * CARD     06-catalogue-pim/definitions-shelf
 *
 *   S-1  create an order model: 200/201, current_version 1, one definition_version row, listed on GET /?kind=ordermodel and readable on GET /:id
 *   S-2  a percent_off offer with no percent: 422; with percent 10 it is a draft; born live without confirmed: 428; the same with confirmed: it is live
 *   S-3  a changed rule writes version 2 (two version rows, GET shows the new rule); a rename alone writes no version; a stale expected_version is 409
 *   S-4  retire: DELETE /:id 200 retired, the definition row stays (status retired), its version rows stay, GET /:id still reads it, a status log row names the retire
 *   S-5  a taken name on the same kind is refused (4xx), no second row
 *   S-6  another shop: GET /:id 404, PUT 404, DELETE 404, its own list does not show S's rows
 * CI: picked up by the T2 loop over tests/*-truth.realstack.cjs.
 */
const H = require('./lib/truth-harness.cjs');
const { Client } = require('pg');
const { j, ok, kase, expect, freshShop, finish, DB } = H;
const RUN = 'ds' + (Date.now() % 1e9).toString(36);
const asOwner = async (sql, args) => { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(sql, args)).rows; } finally { await c.end(); } };
const versions = async (id) => Number((await asOwner('SELECT count(*)::int AS n FROM definition_version WHERE definition_id = $1', [id]))[0].n);
const defRow = async (id) => (await asOwner('SELECT status, current_version FROM definition WHERE definition_id = $1', [id]))[0];
const idOf = (b) => b.definition_id || (b.definition && b.definition.definition_id) || b.id;
let S, X, MODEL, OFFER;
const create = (body, token) => j('/api/definitions', { method: 'POST', token: (token || S.token), body });

(async () => {
  console.log('\n── Definitions shelf on ' + H.API + ' · run ' + RUN + ' ──');
  const au = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } };
  S = await freshShop(RUN + 's', 'Shop', au);
  X = await freshShop(RUN + 'x', 'Other', au);

  await kase('S-1', 'create an order model: version 1 is written with it, it lists and reads back', async () => {
    const r = await create({ kind: 'ordermodel', name: 'Carton of 6 ' + RUN, rules: { pack: 6, unit: 'pcs' }, note: 'six to a carton' });
    expect(r.status === 200 || r.status === 201, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    MODEL = idOf(r.b);
    expect(MODEL, 'no definition id in the reply: ' + JSON.stringify(r.b).slice(0, 300));
    const d = await defRow(MODEL);
    expect(d && Number(d.current_version) === 1 && (await versions(MODEL)) === 1, 'row/version: ' + JSON.stringify(d) + ' versions ' + (await versions(MODEL)));
    const list = await j('/api/definitions?kind=ordermodel', { token: S.token });
    expect(list.status === 200 && JSON.stringify(list.b).includes(MODEL), 'not on the list: HTTP ' + list.status);
    const one = await j('/api/definitions/' + MODEL, { token: S.token });
    expect(one.status === 200 && JSON.stringify(one.b).includes('Carton of 6 ' + RUN), 'GET /:id: HTTP ' + one.status + ' ' + JSON.stringify(one.b).slice(0, 200));
  });
  await kase('S-2', 'an offer needs its value (422) and the shop\'s yes to go live (428)', async () => {
    const noValue = await create({ kind: 'offer', sub_kind: 'percent_off', name: 'Flat ' + RUN, rules: {} });
    expect(noValue.status === 422, 'no percent: HTTP ' + noValue.status + ' ' + JSON.stringify(noValue.b).slice(0, 200));
    const draft = await create({ kind: 'offer', sub_kind: 'percent_off', name: 'Flat 10 ' + RUN, rules: { percent: 10 } });
    expect(draft.status === 200 || draft.status === 201, 'draft: HTTP ' + draft.status + ' ' + JSON.stringify(draft.b).slice(0, 300));
    OFFER = idOf(draft.b);
    expect((await defRow(OFFER)).status === 'draft', 'an offer made without status is not a draft');
    const unconfirmed = await create({ kind: 'offer', sub_kind: 'percent_off', name: 'Live ' + RUN, rules: { percent: 5 }, status: 'live' });
    expect(unconfirmed.status === 428, 'born live without the yes: HTTP ' + unconfirmed.status + ' ' + JSON.stringify(unconfirmed.b).slice(0, 200));
    const live = await create({ kind: 'offer', sub_kind: 'percent_off', name: 'Live ' + RUN, rules: { percent: 5 }, status: 'live', confirmed: true });
    expect(live.status === 200 || live.status === 201, 'born live with the yes: HTTP ' + live.status + ' ' + JSON.stringify(live.b).slice(0, 300));
    expect((await defRow(idOf(live.b))).status === 'live', 'the confirmed offer is not live');
  });
  await kase('S-3', 'a changed rule writes version 2; a rename writes none; a stale version is refused', async () => {
    const edit = await j('/api/definitions/' + MODEL, { method: 'PUT', token: S.token, body: { rules: { pack: 12, unit: 'pcs' }, expected_version: 1 } });
    expect(edit.status === 200, 'rule change: HTTP ' + edit.status + ' ' + JSON.stringify(edit.b).slice(0, 300));
    expect((await versions(MODEL)) === 2 && Number((await defRow(MODEL)).current_version) === 2, 'no version 2: versions ' + (await versions(MODEL)));
    const now = await j('/api/definitions/' + MODEL, { token: S.token });
    expect(JSON.stringify(now.b).includes('12'), 'GET does not show the new rule: ' + JSON.stringify(now.b).slice(0, 300));
    const rename = await j('/api/definitions/' + MODEL, { method: 'PUT', token: S.token, body: { name: 'Carton of 12 ' + RUN, expected_version: 2 } });
    expect(rename.status === 200 && (await versions(MODEL)) === 2, 'rename: HTTP ' + rename.status + ', versions ' + (await versions(MODEL)));
    const stale = await j('/api/definitions/' + MODEL, { method: 'PUT', token: S.token, body: { rules: { pack: 24, unit: 'pcs' }, expected_version: 1 } });
    expect(stale.status === 409, 'stale expected_version: HTTP ' + stale.status + ' ' + JSON.stringify(stale.b).slice(0, 200));
    expect((await versions(MODEL)) === 2, 'the stale write made a version');
  });
  await kase('S-4', 'retire sets status, deletes nothing, still reads, and is logged', async () => {
    const before = await versions(OFFER);
    const r = await j('/api/definitions/' + OFFER, { method: 'DELETE', token: S.token });
    expect(r.status === 200 && r.b.retired === true, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    const d = await defRow(OFFER);
    expect(d && d.status === 'retired' && (await versions(OFFER)) === before, 'row after retire: ' + JSON.stringify(d));
    const one = await j('/api/definitions/' + OFFER, { token: S.token });
    expect(one.status === 200, 'a retired definition must still resolve: HTTP ' + one.status);
    const log = await asOwner("SELECT count(*)::int AS n FROM definition_status_log WHERE definition_id = $1 AND status = 'retired'", [OFFER]);
    expect(Number(log[0].n) === 1, 'the retire is not on the status log');
  });
  await kase('S-5', 'a name already on the shelf (same kind) is refused and no second row is made', async () => {
    const before = Number((await asOwner('SELECT count(*)::int AS n FROM definition WHERE entity_id = $1 AND kind = $2', [S.entity, 'ordermodel']))[0].n);
    const r = await create({ kind: 'ordermodel', name: 'Carton of 12 ' + RUN, rules: { pack: 12, unit: 'pcs' } });
    expect(r.status >= 400 && r.status < 500, 'a duplicate name answered HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    const after = Number((await asOwner('SELECT count(*)::int AS n FROM definition WHERE entity_id = $1 AND kind = $2', [S.entity, 'ordermodel']))[0].n);
    expect(after === before, 'a second row was made: ' + before + ' to ' + after);
  });
  await kase('S-6', "another shop cannot read, edit or retire S's definition, and its own list is empty of it", async () => {
    const get = await j('/api/definitions/' + MODEL, { token: X.token });
    expect(get.status === 404, 'GET: HTTP ' + get.status);
    const put = await j('/api/definitions/' + MODEL, { method: 'PUT', token: X.token, body: { name: 'stolen', expected_version: 2 } });
    expect(put.status === 404, 'PUT: HTTP ' + put.status);
    const del = await j('/api/definitions/' + MODEL, { method: 'DELETE', token: X.token });
    expect(del.status === 404, 'DELETE: HTTP ' + del.status);
    const list = await j('/api/definitions?kind=ordermodel', { token: X.token });
    expect(list.status === 200 && !JSON.stringify(list.b).includes(MODEL), "X's list: HTTP " + list.status);
    expect((await defRow(MODEL)).status !== 'retired', "S's definition was changed by X");
  });
  finish('definitions-shelf', process.env.TRUTH_JSON);
})().catch((e) => { console.error(e); process.exit(1); });
