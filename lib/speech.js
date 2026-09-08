'use strict';
/**
 * lib/speech.js — WHAT SOMEBODY SAID, AS TEXT (2026-09-08). Athi: *"can we speak, right?"* then *"cant we use other services like
 * whisper?"* then *"build the seam with whisper behind it, I'll test the accuracy."*
 *
 * ── ⚠️ A SEAM FIRST, A VENDOR SECOND ──────────────────────────────────────────────────────────────────────────
 * The point of this file is that the counter never learns who transcribes. Three answers exist and they are not ranked the same for
 * every shop:
 *   browser   the recogniser Chrome already has — free, instant, and it sends the audio to Google
 *   server    this file — better on Tamil and on a sentence that switches language mid-breath, costs a fraction of a paisa
 *   local     one day, a model on the shop's own PC — nothing leaves the building, nothing is billed (not built)
 * A pharmacy that will not let audio leave the premises and a shop that wants the best Tamil want opposite things. So the choice is
 * the SHOP's, the counter asks whoever is available, and adding the third answer later changes nothing above this line.
 *
 * ── ⚠️ THE AUDIO IS NEVER STORED ──────────────────────────────────────────────────────────────────────────────
 * It arrives, it is transcribed, it is dropped. Nothing is written to disk, to a table or to a log — a recording of a customer
 * saying their phone number is not something we should be holding, and the only way to be sure of that is not to hold it.
 *
 * ── ⚠️ AND IT IS NOT lib/ai.js ────────────────────────────────────────────────────────────────────────────────
 * That file is one pipe to one text model, and its containment argument is that THE AI HAS NO TOOLS. This is a different modality
 * with a different vendor, so it is a sibling rather than a skill — but it keeps the same posture: invoked, never autonomous, it
 * returns a DRAFT the person can see and edit before anything is billed, and its usage is metered in the same place.
 * ⚠️ It must also be listed in C:\dev\AI-INVENTORY.md, or that inventory quietly stops being true.
 */

const MAX_BYTES = 2 * 1024 * 1024;        /* about a minute of Opus — far more than a counter ever says in one go */
const TIMEOUT_MS = Number(process.env.SPEECH_TIMEOUT_MS || 20000);

/** which provider this installation has, if any — read fresh so a key added on the server needs no deploy */
function provider() {
  const want = String(process.env.SPEECH_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : '')).toLowerCase().trim();
  if (want === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  return null;
}
function available() { return !!provider(); }

/**
 * ⭐ THE ONE CALL. audio in, text out, and it says which provider answered so a screen can be honest about where the words came from.
 * ⚠️ IT NEVER THROWS FOR AN ORDINARY FAILURE. A counter asking for words and getting an exception would be a sale interrupted by a
 * microphone; every failure comes back as { ok:false, why } and the till falls back to the browser's own recogniser.
 */
async function transcribe(buf, opts) {
  const o = opts || {};
  const who = provider();
  if (!who) return { ok: false, why: 'no speech provider is configured on this server' };
  if (!buf || !buf.length) return { ok: false, why: 'nothing was recorded' };
  if (buf.length > MAX_BYTES) return { ok: false, why: 'that is too long — say it in one short phrase' };

  const started = Date.now();
  try {
    if (who === 'openai') {
      const model = process.env.SPEECH_MODEL || 'whisper-1';
      const form = new FormData();
      /* ⚠️ THE FILENAME CARRIES THE FORMAT. The API reads the container from the extension, and a browser's MediaRecorder gives
         webm/opus on Chrome and mp4 on Safari — sending the wrong extension is a 400 that says nothing useful. */
      const ext = String(o.format || 'webm').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'webm';
      form.append('file', new Blob([buf], { type: o.mime || 'audio/webm' }), 'say.' + ext);
      form.append('model', model);
      /**
       * ⚠️ THE LANGUAGE IS A HINT, NOT A FILTER. Given 'ta' the model still returns English words when English was spoken, which is
       * exactly right for a counter where "thakkali 500 gram" is one sentence in two languages. Left unset it guesses, and guesses
       * badly on a three-second clip.
       */
      if (o.lang) form.append('language', String(o.lang).slice(0, 5).split('-')[0]);
      if (o.hint) form.append('prompt', String(o.hint).slice(0, 400));   /* product names help it hear product names */

      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      let r;
      try {
        r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
          body: form,
        });
      } finally { clearTimeout(timer); }
      const text = await r.text();
      if (!r.ok) {
        let msg = text.slice(0, 200);
        try { const j = JSON.parse(text); msg = (j.error && j.error.message) || msg; } catch (_) { /* the body was not JSON */ }
        return { ok: false, why: 'the speech service refused it (' + r.status + '): ' + msg };
      }
      let said = '';
      try { said = String((JSON.parse(text) || {}).text || '').trim(); } catch (_) { said = ''; }
      return said
        ? { ok: true, text: said, provider: 'openai:' + model, ms: Date.now() - started }
        : { ok: false, why: 'nothing was heard' };
    }
    return { ok: false, why: 'unknown provider: ' + who };
  } catch (e) {
    const why = (e && e.name === 'AbortError') ? 'the speech service took too long' : ('the speech service could not be reached: ' + (e && e.message));
    return { ok: false, why: why };
  }
}

module.exports = { transcribe, available, provider, MAX_BYTES };
