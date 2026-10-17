'use strict';
/**
 * tools/sandbox/maps.cjs — a vendor's API records → the move-in's OWN rows (lib/move-in.js cells(): { line, <field>: string }), per lane.
 * OWNS      the lanes: which saved entities feed which move-in kind (accounts · contacts customer/supplier · items · open_bills receivable/payable),
 *           the filter (an open document only), the field picks, and the paths each lane READS (whatever else carries a value has "no home")
 * CALLED BY tools/sandbox/load.cjs (rows for MI.plan / MI.apply) · tools/sandbox/compare.cjs (reads → the no-home list)
 * FLOW      saved records → lane.filter → lane.cells(rec) → { line, ...strings } → lib/move-in plan(kind, { source, side, rows, world })
 * CARD      23-connectors-and-integrations/xero-quickbooks-myob
 * Nothing here converts money, a tax code or a date: the strings go to the move-in, which reads them with its own readers (toMinor · isoDate ·
 * supplyKindFor). A credit note's remaining credit goes in NEGATIVE — the move-in's own way of saying "a credit" (open_bills, :389-390).
 */

/** a value at a dotted path ("SalesDetails.UnitPrice"), or '' */
function at(rec, dotted) {
  let value = rec;
  for (const part of dotted.split('.')) { if (value == null) return ''; value = value[part]; }
  return value == null ? '' : value;
}
const str = (value) => (value === '' || value == null ? '' : String(value));
const negated = (value) => (str(value) === '' ? '' : String(-Number(value)));
/** a lane's cells: each field by a dotted path, or by a function of the record */
const picks = (fieldPaths) => (rec) => {
  const cells = {};
  for (const [field, how] of Object.entries(fieldPaths)) cells[field] = typeof how === 'function' ? how(rec) : str(at(rec, how));
  return cells;
};

/* ── Xero ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const XERO_OPEN = ['AUTHORISED', 'SUBMITTED'];
const xeroPhone = (rec) => {
  const phone = (rec.Phones || []).find((each) => each.PhoneNumber && (each.PhoneType === 'DEFAULT' || each.PhoneType === 'MOBILE'));
  return phone ? [phone.PhoneCountryCode, phone.PhoneAreaCode, phone.PhoneNumber].filter(Boolean).join(' ') : '';
};
/** a contact with neither flag (the docs' examples) is read as a customer only */
const xeroSide = (rec, side) => (rec.IsCustomer === undefined && rec.IsSupplier === undefined ? side === 'customer' : !!rec[side === 'customer' ? 'IsCustomer' : 'IsSupplier']);
const XERO_CONTACT = { name: 'Name', legal_name: () => '', email: 'EmailAddress', phone: xeroPhone, abn: 'TaxNumber' };
const XERO_CONTACT_READS = ['Name', 'EmailAddress', 'Phones', 'TaxNumber', 'IsCustomer', 'IsSupplier', 'ContactStatus'];
const xeroDoc = (type) => ({ entities: ['invoices', 'bills'], id: 'InvoiceID', filter: (rec) => rec.Type === type && XERO_OPEN.includes(rec.Status),
  cells: picks({ contact: 'Contact.Name', invoice_no: (rec) => str(rec.InvoiceNumber || rec.Reference), date: 'DateString', due_date: 'DueDateString', amount_due: 'AmountDue', total: 'Total' }),
  reads: ['Type', 'Status', 'Contact.Name', 'InvoiceNumber', 'Reference', 'DateString', 'DueDateString', 'AmountDue', 'Total'] });
const xeroCredit = (type) => ({ entities: ['credit_notes'], id: 'CreditNoteID', filter: (rec) => rec.Type === type && XERO_OPEN.includes(rec.Status) && Number(rec.RemainingCredit) > 0,
  cells: picks({ contact: 'Contact.Name', invoice_no: 'CreditNoteNumber', date: 'DateString', due_date: () => '', amount_due: (rec) => negated(rec.RemainingCredit), total: (rec) => negated(rec.Total) }),
  reads: ['Type', 'Status', 'Contact.Name', 'CreditNoteNumber', 'DateString', 'RemainingCredit', 'Total'] });

