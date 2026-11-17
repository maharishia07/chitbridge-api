'use strict';
/* A proof page whose data reads failed paints its "Try again" state, and the keyboard pack then scans one opener and reports 0 popups
   with a green row (sit-au run b, 11 Nov: tasks @390 3 -> 0, finance 4 -> 2). watchReads() records the page's api GETs; readFailures() names the ones
   that mean "the data did not load": 5xx, 429, 408 and requests that failed outright. 404/403 are normal app states (books/health, Ledger-off, owner-only reads) and are not flagged. */
const isApi = (u) => u.split('?')[0].replace(/^https?:\/\/[^/]+/, '').indexOf('/api/') === 0;
const path = (u) => u.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
function watchReads(page) {
  const seen = [];
  page.on('response', (r) => { try { seen.push({ method: r.request().method(), status: r.status(), url: r.url() }); } catch (_) { /* page closed */ } });
  page.on('requestfailed', (q) => { try { seen.push({ method: q.method(), status: 0, url: q.url(), failed: (q.failure() && q.failure().errorText) || 'failed' }); } catch (_) { /* page closed */ } });
  return seen;
}
function readFailures(seen) {
  return seen.filter((r) => r.method === 'GET' && isApi(r.url) && (r.failed ? !/ERR_ABORTED/.test(r.failed) : r.status >= 500 || r.status === 429 || r.status === 408))
    .map((r) => (r.failed ? 'failed ' : r.status + ' ') + path(r.url));
}
module.exports = { watchReads, readFailures };
