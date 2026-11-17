#!/usr/bin/env node
/**
 * sec100-folder-fk.test.cjs — SEC-100: no write puts ANOTHER shop's folder into a column that has a foreign key to folder(folder_id).
 *
 * OWNS      the offline proof, for the four writes that store a folder id: POST /api/folders/:id/rules (folder_rule.folder_id) · PATCH /api/folders/:id with parent_id and
 *           POST /api/folders with parent_id (folder.parent_id) · PUT /api/entities/routing with folder_id (entity_work_routing.folder_id). For each: the shop's own folder works,
 *           another shop's folder and an unknown folder get ONE answer (status and body, request id aside), and nothing is written in the foreign case.
 *           The stand-in db MODELS the foreign key the way Postgres does: checked WITHOUT row security, so a folder of any shop satisfies it and only a folder that exists nowhere
 *           is refused (23503). The first check shows that model on its own (the defect: a foreign id stored, an unknown id a 500), so the cases below cannot pass on a model that is too kind.
 * ALSO (SEC-103) the assignee of the same write: entity_work_routing.assignee_actor_id has NO foreign key, so the model keeps whatever it is given; the shop's own actor works, another shop's
 *           actor, an unknown id and text that is no uuid get ONE 404 ("Person not found"), nothing is written, and a clear (null or empty) still works.
 * CALLED BY scripts/guards.cjs. The real T2 twin (real Postgres, run by S41) is tests/sec100-truth.realstack.cjs.
 * FLOW      stand-in sign-in + db (tests/lib/problem-world.cjs) → the real routes/folders.js and routes/entities.js over http → ask as shop B for A's folder, for an unknown folder, for B's own
 *           → compare status and body → read what the model holds (writes, rows pointing at A's folders)
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/sec100-folder-fk.test.cjs
 */
'use strict';
const path = require('path');
const { harness, OWNER, SHOP } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.PLATFORM_ROOT_ENTITY = SHOP;

const SHOP_A = SHOP;
const SHOP_B = '66666666-6666-4666-8666-666666666666';
const WHO_B = { identity_id: SHOP_B, identity_type: 'entity', display_name: 'Shop B' };
const A_FOLDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_FOLDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const B_FOLDER_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';
/** every case has its own unknown id: two cases sharing one uuid collided once (api #394, BELL-02) */
const UNKNOWN_RULES = 'cccccccc-cccc-4ccc-8ccc-cccccccc0001';
const UNKNOWN_PATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccc0002';
const UNKNOWN_CREATE = 'cccccccc-cccc-4ccc-8ccc-cccccccc0003';
const UNKNOWN_ROUTING = 'cccccccc-cccc-4ccc-8ccc-cccccccc0004';
const A_ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0a01';
const B_ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0b01';
const GHOST_ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccc0a01';
const UNKNOWN_MODEL = 'cccccccc-cccc-4ccc-8ccc-cccccccc0005';
const FK_VIOLATION = '23503';
const RULE_WHEN = { doc: 'invoice' };

const lab = harness({ here: HERE, mounts: ['/api/folders', '/api/entities'], routeFiles: { '/api/folders': 'routes/folders.js', '/api/entities': 'routes/entities.js' } });
const { check } = lab;

