/**
 * speech.test.js — THE SEAM, NOT THE VENDOR (2026-09-08). Athi: *"can't we use other services like whisper?"* then *"build the seam
 * with whisper behind it, I'll test the accuracy."*
 *
 * The accuracy is his to judge, with his own voice. What is testable here is everything AROUND the provider — the parts that would
 * be silently wrong: that nothing is kept, that an absent key is an ordinary answer rather than a crash, that a long recording is
 * refused before it costs anything, and that a failure comes back as words the counter can fall back from.
 *
 * Run: node tests/speech.test.js   · no network unless a key is set, and it does not call out even then.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const speech = require(path.join(API, 'lib', 'speech.js'));

let pass = 0;
const JOBS = [];
const it = (what, fn) => JOBS.push([what, fn]);
const say = (line) => JOBS.push([null, () => console.log(line)]);

say('— a seam, with a provider behind it —');

it('with no key configured it says so, and does not throw', async () => {
  const had = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  const wanted = process.env.SPEECH_PROVIDER; delete process.env.SPEECH_PROVIDER;
  assert.strictEqual(speech.available(), false);
  const r = await speech.transcribe(Buffer.from('x'), {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.why.indexOf('no speech provider') >= 0, r.why);
  if (had) process.env.OPENAI_API_KEY = had;
  if (wanted) process.env.SPEECH_PROVIDER = wanted;
});

it('a key turns it on without a deploy — the provider is read fresh every time', () => {
  const had = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  assert.strictEqual(speech.available(), true);
  assert.strictEqual(speech.provider(), 'openai');
  if (had) process.env.OPENAI_API_KEY = had; else delete process.env.OPENAI_API_KEY;
});

it('⚠️ a long recording is refused BEFORE it costs anything', async () => {
  const had = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  const big = Buffer.alloc(speech.MAX_BYTES + 1);
  const r = await speech.transcribe(big, {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.why.indexOf('too long') >= 0, r.why);
  if (had) process.env.OPENAI_API_KEY = had; else delete process.env.OPENAI_API_KEY;
});

it('silence is an answer, not an error', async () => {
  const had = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-not-real';   /* with no provider at all, "no provider" is the more useful answer */
  const r = await speech.transcribe(Buffer.alloc(0), {});
  if (had) process.env.OPENAI_API_KEY = had; else delete process.env.OPENAI_API_KEY;
  assert.strictEqual(r.ok, false);
  assert.ok(r.why.indexOf('nothing was recorded') >= 0, r.why);
});

say('— what must be true of the code itself —');

it('⚠️⚠️ THE AUDIO IS NEVER STORED — nothing here writes a file, a row or a log line', () => {
  const src = fs.readFileSync(path.join(API, 'lib', 'speech.js'), 'utf8');
  for (const forbidden of ['writeFile', 'appendFile', 'createWriteStream', 'INSERT INTO', 'console.log'])
    assert.ok(src.indexOf(forbidden) < 0, 'lib/speech.js contains "' + forbidden + '" — a recording of a customer must not be kept');
  const route = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  const listen = route.slice(route.indexOf("router.post('/listen'"), route.indexOf("router.post('/listen'") + 1200);
  for (const forbidden of ['writeFile', 'INSERT', 'console.log'])
    assert.ok(listen.indexOf(forbidden) < 0, 'the /listen route contains "' + forbidden + '"');
});

it('⚠️ every failure is a sentence, never an exception — a microphone must not stop a sale', () => {
  const src = fs.readFileSync(path.join(API, 'lib', 'speech.js'), 'utf8');
  const body = src.slice(src.indexOf('async function transcribe'));
  assert.ok(body.indexOf('throw ') < 0, 'transcribe() throws somewhere; the counter has nothing to fall back from');
  assert.ok(body.indexOf('catch (e)') > 0, 'and it must catch what fetch throws');
});

it('the route is reachable by a counter, and by nothing else it should not be', () => {
  const auth = fs.readFileSync(path.join(API, 'middleware', 'auth.js'), 'utf8');
  const till = auth.slice(auth.indexOf('  till:'), auth.indexOf('  connector:')).split('\\').join('');
  assert.ok(till.indexOf('/api/till/listen') > 0, 'a till key cannot ask for a transcription');
});

it('⭐ the counter picks an ear, and says which — the page never names a vendor in its logic', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('function whoListens(') > 0, 'the chooser is gone');
  const chooser = page.slice(page.indexOf('function whoListens('), page.indexOf('function listenServer('));
  assert.ok(chooser.indexOf('openai') < 0 && chooser.indexOf('whisper') < 0,
    'the counter must not know who transcribes — that is the whole point of the seam');
  assert.ok(page.indexOf("ls.get('cb_till_speech'") > 0, 'the shop cannot choose');
});

(async () => {
  for (const [what, fn] of JOBS) {
    if (!what) { await fn(); continue; }
    try { await fn(); pass++; console.log('  ok  ' + what); }
    catch (e) { console.log('  FAIL ' + what + '\n      ' + (e && e.message)); process.exitCode = 1; }
  }
  console.log(pass + ' checks');
})();
