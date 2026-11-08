/* raiseticket: a database fault answers one plain sentence in `why`; the raw text (a secret-looking string here) never reaches the caller, only the log (api #1046 review; same pattern as lib/speech fault()) */
const assert = require('assert');
const platformroot = require('../lib/platformroot');
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
  console.log('raiseticket-why: 5 checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
