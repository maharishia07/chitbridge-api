'use strict';
// lib/transcribe.js — VOICE → TEXT. The seam, and deliberately only the seam (W-2).
//
// @stage held
//
// ⚠️⚠️ NOTHING CALLS THIS, AND THAT IS THE HONEST STATE — not an oversight. The seam is built and the residency
// rule above is enforced, but no engine is configured and no route reaches it, so a voice note today stays a voice
// note. Tagged `held` rather than left untagged because an untagged unreachable file reads as "someone forgot",
// and this one was a decision: wire it when a self-hosted Whisper exists to point at.
//
// Directive: *"if it's a voice note, transcribe it (Whisper, self-hosted — audio must not leave CB). Keep BOTH the
// audio and the transcript as evidence; a mis-transcription must be traceable."*
//
// ── ⚠️ IT WILL NOT SILENTLY USE A CLOUD API ─────────────────────────────────────────────────────────────────────
// "Audio must not leave CB" is a RESIDENCY rule, not a preference, and it is the one requirement a convenient
// default would quietly break. So there is no fallback to a hosted transcription service here — none, not even a
// commented-out one. With no engine configured this returns `{ ok:false, reason:'no-engine' }` and the message
// stays a voice note that a human plays. An untranscribed message is an inconvenience; audio posted to a third
// party against an explicit instruction is a breach.
//
// ── HOW HEAVY IS SELF-HOSTING, REALLY (Athi asked, 2026-08-11) ──────────────────────────────────────────────────
// Two different questions that get bundled together, and they have opposite answers:
//
//   VOICE (Whisper) — LIGHT, and worth doing.
//     whisper.cpp `base` ≈ 150 MB, `small` ≈ 500 MB. A 30-second voice note transcribes on plain CPU in a few
//     seconds. No GPU. It fits beside the API on a modest box, and it is the ONLY way to honour "audio must not
//     leave CB". Set WHISPER_URL to a local whisper.cpp/faster-whisper HTTP server and this file uses it.
//
//   TEXT PARSING (a DeepSeek/Qwen/Llama-class model) — HEAVY, and NOT cost-justified today.
//     A 7B model at 4-bit needs ~5 GB RAM and, without a GPU, produces a few tokens per second — too slow to sit
//     in a webhook. A GPU host is $50–200/month. Our ENTIRE text-parsing spend is about $0.001 per message: a
//     thousand messages a month is roughly a dollar. Self-hosting the parser would cost ~100× more to run and
//     parse worse.
//     ⚠️ So the reason to self-host the PARSER is never cost — it is if a customer refuses third-party AI at all.
//     If that day comes, the seam already exists: every call goes through invokeSkill(), so swapping the backend is
//     one module, not a rewrite. Deciding it on cost grounds would be paying more for less.
//
// Verdict: self-host Whisper (small, required); keep the text model hosted (cheap, better) until a customer's
// policy — not our preference — forces the change.

const ENGINE = String(process.env.WHISPER_URL || '').trim();

/**
 * transcribe({ bytes, mime, filename }) — returns { ok, text, engine } or { ok:false, reason }.
 *
 * ⚠️ NEVER THROWS AT THE CALLER. A capture that could not be transcribed must still exist as a capture with its
 * audio attached — losing the message because the transcriber was down would turn a degraded feature into a lost
 * order.
 */
async function transcribe({ bytes, mime, filename } = {}) {
  if (!ENGINE) return { ok: false, reason: 'no-engine', note: 'WHISPER_URL not set — audio is kept, not sent anywhere' };
  if (!bytes || !bytes.length) return { ok: false, reason: 'no-audio' };
  try {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime || 'audio/ogg' }), filename || 'voice.ogg');
    const r = await fetch(ENGINE.replace(/\/$/, '') + '/inference', { method: 'POST', body: form });
    if (!r.ok) return { ok: false, reason: 'engine-' + r.status };
    const b = await r.json().catch(() => null);
    const text = String((b && (b.text || b.transcript)) || '').trim();
    if (!text) return { ok: false, reason: 'empty' };
    return { ok: true, text, engine: 'whisper-local' };
  } catch (e) { return { ok: false, reason: 'engine-error', detail: (e && e.message) || String(e) }; }
}

/** Is a capture's media a voice note? Meta sends `audio`; some clients send it as a document with an audio mime. */
const isVoice = (mediaRefs) => (mediaRefs || []).some((m) => /audio|voice|ogg|opus|m4a|mp3|wav/i.test(String(m.name || m.mime || '')));

module.exports = { transcribe, isVoice, configured: () => !!ENGINE };
