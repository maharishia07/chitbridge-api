// lib/instruments.js — THE COMMERCIAL-INSTRUMENT CLUSTER for EXIM. Athi (2026-07-11): "insurance, hedging, what other
// commercial instruments are relevant for EXIM? can we make it as a cluster?"  YES — and the organising axis is the RISK
// each instrument COVERS, not the instrument's name (derive-not-enumerate, same discipline as the trade lanes). Every
// instrument here is the SAME move on the rail: an UNDERWRITER entity (bank / insurer / export-credit agency / factor)
// mints an INSTRUMENT-CHIT that references the trade and declares "I cover risk X, up to Y, until Z" — i.e. an
// attestation chit whose attestor underwrites a risk. Reuses the trust-ladder rung + attestor-role model. Pure catalogue
// + resolver: NO external API, NO schema. Issuance/verification against real underwriters is gated backlog.
// See SPEC-commercial-attestation.md §6.

// ── the RISK taxonomy: what can go wrong in a cross-border deal ──────────────
// LEGITIMACY: our seven trade risks are not bespoke — each maps onto a CANONICAL FRM (Financial Risk Management)
// category (market · credit · liquidity · operational — GARP FRM / Basel / CTRM for commodity). So the commerce layer
// conforms to the recognised risk discipline; the hedging instruments are the FRM market-risk toolkit. Coherence, not a
// private taxonomy. (FRM is itself a governing STANDARD the commerce layer adopts — see SPEC-commercial-attestation.md.)
const RISKS = {
  payment:     { label: 'Payment risk',      frm: 'credit',      q: 'Will the buyer actually pay?' },
  performance: { label: 'Performance risk',  frm: 'credit',      q: 'Will the seller deliver as promised?' },
  transit:     { label: 'Transit / cargo risk', frm: 'operational', q: 'What if the goods are lost or damaged in transit?' },
  currency:    { label: 'Currency risk',     frm: 'market',      q: 'What if the exchange rate moves before settlement?' },
  price:       { label: 'Price / commodity risk', frm: 'market',  q: 'What if the input/commodity price swings?' },
  country:     { label: 'Country / political risk', frm: 'credit', q: 'What if the buyer\'s country blocks payment or import?' },
  liquidity:   { label: 'Liquidity risk',    frm: 'liquidity',   q: 'How does the seller fund the gap until payment lands?' },
};
// the canonical FRM classes, for the legend/roll-up.
const FRM_CLASSES = {
  market:      'Market risk — price, FX & commodity moves (hedged with forwards/futures/options)',
  credit:      'Credit risk — counterparty & country default (covered by LC, guarantees, credit insurance)',
  liquidity:   'Liquidity risk — funding the cash-flow gap (trade finance, factoring)',
  operational: 'Operational risk — transit, quality & execution failures (cargo & liability insurance)',
};

