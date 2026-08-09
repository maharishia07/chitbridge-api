// lib/whatsapp-templates.js — the ONLY thing that may be sent outside Meta's 24-hour window.
//
// Inside the window a customer has just written to us, so free-form text is allowed and cheap. Outside it, Meta
// accepts nothing but a template it has pre-approved — and bills the send as a business-initiated conversation.
// So this is simultaneously the feature that lets a shop say "your order is ready" three days later, and the only
// place in the product that can spend money on a customer who is not currently talking to us.
//
// ── ⚠️ THREE GATES, ALL OF WHICH MUST BE OPEN ───────────────────────────────────────────────────────────────────
//   1. a template EXISTS here for the thing we want to say
//   2. THIS BUSINESS has marked it approved on THEIR WhatsApp account (Meta approves per-WABA, not per-platform —
//      our having registered it says nothing about whether theirs is allowed to send it)
//   3. outbound is configured at all (WHATSAPP_TOKEN)
// Any one shut → we refuse and log why. Sending an unapproved template does not fail silently; Meta rejects it,
// and a shop that believes the customer was told is worse off than one that knows they were not.
//
// See migration b128 and SPEC-capture-connector.md.

/**
 * The templates we ask a business to register with Meta, in OUR words.
 *
 * ⚠️ ONE TEMPLATE, MANY STATUSES. Each template needs separate Meta approval, and a business waiting on five
 * approvals to get one message out will ship none of them. So the status travels as a PARAMETER inside a single
 * UTILITY template — one approval, every status covered.
 *
 * ⚠️ UTILITY, NOT MARKETING. An order update is a transactional message about something the customer started.
 * Filing it as marketing would be both a rejection risk and, plainly, the wrong description of what it is.
 */
const TEMPLATES = {
  order_status_update: {
    name: 'order_status_update',
    language: 'en',
    category: 'UTILITY',
    // What the business submits to Meta, verbatim. {{1}} is the status sentence.
    body: 'Update on your order: {{1}} Reply to this message if you need anything.',
    /** Used for every status we speak. `text` is the sentence that lands in {{1}}. */
    params: (statusSentence) => [String(statusSentence || '')],
  },
};

/**
 * ⚠️ META REJECTS PARAMETERS CONTAINING NEWLINES, TABS, OR RUNS OF SPACES. A rejected send is indistinguishable
 * from a lost message at the customer's end, so the cleaning happens here rather than being left to whatever the
 * status sentence happened to contain.
 */
function cleanParam(v) {
  return String(v == null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
    .slice(0, 900) || '-';      // never empty: Meta rejects an empty parameter outright
}

/** Is this template approved on THIS binding's WhatsApp account? Absent → NO. */
function approvedOn(binding, name) {
  const t = (binding && binding.templates) || {};
  return t[name] === 'approved';
}

/** The Graph API body for a template send. Shape only — the caller does the sending. */
function buildSend(to, template, args) {
  const t = TEMPLATES[template];
  if (!t) return null;
  const parameters = (t.params.apply(null, args) || []).map((v) => ({ type: 'text', text: cleanParam(v) }));
  return {
    messaging_product: 'whatsapp',
    to: String(to).replace(/^\+/, ''),
    type: 'template',
    template: {
      name: t.name,
      language: { code: t.language },
      components: parameters.length ? [{ type: 'body', parameters }] : [],
    },
  };
}

/** What a business must submit to Meta, so the panel can show it rather than describe it. */
function forDisplay() {
  return Object.values(TEMPLATES).map((t) => ({
    name: t.name, language: t.language, category: t.category, body: t.body,
  }));
}

module.exports = { TEMPLATES, buildSend, approvedOn, cleanParam, forDisplay };
