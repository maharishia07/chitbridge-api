/* CB CRM — SAMPLE DATA for the designer handoff. Every figure here is ILLUSTRATIVE (the page says "Sample data").
   The shapes are the API's, one to one, so the build swaps each block for its call and changes nothing else:

     CRM.list       ⇐ GET /api/crm/parties                          (REQUIREMENT-home §9)
     CRM.records    ⇐ GET /api/crm/parties/:party_id                (REQUIREMENT-record §9)   — merged onto the list row
     CRM.timelines  ⇐ GET /api/crm/parties/:party_id/timeline       (REQUIREMENT-timeline §9) — one page of 50
     CRM.followups  ⇐ GET /api/crm/followups?scope=all&done=0       (REQUIREMENT-followups §9)
     CRM.settings   ⇐ GET /api/crm/settings                         (REQUIREMENT-compose-mail §9)
     CRM.docs       ⇐ the "From this party" picker: party_item bills · /api/books/party/:id/statement · chit attachments
     CRM.search     ⇐ GET /api/entities/search?q=                   (F1 Add party — on-ChitBridge matches)

   Money is ALWAYS minor units from the server (balance_minor, amount_minor) with its currency; the page only paints
   it (app.js money() stands in for CBMoney). Nothing below is a sum the page made.
   "Now" for this sample is 2026-10-02 10:30 IST, so "late" / "today" read the same on every machine — and `late`
   is the SERVER's word (REQUIREMENT-followups §10), never the browser clock. */