/* ── QuickBooks Online ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/** a QBO reference by its NAME (the AU map knows names, as the CSV export writes them); the id only when no name came */
const qboRef = (refPath) => (rec) => str(at(rec, refPath + '.name') || at(rec, refPath + '.value'));
const qboPhone = (rec) => str(at(rec, 'PrimaryPhone.FreeFormNumber') || at(rec, 'Mobile.FreeFormNumber'));
const QBO_PARTY = { name: 'DisplayName', legal_name: 'CompanyName', email: 'PrimaryEmailAddr.Address', phone: qboPhone, abn: 'TaxIdentifier' };
const QBO_PARTY_READS = ['DisplayName', 'CompanyName', 'PrimaryEmailAddr.Address', 'PrimaryPhone.FreeFormNumber', 'Mobile.FreeFormNumber', 'TaxIdentifier', 'Active'];
/** what is still open on a QBO document: a credit's remaining credit, else its balance */
const qboOpen = (rec, credit) => (credit && rec.RemainingCredit != null ? rec.RemainingCredit : rec.Balance);
const qboDoc = (entity, party, credit) => ({ entities: [entity], id: 'Id', filter: (rec) => Number(qboOpen(rec, credit)) > 0,
  cells: picks({ contact: party + '.name', invoice_no: (rec) => str(rec.DocNumber || rec.Id), date: 'TxnDate', due_date: 'DueDate',
    amount_due: (rec) => (credit ? negated(qboOpen(rec, true)) : str(rec.Balance)), total: (rec) => (credit ? negated(rec.TotalAmt) : str(rec.TotalAmt)) }),
  reads: [party + '.name', 'DocNumber', 'Id', 'TxnDate', 'DueDate', 'Balance', 'RemainingCredit', 'TotalAmt'] });

/* ── Zoho Books (the move-in has no Zoho source: these rows are built to measure the gap; the plan refuses them in its own words) ── */
const ZOHO_PARTY = { name: 'contact_name', legal_name: 'company_name', email: 'email', phone: (rec) => str(rec.mobile || rec.phone), gstin: 'gst_no' };
const ZOHO_PARTY_READS = ['contact_name', 'company_name', 'email', 'mobile', 'phone', 'gst_no', 'contact_type'];
const zohoDoc = (entity, party, numberKey, statuses) => ({ entities: [entity], id: entity === 'bills' ? 'bill_id' : 'invoice_id',
  filter: (rec) => statuses.includes(rec.status) && Number(rec.balance) > 0,
  cells: picks({ contact: party, invoice_no: numberKey, date: 'date', due_date: 'due_date', amount_due: 'balance', total: 'total' }),
  reads: ['status', party, numberKey, 'date', 'due_date', 'balance', 'total'] });

