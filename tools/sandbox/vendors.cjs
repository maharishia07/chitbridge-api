'use strict';
/**
 * tools/sandbox/vendors.cjs — WHAT each accounting platform's API is asked for in the sandbox trial, and how its pages are read.
 * OWNS      per vendor: the API version, the base address and headers, the one-time lookup of WHICH company (QBO realm · Xero tenant ·
 *           Zoho organisation), the entity list (path per page · the key the records sit under · is there another page), and the SETUP
 *           list (the company's settings, read once each — pull.cjs --setup; the setup map 23-…/SETUP-MAP-2026-10-18.md)
 * CALLED BY tools/sandbox/pull.cjs (fetch and save) · tools/sandbox/load.cjs (read the saved pages back with the same `list`)
 * FLOW      pull: prepare(token) → for each entity: path(page) → save the body as returned → more(body)?  · load: records(vendor, entity, body)
 * CARD      23-connectors-and-integrations/xero-quickbooks-myob
 * The vendor's own names stay in the files (better-not-copied: we read their shape, we do not adopt it).
 */

const QBO_MINOR = 75;
const QBO_PAGE = 1000;
const XERO_PAGE = 100;
const ZOHO_PAGE = 200;
const ZOHO_DETAIL_CAP = 150;   /* a free Zoho org allows 1,000 calls a day: details for the first 150 documents per kind */

/* QuickBooks: one SQL-like query endpoint; every entity pages by STARTPOSITION */
const qboRecords = (entity) => (body) => (body && body.QueryResponse && body.QueryResponse[entity]) || (body && body[entity] ? [].concat(body[entity]) : []);
const qboEntity = (entity) => ({ name: entity.toLowerCase(), key: entity,
  path: (page) => '/query?minorversion=' + QBO_MINOR + '&query=' + encodeURIComponent('select * from ' + entity + ' startposition ' + ((page - 1) * QBO_PAGE + 1) + ' maxresults ' + QBO_PAGE),
  list: qboRecords(entity),
  more: (body) => qboRecords(entity)(body).length === QBO_PAGE });

/* Xero: one endpoint per entity; the paged ones take page + pageSize */
const xeroEntity = (name, key, route, paged) => ({ name, key,
  path: (page) => '/' + route + (paged ? (route.includes('?') ? '&' : '?') + 'page=' + page + '&pageSize=' + XERO_PAGE : ''),
  list: (body) => (body && body[key]) || [],
  more: (body) => !!paged && ((body && body[key]) || []).length === XERO_PAGE });

/* Zoho Books: one endpoint per entity, page + per_page, page_context.has_more_page; lists carry no lines, so documents get a detail read */
const zohoEntity = (name, key, route, detail) => ({ name, key, detail,
  path: (page) => '/' + route + (route.includes('?') ? '&' : '?') + 'page=' + page + '&per_page=' + ZOHO_PAGE,
  list: (body) => (body && (body[key] || body[key.replace(/_/g, '')])) || [],   /* the docs write customer_payments, the endpoint is customerpayments */
  more: (body) => !!(body && body.page_context && body.page_context.has_more_page) });
/* a setting read once: one GET, no pages (the SETUP set — the company's own settings, read so our setup can be pre-filled) */
const settingEntity = (name, key, route) => ({ name, key, path: () => '/' + route,
  list: (body) => { const holder = [body, body && body.QueryResponse, body && body.data].find((each) => each && each[key] !== undefined);   /* Zoho payment terms sit under data */
    return holder ? [].concat(holder[key]) : []; },
  more: () => false });
const zohoDetail = (kind, idKey) => ({ path: (docId) => '/' + kind + 's/' + docId, id: idKey, key: kind });

/** Xero: the Demo Company among the tenants this token may see; kept on the token file so the next pull does not ask */
async function xeroPrepare(token, getJson) {
  if (token.tenant_id) return { company: token.tenant_name || token.tenant_id };
  const tenants = (await getJson('https://api.xero.com/connections')) || [];
  const pick = tenants.find((tenant) => /demo company/i.test(tenant.tenantName || '')) || tenants[0];
  if (!pick) throw new Error('Xero shows no organisation for this key — turn on the Demo Company and connect again.');
  return { company: pick.tenantName, save: { tenant_id: pick.tenantId, tenant_name: pick.tenantName } };
}
/** Zoho: the default Books organisation this token may see */
async function zohoPrepare(token, getJson) {
  if (!token.api_domain) throw new Error('Zoho gave no API address — connect again.');
  if (token.organization_id) return { company: token.organization_name || token.organization_id };
  const answer = await getJson(String(token.api_domain).replace(/\/$/, '') + '/books/v3/organizations');
  const orgs = (answer && answer.organizations) || [];
  const pick = orgs.find((each) => each.is_default_org) || orgs[0];
  if (!pick) throw new Error('Zoho shows no Books organisation for this key.');
  return { company: pick.name, save: { organization_id: String(pick.organization_id), organization_name: pick.name } };
}

