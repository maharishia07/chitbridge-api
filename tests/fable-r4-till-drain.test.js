'use strict';
/**
 * fable-r4-till-drain.test.js — T4-02 (Fable risk review 4, the till): THE SHOP-PC PROGRAM MUST NEVER ERASE A BILL FROM ITS QUEUE.
 *
 * OWNS      the proof that till.js drain() takes out only the lines it SENT, from a fresh read of queue.jsonl.
 *           Before: it read the file once, awaited the network once per row, then overwrote the file with the rows that
 *           failed — so a bill rung during those awaits (appended to the file at once) was erased, never reached the server,
 *           yet sat in bills-<day>.jsonl, so the day summary counted a sale the server never had.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the shipped drain() is lifted out of till.js and run on a real
 *           temp file with a stubbed send.
 * FLOW      queue.jsonl -> drain() (stubbed cb.call that appends a bill mid-send) -> queue.jsonl after the pass
 * Run: node tests/fable-r4-till-drain.test.js     (TILL_SRC=<path> to run the same checks against another copy of till.js)
 */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const SRC_PATH = process.env.TILL_SRC || path.join(__dirname, '..', 'tools', 'tally-connector', 'till.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** one top-level function (plain or async) out of the shipped source, by name */
function lift(name) {
  let at = SRC.indexOf('\nasync function ' + name + '(');
  if (at < 0) at = SRC.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is gone from till.js — this guard is measuring nothing');
  return SRC.slice(at, SRC.indexOf('\n}\n', at) + 3);
}
const liftLine = (re) => { const m = SRC.match(re); assert.ok(m, String(re) + ' is gone from till.js'); return m[0]; };

/** a drain wired to a temp queue file, and a `send` that runs for each row (it may append, may refuse) */
function program(send) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4-drain-'));
  const F = { queue: path.join(dir, 'queue.jsonl') };
  const body = [
    'let draining = false, drainAt = 0;',
    liftLine(/const appendLine = [^\n]*;/), liftLine(/const readLines = [^\n]*;/),
    /* an old copy of till.js has no helpers: it is run as it is, so its failure is the real one */
    SRC.includes('function readQueueEntries(') ? liftLine(/const TORN_SAID = [^\n]*;/) + lift('parseQueueLine') + lift('readQueueEntries') + lift('removeSentFromQueue') : '',
    SRC.includes('function pointsBody(') ? lift('pointsBody') + lift('logPointsAnswer') : '', /* the points post's two helpers (readability split) */
    SRC.includes('function postPointsFor(') ? lift('postPointsFor') : '',
    SRC.includes('function parkEntry(') ? [liftLine(/const RETRY_CODES = [^\n]*;/), liftLine(/const DUPLICATE_CODES = [^\n]*;/), lift('receivedAlready'), lift('refusalParks'), lift('refusalWords'), lift('replaceQueueLine'), lift('parkEntry')].join(String.fromCharCode(10)) : '', /* till-park (1129): the drain parks a content refusal and keeps what the shop already has: its helpers */
    lift('drain'),
    'return { drain, appendLine, readLines };',
  ].join('\n');
  const ctx = {
    fs, F, log: () => {}, healthNote: () => {}, whyNot: () => ({ online: false, say: 'offline' }), chitOf: (b) => b,
    cb: { call: async (m, p, body2) => send(body2) }, online: true, QUEUE_SAID: false, QUEUE_WHY: null,
  };
  // eslint-disable-next-line no-new-func
  const api = new Function(...Object.keys(ctx), body)(...Object.values(ctx));
  return Object.assign(api, { F, ids: () => api.readLines(F.queue).map((r) => r.no) });
}

(async () => {
  await it('BAD CASE: a bill rung while the first is being sent survives the pass', async () => {
    let p;
    p = program(async (sent) => { if (sent.no === 'A') p.appendLine(p.F.queue, { no: 'B', total: 20 }); });
    p.appendLine(p.F.queue, { no: 'A', total: 10 });
    await p.drain();
    assert.deepStrictEqual(p.ids(), ['B'], 'A was sent and goes; B was rung during the send and must still be queued');
  });

  await it('BAD CASE: a bill rung during the sends survives even when its neighbour fails', async () => {
    let p;
    p = program(async (sent) => { if (sent.no === 'A') p.appendLine(p.F.queue, { no: 'C', total: 5 }); if (sent.no === 'B') throw new Error('line down'); });
    p.appendLine(p.F.queue, { no: 'A' }); p.appendLine(p.F.queue, { no: 'B' });
    await p.drain();
    assert.deepStrictEqual(p.ids(), ['B', 'C'], 'B failed (stays), C was rung mid-send (stays), A went');
  });

  await it('good: every row sent leaves an empty queue file', async () => {
    const p = program(async () => {});
    p.appendLine(p.F.queue, { no: 'A' }); p.appendLine(p.F.queue, { no: 'B' });
    await p.drain();
    assert.deepStrictEqual(p.ids(), []);
    assert.strictEqual(fs.readFileSync(p.F.queue, 'utf8'), '');
  });

  await it('good: a refused row stays, in its place, byte for byte', async () => {
    const p = program(async (sent) => { if (sent.no === 'B') throw new Error('refused'); });
    p.appendLine(p.F.queue, { no: 'A' }); p.appendLine(p.F.queue, { no: 'B', note: 'x' }); p.appendLine(p.F.queue, { no: 'C' });
    await p.drain();
    assert.strictEqual(fs.readFileSync(p.F.queue, 'utf8'), JSON.stringify({ no: 'B', note: 'x' }) + '\n');
  });

  await it('good: a torn line is never dropped, and two rows with one number are sent once each', async () => {
    const p = program(async () => {});
    fs.writeFileSync(p.F.queue, JSON.stringify({ no: 'A' }) + '\n{"no":"TORN\n' + JSON.stringify({ no: 'A' }) + '\n');
    await p.drain();
    assert.strictEqual(fs.readFileSync(p.F.queue, 'utf8'), '{"no":"TORN\n');
  });

  await it('the queue file is replaced through a temp file, never rewritten in place', () => {
    assert.ok(/F\.queue \+ '\.tmp'/.test(lift('removeSentFromQueue')) && /renameSync/.test(lift('removeSentFromQueue')));
    assert.ok(!/fs\.writeFileSync\(F\.queue/.test(SRC), 'no code path may overwrite queue.jsonl in place');
  });

  console.log(pass + ' checks passed' + (process.exitCode ? ' — SOME FAILED' : ''));
})();
