/**
 * tests/support/books-capture.cjs — RECORD THE SUCCESS ANSWERS a books test gets from the real router, in the file format tests/api-problem-books.test.cjs --capture writes
 * (a JSON object keyed "<METHOD> /api/books/<route as written>|<scenario>" → { route, status, type, body }), so tools/api-allowlist.cjs can read them (API-STANDARD S34).
 * OWNS      the writer for `--capture F` in the period and close-country tests · the path → route-template match · the answers fixture (build, and the check that a test still answers what it holds).
 * CALLED BY tests/books-period.test.cjs · tests/books-close-country.test.cjs · tests/api-problem-books.test.cjs (answersOf)
 * Only a 2xx answer that is JSON is kept: the allow-list is about what a success says.
 * FIXTURE   docs/contracts/books-answers.json is PRODUCED from those capture files, never typed (the command, with its date, is in the file's own `about`):
 *             node tests/support/books-capture.cjs --build docs/contracts/books-answers.json <period capture> <close capture>
 *           tests/api-problem-books.test.cjs reads it (checkAllowList) because its no-DB sweep never reaches these answers; the two tests above compare the keys they answer NOW with it (differences),
 *           so a code change that adds a key to an answer fails there until the fixture is rebuilt.
 */
'use strict';
const fs = require('fs');

/** the value after `--capture` in argv, or null */
const captureFile = (argv) => (argv.includes('--capture') ? argv[argv.indexOf('--capture') + 1] : null);

/** every route the router holds as { method, template, pattern } (`/accruals/:ref/reverse` → a regex that takes any one path segment for :ref) */
function templatesOf(router, mount) {
  const out = [];
  router.stack.filter((layer) => layer.route).forEach((layer) => Object.keys(layer.route.methods).forEach((method) => {
    const pattern = new RegExp('^' + (mount + layer.route.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/]+') + '$');
    out.push({ method: method.toUpperCase(), template: mount + layer.route.path, pattern });
  }));
  return out;
}

/** every key path of a value (objects by key, arrays by their items): ['a', 'a.b', 'list[].c'] sorted, so two answers with the same keys compare equal whatever their values */
function keyPaths(value, where) {
  const prefix = where || '';
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => keyPaths(item, prefix + '[]')))].sort();
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value).flatMap((key) => [prefix ? prefix + '.' + key : key].concat(keyPaths(value[key], prefix ? prefix + '.' + key : key))).sort();
}

/** the fixture's answers { key: { route, status, type, body } }, or {} when it is absent */
function answersOf(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).answers || {};
  } catch (unreadable) {
    return {};
  }
}

/** a recorder for `scenarioPrefix`: note(method, path, status, body, wasJson) after each call, save() at the end, differences(fixtureFile) for the check */
function recorder(file, router, mount, scenarioPrefix) {
  const routes = templatesOf(router, mount);
  const recording = {};
  let n = 0;
  return {
    note(method, requestPath, status, body, jsonAnswer) {
      if (status < 200 || status >= 300 || !jsonAnswer) return;
      const route = routes.find((one) => one.method === method && one.pattern.test(requestPath.split('?')[0]));
      if (!route) return;
      const key = method + ' ' + route.template;
      recording[key + '|' + scenarioPrefix + '-' + String(++n).padStart(3, '0')] = { route: key, status, type: 'application/json', body };
    },
    save() {
      if (!file) return;
      fs.writeFileSync(file, JSON.stringify(recording, null, 1));
      console.log('captured ' + Object.keys(recording).length + ' success answers');
    },
    /** the answers of this run whose key paths differ from the fixture's under the same key (and the fixture's answers of this prefix this run did not give): [ 'key: +added -missing' ] */
    differences(fixtureFile) {
      const fixture = answersOf(fixtureFile);
      const changed = Object.keys(recording).map((key) => {
        const now = keyPaths(recording[key].body), before = fixture[key] ? keyPaths(fixture[key].body) : null;
        if (!before) return key + ': not in the fixture';
        const added = now.filter((one) => !before.includes(one)), missing = before.filter((one) => !now.includes(one));
        return added.length || missing.length ? key + ': +' + added.join(',') + ' -' + missing.join(',') : null;
      });
      const gone = Object.keys(fixture).filter((key) => key.split('|')[1].startsWith(scenarioPrefix + '-') && !recording[key]).map((key) => key + ': in the fixture, not answered now');
      return changed.filter(Boolean).concat(gone);
    },
  };
}

/** --build OUT IN... : merge capture files into the fixture file OUT (answers sorted by key; the file says how it was made) */
function build(out, inputs) {
  const answers = {};
  inputs.forEach((file) => Object.assign(answers, JSON.parse(fs.readFileSync(file, 'utf8'))));
  const about = 'The 2xx JSON answers the period-end books routes gave to the real router over the in-memory ledger, recorded by tests/books-period.test.cjs, tests/books-close-country.test.cjs and tests/move-in-country-gate.test.cjs (every answer branch of the period routes, the ledger-off writer included, and the two move-in doors). '
    + 'PRODUCED, never typed, on ' + new Date().toISOString().slice(0, 10) + ' with: node tests/books-period.test.cjs --capture period.json && node tests/books-close-country.test.cjs --capture close.json && node tests/move-in-country-gate.test.cjs --capture movein.json && node tests/support/books-capture.cjs --build docs/contracts/books-answers.json period.json close.json movein.json . '
    + 'Read by tests/api-problem-books.test.cjs (checkAllowList: the no-DB sweep never reaches these) and by tools/api-allowlist.cjs (--capture docs/contracts/books-answers.json). The three recording tests compare the keys they answer now with this file and fail until it is rebuilt.';
  fs.writeFileSync(out, JSON.stringify({ about, answers: Object.fromEntries(Object.keys(answers).sort().map((key) => [key, answers[key]])) }, null, 1) + '\n');
  console.log('wrote ' + out + ': ' + Object.keys(answers).length + ' answers');
}
if (require.main === module && process.argv[2] === '--build') build(process.argv[3], process.argv.slice(4));

module.exports = { captureFile, recorder, keyPaths, answersOf };
