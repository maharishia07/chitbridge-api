/* CB Settings · set up your business — SAMPLE DATA, shaped like what the API would hand the page.
   Every money figure on the sample bill is GIVEN (the tax engine's output, worked once here by hand and checked:
   IN halves per line, AU 1/11 inclusive, AE 5% on top). The page adds up nothing (SYSTEM.md rule 12).
   THEMES: Dark and Terminal are copied from the engine (public/engine/screen.js CBScreen.APP_THEMES, v1.15.0). */
window.CBS = {};

CBS.THEMES = {
  cream: { name: 'Cream', vars: {} },
  dark: { name: 'Dark', vars: {"--paper":"#14181D","--card":"#1C2128","--line":"#2E353E","--ink":"#E6EAEF","--ink-2":"#C4CCD6","--grey":"#D4D9DF","--grey-2":"#C5CBD2","--grey-3":"#B7BEC6","--grey-4":"#ABB3BB","--blue":"#6892DB","--blue-d":"#7BA2E4","--blue-2":"#6A8FD1","--blue-tint":"#1E2A3C","--blue-tint-line":"#31445F","--gold":"#D4B074","--gold-soft":"#2A2418","--gold-line":"#463A22","--ok":"#2E9E5E","--ok-2":"#2E9E5E","--ok-3":"#3BB06E","--prog":"#B07F20","--warn-2":"#B3852A","--warn-3":"#C08F35","--disp":"#E15E54","--disp-2":"#C9463D","--sel":"#2A3647","--hover":"#262D36","--blue-tint-bg":"#1B2739","--ok-tint":"#16281E","--danger-tint":"#2E1A18","--warn-tint":"#2A2418","--shadow":"0 1px 2px rgba(0,0,0,.4),0 12px 34px rgba(0,0,0,.5)"} },
  terminal: { name: 'Terminal', mono: true, vars: {"--paper":"#021A0C","--card":"#03200F","--line":"#24773F","--ink":"#F2FFF2","--ink-2":"#D8F7DE","--grey":"#B8F5C6","--grey-2":"#A0E6B2","--grey-3":"#88D79C","--grey-4":"#6FC888","--blue":"#FFD84A","--blue-d":"#FFE88A","--blue-2":"#FFD84A","--blue-tint":"#2E2A08","--blue-tint-line":"#8C7A1E","--blue-tint-bg":"#2E2A08","--gold":"#FFD84A","--gold-soft":"#06301A","--gold-line":"#8C7A1E","--ok":"#4CFF7A","--ok-2":"#4CFF7A","--ok-3":"#4CFF7A","--prog":"#FFE066","--warn-2":"#FFE066","--warn-3":"#FFE066","--disp":"#FF7A66","--disp-2":"#FF7A66","--ok-tint":"#0B3A20","--danger-tint":"#3A120C","--warn-tint":"#2A2A08","--sel":"#0B3A20","--hover":"#06301A","--shadow":"0 0 0 1px #24773F"} }
};

/* the kinds of business (the Vertical layer) — the picker. Each sets units, slab, paper, sample bill, licences. */
CBS.KINDS = [
  { id: 'tea', i: '☕', n: 'Tea shop / café' }, { id: 'grocery', i: '🛒', n: 'Grocery' }, { id: 'pharmacy', i: '💊', n: 'Pharmacy' },
  { id: 'restaurant', i: '🍽', n: 'Restaurant' }, { id: 'bakery', i: '🥐', n: 'Bakery & sweets' }, { id: 'clothing', i: '👕', n: 'Clothing' },
  { id: 'hardware', i: '🔧', n: 'Hardware' }, { id: 'wholesale', i: '📦', n: 'Wholesale' }, { id: 'services', i: '✂', n: 'Services (salon, repair…)' },
  { id: 'other', i: '•', n: 'Something else' }
];
CBS.NATURE = ['Retailer', 'Wholesaler', 'Distributor', 'Manufacturer', 'Service provider'];
CBS.SUPPLY = ['Goods', 'Services', 'Both'];

