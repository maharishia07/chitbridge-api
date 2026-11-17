// Retire-7 (DECISIONS d05560bf, api #1145): the api answers 404 for four retired routes,
// so the web API map must not name them. Fails if any of the four comes back.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
const RETIRED = ['/api/assist/gap\'', '/api/assist/gaps\'', '/api/connections/list\'', '/api/connections/pending\''];
let fail = 0;
for (const p of RETIRED) {
  const hit = html.includes("p: '" + p);
  console.log((hit ? 'FAIL  ' : 'ok    ') + p.slice(0, -1) + (hit ? ' is still in the API map' : ' is gone from the API map'));
  if (hit) fail++;
}
console.log(fail ? fail + ' failed' : 'ALL PASS');
process.exit(fail ? 1 : 0);