const LANES = {
  xero: [
    { kind: 'accounts', entities: ['accounts'], id: 'AccountID', filter: (rec) => rec.Status !== 'ARCHIVED',
      cells: picks({ code: 'Code', name: 'Name', type: 'Type', system: 'SystemAccount', tax_code: 'TaxType', description: 'Description' }),
      reads: ['Code', 'Name', 'Type', 'SystemAccount', 'TaxType', 'Description', 'Status'] },
    { kind: 'contacts', side: 'customer', entities: ['contacts'], id: 'ContactID', filter: (rec) => xeroSide(rec, 'customer') && rec.ContactStatus !== 'ARCHIVED', cells: picks(XERO_CONTACT), reads: XERO_CONTACT_READS },
    { kind: 'contacts', side: 'supplier', entities: ['contacts'], id: 'ContactID', filter: (rec) => xeroSide(rec, 'supplier') && rec.ContactStatus !== 'ARCHIVED', cells: picks(XERO_CONTACT), reads: XERO_CONTACT_READS },
    { kind: 'items', entities: ['items'], id: 'ItemID',
      cells: picks({ code: 'Code', name: (rec) => str(rec.Name || rec.Code), description: 'Description', sales_price: 'SalesDetails.UnitPrice',
        purchase_price: 'PurchaseDetails.UnitPrice', sales_tax: 'SalesDetails.TaxType', purchase_tax: 'PurchaseDetails.TaxType' }),
      reads: ['Code', 'Name', 'Description', 'SalesDetails.UnitPrice', 'PurchaseDetails.UnitPrice', 'SalesDetails.TaxType', 'PurchaseDetails.TaxType'] },
    Object.assign({ kind: 'open_bills', side: 'receivable' }, xeroDoc('ACCREC')),
    Object.assign({ kind: 'open_bills', side: 'payable' }, xeroDoc('ACCPAY')),
    Object.assign({ kind: 'open_bills', side: 'receivable', label: 'credit notes (customers)' }, xeroCredit('ACCRECCREDIT')),
    Object.assign({ kind: 'open_bills', side: 'payable', label: 'credit notes (suppliers)' }, xeroCredit('ACCPAYCREDIT')),
  ],
  qbo: [
    { kind: 'accounts', entities: ['account'], id: 'Id', filter: (rec) => rec.Active !== false,
      cells: picks({ code: 'AcctNum', name: 'Name', type: 'AccountType', system: 'AccountSubType', tax_code: qboRef('TaxCodeRef'), description: 'Description' }),
      reads: ['AcctNum', 'Name', 'AccountType', 'AccountSubType', 'TaxCodeRef', 'Description', 'Active'] },
    { kind: 'contacts', side: 'customer', entities: ['customer'], id: 'Id', filter: (rec) => rec.Active !== false, cells: picks(QBO_PARTY), reads: QBO_PARTY_READS },
    { kind: 'contacts', side: 'supplier', entities: ['vendor'], id: 'Id', filter: (rec) => rec.Active !== false, cells: picks(QBO_PARTY), reads: QBO_PARTY_READS },
    { kind: 'items', entities: ['item'], id: 'Id', filter: (rec) => rec.Active !== false && rec.Type !== 'Category',
      cells: picks({ code: 'Sku', name: 'Name', description: 'Description', sales_price: 'UnitPrice', purchase_price: 'PurchaseCost', sales_tax: qboRef('SalesTaxCodeRef'), purchase_tax: qboRef('PurchaseTaxCodeRef') }),
      reads: ['Sku', 'Name', 'Description', 'UnitPrice', 'PurchaseCost', 'SalesTaxCodeRef', 'PurchaseTaxCodeRef', 'Active', 'Type'] },
    Object.assign({ kind: 'open_bills', side: 'receivable' }, qboDoc('invoice', 'CustomerRef')),
    Object.assign({ kind: 'open_bills', side: 'payable' }, qboDoc('bill', 'VendorRef')),
    Object.assign({ kind: 'open_bills', side: 'receivable', label: 'credit memos' }, qboDoc('creditmemo', 'CustomerRef', true)),
    Object.assign({ kind: 'open_bills', side: 'payable', label: 'vendor credits' }, qboDoc('vendorcredit', 'VendorRef', true)),
  ],
  zoho: [
    { kind: 'accounts', entities: ['chart_of_accounts'], id: 'account_id', filter: (rec) => rec.is_active !== false,
      cells: picks({ code: 'account_code', name: 'account_name', type: 'account_type', system: () => '', tax_code: () => '', description: 'description' }),
      reads: ['account_code', 'account_name', 'account_type', 'description', 'is_active'] },
    { kind: 'contacts', side: 'customer', entities: ['customers', 'vendors'], id: 'contact_id', filter: (rec) => rec.contact_type === 'customer', cells: picks(ZOHO_PARTY), reads: ZOHO_PARTY_READS },
    { kind: 'contacts', side: 'supplier', entities: ['customers', 'vendors'], id: 'contact_id', filter: (rec) => rec.contact_type === 'vendor', cells: picks(ZOHO_PARTY), reads: ZOHO_PARTY_READS },
    { kind: 'items', entities: ['items'], id: 'item_id', filter: (rec) => !rec.status || rec.status === 'active',
      cells: picks({ code: 'sku', name: 'name', description: 'description', sales_price: 'rate', purchase_price: 'purchase_rate', sales_tax: 'tax_name', purchase_tax: 'purchase_tax_name' }),
      reads: ['sku', 'name', 'description', 'rate', 'purchase_rate', 'tax_name', 'purchase_tax_name', 'status'] },
    Object.assign({ kind: 'open_bills', side: 'receivable' }, zohoDoc('invoices', 'customer_name', 'invoice_number', ['sent', 'overdue', 'partially_paid', 'unpaid'])),
    Object.assign({ kind: 'open_bills', side: 'payable' }, zohoDoc('bills', 'vendor_name', 'bill_number', ['open', 'overdue', 'partially_paid'])),
  ],
};

/** the move-in source word for a vendor (the move-in knows xero and qbo; Zoho is said, not mapped onto another) */
const SOURCE = { xero: 'xero', qbo: 'qbo', zoho: 'zoho' };

/** a lane's rows from the saved records: filtered, de-duplicated by the vendor's id, numbered like a file (header = line 1) */
function laneRows(lane, recordsOf) {
  const seen = new Set(), rows = [];
  for (const entity of lane.entities) for (const rec of recordsOf(entity)) {
    const vendorId = rec && rec[lane.id];
    if (vendorId != null && seen.has(String(vendorId))) continue;
    if (vendorId != null) seen.add(String(vendorId));
    if (lane.filter && !lane.filter(rec)) continue;
    rows.push(Object.assign({ line: rows.length + 2 }, lane.cells(rec)));
  }
  return { rows };
}

module.exports = { LANES, SOURCE, laneRows, at };