/* ── the three country packs (the Jurisdiction layer) ─────────────────────────────────────────── */
CBS.C = {
  IN: {
    code: 'IN', flag: '🇮🇳', name: 'India', money: '₹ Rupee', cur: '₹', yearStarts: 'April', tz: 'Kolkata', looks: '₹1,23,45,678.50 · 16 Oct 2026',
    big: 'Lakh · crore', tax: 'GST', taxId: 'GSTIN', taxIdHint: '15 letters and digits', returns: 'GSTR-1 · GSTR-3B', tenders: 'Cash · UPI',
    regQ: 'Registered for GST', hasTaxType: true, regdLabel: 'Registered name',
    structure: 'derived', // from the PAN letter inside the GSTIN
    addrParts: ['Shop / building no.', 'Street', 'Area', 'City', 'District', 'State', 'PIN'],
    licences: [{ k: 'fssai', n: 'Food licence (FSSAI)', kinds: ['tea', 'grocery', 'restaurant', 'bakery'] }, { k: 'drug', n: 'Drug licence', kinds: ['pharmacy'] }, { k: 'trade', n: 'Trade licence', opt: true }, { k: 'udyam', n: 'Udyam (MSME)', opt: true }],
    exportRows: [{ k: 'iec', n: 'Import-export code (IEC)', req: true }, { k: 'port', n: 'Port you ship from' }],
    bankLine: 'HDFC Bank ••4521', payLine: 'UPI · murugan@okhdfcbank', payName: 'UPI ID',
    shop: {
      name: 'Murugan Tea Shop', kind: 'tea', nature: ['Retailer'], supply: 'Goods', taxReg: 'yes', taxNo: '27AAPFU0939F1ZV', taxType: 'Regular',
      state: 'Maharashtra (27)', pan: 'AAPFU0939F', structureWord: 'Partnership firm', structureFrom: 'F in the PAN',
      regd: 'Murugan & Sons', tagline: 'Fresh tea since 1998', phone: '+91 98200 12345', email: 'murugan.tea@gmail.com',
      addr: '12 MG Road, Fort, Mumbai 400001', parts: ['12', 'MG Road', 'Fort', 'Mumbai', 'Mumbai', 'Maharashtra', '400001'],
      fssai: '11519013000123', udyam: '', trade: '', signer: 'S. Murugan', signerAs: 'Partner',
      wrongTaxNo: '27AAPXU0939F1ZV', wrongWhy: 'Letter 6 (X) is not a holder type — P person · C company · F firm'
    },
    search: ['12 MG Road, Fort, Mumbai 400001', 'MG Road, Kalbadevi, Mumbai 400002'],
    bill: {
      no: 'C1/26-27/0041', date: '16/10/2026', time: '10:42', title: 'TAX INVOICE', codeHead: 'SAC', taxHead: 'GST',
      lines: [
        { n: 'Masala tea', code: '996331', q: '4', r: '15.00', a: '60.00', tx: '3.00' },
        { n: 'Samosa', code: '996331', q: '2', r: '20.00', a: '40.00', tx: '2.00' },
        { n: 'Bun maska', code: '996331', q: '1', r: '30.00', a: '30.00', tx: '1.50' }
      ],
      sum: [['Taxable', '₹130.00'], ['CGST 2.5%', '₹3.25'], ['SGST 2.5%', '₹3.25']], total: '₹136.50', paid: 'Paid · UPI ₹136.50',
      foot: 'Thank you · visit again'
    },
    connectors: [
      { id: 'tally', n: 'Tally Prime', ok: true, guide: true }, { id: 'zoho', n: 'Zoho Books', ok: true, guide: true },
      { id: 'gofrugal', n: 'GoFrugal', ok: true, guide: true }, { id: 'csv', n: 'Files (CSV / Excel)', ok: true, guide: true },
      { id: 'xero', n: 'Xero', ok: false, why: 'Not yet in India' }
    ],
    plan: { name: 'Starter', rows: [['Shops and branches', '1', '1'], ['People', '5', '2'], ['Counters', '3', '2'], ['Chits a month', 'No limit', '214'], ['Suppliers', 'No limit', '6']], usage: 'US$0.00' },
    counters: [{ n: 'C1 · Front counter', dev: 'OFFICE-PC · Chrome', seen: 'now', ok: true }, { n: 'C2 · Tea stall', dev: 'Raju’s phone · Android', seen: '12 min ago', ok: true }],
    pcs: { run: { c: 'Tally Prime', pc: 'OFFICE-PC', seen: '1 min ago' }, stop: { c: 'Files (CSV / Excel)', pc: 'ACCOUNTS-LAPTOP', seen: '14 Oct, 18:20' } },
    me: { name: 'S. Murugan', id: 'murugan-tea', email: 'athi.narayanan.74+in-shop1@gmail.com', phone: '+91 98200 12345' }
  },
  AU: {
    code: 'AU', flag: '🇦🇺', name: 'Australia', money: 'A$ Dollar', cur: 'A$', yearStarts: 'July', tz: 'Sydney (NSW)', looks: 'A$12,345,678.50 · 16 Oct 2026',
    big: 'Million', tax: 'GST', taxId: 'ABN', taxIdHint: '11 digits', returns: 'BAS', tenders: 'Cash · Card',
    regQ: 'Registered for GST', hasTaxType: false, regdLabel: 'Registered name',
    structure: 'ask', structures: ['Sole trader', 'Partnership', 'Company', 'Trust'], companyNo: 'ACN',
    addrParts: ['Unit / street no.', 'Street', 'Suburb', 'State', 'Postcode'],
    licences: [{ k: 'fssai', n: 'Food business licence', kinds: ['tea', 'grocery', 'restaurant', 'bakery'] }, { k: 'trade', n: 'Council permit', opt: true }],
    exportRows: [{ k: 'port', n: 'Port you ship from' }],
    bankLine: 'Westpac · BSB 032-000 ••4521', payLine: 'PayID · hello@harbourbean.com.au', payName: 'PayID',
    shop: {
      name: 'Harbour Bean Café', kind: 'tea', nature: ['Retailer'], supply: 'Goods', taxReg: 'yes', taxNo: '51 824 753 556',
      structureWord: 'Company', acn: '824 753 556', regd: 'Harbour Bean Pty Ltd', tagline: 'Roasted on the harbour',
      phone: '+61 2 9123 4567', email: 'hello@harbourbean.com.au', addr: '24 George St, The Rocks NSW 2000', parts: ['24', 'George St', 'The Rocks', 'NSW', '2000'],
      fssai: 'FBL-2026-0412', trade: '', signer: 'Emma Walsh', signerAs: 'Director',
      wrongTaxNo: '51 824 753 557', wrongWhy: 'The check digits do not match — a digit is wrong or two are swapped'
    },
    search: ['24 George St, The Rocks NSW 2000', 'George St, Sydney NSW 2000'],
    bill: {
      no: 'C1/2026-27/0041', date: '16/10/2026', time: '10:42', title: 'TAX INVOICE', codeHead: '', taxHead: 'GST', incl: true,
      lines: [
        { n: 'Flat white', q: '2', r: '5.50', a: '11.00', tx: '1.00' },
        { n: 'Banana bread', q: '1', r: '6.00', a: '6.00', tx: '0.55' }
      ],
      sum: [], total: 'A$17.00', note: 'Total includes GST A$1.55', paid: 'Paid · Card A$17.00', foot: 'Thanks — see you tomorrow'
    },
    connectors: [
      { id: 'xero', n: 'Xero', ok: false, why: 'Coming soon' }, { id: 'myob', n: 'MYOB', ok: false, why: 'Coming soon' },
      { id: 'qbo', n: 'QuickBooks', ok: false, why: 'Coming soon' }, { id: 'csv', n: 'Files (CSV / Excel)', ok: true, guide: true },
      { id: 'tally', n: 'Tally Prime', ok: false, why: 'Not for Australia' }
    ],
    plan: { name: 'Starter', rows: [['Shops and branches', '1', '1'], ['People', '5', '3'], ['Counters', '3', '1'], ['Chits a month', 'No limit', '96'], ['Suppliers', 'No limit', '4']], usage: 'US$0.00' },
    counters: [{ n: 'C1 · Front counter', dev: 'iPad · Safari', seen: 'now', ok: true }],
    pcs: { run: { c: 'Files (CSV / Excel)', pc: 'BACK-OFFICE', seen: '3 min ago' }, stop: null },
    me: { name: 'Emma Walsh', id: 'harbour-bean', email: 'athi.narayanan.74+au-shop1@gmail.com', phone: '+61 412 345 678' }
  },
  AE: {
    code: 'AE', flag: '🇦🇪', name: 'United Arab Emirates', money: 'AED Dirham', cur: 'AED', yearStarts: 'January', tz: 'Dubai', looks: 'AED 12,345,678.50 · 16 Oct 2026',
    big: 'Million', tax: 'VAT', taxId: 'TRN', taxIdHint: '15 digits', returns: 'VAT return (VAT201)', tenders: 'Cash · Card',
    regQ: 'Registered for VAT', hasTaxType: false, regdLabel: 'Registered name',
    structure: 'ask', structures: ['Sole establishment', 'LLC', 'Free-zone company', 'Branch'], tradeLicence: true,
    addrParts: ['Building', 'Street', 'Area', 'Emirate', 'Makani no.', 'P.O. Box'],
    licences: [{ k: 'fssai', n: 'Food permit', kinds: ['tea', 'grocery', 'restaurant', 'bakery'] }],
    exportRows: [{ k: 'iec', n: 'Customs code', req: true }, { k: 'port', n: 'Port you ship from' }],
    bankLine: 'Emirates NBD · IBAN ••4521', payLine: 'Card machine · Network', payName: 'Card machine',
    shop: {
      name: 'Al Fahidi Karak', kind: 'tea', nature: ['Retailer'], supply: 'Goods', taxReg: 'yes', taxNo: '100123456700003',
      structureWord: 'Sole establishment', tl: '1234567', regd: 'Al Fahidi Karak Tea Est.', tagline: 'Karak · chapati · since 2009',
      phone: '+971 4 353 1234', email: 'alfahidikarak@gmail.com', addr: 'Al Fahidi St, Al Souk Al Kabeer, Bur Dubai', parts: ['Shop 4', 'Al Fahidi St', 'Al Souk Al Kabeer', 'Dubai', '29105 94123', '1234'],
      fssai: 'DM-FP-88213', signer: 'Rashid Khan', signerAs: 'Owner',
      wrongTaxNo: '12345', wrongWhy: 'A TRN is 15 digits'
    },
    search: ['Al Fahidi St, Al Souk Al Kabeer, Bur Dubai', 'Al Fahidi Historical District, Dubai'],
    bill: {
      no: 'C1/2026/0041', date: '16/10/2026', time: '10:42', title: 'TAX INVOICE', codeHead: '', taxHead: 'VAT',
      lines: [
        { n: 'Karak tea', q: '3', r: '2.00', a: '6.00', tx: '0.30' },
        { n: 'Chapati', q: '2', r: '3.00', a: '6.00', tx: '0.30' }
      ],
      sum: [['Subtotal', 'AED 12.00'], ['VAT 5%', 'AED 0.60']], total: 'AED 12.60', paid: 'Paid · Cash AED 12.60', foot: 'Thank you · شكرا'
    },
    connectors: [
      { id: 'zoho', n: 'Zoho Books', ok: false, why: 'Coming soon' }, { id: 'tally', n: 'Tally Prime', ok: true, guide: true },
      { id: 'qbo', n: 'QuickBooks', ok: false, why: 'Coming soon' }, { id: 'csv', n: 'Files (CSV / Excel)', ok: true, guide: true }
    ],
    plan: { name: 'Starter', rows: [['Shops and branches', '1', '1'], ['People', '5', '2'], ['Counters', '3', '1'], ['Chits a month', 'No limit', '58'], ['Suppliers', 'No limit', '2']], usage: 'US$0.00' },
    counters: [{ n: 'C1 · Counter', dev: 'SHOP-PC · Edge', seen: 'now', ok: true }],
    pcs: { run: { c: 'Tally Prime', pc: 'SHOP-PC', seen: '2 min ago' }, stop: null },
    me: { name: 'Rashid Khan', id: 'alfahidi-karak', email: 'athi.narayanan.74+ae-shop1@gmail.com', phone: '+971 50 123 4567' }
  }
};

