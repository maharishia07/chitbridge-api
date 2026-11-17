/* bank-demo-sample.js — the sample of public/bank-demo.html: Harbour Plumbing Pty Ltd, October 2026, twelve statement lines and the books they are checked against.
 * OWNS      SAMPLE_CSV (the 12 lines of Harbour's October statement, the same file the auditor loads in the product), SAMPLE_BOOKS (the two bank entries the clean Harbour books hold, opening 18,500.00), PARTIES (who the books know). Demo seed data only: no rule is computed here.
 * CALLED BY public/app/bank-demo.js (reads CBBankDemoSample); loaded before it by public/bank-demo.html.
 * FLOW      read once at load → the page puts the statement through the engines against these books
 * FIGURES    from C:/dev/shots/l16-clean-seed/EXPECTED.md, never invented: books 19,963.00 = 18,500.00 - 242.00 + 1,705.00; the statement closes 18,280.75; statement less books = -1,682.25 (10 lines to add). The product shows the same.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
(function (root) {
  'use strict';
  var SAMPLE_CSV = [
    'Date,Description,Debit Amount,Credit Amount,Balance',
    '02/10/2026,DIRECT DEBIT ORIGIN ENERGY 7721,242.00,,18258.00',
    '08/10/2026,CARD SETTLEMENT EFTPOS 0810,,451.00,18709.00',
    '09/10/2026,MONTHLY ACCOUNT FEE,12.00,,18697.00',
    '12/10/2026,EFT KENSINGTON STRATA INV 1,,1705.00,20402.00',
    '17/10/2026,EFT JONES PLUMBING SUPPLIES J1,880.00,,19522.00',
    '20/10/2026,EFT COOGEE BAY CAFE INV 2,,2750.00,22272.00',
    '22/10/2026,TRANSFER TO SAVINGS 4411,3000.00,,19272.00',
    '24/10/2026,ATO PAYMENT BAS 1126,1462.00,,17810.00',
    '26/10/2026,DIRECT CREDIT PACIFIC RIM TRADERS,,660.00,18470.00',
    '27/10/2026,EFTPOS BUNNINGS 0450 SYDNEY,96.80,,18373.20',
    '27/10/2026,EFTPOS BUNNINGS 0450 SYDNEY,96.80,,18276.40',
    '31/10/2026,CREDIT INTEREST,,4.35,18280.75'
  ].join('\n');
  /* the books before the load, as the product's clean Harbour holds them (the opening bank 18,500.00, then the two bank entries E1 and PAY1; Dr = money in) */
  var SAMPLE_BOOKS = [
    ['2026-10-02', 0, 24200, 'Electricity: Origin Energy'],
    ['2026-10-12', 170500, 0, 'Invoice INV-1: Kensington Strata']
  ];
  var OPENING_MINOR = 1850000;
  /* the suppliers and customers the books know: a line that names one is paid to or from them */
  var PARTIES = [
    { id: 'p-jones', name: 'Jones Plumbing Supplies', kind: 'supplier' },
    { id: 'p-kens', name: 'Kensington Strata', kind: 'customer' },
    { id: 'p-coogee', name: 'Coogee Bay Cafe', kind: 'customer' },
    { id: 'p-nguyen', name: 'R and J Nguyen', kind: 'customer' }
  ];
  root.CBBankDemoSample = { SAMPLE_CSV: SAMPLE_CSV, SAMPLE_BOOKS: SAMPLE_BOOKS, OPENING_MINOR: OPENING_MINOR, PARTIES: PARTIES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
