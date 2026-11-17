/*
 * OWNS      the three "same purpose" questions over the route list: one handler at two addresses · two handlers for one purpose · one endpoint doing two jobs.
 * CALLED BY tools/endpoint-usage-page.cjs (--md)
 * FLOW      twins(API, rows) -> { twoAddresses, sameTable, sameLeaf, sameLib, twoJobs }
 * CARD      janitor/endpoint-usage
 *
 * 2026-10-23 (Athi: "we cannot have two different endpoints for the same purpose or the other way around"). Static reading of the route files
 * only: every pair here is a CANDIDATE with its evidence, never a verdict. The owning areas decide.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const NOISE_TABLES = /^(audit|audit_log|audit_events?|idempotency_keys?|trips?|access_events?|chit_reads|notifications?)$/;
const GENERIC_LEAF =
  /^(list|summary|status|me|health|count|counts|search|stats|config|settings|preview|export|import|verify|start|new|all|state|today|events?|context|read|reads)$/;
const MODE_FIELD = '(?:mode|action|op|operation|kind|type|variant|step|as)';
const SMALL_HANDLER_LINES = 25;

/** The source text of one route (from its declaration to the next one in the same file), cached per file. */
function chunkOf(API, row, cache) {
  if (!cache[row.file]) cache[row.file] = fs.readFileSync(path.join(API, row.file), 'utf8');
  return cache[row.file].slice(row.span[0], Math.min(row.span[1], row.span[0] + 20000));
}

/** (1) One handler at two addresses: a router mounted twice, an array/regex path, or one named handler on two paths. */
function twoAddresses(API, rows, cache) {
  const mountTwice = {};
  const sameHandler = {};
  for (const row of rows) {
    const key = row.file + ':' + row.line;
    (mountTwice[key] = mountTwice[key] || []).push(row.method + ' ' + row.full);
    const chunk = chunkOf(API, row, cache).split('\n').slice(0, 40).join('\n');
    const named = /,\s*([A-Za-z_$][\w$]*)\s*\)\s*;?\s*(?:\/\/.*)?\n/.exec(chunk.split('\n').slice(0, 3).join('\n') + '\n');
    if (named && !/^(auth|async|req|res|next)$/.test(named[1]))
      (sameHandler[row.file + ' ' + named[1]] = sameHandler[row.file + ' ' + named[1]] || []).push(
        row.method + ' ' + row.full + ' (' + row.file + ':' + row.line + ')'
      );
  }
  return {
    mountedTwice: Object.entries(mountTwice)
      .filter((e) => e[1].length > 1)
      .map((e) => ({ at: e[0], addresses: e[1] })),
    sameNamedHandler: Object.entries(sameHandler)
      .filter((e) => e[1].length > 1)
      .map((e) => ({ handler: e[0], routes: e[1] })),
    arrayPaths: rows.filter((row) => /router\.\w+\(\s*[[/]/.test(chunkOf(API, row, cache).slice(0, 80))).map((row) => row.file + ':' + row.line)
  };
}

/** Tables a route writes, with the verb: INSERT INTO t · UPDATE t SET · DELETE FROM t. */
function writesOf(text) {
  const out = new Set();
  for (const match of text.matchAll(/INSERT\s+INTO\s+"?([a-z_][\w]*)/gi)) out.add('INSERT ' + match[1].toLowerCase());
  for (const match of text.matchAll(/\bUPDATE\s+"?([a-z_][\w]*)"?\s+(?:AS\s+\w+\s+)?SET\b/gi)) out.add('UPDATE ' + match[1].toLowerCase());
  for (const match of text.matchAll(/DELETE\s+FROM\s+"?([a-z_][\w]*)/gi)) out.add('DELETE ' + match[1].toLowerCase());
  return [...out].filter((item) => !NOISE_TABLES.test(item.split(' ')[1]));
}

/** (2a) Two routes in different areas that write the same table with the same verb. */
function sameTable(API, rows, cache) {
  const groups = {};
  for (const row of rows) for (const walkLabel of writesOf(chunkOf(API, row, cache))) (groups[walkLabel] = groups[walkLabel] || []).push(row);
  return Object.entries(groups)
    .map(([write, list]) => ({ write, routes: list, areas: [...new Set(list.map((row) => row.area))] }))
    .filter((group) => group.areas.length > 1)
    .sort((first, second) => second.areas.length - first.areas.length);
}

/** (2b) Same verb and the same last two static segments under different areas (/crm/parties vs /entities/.../parties). */
function sameLeaf(rows) {
  const groups = {};
  for (const row of rows) {
    const segs = row.full.split('/').filter((segment) => segment && segment.charAt(0) !== ':');
    const leaf = segs[segs.length - 1];
    if (!leaf || GENERIC_LEAF.test(leaf) || segs.length < 3) continue;
    (groups[row.method + ' ' + leaf] = groups[row.method + ' ' + leaf] || []).push(row);
  }
  return Object.entries(groups)
    .map(([key, list]) => ({ key, routes: list, areas: [...new Set(list.map((row) => row.area))] }))
    .filter((group) => group.areas.length > 1)
    .sort((first, second) => second.areas.length - first.areas.length);
}

/** (2c) A lib function called from short handlers of two different areas: each route is a thin wrapper of the same thing. */
function sameLib(API, rows, cache) {
  const groups = {};
  for (const row of rows) {
    const chunk = chunkOf(API, row, cache);
    if (chunk.split('\n').length > SMALL_HANDLER_LINES + 12) continue;
    const imported = importsOf(cache[row.file]);
    for (const match of chunk.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(/g)) {
      if (imported[match[1]]) (groups[imported[match[1]] + '.' + match[2]] = groups[imported[match[1]] + '.' + match[2]] || []).push(row);
    }
  }
  return Object.entries(groups)
    .map(([fn, list]) => ({ fn, routes: [...new Set(list)], areas: [...new Set(list.map((row) => row.area))] }))
    .filter((group) => group.areas.length > 1 && group.routes.length <= 6);
}

/** Namespace name -> lib module, from `const x = require('../lib/y')` and `const { a } = require('../lib/y')`. */
function importsOf(source) {
  const out = {};
  for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"]\.\.\/lib\/([\w-]+)['"]\)/g)) out[match[1]] = match[2];
  return out;
}

/** (3) One endpoint, two jobs: the handler reads a body/query field named like a mode (directly or through a variable) and branches on two or more values. */
function twoJobs(API, rows, cache) {
  const found = [];
  for (const row of rows) {
    const foundItem = modeBranches(chunkOf(API, row, cache));
    if (foundItem) found.push({ row, field: foundItem.field, values: foundItem.values, line: row.line });
  }
  return found;
}

/** `const { mode, kind: k } = req.body` -> [[local name, field]] for the mode-like fields. */
function destructuredModes(chunk) {
  const out = [];
  const pattern = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:req\.(?:body|query)|body|b|q|query)\b/g;
  const modeLike = new RegExp('^' + MODE_FIELD + '$');
  for (const match of chunk.matchAll(pattern)) {
    for (const part of match[1].split(',')) {
      const [field, local] = part.split(':').map((x) => x.trim());
      if (modeLike.test(field)) out.push([local || field, field]);
    }
  }
  return out;
}

