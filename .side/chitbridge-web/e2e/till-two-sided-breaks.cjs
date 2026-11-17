/* till-two-sided-breaks.cjs — break each of the COUNTER's two-sided guards once; e2e/till-two-sided.cjs must go red each time.
 *
 * The guards live in the MASTER (chitbridge-api/tools/tally-connector/till.html — never this repo's copy). Each break:
 * copy the master, edit it, vendor (chitbridge-api scripts/vendor-till.cjs), run the harness, then restore the master FROM
 * THE COPY (never git) and vendor again. One browser at a time.
 * The server's guards: chitbridge-api scripts/two-sided-breaks.cjs.
 * Run: node e2e/till-two-sided-breaks.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const API = path.join(__dirname, '..', '..', 'chitbridge-api');
const MASTER = path.join(API, 'tools', 'tally-connector', 'till.html');
const vendor = () => spawnSync(process.execPath, [path.join(API, 'scripts', 'vendor-till.cjs')], { encoding: 'utf8' });
const BREAKS = [
  ["                            cust && cust.entity_id ? { entity_id: cust.entity_id } : {}),", "                            {}),", 'finish() no longer stamps the rail customer on the bill'],
  ["  if (to) r.push({ name: to.name || 'Customer', entity_id: String(to.entity_id), role:'to', self:false });", "", 'chitOf sends every bill to self only again'],
  ["  return (c && c.entity_id && /^[0-9a-f-]{36}$/i.test(String(c.entity_id))) ? c : null;", "  return (c && c.identity_id) ? Object.assign({}, c, { entity_id: c.identity_id }) : null;", 'any KNOWN customer is sent the bill, on the rail or not'],
  ["  var to = billSendTo(bill), r = [{ self:true, name:'self' }];", "  var to = billSendTo(bill), r = [];", 'the shop\'s own copy is dropped'],
];
let caught = 0; const missed = [];
const copy = MASTER + '.breakcopy';
for (const [from, to, what] of BREAKS) {
  const orig = fs.readFileSync(MASTER, 'utf8'); fs.writeFileSync(copy, orig);
  const crlf = orig.includes('\r\n'); let s = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  if (s.split(from).length !== 2) { console.log('  ??     anchor not found once: ' + what); fs.unlinkSync(copy); missed.push(what + ' (no anchor)'); continue; }
  s = s.replace(from, () => to); fs.writeFileSync(MASTER, crlf ? s.replace(/\n/g, '\r\n') : s);
  let red = false;
  try {
    vendor();
    const r = spawnSync(process.execPath, [path.join(__dirname, 'till-two-sided.cjs')], { encoding: 'utf8', timeout: 300000, env: process.env });
    red = r.status !== 0;
    if (process.env.SHOW_LOG) console.log(r.stdout.split('\n').filter((l) => /FAILED/.test(l)).join('\n'));
  } finally {
    fs.writeFileSync(MASTER, fs.readFileSync(copy, 'utf8')); fs.unlinkSync(copy); vendor();
  }
  if (red) caught++; else missed.push(what);
  console.log('  ' + (red ? 'caught' : 'MISSED') + '  ' + what);
}
console.log('\n' + caught + '/' + BREAKS.length + ' caught' + (missed.length ? ' · MISSED: ' + missed.join(' | ') : ''));
process.exit(missed.length ? 1 : 0);
