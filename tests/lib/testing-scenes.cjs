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
const TOO_LONG = 'p'.repeat(81);
const SHIPPED_RECORD = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'cmdb', 'CAP-ADMIN.json'), 'utf8'));
const cannotWrite = { board: { canWrite: () => false } };

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
    X('releases-list-fails', 'GET ' + T + '/releases', 500, { setup: failing })
  ];
}

module.exports = { extras };
