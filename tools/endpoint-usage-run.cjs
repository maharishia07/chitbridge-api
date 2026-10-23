/*
 * OWNS      the wide run of tools/endpoint-usage.cjs: every caller source scanned, every route bucketed, test evidence attached.
 * CALLED BY tools/endpoint-usage.cjs (--buckets · --md)
 * FLOW      sources -> scanAll -> bucketsOf -> testEvidence -> { rows, meta }
 * CARD      janitor/endpoint-usage
 */
'use strict';
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const callers = require('./endpoint-usage-callers.cjs');
const report = require('./endpoint-usage-report.cjs');

/** Read a contract file under docs/contracts, or {} when it is not there (the column then reads "no", and meta says so). */
function readContract(API, name, inner) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(API, 'docs', 'contracts', name), 'utf8'));
    return inner ? data[inner] || {} : data;
  } catch (err) {
    logger.warn('endpoint-usage: ' + name + ' not read, so its unit/contract answers read no: ' + err.message);
    return {};
  }
}

/** The run. `options`: { API, WEB, ENG, rows, registryKeys, graph, cycle }. */
function runWide(options) {
  const { API, WEB_ROOT, ENGINES_ROOT, rows } = options;
  const srcs = callers.sources(API, WEB_ROOT, ENGINES_ROOT);
  const { hits, walkTexts } = callers.scanAll(srcs, rows, options.registryKeys);
  report.bucketsOf(rows, hits);
  const ctx = {
    errorTests: readContract(API, 'api-error-tests.json'),
    contractResults: readContract(API, 'api-contract-results.json', 'routes'),
    board: report.loadBoard(API, options.cycle),
    byFile: report.screensByFile(options.graph),
    walkTexts
  };
  report.testEvidence(rows, ctx);
  const repos = {};
  for (const source of srcs) repos[source.repo] = (repos[source.repo] || 0) + 1;
  return {
    rows,
    meta: {
      sources: srcs.length,
      sourcesByRepo: repos,
      walkFiles: Object.keys(walkTexts).length,
      boardCases: ctx.board.cases.length,
      cycleCodes: ctx.board.cycle.size,
      graph: options.graph ? 'read' : 'not given: screen answers are empty, pass --graph',
      errorTestRoutes: Object.keys(ctx.errorTests).length,
      contractRoutes: Object.keys(ctx.contractResults).length
    }
  };
}

module.exports = { runWide };
