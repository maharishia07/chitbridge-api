# L3 prose proposals — `public/app/cap-service.js`

Scan: 2 interpolated sites. **1 NEEDS-HUMAN · 1 propose-ready.**
Nothing here was edited. ⚠️ This module renders SLA clocks and disputed pauses — the wording
is a record of what each side claims, so the bar for touching it is higher than elsewhere.

---

### cap-service.js:74
BEFORE
```js
+ '⚖️ The two sides do not agree — ' + esc(svcDur(c.disputed_pause_ms)) + ' of paused time is rejected</div>'
```
CANDIDATE (structurally lossless — English byte-identical)
```js
+ txf('⚖️ The two sides do not agree — {duration} of paused time is rejected',
      { duration: esc(svcDur(c.disputed_pause_ms)) })
+ '</div>'
```
**NEEDS-HUMAN.**
This is the headline of the disputed-SLA block: it is the screen's statement of *how much
paused time one party has refused*, and "rejected" is the operative word in a service-credit
argument. The reshape above changes nothing in English — the msgid is the exact sentence
that ships today — so the mechanical risk is nil.

The risk is downstream, and it is the reason this is flagged rather than proposed: once the
sentence is a catalogue key, a translator with no SLA context decides what "rejected" means in
Tamil or Arabic, and the translated line is what the disputing party reads. "Rejected"
(refused by the counterparty) and "excluded" (not counted) are one word apart in English and
frequently the same word in translation, and they say different things about who did what.

Recommendation for the reviewer, if this is applied:
- keep the msgid exactly as written above (do not re-word),
- attach a translator comment on this key: *"rejected = the counterparty refuses to accept this
  paused time; not 'excluded' or 'discarded'. Legal weight."*,
- and decide whether SLA/dispute strings ship untranslated until a domain reviewer signs the
  target language off. That decision is above this pass.

`esc(...)` is preserved verbatim; `txf` does not escape.

---

### cap-service.js:138
BEFORE
```js
+ (r.impact ? esc(r.impact) + ' impact · ' + esc(r.urgency) + ' urgency · ' : '')
+ (c.resolved ? 'resolved' : (c.paused_now ? 'paused' : 'running')) + '</div>'
```
AFTER
```js
+ (r.impact ? txf('{impact} impact · {urgency} urgency', { impact: esc(r.impact), urgency: esc(r.urgency) }) + ' · ' : '')
+ (c.resolved ? 'resolved' : (c.paused_now ? 'paused' : 'running')) + '</div>'
```
NOTE  This is the ITIL classification strip ("high impact · low urgency · running"), descriptive
rather than operative, so it is a normal reshape.
NOTE  The **trailing** ` · ` moves out of the msgid — it separates this fragment from the status
word that follows and belongs to neither. Leaving a separator inside a translatable string
guarantees a translator eventually deletes or duplicates it.
NOTE  The two `esc()` calls are preserved exactly.
NOTE  ⚠️ Beyond this pass: `r.impact` and `r.urgency` are **server values** (`high`/`medium`/`low`)
dropped straight in. `{impact} impact` therefore renders half-translated in any language —
"high impact" needs a value map, not a placeholder. Flagging it; not proposing it, because
mapping server enums to display strings is a different job. The same applies to the
`resolved` / `paused` / `running` literals on the next line (an L2 `tx()` wrap).
