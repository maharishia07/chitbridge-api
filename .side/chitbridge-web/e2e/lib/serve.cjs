/* serve.cjs — a static server over public/ on a port the OS picks (the pattern books-web.cjs and cb-accounts.cjs use).
 * ROOT can be another directory: the *-breaks.cjs files point it at a mutated COPY of public/.                                   */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
exports.PUBLIC = path.join(__dirname, '..', '..', 'public');
exports.serve = function (root) {
  root = root || exports.PUBLIC;
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]);
    /* SHELL-ONE: Home is the repo-root index.html (as it deploys); on the public/ root '/' and '/index.html' serve it, so a tour of every page starts at Home */
    const home = root === exports.PUBLIC && (p === '/' || p === '/index.html');
    const f = home ? path.join(root, '..', 'index.html') : path.join(root, p === '/' ? 'index.html' : p);
    if (!home && !f.startsWith(root)) { r.statusCode = 403; return r.end('no'); }
    fs.readFile(f, (e, d) => {
      if (e) { r.statusCode = 404; return r.end('not found'); }
      r.setHeader('content-type', T[path.extname(f)] || 'application/octet-stream'); r.setHeader('cache-control', 'no-store'); r.end(d);
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port, url: (p) => 'http://127.0.0.1:' + srv.address().port + p, close: () => srv.close() })));
};