// ── the instruments, each tagged with the risk it covers + WHO underwrites it ──
// onrail: 'built' = already provable on ChitBridge; 'chit' = modelled as an underwriter-minted instrument-chit (backlog).
const INSTRUMENTS = [
  // payment
  { key: 'lc',           name: 'Letter of Credit (LC)',            risk: 'payment',     attestor: 'bank',    cross_border: true,  onrail: 'chit',  note: 'Issuing bank becomes payer of record against compliant documents.' },
  { key: 'sblc',         name: 'Standby LC / Bank Guarantee',      risk: 'payment',     attestor: 'bank',    cross_border: false, onrail: 'chit',  note: 'Bank pays if the counterparty defaults — a fallback guarantee.' },
  { key: 'doc_collection',name: 'Documentary Collection (D/P·D/A)',risk: 'payment',     attestor: 'bank',    cross_border: true,  onrail: 'chit',  note: 'Bank releases shipping docs against payment or acceptance.' },
  { key: 'export_credit',name: 'Export Credit Insurance (ECA)',    risk: 'payment',     attestor: 'eca',     cross_border: true,  onrail: 'chit',  note: 'Agency (e.g. ECGC) covers buyer default — pairs with country risk.' },
  { key: 'escrow',       name: 'Escrow / Advance payment',         risk: 'payment',     attestor: 'bank',    cross_border: false, onrail: 'chit',  note: 'Funds held by a neutral third party, released on milestones.' },
  // performance
  { key: 'track_record', name: 'On-rail track record',             risk: 'performance', attestor: 'market',  cross_border: false, onrail: 'built', note: 'Self-proving reference — settled dealings + clean disputes. LIVE.' },
  { key: 'perf_bond',    name: 'Performance Guarantee / Bond',     risk: 'performance', attestor: 'bank',    cross_border: false, onrail: 'chit',  note: 'Bank pays the buyer if the seller fails to perform.' },
  // transit
  { key: 'marine_cargo', name: 'Marine Cargo Insurance (ICC A/B/C)',risk: 'transit',    attestor: 'insurer', cross_border: true,  onrail: 'chit',  note: 'Covers goods in transit; who buys it is set by the Incoterm.' },
  { key: 'liability',    name: 'Product Liability Insurance',      risk: 'transit',     attestor: 'insurer', cross_border: false, onrail: 'chit',  note: 'Covers harm caused by the delivered goods.' },
  // currency / price (hedging)
  { key: 'fx_forward',   name: 'FX Forward / Currency Option',     risk: 'currency',    attestor: 'bank',    cross_border: true,  onrail: 'chit',  note: 'Locks the exchange rate to settlement — hedge, not cover.' },
  { key: 'commodity_hedge',name: 'Commodity / Price Hedge',        risk: 'price',       attestor: 'bank',    cross_border: false, onrail: 'chit',  note: 'Futures/options to fix input or commodity price.' },
  // country / political
  { key: 'political_risk',name: 'Political Risk Insurance',        risk: 'country',     attestor: 'insurer', cross_border: true,  onrail: 'chit',  note: 'Covers expropriation, transfer/convertibility, war.' },
  // liquidity / trade finance
  { key: 'packing_credit',name: 'Pre-shipment Finance (Packing Credit)',risk: 'liquidity',attestor: 'bank', cross_border: true,  onrail: 'chit',  note: 'Working capital to produce the export order.' },
  { key: 'bill_discount',name: 'Post-shipment Finance / Bill Discounting',risk: 'liquidity',attestor: 'bank',cross_border: true,  onrail: 'chit',  note: 'Advance against the shipped invoice.' },
  { key: 'factoring',    name: 'Factoring / Forfaiting',           risk: 'liquidity',   attestor: 'factor',  cross_border: true,  onrail: 'chit',  note: 'Sell the receivable — transfers credit risk and frees cash.' },
];

// Incoterms ROUTE the transit-risk instruments: they decide WHO must insure the cargo. Seller-insures terms carry the
// cargo cover to destination; the rest leave the buyer to insure. This is the pointer that tells each party what it needs.
const INCOTERM_INSURES = { CIF: 'seller', CIP: 'seller', DAP: 'seller', DPU: 'seller', DDP: 'seller',
  EXW: 'buyer', FCA: 'buyer', FAS: 'buyer', FOB: 'buyer', CFR: 'buyer', CPT: 'buyer' };

// resolveInstruments({ cross_border, incoterm }) → the cluster grouped by risk, filtered for the lane. Domestic lanes
// drop the export-only instruments; the Incoterm annotates who carries the transit cover. DERIVED, never enumerated.
function resolveInstruments({ cross_border = true, incoterm } = {}) {
  const ic = incoterm ? String(incoterm).toUpperCase() : null;
  const insures = ic ? (INCOTERM_INSURES[ic] || null) : null;
  const cluster = Object.keys(RISKS).map(risk => {
    const items = INSTRUMENTS.filter(i => i.risk === risk && (cross_border || !i.cross_border)).map(i => ({
      key: i.key, name: i.name, attestor: i.attestor, onrail: i.onrail, note: i.note,
      // annotate the Incoterm-routed transit cover with which party must carry it
      responsibility: (i.risk === 'transit' && i.key === 'marine_cargo') ? insures : null,
    }));
    return { risk, label: RISKS[risk].label, frm_class: RISKS[risk].frm, question: RISKS[risk].q,
      covered_onrail: items.some(i => i.onrail === 'built'), instruments: items };
  }).filter(g => g.instruments.length);
  return { framework: 'FRM', cross_border: !!cross_border, incoterm: ic, cargo_insured_by: insures, frm_classes: FRM_CLASSES, cluster };
}