window.CRM = {
  now: '2026-10-02T10:30:00+05:30',
  me: { user_id: 'athi', name: 'Athi', role: 'owner' },          // role: owner | editor | viewer (lib/access.js hats)
  shop: { name: 'Meenakshi Hardware', user_id: 'meenakshi-hw', state_code: '33', ledger_on: true, population: 'production' },

  /* ── GET /api/crm/parties ─────────────────────────────────────────────────────────────────────────────────── */
  list: {
    alerts: { followups_overdue: 2, dues_overdue: 3, duplicates: 1 },
    parties: [
      { party_id: '6f1c2a10-0001', party_no: 'P-0001', display_name: 'Agro Mills', nickname: null, legal_name: 'Agro Mills Private Limited',
        roles: ['supplier'], kind: 'business', on_rail: true, on_chitbridge: true, why_not: null,
        user_id: 'agro-mills', bridge_id: 'CB7K3QX9PA', phone: '+91 98430 11201', email: 'accounts@agromills.in', city: 'Coimbatore', state_code: '33', supply_type: 'intra',
        tax_ids: [{ scheme: 'GSTIN', value: '33AABCA1234M1Z5' }], segment: null, groups: [], txn_count: 3,
        last_at: '2026-09-30T16:10:00+05:30', balance_minor: -48165, currency: 'INR', oldest_due: '2026-09-12', dues_overdue: true,
        next_followup_at: '2026-09-29T11:00:00+05:30', next_followup_late: true, unread: 0 },
      { party_id: '6f1c2a10-0002', party_no: 'P-0002', display_name: 'Chola Auto Care', nickname: 'Chola', legal_name: 'Chola Auto Care LLP',
        roles: ['customer', 'supplier'], kind: 'business', on_rail: true, on_chitbridge: true, why_not: null,
        user_id: 'chola-auto', bridge_id: 'CB4M8RT2KD', phone: '+91 94433 20877', email: 'office@cholaauto.in', city: 'Madurai', state_code: '33', supply_type: 'intra',
        tax_ids: [{ scheme: 'GSTIN', value: '33AAKFC5521R1ZQ' }, { scheme: 'PAN', value: 'AAKFC5521R' }], segment: 'regular', groups: ['Workshops'], txn_count: 41,
        last_at: '2026-10-02T09:12:00+05:30', balance_minor: 1245000, currency: 'INR', oldest_due: '2026-08-28', dues_overdue: true,
        next_followup_at: '2026-10-02T17:00:00+05:30', next_followup_late: false, unread: 2 },
      { party_id: '6f1c2a10-0003', party_no: 'P-0003', display_name: 'Ravi Traders', nickname: null, legal_name: null,
        roles: ['supplier'], kind: 'local', on_rail: false, on_chitbridge: false, why_not: 'local',
        user_id: '~meenakshi-hw.sup-0001', bridge_id: null, phone: '+91 98940 55621', email: 'ravitraders.mdu@gmail.com', city: 'Madurai', state_code: '33', supply_type: 'intra',
        tax_ids: [{ scheme: 'GSTIN', value: '33BXRPR4410K1Z2' }], segment: null, groups: [], txn_count: 12,
        last_at: '2026-10-01T18:40:00+05:30', balance_minor: -1820000, currency: 'INR', oldest_due: '2026-09-25', dues_overdue: false,
        next_followup_at: '2026-10-02T15:00:00+05:30', next_followup_late: false, unread: 0 },
      { party_id: '6f1c2a10-0004', party_no: 'P-0004', display_name: 'Ravi Trdrs', nickname: null, legal_name: null,
        roles: ['customer'], kind: 'local', on_rail: false, on_chitbridge: false, why_not: 'local',
        user_id: '~meenakshi-hw.cus-0004', bridge_id: null, phone: '+91 98940 55621', email: null, city: 'Madurai', state_code: '33', supply_type: 'intra',
        tax_ids: [], segment: 'new', groups: [], txn_count: 1,
        last_at: '2026-09-21T12:05:00+05:30', balance_minor: 0, currency: 'INR', oldest_due: null, dues_overdue: false,
        next_followup_at: null, next_followup_late: false, unread: 0 },
      { party_id: '6f1c2a10-0005', party_no: 'P-0005', display_name: 'Meena', nickname: null, legal_name: 'Meena Sundaram',
        roles: ['customer'], kind: 'person', on_rail: true, on_chitbridge: true, why_not: null,
        user_id: 'meena-s', bridge_id: 'CB9Q2WE7LM', phone: '+91 99522 31408', email: 'meena.s@outlook.com', city: 'Madurai', state_code: '33', supply_type: 'intra',
        tax_ids: [], segment: 'inactive', groups: [], txn_count: 6,
        last_at: '2026-05-30T11:20:00+05:30', balance_minor: 0, currency: 'INR', oldest_due: null, dues_overdue: false,
        next_followup_at: null, next_followup_late: false, unread: 0 },
      { party_id: '6f1c2a10-0006', party_no: 'P-0006', display_name: 'Sakthi Builders', nickname: null, legal_name: 'Sakthi Builders & Developers',
        roles: ['customer'], kind: 'business', on_rail: true, on_chitbridge: true, why_not: null,
        user_id: 'sakthi-builders', bridge_id: 'CB2H6NV4XC', phone: '+91 90030 77114', email: 'purchase@sakthibuilders.co.in', city: 'Dindigul', state_code: '33', supply_type: 'intra',
        tax_ids: [{ scheme: 'GSTIN', value: '33AAGCS8812F1ZP' }], segment: 'high_value', groups: ['Contractors'], txn_count: 58,
        last_at: '2026-09-29T15:45:00+05:30', balance_minor: 6840000, currency: 'INR', oldest_due: '2026-09-20', dues_overdue: false,
        next_followup_at: '2026-10-09T10:00:00+05:30', next_followup_late: false, unread: 0 },
      { party_id: 'walkin-9876500021', party_no: null, display_name: 'Walk-in 98…21', nickname: null, legal_name: null,
        roles: ['customer'], kind: 'walk-in', on_rail: false, on_chitbridge: false, why_not: null,
        user_id: null, bridge_id: null, phone: '+91 98765 00021', email: null, city: null, state_code: null, supply_type: null,
        tax_ids: [], segment: null, groups: [], txn_count: 4,
        last_at: '2026-09-27T19:02:00+05:30', balance_minor: null, currency: 'INR', oldest_due: null, dues_overdue: false,
        next_followup_at: null, next_followup_late: false, unread: 0, points: { balance: 340, programme: 'Meenakshi Rewards' } },
      { party_id: '6f1c2a10-0009', party_no: 'P-0009', display_name: 'Lakshmi Paints', nickname: null, legal_name: 'Sri Lakshmi Paints & Chemicals',
        roles: ['supplier'], kind: 'business', on_rail: true, on_chitbridge: true, why_not: null,
        user_id: 'lakshmi-paints', bridge_id: 'CB5T1YU8RW', phone: '+91 97877 40213', email: 'orders@lakshmipaints.com', city: 'Salem', state_code: '33', supply_type: 'intra',
        tax_ids: [{ scheme: 'GSTIN', value: '33AAFCL3390B1ZM' }], segment: null, groups: [], txn_count: 22,
        last_at: '2026-09-26T10:30:00+05:30', balance_minor: 0, currency: 'INR', oldest_due: null, dues_overdue: false,
        next_followup_at: null, next_followup_late: false, unread: 1 },
      { party_id: '6f1c2a10-0010', party_no: 'P-0010', display_name: 'Kumar Electricals', nickname: null, legal_name: null,
        roles: ['customer'], kind: 'local', on_rail: false, on_chitbridge: false, why_not: 'local',
        user_id: '~meenakshi-hw.cus-0010', bridge_id: null, phone: '+91 96009 18842', email: 'kumarelec@yahoo.co.in', city: 'Madurai', state_code: '33', supply_type: 'intra',
        tax_ids: [], segment: 'regular', groups: ['Electricians'], txn_count: 17,
        last_at: '2026-09-24T17:15:00+05:30', balance_minor: 312500, currency: 'INR', oldest_due: '2026-08-30', dues_overdue: true,
        next_followup_at: '2026-10-05T11:00:00+05:30', next_followup_late: false, unread: 0 },
      { party_id: '6f1c2a10-0011', party_no: 'P-0011', display_name: 'Anbu Plumbing', nickname: null, legal_name: null,
        roles: ['customer'], kind: 'business', on_rail: false, on_chitbridge: false, why_not: 'inactive',
        user_id: 'anbu-plumbing', bridge_id: 'CB8D3FG6HJ', phone: '+91 93608 22190', email: 'anbu.plumbing@gmail.com', city: 'Theni', state_code: '33', supply_type: 'intra',
        tax_ids: [], segment: 'regular', groups: ['Plumbers'], txn_count: 9,
        last_at: '2026-09-10T13:00:00+05:30', balance_minor: 0, currency: 'INR', oldest_due: null, dues_overdue: false,
        next_followup_at: null, next_followup_late: false, unread: 0 },
      { party_id: '6f1c2a10-0013', party_no: 'P-0013', display_name: 'Vel Timber Depot', nickname: null, legal_name: null,
        roles: ['supplier'], kind: 'local', on_rail: false, on_chitbridge: false, why_not: 'local',
        user_id: '~meenakshi-hw.sup-0013', bridge_id: null, phone: null, email: null, city: null, state_code: null, supply_type: null,
        tax_ids: [], segment: null, groups: [], txn_count: 0,
        last_at: '2026-10-01T09:00:00+05:30', balance_minor: 0, currency: 'INR', oldest_due: null, dues_overdue: false,
        next_followup_at: null, next_followup_late: false, unread: 0 },
      { party_id: '6f1c2a10-0014', party_no: 'P-0014', display_name: 'Priya Interiors', nickname: null, legal_name: 'Priya Interiors & Decor',
        roles: ['customer'], kind: 'business', on_rail: true, on_chitbridge: true, why_not: null,
        user_id: 'priya-interiors', bridge_id: 'CB3J7KL9MN', phone: '+91 95008 60317', email: 'hello@priyainteriors.in', city: 'Madurai', state_code: '33', supply_type: 'intra',
        tax_ids: [{ scheme: 'GSTIN', value: '33ABCFP7761H1ZT' }], segment: 'new', groups: ['Contractors'], txn_count: 2,
        last_at: '2026-09-28T12:40:00+05:30', balance_minor: 98000, currency: 'INR', oldest_due: '2026-09-28', dues_overdue: false,
        next_followup_at: '2026-10-03T10:00:00+05:30', next_followup_late: false, unread: 0 },
      { party_id: '6f1c2a10-0015', party_no: 'P-0015', display_name: 'Kaveri Cements', nickname: null, legal_name: 'Kaveri Cements Ltd',
        roles: ['supplier'], kind: 'business', on_rail: true, on_chitbridge: true, why_not: null,
        user_id: 'kaveri-cements', bridge_id: 'CB6P4QA1ZS', phone: '+91 80 4110 2290', email: 'south.sales@kavericements.com', city: 'Bengaluru', state_code: '29', supply_type: 'inter',
        tax_ids: [{ scheme: 'GSTIN', value: '29AACCK2210E1Z8' }], segment: null, groups: [], txn_count: 8,
        last_at: '2026-09-18T14:00:00+05:30', balance_minor: -2265000, currency: 'INR', oldest_due: '2026-09-18', dues_overdue: false,
        next_followup_at: null, next_followup_late: false, unread: 0 }
    ]
  },

  /* a merged party's id opens its keeper once with "Merged from …" (REQUIREMENT-record §6) */
  merged: { 'P-0008': 'P-0001' },

  /* ── GET /api/crm/parties/:party_id — the list row + these blocks ──────────────────────────────────────────── */
  records: {
    '6f1c2a10-0001': {
      customer: null,
      supplier: { category: 'Grains & feed', preferred: true, supply_kind: 'resale', notes: 'Deliver before 11am — gate closes for unloading after.', added_via: 'handle', credit_days: 30, credit_limit_minor: 50000000, catalogue: true },
      contacts: { phones: ['+91 98430 11201'], emails: ['accounts@agromills.in'], address: 'SF 214, Avinashi Road, Coimbatore 641014' },
      prefs: [ { channel: 'chitbridge', allowed: true, purpose: 'service', basis: 'legitimate_use', noted_at: '2026-06-02' },
               { channel: 'email', allowed: true, purpose: 'service', basis: 'legitimate_use', noted_at: '2026-06-02' },
               { channel: 'whatsapp', allowed: null } ],
      gstn_profile: '33AABCA1234M2Z4',
      scorecard: { first_at: '2026-06-02', last_at: '2026-09-30', you_sent: 4, you_received: 3, completion_rate_pct: 86 },
      points: null,
      followups: [ { followup_id: 'fu-01', what: 'Ask for a corrected GST bill (AM/0912)', due_at: '2026-09-29T11:00:00+05:30', late: true, assignee_name: 'Athi' } ],
      mail_bounced: null,
      changes: [ { at: '2026-08-14T12:00:00+05:30', by: 'Athi', line: 'Linked to ChitBridge (was P-0008, local)', undo: true },
                 { at: '2026-09-02T10:10:00+05:30', by: 'Athi', line: 'Credit days 15 → 30', undo: false } ]
    },
    '6f1c2a10-0002': {
      customer: { txn_count: 41, last_bill_at: '2026-10-02T09:12:00+05:30', since: '2025-11-18', added_via: 'counter', segment: 'regular', segment_override: null, groups: ['Workshops'], credit_days: 15, credit_limit_minor: 2500000 },
      supplier: { category: 'Vehicle service', preferred: false, supply_kind: 'own_use', notes: null, added_via: 'handle', credit_days: 0, credit_limit_minor: null, catalogue: true },
      contacts: { phones: ['+91 94433 20877', '+91 452 253 1190'], emails: ['office@cholaauto.in', 'ravi.k@cholaauto.in'], address: '12 Bypass Road, Madurai 625010' },
      prefs: [ { channel: 'chitbridge', allowed: true, purpose: 'service', basis: 'legitimate_use', noted_at: '2025-11-18' },
               { channel: 'email', allowed: true, purpose: 'marketing', basis: 'consent', noted_at: '2026-01-05' },
               { channel: 'whatsapp', allowed: true, purpose: 'service', basis: 'consent', noted_at: '2026-01-05' } ],
      gstn_profile: '33AAKFC5521R1ZQ',
      scorecard: { first_at: '2025-11-18', last_at: '2026-10-02', you_sent: 38, you_received: 6, completion_rate_pct: 95 },
      points: { balance: 1260, programme: 'Meenakshi Rewards' },
      followups: [ { followup_id: 'fu-02', what: 'Collect ₹12,450.00 — promised by Friday', due_at: '2026-10-02T17:00:00+05:30', late: false, assignee_name: 'Athi' } ],
      mail_bounced: null,
      changes: [ { at: '2026-09-20T16:20:00+05:30', by: 'Athi', line: 'Credit days 7 → 15', undo: false },
                 { at: '2026-07-11T11:00:00+05:30', by: 'Athi', line: 'Also a supplier — added', undo: false } ]
    },
    '6f1c2a10-0003': {
      customer: null,
      supplier: { category: 'Pipes & fittings', preferred: false, supply_kind: 'resale', notes: 'Cash discount 2% if paid in 7 days. Ask for Murugan, not the counter.', added_via: 'name', credit_days: 21, credit_limit_minor: null, catalogue: false },
      contacts: { phones: ['+91 98940 55621'], emails: ['ravitraders.mdu@gmail.com', 'ravi.traders@gmial.com'], address: '44 East Masi Street, Madurai 625001' },
      prefs: [ { channel: 'email', allowed: true, purpose: 'service', basis: 'legitimate_use', noted_at: '2026-03-10' },
               { channel: 'phone', allowed: true, purpose: 'service', basis: 'legitimate_use', noted_at: '2026-03-10' } ],
      gstn_profile: null,
      scorecard: null,
      points: null,
      followups: [ { followup_id: 'fu-03', what: 'Call about pipe fittings rate for October', due_at: '2026-10-02T15:00:00+05:30', late: false, assignee_name: 'Divya' } ],
      mail_bounced: { mail_id: 'ml-18', to: 'ravi.traders@gmial.com', at: '2026-09-30T11:05:00+05:30' },
      changes: [ { at: '2026-09-05T09:40:00+05:30', by: 'Athi', line: 'GSTIN added 33BXRPR4410K1Z2', undo: false } ]
    },
    '6f1c2a10-0005': {
      customer: { txn_count: 6, last_bill_at: '2026-05-30T11:20:00+05:30', since: '2025-12-02', added_via: 'storefront', segment: 'inactive', segment_override: null, groups: [], credit_days: 0, credit_limit_minor: null },
      supplier: null,
      contacts: { phones: ['+91 99522 31408'], emails: ['meena.s@outlook.com'], address: null },
      prefs: [ { channel: 'email', allowed: false, purpose: 'service', basis: 'consent', noted_at: '2026-09-12' },
               { channel: 'chitbridge', allowed: true, purpose: 'service', basis: 'legitimate_use', noted_at: '2025-12-02' } ],
      gstn_profile: null,
      scorecard: { first_at: '2025-12-02', last_at: '2026-05-30', you_sent: 6, you_received: 0, completion_rate_pct: 100 },
      points: { balance: 85, programme: 'Meenakshi Rewards' },
      followups: [], mail_bounced: null, changes: []
    },
    'walkin-9876500021': {
      customer: { txn_count: 4, last_bill_at: '2026-09-27T19:02:00+05:30', since: '2026-07-04', added_via: 'counter', segment: null, groups: [] },
      supplier: null, contacts: { phones: ['+91 98765 00021'], emails: [], address: null }, prefs: [],
      gstn_profile: null, scorecard: null, points: { balance: 340, programme: 'Meenakshi Rewards' }, followups: [], mail_bounced: null, changes: []
    },
    '6f1c2a10-0013': {
      customer: null,
      supplier: { category: 'Timber', preferred: false, supply_kind: 'own_use', notes: null, added_via: 'name', credit_days: null, credit_limit_minor: null, catalogue: false },
      contacts: { phones: [], emails: [], address: null }, prefs: [], gstn_profile: null, scorecard: null, points: null,
      followups: [], mail_bounced: null, changes: [ { at: '2026-10-01T09:00:00+05:30', by: 'Athi', line: 'Added as a local party', undo: false } ]
    }
  },

  /* ── GET /api/crm/parties/:party_id/timeline (first page) ─────────────────────────────────────────────────── */
  timelines: {
    '6f1c2a10-0002': {
      counts: { all: 132, messages: 31, bills: 74, notes: 9, mail: 4, followups: 14 }, next_before: 'c_2026-08-30',
      entries: [
        { id: 't1', kind: 'message', at: '2026-10-02T09:40:00+05:30', by: 'Ravi K (Chola)', theirs: true, line: 'Payment for INV-0418 will come Friday by NEFT — please hold the brake pads for us.', chit_id: 'ch-418', thread: { line_id: null, unread: true, count: 3 } },
        { id: 't2', kind: 'chit', at: '2026-10-02T09:12:00+05:30', by: 'Athi', line: 'INV-0431 · Brake pads, 2 sets + coolant 5 L', state: { word: 'Sent', tone: 'blue' }, chit_id: 'ch-431', amount_minor: 386400, currency: 'INR' },
        { id: 't3', kind: 'followup', at: '2026-10-01T18:05:00+05:30', by: 'Athi', line: 'Collect ₹12,450.00 — promised by Friday', state: { word: 'Due today', tone: 'amber' }, followup_id: 'fu-02' },
        { id: 't4', kind: 'call', at: '2026-10-01T18:02:00+05:30', by: 'Athi', direction: 'out', line: 'Called Ravi about the August bills. He says the cheque is ready, will send Friday after the bank clears their own receipts. Also asked whether we stock Bosch wiper blades — told him next week.', interaction_id: 'ix-77' },
        { id: 't5', kind: 'message_internal', at: '2026-10-01T12:30:00+05:30', by: 'Divya', line: 'They always pay late in the first week of the month — don’t send the reminder before the 5th.', chit_id: 'ch-418', thread: { count: 1 } },
        { id: 't6', kind: 'payment', at: '2026-09-29T16:20:00+05:30', by: 'Chola Auto Care', theirs: true, line: 'RCPT-0219 · UPI', state: { word: 'Received', tone: 'green' }, amount_minor: 500000, currency: 'INR', chit_id: 'ch-r219' },
        { id: 't7', kind: 'dispute', at: '2026-09-27T11:00:00+05:30', by: 'Ravi K (Chola)', theirs: true, line: 'INV-0412 — 1 coolant can leaking on arrival', state: { word: 'Open', tone: 'red' }, chit_id: 'ch-412' },
        { id: 't8', kind: 'mail', at: '2026-09-25T10:00:00+05:30', by: 'Athi', line: 'Statement for September · to office@cholaauto.in', state: { word: 'Sent', tone: 'green' }, mail_id: 'ml-11' },
        { id: 't9', kind: 'bill', at: '2026-09-20T17:45:00+05:30', by: 'Athi', line: 'INV-0418 · Engine oil 20 L, filters', state: { word: 'Due', tone: 'amber' }, amount_minor: 845000, currency: 'INR', chit_id: 'ch-418' },
        { id: 't10', kind: 'change', at: '2026-09-20T16:20:00+05:30', by: 'Athi', line: 'Credit days 7 → 15' },
        { id: 't11', kind: 'chit', at: '2026-09-18T09:30:00+05:30', by: 'Ravi K (Chola)', theirs: true, line: 'Order · Wheel balancing weights, 200 pcs', state: { word: 'Accepted', tone: 'green' }, chit_id: 'ch-o77' },
        { id: 't12', kind: 'note', at: '2026-09-15T14:00:00+05:30', by: 'Athi', line: 'Owner’s son (Karthik) handles purchases from October.', interaction_id: 'ix-61' }
      ]
    },
    '6f1c2a10-0003': {
      counts: { all: 21, messages: 0, bills: 12, notes: 4, mail: 2, followups: 3 }, next_before: null,
      entries: [
        { id: 'r1', kind: 'followup', at: '2026-10-01T18:40:00+05:30', by: 'Divya', line: 'Call about pipe fittings rate for October', state: { word: 'Due today', tone: 'amber' }, followup_id: 'fu-03' },
        { id: 'r2', kind: 'call', at: '2026-10-01T18:38:00+05:30', by: 'Divya', direction: 'in', line: 'Murugan called — rates for 1" CPVC going up 4% from the 10th. Wants our October order before then.', interaction_id: 'ix-80' },
        { id: 'r3', kind: 'mail', at: '2026-09-30T11:05:00+05:30', by: 'Athi', line: 'Purchase order PO-0077 · to ravi.traders@gmial.com', state: { word: 'Bounced', tone: 'amber' }, mail_id: 'ml-18', fix: 'Fix address' },
        { id: 'r4', kind: 'bill', at: '2026-09-25T15:10:00+05:30', by: 'Athi', line: 'RT/2291 · CPVC pipes and elbows (bill received, entered by you)', state: { word: 'Due', tone: 'amber' }, amount_minor: 1820000, currency: 'INR', chit_id: 'ch-b2291' },
        { id: 'r5', kind: 'whatsapp', at: '2026-09-24T10:12:00+05:30', by: 'Athi', direction: 'out', line: 'Sent the PO photo on WhatsApp.', interaction_id: 'ix-70' },
        { id: 'r6', kind: 'mail', at: '2026-09-12T09:00:00+05:30', by: 'Athi', line: 'Payment advice — RT/2240 paid · to ravitraders.mdu@gmail.com', state: { word: 'Sent', tone: 'green' }, mail_id: 'ml-09' },
        { id: 'r7', kind: 'payment', at: '2026-09-12T08:55:00+05:30', by: 'Athi', line: 'PAY-0103 · NEFT · RT/2240', state: { word: 'Paid', tone: 'green' }, amount_minor: 1254000, currency: 'INR', chit_id: 'ch-p103' },
        { id: 'r8', kind: 'visit', at: '2026-09-08T12:00:00+05:30', by: 'Athi', direction: 'out', line: 'Visited the godown — checked stock of 2" fittings.', interaction_id: 'ix-58' },
        { id: 'r9', kind: 'change', at: '2026-09-05T09:40:00+05:30', by: 'Athi', line: 'GSTIN added 33BXRPR4410K1Z2' }
      ]
    },
    '6f1c2a10-0001': {
      counts: { all: 16, messages: 3, bills: 7, notes: 1, mail: 0, followups: 2 }, next_before: null,
      entries: [
        { id: 'a1', kind: 'bill', at: '2026-09-30T16:10:00+05:30', by: 'Agro Mills', theirs: true, line: 'AM/0930 · Cattle feed 10 bags', state: { word: 'Accepted', tone: 'green' }, amount_minor: 18165, currency: 'INR', chit_id: 'ch-am930' },
        { id: 'a2', kind: 'followup', at: '2026-09-22T10:00:00+05:30', by: 'Athi', line: 'Ask for a corrected GST bill (AM/0912)', state: { word: 'Late', tone: 'amber' }, followup_id: 'fu-01' },
        { id: 'a3', kind: 'message', at: '2026-09-21T15:00:00+05:30', by: 'Agro Mills', theirs: true, line: 'We will reissue AM/0912 with the right GSTIN this week.', chit_id: 'ch-am912', thread: { unread: false, count: 4 } },
        { id: 'a4', kind: 'bill', at: '2026-09-12T11:30:00+05:30', by: 'Agro Mills', theirs: true, line: 'AM/0912 · Groundnut cake 6 bags', state: { word: 'Due', tone: 'amber' }, amount_minor: 30000, currency: 'INR', chit_id: 'ch-am912' },
        { id: 'a5', kind: 'link', at: '2026-08-14T12:00:00+05:30', by: 'Athi', line: 'Linked to ChitBridge — was P-0008 (local)' },
        { id: 'a6', kind: 'bill', at: '2026-07-30T10:00:00+05:30', by: 'Athi', line: 'Bill AM/0730 entered by you (before link)', state: { word: 'Paid', tone: 'green' }, amount_minor: 42000, currency: 'INR', chit_id: 'ch-am730' },
        { id: 'a7', kind: 'note', at: '2026-06-02T12:00:00+05:30', by: 'Athi', line: 'First order by phone. Ask for Senthil.', interaction_id: 'ix-10' }
      ]
    },
    '6f1c2a10-0013': { counts: { all: 0, messages: 0, bills: 0, notes: 0, mail: 0, followups: 0 }, next_before: null, entries: [] }
  },

  /* ── GET /api/crm/followups?scope=all&done=0 ───────────────────────────────────────────────────────────────── */
  followups: {
    followups: [
      { followup_id: 'fu-01', party_id: '6f1c2a10-0001', party_no: 'P-0001', party_name: 'Agro Mills', what: 'Ask for a corrected GST bill (AM/0912)', due_at: '2026-09-29T11:00:00+05:30', late: true, bucket: 'late', assignee_user_id: 'athi', assignee_name: 'Athi', source: 'manual', done_at: null, created_at: '2026-09-22T10:00:00+05:30', on_chitbridge: true },
      { followup_id: 'fu-04', party_id: '6f1c2a10-0010', party_no: 'P-0010', party_name: 'Kumar Electricals', what: 'Remind about ₹3,125.00 overdue since 30 Aug', due_at: '2026-10-01T10:00:00+05:30', late: true, bucket: 'late', assignee_user_id: 'suresh', assignee_name: null, assignee_left: true, source: 'dues', done_at: null, created_at: '2026-09-25T09:00:00+05:30', on_chitbridge: false },
      { followup_id: 'fu-02', party_id: '6f1c2a10-0002', party_no: 'P-0002', party_name: 'Chola Auto Care', what: 'Collect ₹12,450.00 — promised by Friday', due_at: '2026-10-02T17:00:00+05:30', late: false, bucket: 'today', assignee_user_id: 'athi', assignee_name: 'Athi', source: 'interaction', done_at: null, created_at: '2026-10-01T18:05:00+05:30', on_chitbridge: true },
      { followup_id: 'fu-03', party_id: '6f1c2a10-0003', party_no: 'P-0003', party_name: 'Ravi Traders', what: 'Call about pipe fittings rate for October', due_at: '2026-10-02T15:00:00+05:30', late: false, bucket: 'today', assignee_user_id: 'divya', assignee_name: 'Divya', source: 'interaction', done_at: null, created_at: '2026-10-01T18:40:00+05:30', on_chitbridge: false },
      { followup_id: 'fu-05', party_id: '6f1c2a10-0014', party_no: 'P-0014', party_name: 'Priya Interiors', what: 'Send the tile catalogue and the bulk rate', due_at: '2026-10-03T10:00:00+05:30', late: false, bucket: 'week', assignee_user_id: 'divya', assignee_name: 'Divya', source: 'manual', done_at: null, created_at: '2026-09-28T12:45:00+05:30', on_chitbridge: true },
      { followup_id: 'fu-06', party_id: '6f1c2a10-0010', party_no: 'P-0010', party_name: 'Kumar Electricals', what: 'Ask if they want the new MCB range', due_at: '2026-10-05T11:00:00+05:30', late: false, bucket: 'week', assignee_user_id: 'athi', assignee_name: 'Athi', source: 'manual', done_at: null, created_at: '2026-09-24T17:20:00+05:30', on_chitbridge: false },
      { followup_id: 'fu-07', party_id: '6f1c2a10-0006', party_no: 'P-0006', party_name: 'Sakthi Builders', what: 'Quarterly rate review — cement and steel', due_at: '2026-10-09T10:00:00+05:30', late: false, bucket: 'later', assignee_user_id: 'athi', assignee_name: 'Athi', source: 'manual', done_at: null, created_at: '2026-09-15T10:00:00+05:30', on_chitbridge: true },
      { followup_id: 'fu-08', party_id: '6f1c2a10-0012', party_no: 'P-0012', party_name: 'Ganesh Stores', what: 'Return the spare crates', due_at: '2026-10-12T10:00:00+05:30', late: false, bucket: 'later', assignee_user_id: 'athi', assignee_name: 'Athi', source: 'manual', done_at: null, created_at: '2026-08-30T10:00:00+05:30', party_removed: true, on_chitbridge: false }
    ]
  },
  co_assists: [ { user_id: 'athi', name: 'Athi', me: true }, { user_id: 'divya', name: 'Divya' } ],

  /* ── GET /api/crm/settings ─────────────────────────────────────────────────────────────────────────────────── */
  settings: {
    mail: {
      set_up: true, from_name: 'Meenakshi Hardware', reply_to: 'meenakshihw@gmail.com', daily_cap: 200, sent_today: 12,
      signature: 'Athi\nMeenakshi Hardware · 21 West Veli Street, Madurai\n+91 98421 00456',
      templates: [
        { template_id: 'tp-1', name: 'Statement of account', purpose: 'service', subject: 'Your statement from {shop.name}', body: 'Dear {party.name},\n\nPlease find your statement attached. The balance as of today is {dues.total}.\n\nThank you.' },
        { template_id: 'tp-2', name: 'Payment reminder', purpose: 'service', subject: 'A gentle reminder — {party.no}', body: 'Dear {party.name},\n\nThis is a reminder that {dues.total} is pending with us. Please arrange payment at your convenience.\n\nThank you.' },
        { template_id: 'tp-3', name: 'Purchase order', purpose: 'service', subject: 'Purchase order from {shop.name}', body: 'Dear {party.name},\n\nPlease find our purchase order attached. Kindly confirm the delivery date.\n\nThank you.' },
        { template_id: 'tp-4', name: 'Diwali offers', purpose: 'marketing', subject: 'Diwali offers at {shop.name}', body: 'Dear {party.name},\n\nOur Diwali offers are on until 31 October.' }
      ]
    }
  },

  /* ── "From this party" (REQUIREMENT-compose-mail §4): referenced by id, never re-uploaded ──────────────────── */
  docs: {
    '6f1c2a10-0003': [
      { doc_ref: 'statement:6f1c2a10-0003', kind: 'statement', name: 'Statement — September 2026', note: 'PDF, made at send' },
      { doc_ref: 'party_item:RT-2291', kind: 'bill', name: 'RT/2291 · CPVC pipes and elbows', amount_minor: 1820000, currency: 'INR' },
      { doc_ref: 'party_item:PAY-0103', kind: 'payment', name: 'PAY-0103 · NEFT', amount_minor: 1254000, currency: 'INR' },
      { doc_ref: 'attachment:at-5531', kind: 'attachment', name: 'PO-0077.pdf', size: '182 KB' }
    ]
  },

  /* ── GET /api/entities/search?q= (F1) — on-ChitBridge matches only; ~ handles never come back ─────────────── */
  search: {
    ravi: [ { user_id: 'ravi-hardwares', bridge_id: 'CB1Z9XC3VB', display_name: 'Ravi Hardwares', city: 'Tiruchirappalli', identity_type: 'entity' } ]
  }
};
