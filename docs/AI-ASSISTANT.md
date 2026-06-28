# Floating AI assistant — design + roadmap

A single, context-sensitive assistant on **every page** (pre-auth *and* in-app) that consolidates the scattered
help + KB. You describe your problem; it points you to the right tool/facility. Pre-auth it honestly assesses
**fit** ("is this for you"). Library-backed, rich-media ready, **built not to oversell**.

## Built now (v1 — web `63caa7d`)
- A floating **💬 Assistant** button (bottom-right) on every page, mounted from `route()` (survives re-renders;
  appended to `document.body`, so it shows pre-auth on welcome/login/register too).
- **Context-sensitive:** `curScreen()` reads the current screen (`UI.nav` post-auth, the hash pre-auth) and seeds
  the relevant suggestions; pre-auth it surfaces **fit** entries first.
- **Library-backed matching:** `assistAsk()` keyword-scores the question against `ASSIST_LIB` (topic hits weighted,
  plus word overlap) and returns the best entry — or honestly says "I am not certain… I will not guess or oversell."
- **Rich media ready:** an entry can carry `media:{type:'img'|'video', src}` → rendered inline (text / picture / movie).
- **Honest fit:** entries can carry `fit:'good'|'maybe'|'no'`, shown with the answer (so it can say "probably not").

## Library entry shape (`ASSIST_LIB`)
```js
{ id, topics:[...keywords], q:"question", a:"plain answer",
  fit?:'good'|'maybe'|'no',           // for pre-auth qualification
  context?:['welcome','task','*',...],// which screens surface it ('*' = everywhere)
  media?:{ type:'img'|'video', src }  // optional picture/movie
}
```

## Consolidation plan (single source)
Fold the scattered help into `ASSIST_LIB` over time, so there's one library behind the "?" overlays AND the
floating assistant:
- `HELP_PACKS` (per-screen menu help), `CO_HELP`, `COMPOSE_HELP` → migrate into `ASSIST_LIB` entries with `context`.
- The KB docs (`TRUST.md`, `KB-SCHEMA-CUSTOMIZATION.md`, `KB-your-data-is-safe.md`) → distilled into entries.
- Use cases (the `[TO BE ADDED]` items in the schema KB) → entries with `media` (screens/clips).

## Phased roadmap
1. **v1 (done):** floating widget + seed library + keyword match + context + media support + fit-check.
2. **Fill the library** — migrate HELP_PACKS/CO_HELP/COMPOSE_HELP + KB; add the use-case entries with media.
3. **Real NLU/AI** — back `assistAsk` with an LLM over the library + (post-auth) the user's live context, instead of
   keyword match. Keep the "honest, no-oversell, says when it doesn't know" guardrail in the prompt.
4. **Pre-auth fit funnel** — a short guided "is this for you" (ties to the simulator/fit questions); capture a lead only if they opt in.
5. **Analytics** — which questions are asked / unanswered → grows the library; surfaces product gaps.
6. **Rich media** — short screen clips per use case.

## Principles (keep these)
- **Honest, not salesy** — fit can be "probably not"; say "I don't know" rather than guess.
- **Context first** — answer for the screen the user is on.
- **One library** — the assistant, the "?" overlays, and the KB draw from the same source of truth.
- **Pre-auth value** — help a prospect decide *before* signing up.

Cross-refs: `KB-SCHEMA-CUSTOMIZATION.md`, `TRUST.md`, `MESSAGING.md` (the "?" help these consolidate into).