/** the database as Postgres holds it for these four tables: folders of two shops, and a foreign key checked WITHOUT row security */
function fkModel() {
  const folders = new Map([[A_FOLDER, { entity_id: SHOP_A, parent_id: null }], [B_FOLDER, { entity_id: SHOP_B, parent_id: null }], [B_FOLDER_TWO, { entity_id: SHOP_B, parent_id: null }]]);
  const actors = new Map([[A_ACTOR, SHOP_A], [B_ACTOR, SHOP_B]]);
  const writes = [];
  const rules = [];
  const routing = [];
  const foreignKey = (id) => {
    if (id !== null && !folders.has(id)) throw Object.assign(new Error('violates foreign key constraint'), { code: FK_VIOLATION });
  };
  const answer = (rows) => ({ rows, rowCount: rows.length });
  const statements = [
    [/^\s*SELECT 1 FROM folder WHERE folder_id = \$1 AND entity_id = \$2/, ([id, entity]) => answer(folders.has(id) && folders.get(id).entity_id === entity ? [{ '?column?': 1 }] : [])],
    [/INSERT INTO folder_rule/, ([entity, folder]) => (foreignKey(folder), rules.push({ entity, folder }), writes.push('rule'), answer([{ rule_id: 'rule-1', folder_id: folder, when: RULE_WHEN }]))],
    [/UPDATE folder SET parent_id = \$1 WHERE folder_id = \$2 AND entity_id = \$3/, ([parent, id, entity]) => {
      foreignKey(parent);
      if (!folders.has(id) || folders.get(id).entity_id !== entity) return answer([]);
      folders.get(id).parent_id = parent;
      writes.push('parent');
      return answer([{ folder_id: id, parent_id: parent, name: 'x' }]);
    }],
    [/INSERT INTO folder \(entity_id, parent_id, name/, ([entity, parent, name]) => (foreignKey(parent), writes.push('create'), answer([{ folder_id: 'new-1', parent_id: parent, name, sort: 0 }]))],
    [/FROM identities WHERE identity_id = \$1 AND identity_type = 'actor' AND parent_entity_id = \$2/, ([id, entity]) => answer(actors.get(id) === entity ? [{ '?column?': 1 }] : [])],
    [/INSERT INTO entity_work_routing/, ([entity, kind, folder, assignee]) => (foreignKey(folder), routing.push({ entity, folder, assignee }), writes.push('routing'), answer([]))]
  ];
  const query = (sql, params) => {
    const found = statements.find(([pattern]) => pattern.test(String(sql)));
    return found ? found[1](params || []) : null;
  };
  /** every row of shop B that points at a folder of shop A (parents, rules, routing): there must be none */
  const pointingAtA = () =>
    [...folders.values()].filter((f) => f.entity_id === SHOP_B && folders.has(f.parent_id) && folders.get(f.parent_id).entity_id === SHOP_A).length +
    rules.concat(routing).filter((r) => r.entity === SHOP_B && folders.has(r.folder) && folders.get(r.folder).entity_id === SHOP_A).length;
  /** every routing row of shop B that names a person of shop A: there must be none */
  const assigneesOfA = () => routing.filter((r) => r.entity === SHOP_B && actors.get(r.assignee) === SHOP_A).length;
  return { query, writes, pointingAtA, assigneesOfA, folders };
}

/** an answer as it is compared: status, type and body, the request id aside */
const comparable = (answer) => JSON.stringify({ status: answer.status, type: answer.type, body: answer.json ? Object.assign({}, answer.json, { request_id: null }) : answer.text });

/** ask as a shop with a fresh model; returns the answer and the model */
async function ask(port, model, who, method, url, body) {
  Object.assign(lab.world, { who, sqlRows: model.query, db: 'ok' });
  return lab.send(port, method, url, body);
}

/** one write, three asks: B for A's folder, B for an unknown folder (one answer), B for its own (success) */
async function oneWrite(port, label, spec) {
  const model = fkModel();
  const foreign = await ask(port, model, WHO_B, spec.method, spec.url(A_FOLDER), spec.body(A_FOLDER));
  const unknown = await ask(port, model, WHO_B, spec.method, spec.url(spec.unknown), spec.body(spec.unknown));
  check(label + ': another shop\'s folder is refused with ' + spec.refused + ' (it answered ' + foreign.status + ')', foreign.status === spec.refused, foreign.text.slice(0, 200));
  check(label + ': an unknown folder is refused with the same ' + spec.refused + ' (it answered ' + unknown.status + ')', unknown.status === spec.refused, unknown.text.slice(0, 200));
  check(label + ': foreign and unknown answer byte for byte alike, request id aside', comparable(foreign) === comparable(unknown), [foreign.text.slice(0, 160), unknown.text.slice(0, 160)]);
  check(label + ': nothing was written for the foreign folder', model.writes.length === 0 && model.pointingAtA() === 0, model.writes);
  const own = await ask(port, model, WHO_B, spec.method, spec.url(spec.own), spec.body(spec.own));
  check(label + ': the shop\'s own folder works (200, it answered ' + own.status + ')', own.status === 200, own.text.slice(0, 200));
  check(label + ': the own write was made, and none of shop B points at a folder of shop A', model.writes.length === 1 && model.pointingAtA() === 0, model.writes);
  return model;
}

/** SEC-103: the same three asks for the assignee of PUT /routing, then the own actor, the clears and a non-uuid */
async function assigneeCases(port) {
  const put = (model, assignee) => ask(port, model, WHO_B, 'PUT', '/api/entities/routing', { kind: 'incident', folder_id: null, assignee_actor_id: assignee, route_to_entity_id: null });
  const model = fkModel();
  const foreign = await put(model, A_ACTOR);
  const unknown = await put(model, GHOST_ACTOR);
  const notUuid = await put(model, 'not-a-uuid');
  check("assignee: another shop's person is refused with 404 (it answered " + foreign.status + ')', foreign.status === 404, foreign.text.slice(0, 200));
  check('assignee: an unknown person gets the same 404 (it answered ' + unknown.status + ')', unknown.status === 404, unknown.text.slice(0, 200));
  check('assignee: foreign, unknown and no-uuid answer byte for byte alike, request id aside', comparable(foreign) === comparable(unknown) && comparable(foreign) === comparable(notUuid), [foreign.text.slice(0, 160), unknown.text.slice(0, 160), notUuid.text.slice(0, 160)]);
  check('assignee: the answer says "Person not found" and does not echo the id sent', /Person not found/.test(foreign.text) && !foreign.text.includes(A_ACTOR) && !notUuid.text.includes('not-a-uuid'), foreign.text.slice(0, 200));
  check('assignee: nothing was written for the foreign person', model.writes.length === 0 && model.assigneesOfA() === 0, model.writes);
  const own = await put(model, B_ACTOR);
  check("assignee: the shop's own person works (200, it answered " + own.status + ')', own.status === 200, own.text.slice(0, 200));
  const cleared = await put(model, null);
  const emptied = await put(model, '');
  check('assignee: clearing with null or empty text is still a 200', cleared.status === 200 && emptied.status === 200, [cleared.text.slice(0, 120), emptied.text.slice(0, 120)]);
  check('assignee: the own write and the two clears were made, none names shop A person', model.writes.length === 3 && model.assigneesOfA() === 0, model.writes);
  const bare = fkModel();
  bare.query('INSERT INTO entity_work_routing (entity_id, kind, folder_id, assignee_actor_id) VALUES ($1,$2,$3,$4)', [SHOP_B, 'incident', null, A_ACTOR]);
  check('the model: a write with no lookup stores a person of shop A against shop B (the defect, there is no key to refuse it)', bare.assigneesOfA() === 1);
}

/** the model on its own: what Postgres does when a write skips the lookup, so the cases above are not passing on a model too kind to fail */
function modelShowsTheDefect() {
  const model = fkModel();
  const stored = model.query('INSERT INTO folder_rule (entity_id, folder_id) VALUES ($1,$2)', [SHOP_B, A_FOLDER]);
  let unknownCode = null;
  try {
    model.query('INSERT INTO folder_rule (entity_id, folder_id) VALUES ($1,$2)', [SHOP_B, UNKNOWN_MODEL]);
  } catch (failure) {
    unknownCode = failure.code;
  }
  check('the model: a write with no lookup stores a reference to another shop\'s folder (the defect)', stored.rowCount === 1 && model.pointingAtA() === 1);
  check('the model: the same write with an unknown folder fails with the foreign-key violation, the existence oracle (the defect)', unknownCode === FK_VIOLATION);
}

async function main() {
  lab.installStubs();
  const folders = require(path.join(HERE, 'routes', 'folders.js'));
  const entities = require(path.join(HERE, 'routes', 'entities.js'));
  const server = lab.appOf([{ mount: '/api/folders', router: folders }, { mount: '/api/entities', router: entities }]).listen(0);
  const port = server.address().port;
  console.log('-- SEC-100: the model of the foreign key --');
  modelShowsTheDefect();
  console.log('-- SEC-100: POST /api/folders/:id/rules --');
  await oneWrite(port, 'rule', { method: 'POST', url: (id) => '/api/folders/' + id + '/rules', body: () => ({ when: RULE_WHEN }), unknown: UNKNOWN_RULES, own: B_FOLDER, refused: 404 });
  console.log('-- SEC-100: PATCH /api/folders/:id with parent_id --');
  await oneWrite(port, 'parent', { method: 'PATCH', url: () => '/api/folders/' + B_FOLDER, body: (parent) => ({ parent_id: parent }), unknown: UNKNOWN_PATCH, own: B_FOLDER_TWO, refused: 404 });
  console.log('-- SEC-100: POST /api/folders with parent_id --');
  await oneWrite(port, 'create', { method: 'POST', url: () => '/api/folders', body: (parent) => ({ name: 'Mayur', parent_id: parent }), unknown: UNKNOWN_CREATE, own: B_FOLDER, refused: 400 });
  console.log('-- SEC-100: PUT /api/entities/routing with folder_id --');
  await oneWrite(port, 'routing', { method: 'PUT', url: () => '/api/entities/routing', body: (folder) => ({ kind: 'incident', folder_id: folder }), unknown: UNKNOWN_ROUTING, own: B_FOLDER, refused: 404 });

  console.log('-- SEC-103: PUT /api/entities/routing with assignee_actor_id --');
  await assigneeCases(port);

  console.log('-- SEC-100: the roots and the clears keep working --');
  const model = fkModel();
  const toRoot = await ask(port, model, WHO_B, 'PATCH', '/api/folders/' + B_FOLDER, { parent_id: '' });
  check('moving a folder to the root (parent_id empty) is still a 200', toRoot.status === 200, toRoot.text.slice(0, 200));
  const plain = await ask(port, model, WHO_B, 'POST', '/api/folders', { name: 'Mayur' });
  check('a folder with no parent is still made (200)', plain.status === 200, plain.text.slice(0, 200));
  const cleared = await ask(port, model, WHO_B, 'PUT', '/api/entities/routing', { kind: 'incident', folder_id: null });
  check('clearing the routing folder (null) is still a 200', cleared.status === 200, cleared.text.slice(0, 200));
  const asOwner = await ask(port, model, OWNER, 'POST', '/api/folders/' + A_FOLDER + '/rules', { when: RULE_WHEN });
  check('shop A\'s own folder takes a rule (200)', asOwner.status === 200, asOwner.text.slice(0, 200));
  const notAnId = await ask(port, model, WHO_B, 'PUT', '/api/entities/routing', { kind: 'incident', folder_id: 'nope' });
  check('a routing folder that is no uuid is the same 404, not a 500', notAnId.status === 404, notAnId.text.slice(0, 200));
  const systemParent = await ask(port, model, WHO_B, 'PATCH', '/api/folders/' + B_FOLDER, { parent_id: require(path.join(HERE, 'lib', 'folder-inventory')).sysId('B-2100') });
  check('a system folder as a parent is the same 404 (it is no row of the folder table)', systemParent.status === 404, systemParent.text.slice(0, 200));

  server.close();
  console.log('\n  ' + (lab.count.passed + lab.count.failed) + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
}

main().catch((failure) => {
  console.log('sec100-folder-fk crashed:', failure);
  process.exit(1);
});
