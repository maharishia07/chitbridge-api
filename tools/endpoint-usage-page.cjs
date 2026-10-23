/*
 * OWNS      the markdown page of the wide endpoint run (summary, bucket D count, the test-gap list, one line per called endpoint, same-purpose review).
 * CALLED BY tools/endpoint-usage-md.cjs
 * FLOW      page(wide, summary, gapGroups, names) -> markdown text
 * CARD      janitor/endpoint-usage
 */
'use strict';
const path = require('path');
const { twins } = require('./endpoint-usage-twins.cjs');

/** yes / no for a table cell. */
const yesNo = (value) => (value ? 'yes' : 'no');
/** METHOD /path of a row. */
const short = (row) => row.method + ' ' + row.full;

/** One markdown table from a header and rows. */
function table(header, rows) {
  return ['| ' + header.join(' | ') + ' |', '|' + header.map(() => '---').join('|') + '|']
    .concat(rows.map((cells) => '| ' + cells.join(' | ') + ' |'))
    .join('\n');
}

/** The counts of one group of rows, in the summary table's column order. */
function summaryLine(name, mine) {
  const count = (list, test) => list.filter(test).length;
  const called = mine.filter((row) => row.bucket !== 'D');
  const inBucket = (bucket) => count(mine, (row) => row.bucket === bucket);
  return [
    name,
    mine.length,
    inBucket('A'),
    inBucket('B'),
    inBucket('C'),
    inBucket('D'),
    count(called, (row) => row.tests.unit),
    count(called, (row) => row.tests.walk),
    count(called, (row) => row.tests.board),
    count(called, (row) => row.tests.cycle),
    count(called, (row) => row.tests.gap)
  ];
}

const SUMMARY_HEAD = [
  'area',
  'routes',
  'A live',
  'B internal',
  'C external',
  'D none (watch)',
  'unit/contract',
  'walk',
  'board case',
  'in 24 Oct cycle',
  'GAP: no walk, no board'
];

/** Summary rows: one per area plus the total. */
function summaryTable(rows, summary) {
  const body = summary.areas.map((item) =>
    summaryLine(
      item.area,
      rows.filter((row) => row.area === item.area)
    )
  );
  body.push(
    ['**all**'].concat(
      summaryLine('', rows)
        .slice(1)
        .map((value) => '**' + value + '**')
    )
  );
  return { text: table(SUMMARY_HEAD, body), calledCount: rows.filter((row) => row.bucket !== 'D').length };
}

/** The headline: gaps grouped by screen, each group listing its routes by area. */
function gapSection(groups) {
  const out = [];
  for (const [screen, list] of groups) {
    const byArea = {};
    for (const row of list) (byArea[row.area] = byArea[row.area] || []).push(short(row) + ' [' + row.bucket + ']');
    out.push('**' + screen + '** (' + list.length + ')');
    for (const area of Object.keys(byArea).sort()) out.push('- ' + area + ': ' + byArea[area].join(' · '));
    out.push('');
  }
  return out.join('\n');
}

/** One line per A/B/C endpoint. */
function endpointTable(rows) {
  const body = rows
    .filter((row) => row.bucket !== 'D')
    .sort((first, second) => first.area.localeCompare(second.area) || first.full.localeCompare(second.full))
    .map((row) => [
      '`' + short(row) + '`',
      row.area,
      row.bucket + (row.weak ? ' (weak)' : ''),
      row.why.replace(/\|/g, '/'),
      yesNo(row.tests.unit) + (row.tests.unitWhy.indexOf('real-stack') >= 0 ? ' +real' : ''),
      yesNo(row.tests.walk),
      yesNo(row.tests.board),
      yesNo(row.tests.cycle)
    ]);
  return table(['route', 'area', 'bucket', 'evidence (caller file:line, others +n)', 'unit/contract', 'walk', 'board case', '24 Oct cycle'], body);
}

/** Bucket D counts per area, with dead / planned when the history was read. */
function dSection(rows) {
  const dRows = rows.filter((row) => row.bucket === 'D');
  const areas = [...new Set(dRows.map((row) => row.area))].sort();
  const body = areas.map((area) => {
    const mine = dRows.filter((row) => row.area === area);
    const dead = mine.filter((row) => /^dead/.test(row.history || '')).length;
    const planned = mine.filter((row) => /^planned/.test(row.history || '')).length;
    return [area, mine.length, row0(dRows) ? dead : 'n/a', row0(dRows) ? planned : 'n/a'];
  });
  return table(['area', 'D count', 'dead (a client call existed, gone)', 'planned (no client call ever)'], body);
}