const VENDORS = {
  qbo: {
    api_version: 'v3 minorversion ' + QBO_MINOR,
    base: (token) => 'https://sandbox-quickbooks.api.intuit.com/v3/company/' + encodeURIComponent(token.realm_id),
    headers: (token) => ({ Authorization: 'Bearer ' + token.access_token, Accept: 'application/json' }),
    async prepare(token) { if (!token.realm_id) throw new Error('QuickBooks gave no company id (realmId) — connect again.'); return { company: token.realm_id }; },
    entities: ['Customer', 'Vendor', 'Item', 'Invoice', 'Bill', 'CreditMemo', 'VendorCredit', 'Payment', 'BillPayment', 'TaxCode', 'TaxRate', 'Account', 'CompanyInfo'].map(qboEntity),
    setup: ['Preferences', 'CompanyInfo', 'Term', 'PaymentMethod', 'Class', 'Department', 'CompanyCurrency', 'TaxCode', 'TaxRate'].map(qboEntity),
  },
  xero: {
    api_version: 'api.xro/2.0',
    base: () => 'https://api.xero.com/api.xro/2.0',
    headers: (token) => ({ Authorization: 'Bearer ' + token.access_token, Accept: 'application/json', 'xero-tenant-id': token.tenant_id }),
    prepare: xeroPrepare,
    entities: [
      xeroEntity('contacts', 'Contacts', 'Contacts', true), xeroEntity('items', 'Items', 'Items', false),
      xeroEntity('invoices', 'Invoices', 'Invoices?where=' + encodeURIComponent('Type=="ACCREC"'), true),
      xeroEntity('bills', 'Invoices', 'Invoices?where=' + encodeURIComponent('Type=="ACCPAY"'), true),
      xeroEntity('credit_notes', 'CreditNotes', 'CreditNotes', true), xeroEntity('payments', 'Payments', 'Payments', true),
      xeroEntity('tax_rates', 'TaxRates', 'TaxRates', false), xeroEntity('accounts', 'Accounts', 'Accounts', false), xeroEntity('organisation', 'Organisations', 'Organisation', false),
    ],
    setup: [settingEntity('organisation', 'Organisations', 'Organisation'), settingEntity('currencies', 'Currencies', 'Currencies'),
      settingEntity('tracking_categories', 'TrackingCategories', 'TrackingCategories'), settingEntity('branding_themes', 'BrandingThemes', 'BrandingThemes'),
      settingEntity('tax_rates', 'TaxRates', 'TaxRates')],
  },
  zoho: {
    api_version: 'books/v3',
    base: (token) => String(token.api_domain || '').replace(/\/$/, '') + '/books/v3',
    headers: (token) => ({ Authorization: 'Zoho-oauthtoken ' + token.access_token, Accept: 'application/json' }),
    query: (token) => 'organization_id=' + encodeURIComponent(token.organization_id),
    prepare: zohoPrepare,
    entities: [
      zohoEntity('customers', 'contacts', 'contacts?contact_type=customer'), zohoEntity('vendors', 'contacts', 'contacts?contact_type=vendor'),
      zohoEntity('items', 'items', 'items'),
      zohoEntity('invoices', 'invoices', 'invoices', zohoDetail('invoice', 'invoice_id')),
      zohoEntity('bills', 'bills', 'bills', zohoDetail('bill', 'bill_id')),
      zohoEntity('credit_notes', 'creditnotes', 'creditnotes', zohoDetail('creditnote', 'creditnote_id')),
      zohoEntity('customer_payments', 'customer_payments', 'customerpayments'), zohoEntity('vendor_payments', 'vendorpayments', 'vendorpayments'),
      zohoEntity('taxes', 'taxes', 'settings/taxes'), zohoEntity('chart_of_accounts', 'chartofaccounts', 'chartofaccounts'),
      { name: 'organisation', key: 'organization', path: () => '/organizations/{org}', list: (body) => (body && body.organization ? [body.organization] : []), more: () => false },
    ],
    setup: [settingEntity('organisation', 'organization', 'organizations/{org}'), settingEntity('preferences', 'preferences', 'settings/preferences'),
      settingEntity('currencies', 'currencies', 'settings/currencies'), settingEntity('taxes', 'taxes', 'settings/taxes'),
      /* not asked: settings/taxgroups answers 405 to a GET and settings/units 404 (18 Oct) — groups come inside settings/taxes */
      settingEntity('payment_terms', 'payment_terms', 'settings/paymentterms'), settingEntity('invoice_settings', 'invoice_settings', 'settings/invoices'),
      settingEntity('opening_balances', 'opening_balance', 'settings/openingbalances')],
  },
};

/** the records inside one saved body, by the entity's own reader (the load reads with exactly what the pull fetched with) */
function records(vendor, entityName, body) {
  const entity = VENDORS[vendor].entities.find((candidate) => candidate.name === entityName);
  return entity ? entity.list(body) : [];
}

module.exports = { VENDORS, records, ZOHO_DETAIL_CAP };
