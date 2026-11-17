/* Chart of accounts. Replace with an API call in production.
   kind: personal | real | nominal (golden rules of accounting). */
window.LEDGER_DATA = [
  { id:'people', kind:'personal', label:'PERSONAL', title:'People', blurb:'Customers and suppliers',
    rule:'Debit the receiver, credit the giver', color:'var(--personal)',
    groups:[ { title:'PARTIES', accounts:[['1300','Customers (Sundry Debtors)'],['2100','Suppliers (Sundry Creditors)']] } ] },
  { id:'real', kind:'real', label:'REAL', title:'Things you hold', blurb:'Cash, bank, stock, and what you owe on them',
    rule:'Debit what comes in, credit what goes out', color:'var(--real)',
    groups:[
      { title:'CASH & BANK', accounts:[['1400','Cash'],['1500','Bank'],['1510','UPI collections'],['1520','Card settlements']] },
      { title:'STOCK & ADVANCES', accounts:[['1200','Stock-in-hand'],['1700','Advances to suppliers'],['2400','Advances from customers']] },
      { title:'GST', accounts:[['2200','Output CGST'],['2201','Output SGST'],['2202','Output IGST'],['2210','Input CGST'],['2211','Input SGST'],['2212','Input IGST']] },
      { title:'TAXES & SUSPENSE', accounts:[['2220','TDS payable'],['2900','Suspense']] },
      { title:"OWNER'S EQUITY", accounts:[['3000','Capital'],['3100','Drawings'],['3900','Profit and loss (retained)']] }
    ] },
  { id:'nominal', kind:'nominal', label:'NOMINAL', title:'Income and expenses', blurb:'What you earn and what it costs to run the shop',
    rule:'Debit expenses and losses, credit income and gains', color:'var(--nominal)',
    groups:[
      { title:'INCOME', accounts:[['4000','Sales'],['4090','Sales returns'],['4200','Interest received'],['4210','Commission received'],['4220','Rent received'],['4230','Discount received'],['4240','Scrap sales'],['4290','Sundry income']] },
      { title:'DIRECT COSTS', accounts:[['5000','Purchases'],['5090','Purchase returns'],['5100','Wages'],['5110','Freight and cartage inward'],['5120','Packing materials']] },
      { title:'OPERATING EXPENSES', accounts:[['6010','Rent'],['6020','Salaries'],['6030','Electricity and water'],['6040','Telephone and internet'],['6050','Transport and delivery'],['6060','Repairs and maintenance'],['6070','Printing and stationery'],['6080','Fuel'],['6090','Bank charges'],['6100','Commission paid'],['6110','Advertising'],['6120','Professional fees'],['6130','Staff welfare'],['6190','Sundry expenses']] },
      { title:'ADJUSTMENTS', accounts:[['6800','Discount allowed'],['6850','Bad debts written off'],['6900','Round off']] }
    ] }
];

window.NAV_ITEMS = [
  ['Day book','M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5'],
  ['Ledgers','M5 3h14v18H5zM9 7h6M9 11h6M9 15h4'],
  ['Trial balance','M12 3v18M5 21h14M4 8h16M7 8l-3 7h6zM17 8l-3 7h6z'],
  ['P&L','M4 20V4M4 20h16M8 15l4-4 3 3 5-6'],
  ['Balance sheet','M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18'],
  ['Dues','M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9'],
  ['Cheques','M3 6h18v12H3zM7 14h5M15 10h2'],
  ['Waiting','M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2'],
  ['Month lock','M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4'],
  ['Packs','M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10'],
  ['Opening balances','M12 3v12M7 10l5 5 5-5M4 21h16'],
  ['Shop ledgers','M3 6h6l2 2h10v11H3z']
];
