/* raiseticket: a database fault answers one plain sentence in `why`; the raw text (a secret-looking string here) never reaches the caller, only the log (api #1046 review; same pattern as lib/speech fault()) */
const assert = require('assert');
const platformroot = require('../lib/platformroot');
/* raiseticket destructures withEntity when it loads, so the stand-in goes in first */
const db = require('../db');
let withEntityFault = null;
db.withEntity = async () => { throw withEntityFault; };
db.query = async () => ({ rows: [{ bridge_id: 'b1', display_name: 'Shop' }] });
const raiseticket = require('../lib/raiseticket');

const SECRET = 'password authentication failed for user "svc" host=db.internal sk-live-SECRET123';
const dbErr = Object.assign(new Error(SECRET), { code: '28P01' });

(async () => {
  const logged = [];
  const origErr = console.error, origLog = console.log, origWarn = console.warn;
  const grab = (...a) => logged.push(a.map(String).join(' '));
  console.error = console.log = console.warn = grab;
  platformroot.deskFor = async () => { throw dbErr; };
  let r, p;
  try {
    r = await raiseticket.resolveDesk({ entity_id: 'e1', population: 'production' }, { audience: 'platform' }, 'root');
    p = await raiseticket.preview({ entity_id: 'e1', population: 'production' }, { audience: 'here' });
  } finally { console.error = origErr; console.log = origLog; console.warn = origWarn; }
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.why, raiseticket.DESK_FAULT);
  assert.strictEqual(p.why, raiseticket.DESK_FAULT, 'preview carries the same sentence');
  for (const o of [r, p]) assert.ok(!JSON.stringify(o).includes('SECRET123') && !JSON.stringify(o).includes('28P01'), 'raw text absent from the answer');
  assert.ok(logged.some((l) => l.includes('SECRET123')), 'the raw text went to the server log');
  /* POST /:bridge_id/support relays raise()'s why: a refusal at the test/live boundary must read as one fixed sentence, never the thrown text */
  const THROWN = 'a test entity cannot trade with a live entity (entity 7f3a-INTERNAL-KEY)';
  const boundary = Object.assign(new Error(THROWN), { code: '23514' });
  withEntityFault = boundary;
  const keepRoute = require('../lib/workroute').routeFor;
  require('../lib/workroute').routeFor = async () => ({ why: 'routed', folder_id: null });
  platformroot.deskFor = async () => ({ entity_id: 'e1', source: 'root' });
  let b;
  const savedLog = [console.error, console.log, console.warn];
  console.error = console.log = console.warn = grab;
  try {
    b = await raiseticket.raise({ entity_id: 'e1', bridge_id: 'b1', population: 'production' }, { audience: 'here' }, { audience: 'here', kind: 'incident', subject: 's' });
  } finally { [console.error, console.log, console.warn] = savedLog; require('../lib/workroute').routeFor = keepRoute; }
  assert.strictEqual(b.raised, false);
  assert.ok(!JSON.stringify(b).includes('INTERNAL-KEY') && !JSON.stringify(b).includes(THROWN), 'the thrown text is absent from the answer');
  assert.strictEqual(b.why, raiseticket.BOUNDARY_WHY, 'the boundary refusal is the one fixed sentence');
  console.log('raiseticket-why: 8 checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
