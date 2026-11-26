#!/usr/bin/env node
'use strict';
/*
 * tools/paged-reads-report.cjs — which list routes really answered more rows than a line, read from the request log
 * OWNER     cb-speed
 * OWNS      the runtime half of the paged-read check (PERF1, Athi 26 Nov 2026: "if it is read, how many records it fetches, is lazy loading enabled or not"): which list routes really answered more than N rows.
 * CALLED BY by hand on a SIT box's request log; the register's static column paged_read (lib/paged-read.js) is the other half and the two are joined here (route -> its static facts).
 * FLOW      JSON log lines (the one "request" line, lib/request-log.js: route, status, rows, total, entity, seat) ──▶ per route: calls, max rows, p95 rows, max total ──▶ the routes over the line, worst first
 * CARD      28-platform-and-operations/api-standard
 *
 *   docker logs <api container> 2>&1 | node tools/paged-reads-report.cjs            lines on stdin
 *   node tools/paged-reads-report.cjs <logfile> [<logfile> ...] [--min 100] [--json] [--top 20]
 *   --min N    a route is listed when ANY answer carried more than N rows (default 100)
 *   --json     the report as JSON (PM/PAGED-READS-*.md is built from it)
 * Only the counts are read: no body, no query, no name. Lines written before the rows key existed carry no `rows` and are counted as "unmeasured".
 */
const fs = require('fs');
const path = require('path');

const flag = (name) => process.argv.includes(name);
const valueOf = (name, fallback) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : fallback; };

/** one request line out of a raw log line (a docker line may carry a prefix before the JSON), or null */
function requestOf(logLine) {
  const start = logLine.indexOf('{');
  if (start < 0) return null;
  try {
    const record = JSON.parse(logLine.slice(start));
    const body = record.ctx && typeof record.ctx === 'object' ? Object.assign({}, record, record.ctx) : record;
    return body.msg === 'request' || body.message === 'request' || body.route !== undefined ? body : null;
  } catch (failure) {
    return null; /* a line that is not JSON is not a request line: it is skipped and counted nowhere */
  }
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : 0);

/** { routes: [{ route, method, calls, measured, max_rows, p95_rows, max_total, seats }], unmeasured, lines } from raw lines */
function reportOf(lines, min) {
  const by = new Map();
  let unmeasured = 0;
  let seen = 0;
  for (const logLine of lines) {
    const record = requestOf(logLine);
    if (!record || record.method !== 'GET' || !(record.status >= 200 && record.status < 300) || !record.route) continue;
    seen++;
    if (typeof record.rows !== 'number') { unmeasured++; continue; }
    const key = record.method + ' ' + record.route;
    const entry = by.get(key) || { route: key, calls: 0, rows: [], max_total: 0, seats: new Set() };
    entry.calls++;
    entry.rows.push(record.rows);
    if (typeof record.total === 'number') entry.max_total = Math.max(entry.max_total, record.total);
    if (record.seat) entry.seats.add(record.seat);
    by.set(key, entry);
  }
  const routes = [...by.values()].map((entry) => {
    const sorted = entry.rows.slice().sort((a, b) => a - b);
    return { route: entry.route, calls: entry.calls, max_rows: sorted[sorted.length - 1], p95_rows: percentile(sorted, 0.95), over: sorted.filter((n) => n > min).length, max_total: entry.max_total, seats: [...entry.seats].sort() };
  });
  return { min, lists_seen: routes.length, get_lines: seen, unmeasured, routes: routes.filter((item) => item.max_rows > min).sort((a, b) => b.max_rows - a.max_rows) };
}

/** the report as text */
function render(report, top) {
  const out = ['GET list answers over ' + report.min + ' rows: ' + report.routes.length + ' of ' + report.lists_seen + ' list routes seen (' + report.get_lines + ' GET lines, ' + report.unmeasured + ' with no rows count)'];
  report.routes.slice(0, top).forEach((item) => out.push(String(item.max_rows).padStart(7) + ' rows max · p95 ' + String(item.p95_rows).padStart(6) + ' · ' + item.over + '/' + item.calls + ' calls over · total ' + item.max_total + ' · ' + item.route));
  return out.join('\n');
}

if (require.main === module) {
  const files = process.argv.slice(2).filter((arg, at, all) => !arg.startsWith('--') && !['--min', '--top'].includes(all[at - 1]));
  const text = files.length ? files.map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n') : fs.readFileSync(0, 'utf8');
  const report = reportOf(text.split(/\r?\n/), Number(valueOf('--min', 100)));
  console.log(flag('--json') ? JSON.stringify(report, null, 1) : render(report, Number(valueOf('--top', 20))));
}

module.exports = { requestOf, reportOf, render };