/* ── the four demo states: which answers exist (PROTOTYPE ONLY) ───────────────────────────────── */
CBS.STATES = {
  first: { n: 'First visit', has: ['country'] },
  half: { n: 'Half done', has: ['country', 'kind', 'nature', 'supply', 'taxReg', 'taxNo', 'taxType', 'name', 'logo', 'addr', 'phone', 'regd', 'structure', 'acn', 'tl'] },
  all: { n: 'All done', has: '*' },
  wrong: { n: 'Wrong tax number', has: ['country', 'kind', 'nature', 'supply', 'taxReg', 'taxNo', 'taxType', 'name', 'logo', 'addr', 'phone', 'email', 'regd', 'structure', 'acn', 'tl'], wrong: true }
};

/* ── Policy: Rule · Now · Who may change it · where it acts (ⓘ). Words from R13/R37/R48; dead rows (trade cover, chit expiry) hidden. */
CBS.POLICY = [
  { r: 'Shelf price includes tax', now: 'Includes tax', opts: ['Includes tax', 'Tax added on top'], who: 'You', where: 'Counter and every bill: the price you type is the price paid.' },
  { r: 'Hide items at zero stock', now: 'Show them', opts: ['Show them', 'Hide them'], who: 'You', where: 'Counter and online shop.' },
  { r: 'A bill is overdue after', now: '7 days', opts: ['7 days', '15 days', '30 days', '45 days'], who: 'You', where: 'Collections in CB Finance.' },
  { r: 'Orders go to the ledger', now: 'When accepted', opts: ['When accepted', 'When delivered', 'When paid'], who: 'You', where: 'Each order, and your connector (Tally …).' },
  { r: 'Ledger entry late after', now: '12 hours', opts: ['6 hours', '12 hours', '24 hours'], who: 'You', where: 'The to-do on CB Accounts.' },
  { r: 'Short delivery allowed · weighed', now: '0.5 %', opts: ['0 %', '0.5 %', '1 %', '2 %'], who: 'You', where: 'Receiving a delivery.' },
  { r: 'Short delivery allowed · counted', now: '0 units', opts: ['0 units', '1 unit', '2 units'], who: 'You', where: 'Receiving a delivery.' },
  { r: 'Rate difference allowed', now: '0 %', opts: ['0 %', '1 %', '2 %'], who: 'You', where: 'Matching a supplier’s bill.' },
  { r: 'Keep records for', now: '8 years', opts: ['6 years', '8 years', '10 years'], who: 'Owner only', where: 'Old bills and chits; the law here asks for at least this.' },
  { r: 'Tax registration', now: 'Registered', who: 'Your business', link: 'business', where: 'Set by your tax number.' }
];