/** The mode field a chunk branches on and the values it compares it with, or null. */
function modeBranches(chunk) {
  const read = '(?:req\\.(?:body|query)|\\bbody|\\bb|\\bq|\\bquery|\\bpayload)\\.(' + MODE_FIELD + ')\\b';
  const names = new Map([['', '']]);
  for (const match of chunk.matchAll(new RegExp('(?:const|let|var)\\s+(\\w+)\\s*=[^;]{0,160}?' + read, 'g'))) names.set(match[1], match[2]);
  for (const [name, field] of destructuredModes(chunk)) names.set(name, field);
  for (const [name, field] of names) {
    const values = valuesCompared(chunk, name, read);
    if (values.size >= 2) return { field: field || 'mode', values: [...values] };
  }
  return null;
}

/** The string values a mode variable (or the body field itself when name is empty) is compared with, by === or by switch/case. */
function valuesCompared(chunk, name, read) {
  const values = new Set();
  const subject = name ? '\\b' + name : read;
  for (const match of chunk.matchAll(new RegExp(subject + '\\s*(?:===|!==)\\s*[\'"]([\\w-]+)[\'"]', 'g'))) values.add(match[match.length - 1]);
  if (!name) return values;
  for (const block of chunk.matchAll(new RegExp('switch\\s*\\(\\s*' + name + '\\s*\\)[\\s\\S]{0,1500}', 'g'))) {
    for (const label of block[0].matchAll(/case\s+['"]([\w-]+)['"]/g)) values.add(label[1]);
  }
  return values;
}

/** All three answers. */
function twins(API, rows) {
  const cache = {};
  const real = rows.filter((row) => row.span);
  return {
    twoAddresses: twoAddresses(API, real, cache),
    sameTable: sameTable(API, real, cache),
    sameLeaf: sameLeaf(real),
    sameLib: sameLib(API, real, cache),
    twoJobs: twoJobs(API, real, cache)
  };
}

module.exports = { twins };