const row0 = (list) => list.length && list[0].history;

/** The same-purpose review. */
function twinsSection(API, rows) {
  const review = twins(API, rows);
  return [addressesSection(review), purposeSection(review), jobsSection(review)].join('\n');
}

/** Part 1: one handler at two addresses. */
function addressesSection(review) {
  const mounted = review.twoAddresses.mountedTwice;
  const listed = mounted.length ? mounted.map((mount) => '`' + mount.addresses.join('` and `') + '` (' + mount.at + ')').join('; ') : 'none';
  return [
    '### 1 · One handler at two addresses',
    '',
    'Mounted twice (the register counts each address): ' + listed + '.',
    'Same named handler on two paths: ' +
      review.twoAddresses.sameNamedHandler.length +
      '. Array or regex paths: ' +
      review.twoAddresses.arrayPaths.length +
      '. So the three CTP aliases are the only ones the scan finds; the protocol needs them.',
    ''
  ].join('\n');
}

/** Part 2: two handlers for one purpose (same table, same word, same lib function). */
function purposeSection(review) {
  const routesOf = (group) => group.routes.map((row) => '`' + short(row) + '`').join(' · ');
  return [
    '### 2 · Two handlers for one purpose (candidates, the owning areas decide)',
    '',
    '**2a · Same table, same verb, different areas** (route chunk SQL only; writes through a service or lib are not seen):',
    '',
    table(
      ['write', 'areas', 'routes', 'suggested owner'],
      review.sameTable.map((group) => ['`' + group.write + '`', group.areas.join(', '), group.routes.length, ownerOf(group)])
    ),
    '',
    '**2b · Same verb and last path word under different areas** (generic words skipped; ' + review.sameLeaf.length + ' groups, the widest 15 shown):',
    '',
    table(
      ['verb + word', 'routes'],
      review.sameLeaf.slice(0, 15).map((group) => [group.key, routesOf(group)])
    ),
    '',
    '**2c · One lib function behind short handlers of two areas** (' + review.sameLib.length + ' groups; thin wrappers around the same thing):',
    '',
    table(
      ['lib function', 'routes'],
      review.sameLib.map((group) => [group.fn, routesOf(group)])
    ),
    ''
  ].join('\n');
}

/** Part 3: one endpoint, two jobs. */
function jobsSection(review) {
  const body = review.twoJobs.map((item) => ['`' + short(item.row) + '`', item.field, item.values.join(' / '), item.row.file + ':' + item.line]);
  return [
    '### 3 · One endpoint, two jobs (the handler branches on a body or query field named like a mode)',
    '',
    table(['route', 'field', 'values', 'file:line'], body)
  ].join('\n');
}

/** The area that writes this table most is the suggested owner. */
function ownerOf(group) {
  const counts = {};
  for (const row of group.routes) counts[row.area] = (counts[row.area] || 0) + 1;
  return Object.entries(counts).sort((first, second) => second[1] - first[1])[0][0];
}

/** The page. */
function page(wide, summary, groups, names) {
  const rows = wide.rows;
  const sum = summaryTable(rows, summary);
  const API = path.join(__dirname, '..');
  const parts = [
    '## 1 · Summary',
    '',
    'Buckets: ' +
      Object.keys(names)
        .map((key) => names[key] + ' = ' + (summary.buckets[key] || 0))
        .join(' · ') +
      '. Total ' +
      rows.length +
      ' routes (the register counts 633: it also lists the cors `OPTIONS *`). ' +
      summary.weak +
      ' routes have only weak evidence (a path prefix or a bare registry key); they stay out of D and are marked (weak).',
    '',
    sum.text,
    '',
    '## 2 · Bucket D, no caller found: a count, kept as a watch figure',
    '',
    dSection(rows),
    '',
    '## 3 · THE GAP LIST: called endpoints with no walk and no board case (cases for cb-qa to write)',
    '',
    gapSection(groups),
    '## 4 · Every called endpoint (A, B, C) and whether it is tested and verified',
    '',
    endpointTable(rows),
    '',
    '## 5 · The same purpose twice',
    '',
    twinsSection(API, rows)
  ];
  return parts.join('\n');
}

module.exports = { page };
