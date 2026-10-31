/**
 * testing-scenes.cjs — the named scenarios of tests/api-problem-testing.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per refusal of routes/testing.js, and one per success answer, each with the stand-in rows it needs.
 * CALLED BY tests/api-problem-testing.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, body, url, after }] → the harness runs each one against the real route
 * CARD      qa/offline-guards
 * A scenario with `after: true` is an answer the sweep ADDS (the schema's refusal): the old code answered it otherwise, so it is run in a check but never frozen.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const T = '/api/testing';
const SHOP = '11111111-1111-4111-8111-111111111111';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JUNIT_OK = '<testsuites><testsuite name="s"><testcase name="[CTR-05] a single click chooses" classname="x"/></testsuite></testsuites>';
const JUNIT_NO_KEY = '<testsuites><testsuite name="s"><testcase name="nothing here" classname="x"/></testsuite></testsuites>';
const FEATURE = 'Feature: CTR-01 Clicks\n  Scenario: [CTR-05] a click\n    Given a screen\n    When I click\n    Then it opens\n';
const FEATURE_OK = 'Feature: CTR-01 Clicks\n  Scenario: CTR-05 a click\n    Given a screen\n    When I click\n    Then it opens\n';
const TOO_LONG = 'p'.repeat(81);
const SHIPPED_RECORD = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'cmdb', 'CAP-ADMIN.json'), 'utf8'));
const cannotWrite = { board: { canWrite: () => false } };

const RUN = '33333333-3333-4333-8333-333333333333';
const AT = '2026-10-01T10:00:00.000Z';
/** a test_result row as the table holds it (migrations/000_baseline_2026-10-21.sql + b292's project): the first with every column filled, the second with every nullable column null */
const RESULT_FULL = { result_id: RUN, entity_id: SHOP, definition_id: RUN, case_version: 1, case_key: 'CTR-05', module_key: 'CTR', status: 'pass', run_kind: 't1', layer: 'web', tested_by: SHOP, tester_name: 'Asha', at: AT, run_id: RUN, run_label: 'Sprint 4', note: 'ok', evidence: 'ev', build: 'b1', project: 'Sprint 4' };
const RESULT_BARE = { result_id: RUN, entity_id: SHOP, definition_id: null, case_version: null, case_key: 'CTR-06', module_key: null, status: 'fail', run_kind: 'manual', layer: null, tested_by: null, tester_name: null, at: AT, run_id: RUN, run_label: null, note: null, evidence: null, build: null, project: null };
/** the rows of a page read, each carrying the count of the whole set (readPage's window count) */
const paged = (rows) => rows.map((row) => Object.assign({}, row, { full_count: rows.length }));
/** the rows of a statement that matches `pattern`, a stand-in answer */
const rowsWhen = (pattern, rows) => (sql) => (pattern.test(sql) ? { rows, rowCount: rows.length } : null);

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { PARTY, answering, firstOf } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** an answer the sweep adds: never frozen */
  const N = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const withRows = (answer) => ({ sqlRows: answer });
  const failing = { db: 'fail' };
  const noEntity = { who: { identity_type: 'entity' } };
  const caseRow = answering(/UPDATE definition d SET status/, [{ definition_id: PARTY, name: 'CTR-05', status: 'retired', current_version: 1 }]);
  const record = answering(/COALESCE\(\$3, d\.current_version\)/, [{ name: 'CAP-SIGNIN', current_version: 1, version: 1, rules: { title: 'Sign in' }, created_at: '2026-10-01T00:00:00Z' }]);
  const spec = answering(/d\.kind = 'spec' AND d\.definition_id/, [{ definition_id: PARTY, name: 'CLAUSE-1', created_by: SHOP, current_version: 1, rules: { priority: 'Medium', state: 'raised', history: [] } }]);
  const incident = answering(/d\.kind = 'incident' AND d\.definition_id/, [{ definition_id: PARTY, name: 'INC-1', created_by: SHOP, current_version: 1, rules: { severity: 'Sev-3', state: 'raised', history: [] } }]);
  const result = { case_key: 'CTR-05', status: 'pass', run_kind: 't1' };
  const evidence = { data_base64: PNG_B64, mime: 'image/png', name: 'a.png' };
  const inserted = answering(/INSERT INTO definition /, [{ definition_id: PARTY }]);
  const change = { summary: 'Fix it', backout: 'Revert', cites: { ref: 'INC-1' } };
  return [
    /* SEC-122: a read of the shared board by a caller who is not a board writer */
    N('read-not-a-reader-cases', 'GET ' + T + '/cases', 403, { patch: cannotWrite }),
    N('read-not-a-reader-cases-gherkin', 'GET ' + T + '/cases/gherkin', 403, { patch: cannotWrite }),
    N('read-not-a-reader-results', 'GET ' + T + '/results', 403, { patch: cannotWrite }),
    N('read-not-a-reader-runs', 'GET ' + T + '/runs', 403, { patch: cannotWrite }),
    N('read-not-a-reader-coverage', 'GET ' + T + '/coverage', 403, { patch: cannotWrite }),
    N('read-not-a-reader-report', 'GET ' + T + '/report', 403, { patch: cannotWrite }),
    N('read-not-a-reader-reliability', 'GET ' + T + '/reliability', 403, { patch: cannotWrite }),
    N('read-not-a-reader-stale', 'GET ' + T + '/stale', 403, { patch: cannotWrite }),
    N('read-not-a-reader-engine', 'GET ' + T + '/engine', 403, { patch: cannotWrite }),
    N('read-not-a-reader-cmdb', 'GET ' + T + '/cmdb', 403, { patch: cannotWrite }),
    N('read-not-a-reader-cmdb--ci', 'GET ' + T + '/cmdb/:ci', 403, { url: T + '/cmdb/CAP-SIGNIN', patch: cannotWrite }),
    /* POST /cases/close */
    X('close-no-case', 'POST ' + T + '/cases/close', 400, { body: {} }),
    X('close-unknown-case', 'POST ' + T + '/cases/close', 404, { body: { case_key: 'CTR-05' } }),
    X('close-done', 'POST ' + T + '/cases/close', 200, { body: { case_key: 'CTR-05', why: 'done' }, setup: withRows(caseRow) }),
    X('close-fails', 'POST ' + T + '/cases/close', 500, { body: { case_key: 'CTR-05' }, setup: failing }),
    X('close-not-a-writer', 'POST ' + T + '/cases/close', 403, { body: { case_key: 'CTR-05' }, patch: cannotWrite }),
    X('close-no-entity', 'POST ' + T + '/cases/close', 401, { body: { case_key: 'CTR-05' }, setup: noEntity }),
    N('close-body-a-list', 'POST ' + T + '/cases/close', 400, { body: [] }),
    /* trace */
    X('trace-on', 'POST ' + T + '/trace', 200, { body: { minutes: 1 } }),
    X('trace-off', 'POST ' + T + '/trace', 200, { body: { off: true } }),
    X('trace-no-entity', 'POST ' + T + '/trace', 401, { setup: noEntity }),
    X('trace-fails', 'POST ' + T + '/trace', 500, { setup: { jsonThrows: true } }),
    X('trace-state', 'GET ' + T + '/trace', 200, {}),
    X('trace-state-no-entity', 'GET ' + T + '/trace', 401, { setup: noEntity }),
    X('trace-state-fails', 'GET ' + T + '/trace', 500, { setup: { jsonThrows: true } }),
    N('trace-body-a-list', 'POST ' + T + '/trace', 400, { body: [] }),
    /* vocabulary, engine */
    X('vocabulary', 'GET ' + T + '/vocabulary', 200, {}),
    X('vocabulary-fails', 'GET ' + T + '/vocabulary', 500, { setup: { jsonThrows: true } }),
    X('engine', 'GET ' + T + '/engine', 200, {}),
    /* the manifest file is missing: the answer is { engine: null } */
    X('engine-file-missing', 'GET ' + T + '/engine', 200, { patch: { fs: { existsSync: (file) => !/test-cases.json$/.test(String(file)) && require('fs').statSync(file, { throwIfNoEntry: false }) !== undefined } } }),
    X('engine-fails', 'GET ' + T + '/engine', 500, { setup: { jsonThrows: true } }),
    /* cases */
    X('cases-empty', 'GET ' + T + '/cases', 200, {}),
    X('cases-all', 'GET ' + T + '/cases', 200, { url: T + '/cases?all=1&limit=5' }),
    N('cases-page-twice', 'GET ' + T + '/cases', 400, { url: T + '/cases?page=1&page=2' }),
    X('import-nothing', 'POST ' + T + '/cases/import', 400, { body: {} }),
    X('import-not-a-writer', 'POST ' + T + '/cases/import', 403, { body: { cases: [{ case_key: 'A-1' }] }, patch: cannotWrite }),
    X('import-fails', 'POST ' + T + '/cases/import', 500, { body: { cases: [{ case_key: 'A-1', module_key: 'A' }] }, setup: failing }),
    N('import-body-a-list', 'POST ' + T + '/cases/import', 400, { body: [] }),
    X('seed-not-a-writer', 'POST ' + T + '/cases/seed', 403, { patch: cannotWrite }),
    X('seed-fails', 'POST ' + T + '/cases/seed', 500, { setup: failing }),
    /* gherkin */
    X('gherkin-export', 'GET ' + T + '/cases/gherkin', 200, {}),
    X('gherkin-export-fails', 'GET ' + T + '/cases/gherkin', 500, { setup: failing }),
    X('gherkin-import-nothing', 'POST ' + T + '/cases/gherkin', 400, { body: {} }),
    X('gherkin-import-no-feature', 'POST ' + T + '/cases/gherkin', 422, { body: { text: 'just words' } }),
    X('gherkin-import-not-a-writer', 'POST ' + T + '/cases/gherkin', 403, { body: { text: FEATURE }, patch: cannotWrite }),
    X('gherkin-import-fails', 'POST ' + T + '/cases/gherkin', 500, { body: { text: FEATURE }, setup: failing }),
    N('gherkin-import-body-a-list', 'POST ' + T + '/cases/gherkin', 400, { body: [] }),
    /* cmdb */
    X('cmdb-list', 'GET ' + T + '/cmdb', 200, {}),
    X('cmdb-one-not-a-ci', 'GET ' + T + '/cmdb/:ci', 400, { url: T + '/cmdb/nope' }),
    X('cmdb-one-unknown', 'GET ' + T + '/cmdb/:ci', 404, { url: T + '/cmdb/CAP-SIGNIN' }),
    X('cmdb-one-found', 'GET ' + T + '/cmdb/:ci', 200, { url: T + '/cmdb/CAP-SIGNIN', setup: withRows(record) }),
    X('cmdb-one-fails', 'GET ' + T + '/cmdb/:ci', 500, { url: T + '/cmdb/CAP-SIGNIN', setup: failing }),
    X('cmdb-put-does-not-fit', 'PUT ' + T + '/cmdb/:ci', 400, { url: T + '/cmdb/CAP-SIGNIN', body: {} }),
    X('cmdb-put-fails', 'PUT ' + T + '/cmdb/:ci', 500, { url: T + '/cmdb/CAP-ADMIN', body: SHIPPED_RECORD, setup: failing }),
    X('cmdb-put-not-a-writer', 'PUT ' + T + '/cmdb/:ci', 403, { url: T + '/cmdb/CAP-SIGNIN', body: {}, patch: cannotWrite }),
    N('cmdb-put-body-a-list', 'PUT ' + T + '/cmdb/:ci', 400, { url: T + '/cmdb/CAP-SIGNIN', body: [] }),
    X('cmdb-seed-not-a-writer', 'POST ' + T + '/cmdb/seed', 403, { patch: cannotWrite }),
    X('cmdb-seed-fails', 'POST ' + T + '/cmdb/seed', 500, { setup: failing }),
    /* results, runs, junit */
    X('result-not-recorded', 'POST ' + T + '/results', 422, { body: {} }),
    X('result-blocked-no-note', 'POST ' + T + '/results', 422, { body: { case_key: 'CTR-05', status: 'blocked', run_kind: 't1' } }),
    X('result-project-too-long', 'POST ' + T + '/results', 422, { body: Object.assign({ project: TOO_LONG }, result) }),
    X('result-recorded', 'POST ' + T + '/results', 200, { body: result }),
    X('result-fails', 'POST ' + T + '/results', 500, { body: result, setup: failing }),
    N('result-body-a-list', 'POST ' + T + '/results', 400, { body: [] }),
    X('results-project-too-long', 'GET ' + T + '/results', 400, { url: T + '/results?project=' + TOO_LONG }),
    X('results-board', 'GET ' + T + '/results', 200, {}),
    X('results-one-case', 'GET ' + T + '/results', 200, { url: T + '/results?case_key=CTR-05' }),
    N('results-case-twice', 'GET ' + T + '/results', 400, { url: T + '/results?case_key=a&case_key=b' }),
    X('runs-project-too-long', 'GET ' + T + '/runs', 400, { url: T + '/runs?project=' + TOO_LONG }),
    X('runs-list', 'GET ' + T + '/runs', 200, {}),
    X('junit-no-report', 'POST ' + T + '/results/junit', 400, { body: {} }),
    X('junit-not-read', 'POST ' + T + '/results/junit', 400, { body: { xml: JUNIT_OK, key_from: 'file' } }),
    X('junit-nothing-recognisable', 'POST ' + T + '/results/junit', 422, { body: { xml: JUNIT_NO_KEY } }),
    X('junit-recorded', 'POST ' + T + '/results/junit', 200, { body: { xml: JUNIT_OK } }),
    X('junit-fails', 'POST ' + T + '/results/junit', 500, { body: { xml: JUNIT_OK }, setup: failing }),
    N('junit-body-a-list', 'POST ' + T + '/results/junit', 400, { body: [] }),
    /* requirements */
    X('requirement-nothing', 'POST ' + T + '/requirements', 400, { body: {} }),
    X('requirement-no-evidence', 'POST ' + T + '/requirements', 400, { body: { requirement: 'It must work' } }),
    X('requirement-raised', 'POST ' + T + '/requirements', 200, { body: { requirement: 'It must work', observed: 'It did not' }, setup: withRows(inserted) }),
    X('requirement-fails', 'POST ' + T + '/requirements', 500, { body: { requirement: 'It must work', observed: 'It did not' }, setup: failing }),
    N('requirement-body-a-list', 'POST ' + T + '/requirements', 400, { body: [] }),
    X('requirements-list', 'GET ' + T + '/requirements', 200, {}),
    X('requirements-rejected', 'GET ' + T + '/requirements', 200, { url: T + '/requirements?state=rejected' }),
    N('requirements-state-twice', 'GET ' + T + '/requirements', 400, { url: T + '/requirements?state=a&state=b' }),
    X('requirement-not-a-state', 'PATCH ' + T + '/requirements/:id', 400, { body: { state: 'nope' } }),
    X('requirement-reject-no-why', 'PATCH ' + T + '/requirements/:id', 400, { body: { state: 'rejected' } }),
    X('requirement-unknown', 'PATCH ' + T + '/requirements/:id', 404, { body: { state: 'accepted' } }),
    X('requirement-set', 'PATCH ' + T + '/requirements/:id', 200, { body: { state: 'accepted' }, setup: withRows(spec) }),
    X('requirement-patch-fails', 'PATCH ' + T + '/requirements/:id', 500, { body: { state: 'accepted' }, setup: failing }),
    N('requirement-patch-body-a-list', 'PATCH ' + T + '/requirements/:id', 400, { body: [] }),
    /* incidents */
    X('incident-nothing', 'POST ' + T + '/incidents', 400, { body: {} }),
    X('incident-recorded', 'POST ' + T + '/incidents', 200, { body: { observed: 'It broke' }, setup: withRows(inserted) }),
    X('incident-fails', 'POST ' + T + '/incidents', 500, { body: { observed: 'It broke' }, setup: failing }),
    N('incident-body-a-list', 'POST ' + T + '/incidents', 400, { body: [] }),
    X('incidents-list', 'GET ' + T + '/incidents', 200, {}),
    N('incidents-state-twice', 'GET ' + T + '/incidents', 400, { url: T + '/incidents?state=a&state=b' }),
    X('incident-not-a-state', 'PATCH ' + T + '/incidents/:id', 400, { body: { state: 'nope' } }),
    X('incident-resolve-no-change', 'PATCH ' + T + '/incidents/:id', 400, { body: { state: 'resolved' } }),
    X('incident-close-no-why', 'PATCH ' + T + '/incidents/:id', 400, { body: { state: 'closed' } }),
    X('incident-unknown', 'PATCH ' + T + '/incidents/:id', 404, { body: { state: 'investigating' } }),
    X('incident-set', 'PATCH ' + T + '/incidents/:id', 200, { body: { state: 'investigating' }, setup: withRows(incident) }),
    X('incident-patch-fails', 'PATCH ' + T + '/incidents/:id', 500, { body: { state: 'investigating' }, setup: failing }),
    N('incident-patch-body-a-list', 'PATCH ' + T + '/incidents/:id', 400, { body: [] }),
    /* evidence */
    X('evidence-nothing', 'POST ' + T + '/evidence', 400, { body: {} }),
    X('evidence-not-an-image', 'POST ' + T + '/evidence', 400, { body: { data_base64: PNG_B64, mime: 'text/plain' } }),
    X('evidence-empty', 'POST ' + T + '/evidence', 400, { body: { data_base64: '=', mime: 'image/png' } }),
    X('evidence-too-large', 'POST ' + T + '/evidence', 413, { body: { data_base64: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64'), mime: 'image/png' } }),
    X('evidence-not-stored', 'POST ' + T + '/evidence', 500, { body: evidence, patch: { storage: { putForParticipants: async () => null } } }),
    X('evidence-stored', 'POST ' + T + '/evidence', 200, { body: evidence, patch: { storage: { putForParticipants: async () => PARTY } } }),
    X('evidence-fails', 'POST ' + T + '/evidence', 500, { body: evidence, patch: { storage: { putForParticipants: async () => { throw new Error('x'); } } } }),
    N('evidence-body-a-list', 'POST ' + T + '/evidence', 400, { body: [] }),
    /* reads */
    X('stale', 'GET ' + T + '/stale', 200, {}),
    X('coverage-project-too-long', 'GET ' + T + '/coverage', 400, { url: T + '/coverage?project=' + TOO_LONG }),
    X('coverage', 'GET ' + T + '/coverage', 200, {}),
    X('report-project-too-long', 'GET ' + T + '/report', 400, { url: T + '/report?project=' + TOO_LONG }),
    X('report', 'GET ' + T + '/report', 200, {}),
    X('reliability', 'GET ' + T + '/reliability', 200, { url: T + '/reliability?run_kind=t1' }),
    N('reliability-kind-twice', 'GET ' + T + '/reliability', 400, { url: T + '/reliability?run_kind=a&run_kind=b' }),
    /* changes and releases */
    X('change-no-summary', 'POST ' + T + '/changes', 400, { body: {} }),
    X('change-no-backout', 'POST ' + T + '/changes', 400, { body: { summary: 'Fix it' } }),
    X('change-no-cause', 'POST ' + T + '/changes', 400, { body: { summary: 'Fix it', backout: 'Revert' } }),
    X('change-recorded', 'POST ' + T + '/changes', 201, { body: change, setup: withRows(inserted) }),
    X('change-fails', 'POST ' + T + '/changes', 500, { body: change, setup: failing }),
    N('change-body-a-list', 'POST ' + T + '/changes', 400, { body: [] }),
    X('changes-list', 'GET ' + T + '/changes', 200, {}),
    X('changes-list-fails', 'GET ' + T + '/changes', 500, { setup: failing }),
    N('changes-state-twice', 'GET ' + T + '/changes', 400, { url: T + '/changes?state=a&state=b' }),
    X('release-unnamed', 'POST ' + T + '/releases', 400, { body: {} }),
    X('release-empty', 'POST ' + T + '/releases', 400, { body: { name: 'v1' } }),
    X('release-fails', 'POST ' + T + '/releases', 500, { body: { name: 'v1', changes: [PARTY] }, setup: failing }),
    N('release-body-a-list', 'POST ' + T + '/releases', 400, { body: [] }),
    X('releases-list', 'GET ' + T + '/releases', 200, {}),
    X('releases-list-fails', 'GET ' + T + '/releases', 500, { setup: failing }),
    ...writeBranch(tools),
    ...readyBranch(tools)
  ];
}

/**
 * The WRITE branch of the board: the database holds rows and answers the statements a write makes, so the real handler and the real libraries (importCases, upsertVersioned,
 * recordResults, lib/cmdb, lib/gherkin) give the whole of what each write can answer. Every route here names the keys of its success answer in the handler (S34), and each
 * key an answer can leave out (retired, retire_held, project_not_written, cite_held, cited) has a scene on each side, so the shape tools/api-allowlist.cjs derives
 * (docs/contracts/api-output-shapes.json) is the whole of what the route can say and the output filter drops nothing real.
 */
function writeBranch(tools) {
  const { PARTY, firstOf } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const world = (...answers) => ({ sqlRows: firstOf(...answers) });
  const projectColumn = rowsWhen(/information_schema\.columns/, [{ ok: 1 }]);
  const named = (...keys) => keys.map((key) => ({ definition_id: PARTY, name: key }));
  const created = (...keys) => rowsWhen(/INSERT INTO definition \(/, named(...keys));
  const liveCases = (...keys) => rowsWhen(/AND status <> 'retired'/, named(...keys));
  const haveCase = (rules) => rowsWhen(/d\.name = ANY\(\$2::text\[\]\)/, [{ definition_id: PARTY, name: 'CTR-05', current_version: 1, rules }]);
  const cases = [{ case_key: 'CTR-05', module_key: 'CTR', title: 'Sign in', zzz: 1 }, { case_key: 'CTR-06', module_key: 'CTR', title: 'Sign out' }];
  const shaped = require('../../lib/cmdb').shape(SHIPPED_RECORD).record;
  const heldCmdb = (rules) => rowsWhen(/d\.kind = \$2 AND d\.name = \$3/, [{ definition_id: PARTY, current_version: 3, rules }]);
  const savedRows = [{ result_id: RUN, case_key: 'CTR-05', status: 'pass', at: AT }, { result_id: RUN, case_key: 'CTR-06', status: 'fail', at: AT }];
  const savedWorld = (rows, ...more) => world(...more, rowsWhen(/INSERT INTO test_result/, rows));
  const result = { case_key: 'CTR-05', status: 'pass', run_kind: 't1' };
  const change = { definition_id: PARTY, name: 'CHG-1', current_version: 1, rules: { risk: 'routine', proves: ['CTR-05'], cites: { kind: 'incident', ref: 'INC-1', definition_id: PARTY, entity_id: SHOP }, history: [] } };
  const changeBare = { definition_id: PARTY, name: 'CHG-2', current_version: 2, rules: {} };
  const releaseWorld = (...rows) => world(rowsWhen(/d\.kind = 'change' AND d\.definition_id = ANY/, rows), created('REL-1'));
  return [
    /* POST /cases/import and /cases/seed: a rebuild that retires what the document dropped, one held back for being too small, an edit, an addition */
    X('import-rebuild', 'POST ' + T + '/cases/import', 200, { body: { cases }, setup: world(created('CTR-05', 'CTR-06'), liveCases('CTR-05', 'CTR-06', 'OLD-1')) }),
    X('import-rebuild-held', 'POST ' + T + '/cases/import', 200, { body: { cases: [cases[1]] }, setup: world(created('CTR-06'), liveCases(...Array.from({ length: 10 }, (one, at) => 'OLD-' + at))) }),
    X('import-edited', 'POST ' + T + '/cases/import', 200, { body: { cases: [cases[0]] }, setup: world(haveCase({}), liveCases('CTR-05')) }),
    X('import-add', 'POST ' + T + '/cases/import', 200, { body: { cases: [cases[1]], mode: 'add' }, setup: world(created('CTR-06'), liveCases('CTR-06', 'CTR-05')) }),
    X('seed-loaded', 'POST ' + T + '/cases/seed', 200, { setup: world(liveCases('OLD-1')) }),
    X('seed-nothing-to-retire', 'POST ' + T + '/cases/seed', 200, {}),
    /* POST /cases/gherkin */
    X('gherkin-import-done', 'POST ' + T + '/cases/gherkin', 200, { body: { text: FEATURE_OK }, setup: world(created('CTR-05')) }),
    X('gherkin-import-with-problems', 'POST ' + T + '/cases/gherkin', 200, { body: { text: FEATURE }, setup: world(created('CTR-05')) }),
    X('gherkin-import-without-cases', 'POST ' + T + '/cases/gherkin', 200, { body: { text: 'Feature: CTR-01 Clicks\n' }, setup: world(created('CTR-01')) }),
    /* PUT /cmdb/:ci and POST /cmdb/seed */
    X('cmdb-put-new', 'PUT ' + T + '/cmdb/:ci', 200, { url: T + '/cmdb/CAP-ADMIN', body: SHIPPED_RECORD, setup: world(created('CAP-ADMIN')) }),
    X('cmdb-put-unchanged', 'PUT ' + T + '/cmdb/:ci', 200, { url: T + '/cmdb/CAP-ADMIN', body: SHIPPED_RECORD, setup: world(heldCmdb(shaped)) }),
    X('cmdb-put-edited', 'PUT ' + T + '/cmdb/:ci', 200, { url: T + '/cmdb/CAP-ADMIN', body: SHIPPED_RECORD, setup: world(heldCmdb({ title: 'older' })) }),
    X('cmdb-seed-loaded', 'POST ' + T + '/cmdb/seed', 200, { setup: world(created('CAP-ADMIN')) }),
    /* POST /results and /results/junit: the project column there or not, the rows the insert gave back */
    X('result-recorded-rows', 'POST ' + T + '/results', 200, { body: { results: [result, { case_key: 'CTR-06', status: 'fail', run_kind: 't1' }] }, setup: savedWorld(savedRows) }),
    X('result-recorded-project', 'POST ' + T + '/results', 200, { body: Object.assign({ project: 'Sprint 4', run_label: 'Sprint 4', build: 'b1' }, result), setup: savedWorld(savedRows.slice(0, 1), projectColumn) }),
    X('result-project-not-written', 'POST ' + T + '/results', 200, { body: Object.assign({ project: 'Sprint 4' }, result), setup: savedWorld(savedRows.slice(0, 1)) }),
    X('junit-recorded-rows', 'POST ' + T + '/results/junit', 200, { body: { xml: JUNIT_OK, project: 'Sprint 4', run_label: 'nightly' }, setup: savedWorld(savedRows.slice(0, 1), projectColumn) }),
    /* POST /requirements: a case to cite */
    X('requirement-raised-cited', 'POST ' + T + '/requirements', 200, { body: { requirement: 'It must work', observed: 'It did not', case_key: 'CTR-05', clause: 'CLAUSE-9' }, setup: world(rowsWhen(/d\.kind = 'testcase' AND d\.name = \$2/, [{ definition_id: PARTY, current_version: 1, rules: { title: 'Sign in' } }]), created('CLAUSE-9')) }),
    X('requirement-raised-case-on-shared-board', 'POST ' + T + '/requirements', 200, { body: { requirement: 'It must work', observed: 'It did not', case_key: 'CTR-05' }, patch: { board: { entityFor: () => '99999999-9999-4999-8999-999999999999' } }, setup: world(rowsWhen(/SELECT 1 FROM definition/, [{ '?column?': 1 }]), created('CLAUSE-8')) }),
    X('requirement-raised-no-such-case', 'POST ' + T + '/requirements', 200, { body: { requirement: 'It must work', observed: 'It did not', case_key: 'CTR-09' }, patch: { board: { entityFor: () => '99999999-9999-4999-8999-999999999999' } }, setup: world(created('CLAUSE-7')) }),
    /* POST /releases: a change that proves a case and cites an incident, one that proves nothing and cites none */
    X('release-cut', 'POST ' + T + '/releases', 201, { body: { name: 'v1', note: 'first', changes: [PARTY] }, setup: releaseWorld(change, changeBare) }),
    X('release-cut-bare', 'POST ' + T + '/releases', 201, { body: { name: 'v2', changes: [PARTY] }, setup: releaseWorld(changeBare) })
  ];
}

/**
 * The READY branch of the board's reads: the database holds rows, the project column exists, so the real handlers and the real libraries (lib/page-limit, lib/teststatus, lib/cmdb) run over them.
 * Every row below carries every column its statement selects (the table's DDL: test_result in migrations/000_baseline_2026-10-21.sql + b292's project), a nullable column null in the second row,
 * so the shape tools/api-allowlist.cjs derives (docs/contracts/api-output-shapes.json) is the whole of what the board can answer, and the output filter drops nothing real.
 */
function readyBranch(tools) {
  const { PARTY, firstOf } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const projectColumn = rowsWhen(/information_schema\.columns/, [{ ok: 1 }]);
  const world = (...answers) => ({ sqlRows: firstOf(projectColumn, ...answers) });
  const CASE_RULES = { title: 'Sign in', priority: 'High', pre: 'p', data: 'd', steps: ['a'], note: 'n', layer: 'web', module_name: 'Clicks', intro: 'i', test_type: 'system', group: 'g', automated: true, areas: ['a'], subjects: ['s'], claim: 'c', run_by: 'person', seq: 1, step: 's', cites: { spec: 'SPEC', clause: 'CLAUSE-1', definition_id: PARTY, version: 1 }, screen_purpose: 'sp', generic: false, changed_at: AT, needs: ['n'], held: null, menu: 'Rail', generated: false, observed: 'o', evidence_id: PARTY, screen_code: 'S1', control_code: 'C1', written_by: 'Asha', written_by_id: SHOP, written_at: AT, closed_note: null, closed_by: null, closed_at: null };
  const history = [{ state: 'raised', at: AT, by: 'Asha', by_id: SHOP }];
  const spec = { definition_id: PARTY, name: 'CLAUSE-1', sub_kind: 'SPEC', status: 'live', updated_at: AT, created_by: SHOP, rules: { text: 'It must work', observed: 'It did not', priority: 'High', screen_code: 'S1', popup_code: 'P1', state: 'raised', raised_from: 'screen', raised_by: 'Asha', raised_at: AT, raised_by_id: SHOP, why: 'w', history } };
  const specBare = { definition_id: PARTY, name: 'CLAUSE-2', sub_kind: null, status: 'live', updated_at: AT, created_by: null, rules: {} };
  const incident = { definition_id: PARTY, name: 'INC-1', sub_kind: null, status: 'live', updated_at: AT, created_by: SHOP, rules: { severity: 'Sev-1', observed: 'It broke', screen_code: 'S1', popup_code: 'P1', evidence_id: PARTY, affected: 'all', build: 'b1', found_by_case: 'CTR-05', state: 'resolved', happened_at: '2026-09-30T10:00:00.000Z', raised_at: AT, resolved_at: '2026-10-02T10:00:00.000Z', defects: ['D1'], changes: ['CHG-1'], raised_by: 'Asha', raised_by_id: SHOP, origin: 'shop', resolved_in: 'v1', why: 'w', history } };
  const incidentBare = { definition_id: PARTY, name: 'INC-2', sub_kind: null, status: 'live', updated_at: AT, created_by: null, rules: {} };
  const change = { definition_id: PARTY, name: 'CHG-1', sub_kind: 'routine', status: 'live', updated_at: AT, rules: { text: 'Fix it', backout: 'Revert', cites: { ref: 'INC-1', entity_id: SHOP }, repo: 'api', sha: 'abc', proves: ['CTR-05'], shipped_in: 'v1', state: 'reviewed', raised_by: 'Asha', history } };
  const changeBare = { definition_id: PARTY, name: 'CHG-2', sub_kind: null, status: 'live', updated_at: AT, rules: {} };
  const release = { definition_id: PARTY, name: 'v1', note: 'n', updated_at: AT, rules: { carried: [PARTY], proves: ['CTR-05'], cut_by: 'Asha' } };
  const releaseBare = { definition_id: PARTY, name: 'v0', note: null, updated_at: AT, rules: {} };
  const cover = [{ module_key: 'CTR', module_name: 'Clicks', total: '3', passed: '1', failed: '1', blocked: '0', skipped: '0', untested: '1', high_untested: '1', untested_swept: '0', untested_written: '1' }];
  const bad = [
    { case_key: 'CTR-05', module_key: 'CTR', status: 'fail', note: 'n', evidence: 'ev', tester_name: 'Asha', run_kind: 't1', layer: 'web', at: AT, case_version: 1 },
    { case_key: 'CTR-06', module_key: null, status: 'blocked', note: null, evidence: null, tester_name: null, run_kind: 'manual', layer: null, at: AT, case_version: null }
  ];
  const found = [
    { kind: 'incident', name: 'INC-1', status: 'live', rules: incident.rules },
    { kind: 'spec', name: 'CLAUSE-1', status: 'live', rules: spec.rules },
    { kind: 'testcase', name: 'CTR-H1', status: 'live', rules: { title: 't', state: '', written_by: 'Asha', written_at: AT, closed_note: 'done' } },
    { kind: 'testcase', name: 'CTR-H2', status: 'retired', rules: {} }
  ];
  const people = [{ tested_by: SHOP, tester_name: 'Asha', recorded: 2, passed: 1, failed: 1, blocked: 0, skipped: 0, first_at: AT, last_at: AT }];
  const sitting = [{ run_id: RUN, run_label: 'Sprint 4', build: 'b1', project: 'Sprint 4', started: AT, finished: AT, kinds: 't1', testers: 'Asha, Ravi', layers: 'web', total: '2' }];
  const kinds = [
    { test_type: 'unit', layer: 'engine', total: 2, run: 1, passed: 1, failed: 0 },
    { test_type: 'system', layer: 'web', total: 1, run: 1, passed: 0, failed: 1 }
  ];
  const reportWorld = world(
    rowsWhen(/untested_written/, cover),
    rowsWhen(/SELECT DISTINCT ON \(case_key\) case_key, module_key, status, note, evidence/, bad),
    rowsWhen(/GROUP BY tested_by/, people),
    rowsWhen(/string_agg\(DISTINCT layer/, sitting),
    rowsWhen(/SELECT count\(\*\)::int AS n FROM definition d/, [{ n: 1 }]),
    rowsWhen(/GROUP BY c\.test_type, c\.layer/, kinds),
    rowsWhen(/SELECT d\.kind, d\.name, d\.status, v\.rules/, found)
  );
  const sittings = [
    { run_id: RUN, run_label: 'Sprint 4', build: 'b1', project: 'Sprint 4', started: AT, finished: AT, kinds: 't1, manual', testers: 'Asha', total: '2', passed: '1', failed: '1', blocked: '0', skipped: '0' },
    { run_id: RUN, run_label: null, build: null, project: null, started: AT, finished: AT, kinds: 'manual', testers: null, total: '1', passed: '0', failed: '0', blocked: '0', skipped: '1' }
  ];
  const tracked = [
    { case_key: 'CTR-05', module_key: 'CTR', runs: '3', passed: '1', failed: '2', blocked: '0', skipped: '0', flips: '2', first_seen: AT, last_seen: AT, kinds: 't1', layers: 'web', last_status: 'fail', tester_name: 'Asha', last_kind: 't1' },
    { case_key: 'CTR-06', module_key: null, runs: '2', passed: '2', failed: '0', blocked: '0', skipped: '0', flips: '0', first_seen: AT, last_seen: AT, kinds: null, layers: null, last_status: 'pass', tester_name: null, last_kind: 'unit' }
  ];
  const area = { module_key: 'CTR', module_name: 'Clicks', total: '3', tested: '2', passed: '1', failed: '1', blocked: '0', untested: '1', high_untested: '1', tested_in_run: '0' };
  const group = { key: 'web', total: '2', passed: '1', failed: '0', blocked: '0', untested: '1' };
  const trend = { run_id: RUN, run_label: 'Sprint 4', at: AT, passed: '1', failed: '0', blocked: '0', total: '1' };
  /** a row as the database answers before b292 added the project column */
  const withoutProject = (row) => Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'project'));
  const staleBare = { case_key: 'CTR-06', module_key: null, rules: {}, clause: 'CLAUSE-2', spec: null, clause_now: 3 };
  const staleCase = { case_key: 'CTR-05', module_key: 'CTR', rules: { title: 'Sign in', cites: { version: 1 } }, clause: 'CLAUSE-1', spec: 'SPEC', clause_now: 2 };
  return [
    X('cases-ready', 'GET ' + T + '/cases', 200, { setup: world(rowsWhen(/\$2::boolean IS TRUE/, paged([{ definition_id: PARTY, name: 'CTR-05', sub_kind: 'CTR', status: 'live', current_version: 1, rules: CASE_RULES }, { definition_id: PARTY, name: 'CTR-06', sub_kind: null, status: 'retired', current_version: 2, rules: {} }]))) }),
    X('cmdb-list-ready', 'GET ' + T + '/cmdb', 200, { setup: world(rowsWhen(/d\.kind = 'cmdb'/, paged([{ name: 'CAP-SIGNIN', current_version: 1, updated_at: AT, rules: { title: 'Sign in', source: 'repo' } }, { name: 'CAP-ADMIN', current_version: 2, updated_at: AT, rules: {} }]))) }),
    X('results-ready', 'GET ' + T + '/results', 200, { setup: world(rowsWhen(/FROM \(SELECT DISTINCT ON/, paged([RESULT_FULL, RESULT_BARE]))) }),
    X('results-before-the-project-column', 'GET ' + T + '/results', 200, { setup: { sqlRows: rowsWhen(/FROM \(SELECT DISTINCT ON/, paged([withoutProject(RESULT_FULL), withoutProject(RESULT_BARE)])) } }),
    X('runs-before-the-project-column', 'GET ' + T + '/runs', 200, { setup: { sqlRows: rowsWhen(/GROUP BY run_id/, paged(sittings.map(withoutProject))) } }),
    X('results-ready-one-case', 'GET ' + T + '/results', 200, { url: T + '/results?case_key=CTR-05', setup: world(rowsWhen(/AND case_key = \$2/, paged([RESULT_FULL, RESULT_BARE]))) }),
    X('runs-ready', 'GET ' + T + '/runs', 200, { setup: world(rowsWhen(/GROUP BY project/, [{ project: 'Sprint 4', runs: 2, last_at: AT }]), rowsWhen(/GROUP BY run_id/, paged(sittings))) }),
    X('requirements-ready', 'GET ' + T + '/requirements', 200, { setup: world(rowsWhen(/AS state, count\(\*\)::int AS n/, [{ state: 'raised', n: 2 }]), rowsWhen(/d\.kind = 'spec'/, paged([spec, specBare]))) }),
    X('incidents-ready', 'GET ' + T + '/incidents', 200, { setup: world(rowsWhen(/AS severity, count\(\*\)::int AS n/, [{ state: 'raised', severity: 'Sev-1', n: 1 }]), rowsWhen(/d\.kind = 'incident'/, paged([incident, incidentBare]))) }),
    X('stale-ready', 'GET ' + T + '/stale', 200, { setup: world(rowsWhen(/IS NOT NULL/, [staleCase, staleBare])) }),
    X('coverage-ready', 'GET ' + T + '/coverage', 200, { setup: world(rowsWhen(/tested_in_run/, [area]), rowsWhen(/SELECT c\.\w+ AS key/, [group]), rowsWhen(/max\(run_label\) AS run_label, max\(at\) AS at/, [trend])) }),
    X('report-ready', 'GET ' + T + '/report', 200, { setup: reportWorld }),
    X('report-ready-one-run', 'GET ' + T + '/report', 200, { url: T + '/report?run_id=' + RUN + '&project=Sprint%204', setup: reportWorld }),
    X('reliability-ready', 'GET ' + T + '/reliability', 200, { setup: world(rowsWhen(/COUNT\(DISTINCT run_id\)::int AS n FROM test_result/i, [{ n: 3 }]), rowsWhen(/lag\(status\)/, tracked)) }),
    X('changes-ready', 'GET ' + T + '/changes', 200, { url: T + '/changes?state=all', setup: world(rowsWhen(/d\.kind = 'change'/, [change, changeBare])) }),
    X('changes-past-the-cap', 'GET ' + T + '/changes', 200, { url: T + '/changes?state=all&limit=9999&page=2', setup: world(rowsWhen(/d\.kind = 'change'/, [change])) }),
    X('releases-ready', 'GET ' + T + '/releases', 200, { setup: world(rowsWhen(/d\.kind = 'release'/, [release, releaseBare])) }),
    X('releases-past-the-cap', 'GET ' + T + '/releases', 200, { url: T + '/releases?limit=9999&page=2', setup: world(rowsWhen(/d\.kind = 'release'/, [release])) })
  ];
}

module.exports = { extras };