// ── PARTNERS & the END-TO-END SETTLEMENT CHAIN ───────────────────────────────
// Athi (2026-07-11): "listed partners for other activities like end-to-end settlement?"  A trade needs more than
// governance + cover — it needs PARTNERS who PERFORM activities: forwarders, customs brokers, inspection labs, insurers,
// banks, factors. On the rail these are just ENTITIES of a partner TYPE, discoverable in a directory and engaged by
// minting a service chit. Note the unification: an ATTESTOR partner (bank/insurer/eca) underwrites a risk = an
// instrument (above); a SERVICE partner (forwarder/broker/lab) performs a task. Same directory, two verbs.
const PARTNER_TYPES = {
  bank:            'Bank — trade finance, LC, settlement',
  eca:             'Export Credit Agency — buyer-default & political cover',
  insurer:         'Insurer — cargo, liability, political risk',
  factor:          'Factor — receivables purchase / forfaiting',
  inspection:      'Inspection & testing lab — pre-shipment quality',
  certifier:       'Certifier — standards conformity (ISO, REACH…)',
  customs_broker:  'Customs broker (CHA) — export & import clearance',
  freight_forwarder:'Freight forwarder — booking, docs, multimodal',
  carrier:         'Carrier — shipping line / airline',
  transporter:     'Transporter — inland & last-mile',
  warehouse:       'Warehouse — storage, bonded holding',
  market:          'The market — reputation / references (on-rail)',
};

// the END-TO-END journey: each stage = an activity, the partner TYPE that performs it, and the instrument/attestation
// that de-risks it. cross_border-only stages drop out of a domestic lane. This is the map "end-to-end settlement" needs.
const STAGES = [
  { stage: 'enquiry',    activity: 'Catalogue, quote & terms',        partner_type: null,             instrument: null,            onrail: 'built',  cross_border: false },
  { stage: 'contract',   activity: 'Agree PO & Incoterms',            partner_type: null,             instrument: null,            onrail: 'built',  cross_border: false },
  { stage: 'finance',    activity: 'Arrange payment cover',           partner_type: 'bank',           instrument: 'lc',            onrail: 'chit',   cross_border: true  },
  { stage: 'credit_cover',activity:'Cover buyer default / country risk',partner_type: 'eca',          instrument: 'export_credit', onrail: 'chit',   cross_border: true  },
  { stage: 'compliance', activity: 'Gather clearances & certificates', partner_type: 'certifier',     instrument: null,            onrail: 'built',  cross_border: true  },
  { stage: 'inspection', activity: 'Pre-shipment inspection',         partner_type: 'inspection',     instrument: null,            onrail: 'chit',   cross_border: false },
  { stage: 'insurance',  activity: 'Insure the cargo',                partner_type: 'insurer',        instrument: 'marine_cargo',  onrail: 'chit',   cross_border: true  },
  { stage: 'logistics',  activity: 'Book freight & forwarding',       partner_type: 'freight_forwarder',instrument: null,          onrail: 'chit',   cross_border: false },
  { stage: 'export_customs',activity:'Export clearance',              partner_type: 'customs_broker', instrument: null,            onrail: 'chit',   cross_border: true  },
  { stage: 'transit',    activity: 'Ship & track',                    partner_type: 'carrier',        instrument: null,            onrail: 'chit',   cross_border: false },
  { stage: 'import_customs',activity:'Import clearance & duties',      partner_type: 'customs_broker', instrument: null,            onrail: 'chit',   cross_border: true  },
  { stage: 'delivery',   activity: 'Last-mile delivery',              partner_type: 'transporter',    instrument: null,            onrail: 'chit',   cross_border: false },
  { stage: 'settlement', activity: 'Documents vs payment, release',   partner_type: 'bank',           instrument: 'doc_collection',onrail: 'chit',   cross_border: false },
  { stage: 'close',      activity: 'Settle, rate & build reference',  partner_type: 'market',         instrument: 'track_record',  onrail: 'built',  cross_border: false },
];

// resolveJourney({ cross_border, incoterm }) → the ordered end-to-end settlement chain for the lane, each stage carrying
// its partner type + the instrument that de-risks it. Domestic lanes drop the export/import-only stages.
function resolveJourney({ cross_border = true, incoterm } = {}) {
  const chain = STAGES.filter(s => cross_border || !s.cross_border).map(s => ({
    stage: s.stage, activity: s.activity,
    partner_type: s.partner_type, partner_label: s.partner_type ? PARTNER_TYPES[s.partner_type] : null,
    instrument: s.instrument, onrail: s.onrail,
  }));
  return { cross_border: !!cross_border, incoterm: incoterm ? String(incoterm).toUpperCase() : null, chain };
}

module.exports = { resolveInstruments, resolveJourney, RISKS, FRM_CLASSES, INSTRUMENTS, PARTNER_TYPES, STAGES };
