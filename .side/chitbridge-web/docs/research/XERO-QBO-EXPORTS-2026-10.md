# Xero and QuickBooks Online — what a practice can EXPORT, and where each field lands in ChitBridge (research round IM0, 2026-10-12)

**Why this file exists.** Round IM1 builds the move-in importer: an Australian practice (Athi's CA friend, ~150 clients on
Xero and QuickBooks Online, PLAN-2026-10-12 §B.2, COMPARE-AU-BOOKS-2026-10.md) exports a client's books "as at" a move
date and ChitBridge takes them in. Before anything is built, this file says what those exports actually contain, which API
route each one maps to for a later live connector, and which of OUR slots each field fills — or that it has no home yet.

**How to read it.** Every external claim carries its URL. Three marks:
*(verified)* = the page or spec was read on the runner on 2026-10-12 · *(not fetched)* = the page exists but could not be
read from the runner, so nothing is claimed from it · *(recall, UNVERIFIED)* = what the author remembers of a template
that could not be fetched; a hypothesis for IM1 to check against a downloaded file, never a spec to code from.
ChitBridge cells cite a file in the API repo (`api:` = `chitbridge-api/`) or this repo (`web:`).

**What could and could not be verified.**

| Source | Status on the runner | Consequence |
|---|---|---|
| developer.xero.com (OAuth limits · scopes · Types and Codes · Reports · Conversions guide) | *(verified)* through a rendering proxy | AU tax codes, report columns, Setup endpoint, limits, scopes — all sourced |
| Xero Accounting OpenAPI spec (XeroAPI GitHub, official) | *(verified)* `https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml` | every Xero entity field and enum below |
| central.xero.com (the Help Centre: every "Export …" / "Import …" article) | *(not fetched)* — Salesforce Lightning shell to curl; "Error" through the renderer; `xero.my.site.com` answered 503 "Xero Central Maintenance Page" | **Xero menu paths and CSV headers are NOT sourced.** They are given as recall, flagged, for IM1 to verify by downloading the template from a Xero org |
| developer.intuit.com (entities · reports · scopes · OAuth · limits) | *(verified)* through a rendering proxy | every QBO field below is sourced |
| quickbooks.intuit.com/learn-support (AU export-data, move-lists, ageing report, import FAQ; CA export-data and contact-fields; ZA customer export) | *(verified)* | QBO menu paths and import layouts sourced; the four per-list AU import articles (chart, contacts, invoices, bills) answered "We're sorry, we can't find the page" and the products-and-services one is sign-in gated — their column lists are *(not fetched)* |

---

## 1. Xero (AU organisation)

### 1.1 How a practice or owner exports

Xero Help Centre articles exist for each export but **none could be read from the runner** *(not fetched)*; IM1 verifies these
first. The slugs are the ones the Help Centre uses (`https://central.xero.com/s/article/<slug>`):

| Thing | Help Centre article to verify | Menu path *(recall, UNVERIFIED)* |
|---|---|---|
| Chart of accounts | `Export-your-chart-of-accounts` · `Import-a-chart-of-accounts` | Accounting › Advanced › Chart of accounts › **Export** → `ChartOfAccounts.csv` |
| Contacts | `Export-contacts` · `Import-contacts` | Contacts › All contacts (or a group) › **Export** → CSV |
| Items | `Export-inventory-items` · `Import-inventory-items` | Business › Products and services › **Export** → CSV |
| Invoices, bills, credit notes | `Export-invoices-bills-and-credit-notes` | Business › Invoices (or Bills to pay) › **Export** → CSV of the current tab and filter |
| Trial balance, aged receivables / payables | `Trial-Balance-report` · `Aged-Receivables-Summary-report` | Accounting › Reports › pick the report › set **as at** date › **Export** › Excel · PDF · Google Sheets |
| Default AU tax rates | `Default-tax-rates-in-Xero-AU` | Accounting › Advanced › Tax rates (the API list in §1.7 is the sourced one) |

What IS sourced about the export side: a practice-level alternative to CSV is the API, and Xero's own conversion guide
says AU organisations arrive with the default tax rates already set, so only the chart, contacts, items and balances
move *(verified)* https://developer.xero.com/documentation/api-guides/conversions.

### 1.2 Chart of accounts

**CSV** *(recall, UNVERIFIED — check the downloaded template)*: `*Code, *Name, *Type, *Tax Code, Description, Dashboard,
Expense Claims, Enable Payments, Balance`. The starred four are the required ones; `Balance` is only read on import.

**API** *(verified)* `GET https://api.xero.com/api.xro/2.0/Accounts` — scope `accounting.settings.read`
(OpenAPI `Account`): `Code` (alphanumeric, max 10) · `Name` (max 150) · `AccountID` · `Type` · `BankAccountNumber` ·
`Status` (ACTIVE · ARCHIVED) · `Description` · `BankAccountType` · `CurrencyCode` · `TaxType` ("the tax type from
taxRates") · `EnablePaymentsToAccount` · `ShowInExpenseClaims` · `Class` · `SystemAccount` (DEBTORS, CREDITORS, …) ·
`ReportingCode` · `ReportingCodeName` · `UpdatedDateUTC` · `AddToWatchlist`.
`Type` enum: `BANK CURRENT CURRLIAB DEPRECIATN DIRECTCOSTS EQUITY EXPENSE FIXED INVENTORY LIABILITY NONCURRENT OTHERINCOME
OVERHEADS PREPAYMENT REVENUE SALES TERMLIAB PAYG`. No balance is on the Account object; balances come from the reports.

### 1.3 Opening balances and trial balance as at a date

**Trial balance** *(verified)* `GET /Reports/TrialBalance?date=YYYY-MM-DD&paymentsOnly=false` — "Returns a trial balance
for the current month up to the date specified. YTD values are shown too." Header row cells: **Account · Debit · Credit ·
YTD Debit · YTD Credit**; rows are grouped in Sections (Revenue, Expenses, Assets, …) and each `Row` cell carries the
`AccountID` in `Attributes`. Scope `accounting.reports.trialbalance.read` (granular) or the deprecated
`accounting.reports.read`. https://developer.xero.com/documentation/api/accounting/reports
The Excel export of the same report from the UI carries the same five columns *(recall, UNVERIFIED)*.

**Conversion balances** *(verified)* — the other direction (into Xero) is `POST /Setup` with `ConversionDate {Month, Year}`
and `ConversionBalances [{AccountCode, Balance}]`, "Debits are positive, credits are negative values"; multi-currency
balances carry `BalanceDetails [{Balance, CurrencyCode, CurrencyRate}]`. Scope `accounting.settings`.
https://developer.xero.com/documentation/api-guides/conversions. That sign convention is the one a practice is used to
reading in a conversion file and is the one to accept in ours.

**Balance sheet as at** *(verified)* `GET /Reports/BalanceSheet?date=&periods=&timeframe=&standardLayout=&paymentsOnly=`.

### 1.4 Contacts (customers and suppliers)

**CSV** *(recall, UNVERIFIED)*: `*ContactName, AccountNumber, EmailAddress, FirstName, LastName, POAttentionTo,
POAddressLine1..4, POCity, PORegion, POPostalCode, POCountry, SAAttentionTo, SAAddressLine1..4, SACity, SARegion,
SAPostalCode, SACountry, PhoneNumber, FaxNumber, MobileNumber, DDINumber, SkypeName, BankAccountName, BankAccountNumber,
BankAccountParticulars, TaxNumber, AccountsReceivableTaxCodeName, AccountsPayableTaxCodeName, Website, LegalName,
Discount, CompanyNumber, DueDateBillDay, DueDateBillTerm, DueDateSalesDay, DueDateSalesTerm, SalesAccount,
PurchasesAccount, TrackingName1, SalesTrackingOption1, PurchasesTrackingOption1, TrackingName2, …, BrandingTheme,
DefaultTaxBillsInclusive, DefaultTaxSalesInclusive, Person1FirstName, Person1LastName, Person1Email, …`. One file holds
customers and suppliers together; the export does not carry the ContactID (a Xero product-ideas thread confirms the gap).

**API** *(verified)* `GET /Contacts` (paged, 100 per page; `?where=IsCustomer==true`, `summaryOnly=true`,
`searchTerm`) — scope `accounting.contacts.read`. Fields (OpenAPI `Contact`): `ContactID` · `ContactNumber` (external
systems' id, max 50, shown as "Contact Code") · `AccountNumber` (max 50) · `ContactStatus` · `Name` (max 255) · `FirstName` ·
`LastName` · `CompanyNumber` ("Company registration number", max 50) · `EmailAddress` · `ContactPersons` ·
`BankAccountDetails` · **`TaxNumber`** — "this is also known as the **ABN (Australia)**, GST Number (New Zealand), VAT
Number (UK) or Tax ID Number (US and global) in the Xero UI" (max 50) · `TaxNumberType` · `AccountsReceivableTaxType` ·
`AccountsPayableTaxType` · `Addresses [{AddressType, AddressLine1-4, City, Region, PostalCode, Country, AttentionTo}]` ·
`Phones [{PhoneType, PhoneNumber, PhoneAreaCode, PhoneCountryCode}]` · `IsSupplier` · `IsCustomer` (set by Xero when a
bill / invoice exists) · `SalesDefaultLineAmountType` · `PurchasesDefaultLineAmountType` · `DefaultCurrency` ·
`SalesDefaultAccountCode` · `PurchasesDefaultAccountCode` · `PaymentTerms {Bills {Day, Type}, Sales {Day, Type}}` (Type
e.g. `DAYSAFTERBILLDATE`, `OFCURRENTMONTH`) · `ContactGroups` · `Website` · `Discount` · **`Balances {AccountsReceivable
{Outstanding, Overdue}, AccountsPayable {Outstanding, Overdue}}`** ("not converted to base currency (read only)") ·
`UpdatedDateUTC`.

### 1.5 Items (products and services)

**CSV** *(recall, UNVERIFIED)*: `*ItemCode, ItemName, PurchasesDescription, PurchasesUnitPrice, PurchasesAccount,
PurchasesTaxRate, SalesDescription, SalesUnitPrice, SalesAccount, SalesTaxRate, InventoryAssetAccount,
CostOfGoodsSoldAccount`. Tax rates are given by NAME ("GST on Income"), not by TaxType code. There is no unit-of-measure
column and no quantity column in the item CSV.

**API** *(verified)* `GET /Items` (`?unitdp=4` for 4-decimal prices) — scope `accounting.settings.read`. Fields
(OpenAPI `Item`): `Code` (max 30) · `Name` (max 50) · `Description` · `PurchaseDescription` · `IsSold` · `IsPurchased` ·
`PurchaseDetails {UnitPrice, AccountCode, COGSAccountCode, TaxType}` · `SalesDetails {UnitPrice, AccountCode, TaxType}` ·
`IsTrackedAsInventory` (true when `InventoryAssetAccountCode` and `COGSAccountCode` are set) · `InventoryAssetAccountCode` ·
`TotalCostPool` ("calculated using average cost accounting") · `QuantityOnHand` · `QuantityAvailable` ·
`QuantityOnBackOrder` · `ItemID` · `UpdatedDateUTC`. Xero recommends at most 4,000 tracked items per organisation and
100 items per write request (limits page, §1.9).

### 1.6 Open invoices and bills as at the move date

**UI** *(recall, UNVERIFIED)*: the invoices export is the current list tab (Awaiting Payment) as one CSV, one row per
LINE, with `ContactName, EmailAddress, PO address…, InvoiceNumber, Reference, InvoiceDate, DueDate, Total, TaxTotal,
InvoiceAmountPaid, InvoiceAmountDue, InventoryItemCode, Description, Quantity, UnitAmount, Discount, LineAmount,
AccountCode, TaxType, TaxAmount, TrackingName1, TrackingOption1, TrackingName2, TrackingOption2, Currency, Type,
Sent, Status`; the import template (`Import-sales-invoices`) is the shorter `*ContactName, EmailAddress, POAddressLine1..4,
POCity, PORegion, POPostalCode, POCountry, *InvoiceNumber, Reference, *InvoiceDate, *DueDate, InventoryItemCode,
*Description, *Quantity, *UnitAmount, Discount, *AccountCode, *TaxType, TaxAmount, TrackingName1, TrackingOption1,
TrackingName2, TrackingOption2, Currency, BrandingTheme`. The aged reports are the sourced path to "as at".

**API** *(verified)*:
* `GET /Invoices?Statuses=AUTHORISED&where=Type=="ACCREC"&page=1` (100 per page with line items) — scope
  `accounting.invoices.read` (new granular) or `accounting.transactions.read`. `Type` ∈ `ACCREC` (sales invoice) ·
  `ACCPAY` (bill) plus credit / overpayment / prepayment kinds; `Status` ∈ `DRAFT SUBMITTED DELETED AUTHORISED PAID VOIDED`.
  Fields (OpenAPI `Invoice`): `InvoiceNumber` · `Reference` · `Contact` · `Date` · `DueDate` · `LineAmountTypes`
  (`Exclusive` · `Inclusive` · `NoTax`) · `LineItems [{Description, Quantity, UnitAmount, ItemCode, AccountCode, TaxType,
  TaxAmount, LineAmount, DiscountRate, DiscountAmount, Tracking}]` · `SubTotal` · `TotalTax` · `Total` · `TotalDiscount` ·
  `RoundingAmount` · `CurrencyCode` · `CurrencyRate` · **`AmountDue`** · `AmountPaid` · `AmountCredited` ·
  `FullyPaidOnDate` · `Payments` · `CreditNotes` · `UpdatedDateUTC`. Line tax: "The tax amount is auto calculated as a
  percentage of the line amount … based on the tax rate. This value can be overriden".
* Aged, as at a date, **per contact only**: `GET /Reports/AgedReceivablesByContact?contactID=<required>&date=&fromDate=&toDate=`
  ("Shows payments up to this date … Defaults to end of the current month") and `GET /Reports/AgedPayablesByContact`
  with the same parameters — scope `accounting.reports.aged.read`. There is no whole-organisation aged endpoint: a live
  connector walks `Contacts` and calls the report once per contact (rate limits, §1.9), or filters `Invoices` on
  `AmountDue > 0` and ages them itself from `DueDate`.

### 1.7 The GST / tax-rate list (AU)

*(verified)* https://developer.xero.com/documentation/api/accounting/types — "Tax Types included by default … Australia":

| TaxType | Rate | Name | System defined |
|---|---|---|---|
| `OUTPUT` | 10.00 | GST on Income | |
| `INPUT` | 10.00 | GST on Expenses | |
| `EXEMPTEXPENSES` | 0.00 | GST Free Expenses | Yes |
| `EXEMPTOUTPUT` | 0.00 | GST Free Income | |
| `BASEXCLUDED` | 0.00 | BAS Excluded | |
| `GSTONIMPORTS` | 0.00 | GST on Imports | Yes |

Report tax types for AU (the BAS bucket a rate reports into): usable on create/update `OUTPUT INPUT EXEMPTOUTPUT INPUTTAXED
BASEXCLUDED EXEMPTEXPENSES`; system-only (GET) `EXEMPTCAPITAL EXEMPTEXPORT CAPITALEXINPUT GSTONCAPITALIMPORTS GSTONIMPORTS`.
"New tax rates added have a TaxType of the format TAX001, TAX002". *Input Taxed*, *GST Free Capital* and *GST on Capital*
appear in an org as tax rates whose TaxType is one of those codes (`INPUTTAXED`, `EXEMPTCAPITAL`, `CAPEXINPUT`); the
display names of those are *(recall, UNVERIFIED)* — the names an export carries must be read from `GET /TaxRates` of the
actual organisation, never from a fixed list.

**API** *(verified)* `GET /TaxRates` (`?where=Status=="ACTIVE"`) — scope `accounting.settings.read`. Fields (OpenAPI
`TaxRate`): `Name` · `TaxType` · `TaxComponents [{Name, Rate, IsCompound, IsNonRecoverable}]` · `Status` ·
`ReportTaxType` · plus the read-only `CanApplyTo…`, `DisplayTaxRate`, `EffectiveRate`.

### 1.8 Auth model

*(verified)* OAuth 2.0 authorization code: `https://login.xero.com/identity/connect/authorize` →
`https://identity.xero.com/connect/token`; every call carries the `xero-tenant-id` header (one token can hold several
organisations). Scopes https://developer.xero.com/documentation/guides/oauth2/scopes — `openid profile email`;
`offline_access` ("To get a refresh token, you must request the offline_access scope"); the **granular** read scopes a
read-only importer wants: `accounting.settings.read` (Accounts, Currencies, Organisation, TaxRates …) ·
`accounting.contacts.read` · `accounting.invoices.read` · `accounting.payments.read` · `accounting.reports.aged.read` ·
`accounting.reports.trialbalance.read` · `accounting.reports.balancesheet.read` · `accounting.reports.taxreports.read`
(GST / BAS reports) · `accounting.journals.read`. `accounting.transactions(.read)` and `accounting.reports.read` are
listed as **Deprecated** in favour of those. Setup (writing a chart and conversion balances) needs `accounting.settings`.
App tiers: "New apps default to the starter tier with 5 connections … Core will give you up to 50"; "each organisation
or practice is limited to connecting a maximum of five uncertified apps" https://developer.xero.com/documentation/guides/oauth2/limits.

### 1.9 Rate limits

*(verified)* https://developer.xero.com/documentation/guides/oauth2/limits — per tenant: **5 concurrent · 60 per minute ·
1,000 per day on the starter tier, 5,000 per day on higher tiers**; per app: **10,000 per minute** across tenants. Headers
`X-DayLimit-Remaining`, `X-MinLimit-Remaining`, `X-AppMinLimit-Remaining`; a 429 carries `X-Rate-Limit-Problem` and
`Retry-After` (seconds). Pagination: 100 invoices / contacts / credit notes per page; Journals in batches of 100 ("a
premium feature for apps in the Advanced tier and above"). Max request 10 MB, ~50 nodes per write recommended. Design
volumes: 5,000 sales invoices and 5,000 bills a month, 4,000 tracked items, contacts over 10,000 "could cause
performance issues". Older FAQ wording (5,000/day flat) is at https://developer.xero.com/faq/limits — the limits page
above is the newer one and splits by tier.

---

## 2. QuickBooks Online (AU; IN discontinued)

### 2.1 How a practice or owner exports

*(verified)* AU "Export your reports and lists" https://quickbooks.intuit.com/learn-support/en-au/help-article/list-management/export-data-reports-lists-quickbooks-online/L1xleDrLp_AU_en_AU
and the CA twin (same text) https://quickbooks.intuit.com/learn-support/en-ca/help-article/list-management/export-data-reports-lists-quickbooks-online/L1xleDrLp_CA_en_CA:

* **Everything at once:** Settings (gear) › **Export data** › Reports tab (set "Pre-selected date ranges") and Lists tab,
  turn items on or off › **Export to Excel** — "Export your reports and lists as Excel files in one .zip file". The page
  does not list which lists and reports the zip holds; IM1 reads a real zip.
* **Chart of accounts:** Reports › Standard reports › **Account List** › export icon › **Export to Excel**.
* **Products and services:** All apps › Sales & Get Paid › Products & services › **More ▼ › Run reports** › export icon ›
  Export to Excel.
* **Customers and suppliers** (AU "Move your lists" article https://quickbooks.intuit.com/learn-support/en-au/help-article/migrate-services/move-lists-quickbooks-online/L6v7AmS9l_AU_en_AU
  and ZA customer article https://quickbooks.intuit.com/learn-support/en-za/help-article/import-export-files/export-customer-data-excel/L0ZerVWiO_ZA_en_ZA):
  Reports › Standard reports › **Customer Contact List** / **Supplier Contact List** › Customise › Columns (tick, reorder)
  › Run report › export icon › Export to Excel. "Remove the header info so the column headers sit on row 1"; Mac users
  save as Windows CSV.
* **Trial balance:** Reports › the accountant section › Trial Balance › set the report period › Run report › Export to
  Excel — only community answers describe this path (e.g. https://quickbooks.intuit.com/learn-support/en-uk/reports-and-accounting/report-format/00/676453);
  no AU help article was found. The report has **Debit and Credit** columns only (no opening / movement / closing).
* **Ageing:** AU article https://quickbooks.intuit.com/learn-support/en-au/help-article/accounts-receivable-reports/run-accounts-receivable-ageing-report/L4N7PC2hg_AU_en_AU
  — Reports › Standard reports › "Who owes you" › **Accounts receivable ageing summary** (or **detail**); options
  **Ageing method: Current (today) or Report date (a specific date)**, **Days per ageing period** (30), **Number of
  periods** "four periods: 1-30 days, 31-60 days, 61-90 days, and 91 and Over", **Min. Days Past Due**, an optional
  **Outstanding GST** column (gear icon). Payables: the mirror "What you owe" reports (same options).

Import-side layouts the "Move your lists" article prescribes (these are the columns a list export must be trimmed to,
in this order) *(verified)*:
* Accounts: `Account · Account Name · Detail type · Description · Total balance`
* Customers: `Customer · Customer full name · Email · Phone · Website · Bill street · Bill city · Bill state · Bill zip · Bill country`
* Suppliers: `Supplier · Company · Email · Phone · Website · Bill street · Bill city · Bill state · Bill zip · Bill country`
* Products and Services: `Product/Service · Type · Memo/Description · Purchase price · Sales price · Quantity on hand`
"Import the Chart of Accounts first, because products and services must map to existing income and expense accounts."

Import rules *(verified)* https://quickbooks.intuit.com/learn-support/en-au/help-article/import-export-files/common-questions-importing-data-quickbooks-online/L4OYJRFdj_AU_en_AU:
CSV, Google Sheets or XLS/XLSX; first row is the header and is not imported; **under 1,000 rows per file**; order
Chart of Accounts → Customers → Suppliers → Products and services → Invoices → Bills → Journal entries; a re-import does
not overwrite contacts (duplicates); currency is not read from a contact file. Contact import fields *(verified, CA
wording)* https://quickbooks.intuit.com/learn-support/en-ca/help-article/list-management/contact-fields-imported-excel/L0fwkOCms_CA_en_CA:
name (≤100, unique across Employee · Customer · Supplier), company (≤50), email, phone · mobile · fax (≤21), website,
street (≤2000), city, state/province, postal code (≤30), country, **opening balance** and **opening balance date**,
account number (customers start 411…, suppliers 401…, 6–15 chars; defaults 411001 / 401001), **business number / tax
number** ("Business Number (BN) and GST/HST/QST Number" in CA; the AU/global wording in search snippets is "the ABN and
Tax Reg Number (customers) or Tax ID Number (suppliers)" — the ZA page body was *(not fetched)*, so treat the AU wording
as unconfirmed), report basis (supplier: cash | accrual), resale number (customer, ≤16) / Tax ID (supplier, ≤20).

### 2.2 Chart of accounts

**API** *(verified)* `GET /v3/company/<realmID>/query?query=select * from Account` (1,000 entities max per query response)
https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account. Fields: `Id` · `Name` (no `"` or
`:`) · **`AcctNum`** ("Max length … AU & CA: 20 characters. US, UK & IN: 7") · `AccountType` · `AccountSubType` ·
`Classification` (`Asset Equity Expense Liability Revenue`) · `FullyQualifiedName` (`Parent:Account1:SubAccount1`, 5 levels) ·
`SubAccount` · `ParentRef` · `Description` · `Active` · `CurrencyRef` · **`TaxCodeRef`** ("default tax code used by this
account … For global locales, only") · **`CurrentBalance`** ("Valid for Balance Sheet accounts") ·
`CurrentBalanceWithSubAccounts`. Account List report: `GET /reports/AccountList` (columns Account · Type; params
`account_type` ∈ `AccountsPayable AccountsReceivable Bank CostOfGoodsSold CreditCard Equity Expense FixedAsset Income
LongTermLiability NonPosting OtherAsset OtherCurrentAsset OtherCurrentLiability OtherExpense OtherIncome`,
`account_status` ∈ `Deleted Not_Deleted`) https://developer.intuit.com/app/developer/qbo/docs/api/accounting/report-entities/accountlistdetail.

**Excel** (Account List report, exported): the per-list AU import article was *(not fetched)*; the "Move your lists"
layout above (`Account · Account Name · Detail type · Description · Total balance`) is the sourced column set.

### 2.3 Opening balances and trial balance as at a date

**API** *(verified)* `GET /v3/company/<realmID>/reports/TrialBalance?start_date=&end_date=&accounting_method=Accrual|Cash&date_macro=&summarize_column_by=`
— columns `Account` (with the account `id`) · `Debit` · `Credit`; a `GrandTotal` summary row; FR uses `TrialBalanceFR`
https://developer.intuit.com/app/developer/qbo/docs/api/accounting/report-entities/trialbalance. A single-date trial
balance is `end_date=<move date>` with `start_date` at the start of the fiscal year (`CompanyInfo.FiscalYearStartMonth`).
Balance sheet accounts also expose `Account.CurrentBalance`, but that is "current", not "as at".

### 2.4 Contacts (customers and suppliers)

**API** *(verified)* `select * from Customer` / `select * from Vendor` (paged with `STARTPOSITION … MAXRESULTS 1000`).
Customer https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer: `Id` · `DisplayName`
(unique across Customer · Vendor · Employee) · `CompanyName` · `GivenName` · `FamilyName` · `PrimaryEmailAddr.Address` ·
`PrimaryPhone.FreeFormNumber` · `Mobile` · `BillAddr {Line1-5, City, CountrySubDivisionCode, PostalCode, Country}` ·
`ShipAddr` · **`PrimaryTaxIdentifier`** ("Also called Tax Reg. No in (UK), (CA), (IN), (AU) … **masked in responses,
exposing only last five characters**") · `SecondaryTaxIdentifier` ("UTR No. in (UK), CST Reg No. (IN)", masked) ·
`ResaleNum` · `Taxable` · `DefaultTaxCodeRef` · `SalesTermRef` · `CurrencyRef` · **`Balance`** ("current open balance
(unpaid amount)"; on create it is the opening balance) · `BalanceWithJobs` · `OpenBalanceDate` · `Active` · `ParentRef` /
`Job` (sub-customers) · `CustomerTypeRef` · `Notes` · `WebAddr`.
Vendor https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/vendor: `DisplayName` ·
`CompanyName` · `PrimaryEmailAddr` · `PrimaryPhone` · `BillAddr` · **`TaxIdentifier`** ("masked … last four") · `AcctNum`
("Name or number of the account associated with this vendor") · `TermRef` · `CurrencyRef` · **`Balance`** · **`HasTPAR`**
("Taxable Payments Annual Report … mandated by ATO") · `Vendor1099` (US) · `T4AEligible` / `T5018Eligible` (CA) ·
`VendorPaymentBankDetail` · `Active`.
⚠️ **The API masks tax ids.** An ABN can only arrive whole from the Excel export of the contact list (if the column is
added under Customise › Columns) or by typing; a live connector cannot read it.

### 2.5 Items (products and services)

**API** *(verified)* `select * from Item` https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item:
`Id` · `Name` (unique, no tab / newline / colon) · **`Sku`** · `Type` (`Inventory` · `NonInventory` · `Service` · `Group`
(bundle) · `Category`) · `Description` · `PurchaseDesc` · **`UnitPrice`** ("Corresponds to the Price/Rate column … in the
home currency") · **`PurchaseCost`** · `IncomeAccountRef` · `ExpenseAccountRef` · `AssetAccountRef` · **`QtyOnHand`** ·
`InvStartDate` · `TrackQtyOnHand` · `ReorderPoint` · **`SalesTaxCodeRef`** · **`PurchaseTaxCodeRef`** ·
`SalesTaxIncluded` · `PurchaseTaxIncluded` · `Taxable` ("Applicable to US companies, only") · `PrefVendorRef` ·
`ParentRef` / `SubItem` / `FullyQualifiedName` (`Item:SubItem`) · `Active`. No unit-of-measure field.

**Excel**: the Product/Service List report columns are whatever is ticked under Columns (SKU can be added — community
answer only); the prescribed import layout is `Product/Service · Type · Memo/Description · Purchase price · Sales price ·
Quantity on hand` *(verified, §2.1)*; the AU "Import products and services" article is sign-in gated *(not fetched)*.

### 2.6 Open invoices and bills as at the move date

**API** *(verified)*:
* Invoice https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice:
  `select * from Invoice where Balance > '0'` (QBO's query language quotes numbers). Fields: `Id` · `DocNumber` · `TxnDate` ·
  `DueDate` · `CustomerRef {value, name}` · `Line [{DetailType: SalesItemLineDetail, Amount, Description, SalesItemLineDetail
  {ItemRef, Qty, UnitPrice, TaxCodeRef}}]` + a `SubTotalLineDetail` line (+ `DiscountLineDetail`) · `TxnTaxDetail
  {TxnTaxCodeRef, TotalTax, TaxLine [{Amount, TaxLineDetail {TaxRateRef, TaxPercent, NetAmountTaxable}}]}` · **`TotalAmt`** ·
  **`Balance`** · `CurrencyRef` · `ExchangeRate` · **`GlobalTaxCalculation`** (`TaxExcluded` · `TaxInclusive` ·
  `NotApplicable`; "required for non-US companies") · `SalesTermRef` · `BillAddr` · `ShipAddr` · `CustomerMemo` ·
  `PrivateNote` · `LinkedTxn` · `TransactionLocationType` (UAE only).
* Bill https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/bill: `select * from Bill where
  Balance > '0'`. `DocNumber` · `TxnDate` · `DueDate` · `VendorRef` · `APAccountRef` · `Line [{ItemBasedExpenseLineDetail
  {ItemRef, Qty, UnitPrice, TaxCodeRef} | AccountBasedExpenseLineDetail {AccountRef, TaxCodeRef}}]` · `TotalAmt` ·
  **`Balance`** · `CurrencyRef` · `SalesTermRef` · `PrivateNote` · `LinkedTxn`.
* Aged as at a date, whole organisation: `GET /reports/AgedReceivables?report_date=YYYY-MM-DD&aging_method=Report_Date|Current&customer=`
  — columns `Customer · Current · 1 - 30 · 31 - 60 · 61 - 90 · 91 and over · Total`
  https://developer.intuit.com/app/developer/qbo/docs/api/accounting/report-entities/aragingsummary;
  `GET /reports/AgedReceivableDetail?report_date=&aging_method=&aging_period=30&num_periods=4&past_due=&columns=doc_num,due_date,tx_date,txn_type,memo,…&start_duedate=&end_duedate=`
  (rows grouped "1 - 30 days past due", …) https://developer.intuit.com/app/developer/qbo/docs/api/accounting/report-entities/aragingdetail;
  `GET /reports/AgedPayables` (same shape, Vendor rows)
  https://developer.intuit.com/app/developer/qbo/docs/api/accounting/report-entities/apagingsummary; `CustomerBalance`
  (Customer · Total) https://developer.intuit.com/app/developer/qbo/docs/api/accounting/report-entities/customerbalance.

**Excel**: the A/R and A/P ageing detail reports with **Ageing method = Report date** are the "as at" exports (§2.1);
the summary carries the five buckets and Total, the detail one row per open document with Date · Transaction Type ·
Num · Customer · Due Date · Amount · Open Balance (and optional Past Due, Outstanding GST) — the column names are from
the AU article's options, not from a fetched sample file.

### 2.7 The GST / tax-code list

**AU** *(verified)* Intuit AU product update https://quickbooks.intuit.com/au/blog/product-update/setting-up-gst-in-quickbooks-online/
(detailed coding) — sales: `GST` "GST on sales 10%" · `GST free` 0% · `Input tax` 0% · `GST free export` 0% · `Out of
Scope` 0%; purchases: `GST on capital` 10% · `GST on non-capital` 10% · `GST-free capital` 0% · `GST-free non-capital` 0% ·
`Input tax` 0% · `Out of Scope` 0%. **Simpler GST** (the default for every new AU file) collapses these to **`GST` · `GST
Free` · `Out of Scope`** and retires "Export Sales, Input Tax, GST on capital purchases, GST on non-capital purchases, GST
Free capital purchases and GST Free non-capital purchases" https://quickbooks.intuit.com/learn-support/en-au/help-article/taxation/simpler-gst/L4819AT7k_AU_en_AU;
switching back to Detailed is a support request. Payroll adds `BAS-W1` / `BAS-W2` codes; the GST centre is "GST tab on the
left menu › Settings" https://quickbooks.intuit.com/learn-support/en-au/help-article/set-sales-taxes/edit-gst-settings-quickbooks-online/L2Yt4K5G5_AU_en_AU.
So an AU QBO export carries ONE of two code vocabularies and the importer must read the file's own list, not assume.

**API** *(verified)* `select * from TaxCode` https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/taxcode:
`Id` · `Name` (≤100) · `Description` · `Active` · `Taxable` · `TaxGroup` · `Hidden` · `TaxCodeConfigType` (`USER_DEFINED` ·
`SYSTEM_GENERATED`) · `SalesTaxRateList {TaxRateDetail [{TaxRateRef, TaxTypeApplicable, TaxOrder}]}` ·
`PurchaseTaxRateList`; `select * from TaxRate` gives `Name` · `RateValue` · `AgencyRef` · `SpecialTaxType` ·
`EffectiveTaxRate` · `DisplayType` · `OriginalTaxRate` https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/taxrate.
A tax CODE is a group of RATES split by sales / purchase side; the percentage lives on the rate.

**IN** *(verified)*: "Intuit QuickBooks Online products are no longer available in India. New sign-ups … ended July
2022. QuickBooks subscribers retained access to the product through 30 April 2023. As of 1 July 2023, there is no longer
access" https://quickbooks.intuit.com/in/ (developer notice https://blogs.intuit.com/2023/03/22/discontinuation-of-quickbooks-in-india/).
There is no live QBO India file to export; the only IN traces left in the API are `PrimaryTaxIdentifier` "(IN)" and
`SecondaryTaxIdentifier` "CST Reg No. (IN)" on Customer, and `AcctNum` "7 characters" for IN. **No India tax-code list
exists to map.** An Indian practice moving in will come from Tally or Zoho — the adapters the kit already has.

### 2.8 Auth model

*(verified)* OAuth 2.0 authorization code https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0:
authorize at `https://appcenter.intuit.com/connect/oauth2` with `client_id, scope, redirect_uri, response_type=code,
state`; the callback carries `code` and **`realmId`** ("The unique ID of the connected user's QuickBooks Online company …
Use the realmId for subsequent API endpoint URLs"); token and userinfo endpoints come from the discovery documents
(`/.well-known/openid_configuration`, `_sandbox_` for sandboxes). Scopes
https://developer.intuit.com/app/developer/qbo/docs/learn/scopes: **`com.intuit.quickbooks.accounting`** (the whole
Accounting API — there is no read-only accounting scope) · `com.intuit.quickbooks.payment` · `openid` with `profile email
phone address`; changing scopes restarts consent. Token lifetimes
https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq: **access token 3,600 s;
refresh token 100 days rolling**, its value rotates every 24 h, five-year absolute maximum; 401 = expired access token.
Base URLs `https://quickbooks.api.intuit.com` (production) and `https://sandbox-quickbooks.api.intuit.com`.

### 2.9 Rate limits

*(verified)* https://developer.intuit.com/app/developer/qbo/docs/learn/limits-and-throttles — REST: **500 requests per
minute per realm ID; 10 requests per second per realm ID and app**; batch: ≤30 payloads recommended per batch, 40 batch
requests per minute per realm and app, 120 per minute per realm; sandbox adds 40 emails a day; combined 800/min per
realm and app when other Intuit endpoints are called; **HTTP 429 → wait 60 s**; requests over 120 s time out; a query
response returns at most 1,000 entities (page with `STARTPOSITION`/`MAXRESULTS`). Builder-tier apps in the App Partner
Program have "an included limit of 500,000 CorePlus API calls per workspace per month" (2025 change).

---

## 3. MAPPING — their field → our field

**Our reuse points, found first (CLAUDE.md rule 1).** The connector kit is the import path that already exists:
`api:tools/tally-connector/adapters/csv.js` (`readProducts` · `readStock` · `readProfile` from `products.csv` / `stock.csv`
/ `profile.csv`), `zoho.js` and `tally.js` (the same four reads over REST / XML, plus `ensureParty` — the party shape the
kit already speaks: `{ name, gstin, state_code }`), driven by `api:tools/tally-connector/core.js syncProducts` (→ `POST
/api/products/bulk`, `item_data { name, code, unit, unit_source, price, hsn, gst_rate, category_name, source_system,
source_ref }`), `syncStock`, and `POST /api/integrations/profile` (`api:routes/integrations.js:478`, keys from
`api:lib/profile-map.js FIELDS`). A spreadsheet upload goes through `api:lib/csv-preflight.js` (header → field proposal a
person confirms, `POST /api/products/import/preflight`) and `api:lib/xlsx-read.js` (one sheet of an .xlsx into the same
`{ headers, rows }`), committing through `POST /api/products/import` (`api:routes/products.js:878`). The ledger side:
`POST /api/books/opening { date?, rows: [{ code, party_no?, dr_minor, cr_minor, bill_ref?, due_date? }] }`
(`api:routes/books.js:774`) — one period-0 entry, bill-wise party rows from day one, the difference to Suspense 2900
(`api:lib/posting.js` opening rule; `api:lib/books.js typedDate`: "What was owed before then goes in as an opening
balance"); the chart is `ledger_account` (`api:migrations/b272_books_ledger.sql`: `code · name · parent_id · is_group ·
nature · role · tally_group · sch3_line · currency`) seeded from `api:lib/accounts-packs.js` and read/added through `GET |
POST /api/books/accounts` (`api:routes/books.js:174`); parties are `customer_list` / `supplier_list` + b274 columns
(`legal_name · party_no · credit_days · credit_limit_minor · state_code`) and `party_tax_id (scheme, value)`
(`api:migrations/b274_books_party.sql`, `api:lib/party-fields.js clean / cleanTaxIds / decorate`). Tax is data in
`api:lib/tax-packs.js PACKS` (IN only today) with the arithmetic in `tax-engine` / `tax-lines.invoiceFor`.
**No new importer path is proposed here; IM1 widens these.**

| Their field (Xero → QBO) | Our slot | How, and what is missing |
|---|---|---|
| **Organisation** `Organisation.Name · LegalName · TaxNumber · CountryCode · BaseCurrency · FinancialYearEndDay/Month` → `CompanyInfo.CompanyName · LegalName · Country · FiscalYearStartMonth · Email · PrimaryPhone` | `api:lib/profile-map.js FIELDS` keys `trade_name · legal_name · country · currency · phone · email` via `POST /api/integrations/profile { source, as_of, fields }` (rung `copied`) | Add `xero:` / `qbo:` entries to each field's `sources` map (additive). **No home:** `TaxNumber` = ABN (the only tax key is `gstin`, India-shaped with a check digit); financial-year start (`accounts-packs PACKS.IN.fy_start_month = 4`; AU is July — no AU pack). |
| **Chart of accounts** `Account.Code · Name · Type · TaxType · SystemAccount · Status` → `Account.AcctNum · Name · AccountType · AccountSubType · Classification · TaxCodeRef · ParentRef/FullyQualifiedName · Active` | `ledger_account.name · parent_id (group) · nature · active`; `role` for system accounts (`SystemAccount DEBTORS/CREDITORS`, QBO `AccountsReceivable/AccountsPayable` sub-types → roles `debtors` / `creditors`, `api:lib/accounts-packs.js`) | `POST /api/books/accounts { name, parent_code }` — **"the code is the system's … one typed here is refused (422)"**, so **their account code has no home**: keep it as the mapping key only (a `source_ref`-style column on `ledger_account` would be a new key with a dictionary entry). Their `Type` → our group needs a table: Xero `BANK→bank_accounts · CURRENT→current_assets · INVENTORY→stock_in_hand · CURRLIAB→current_liabilities · SALES/REVENUE→sales_accounts · DIRECTCOSTS→purchase_accounts/direct_expenses · OVERHEADS/EXPENSE→indirect_expenses · EQUITY→capital · FIXED→fixed_assets · TERMLIAB→loans_liability`; QBO `AccountType` likewise — **no such table exists (no AU accounts pack)**. Per-account default tax (`TaxType` / `TaxCodeRef`) has no slot. |
| **Opening balances** TrialBalance rows (`Account, Debit, Credit` as at date) · `Setup.ConversionBalances {AccountCode, Balance}` (Dr +, Cr −) → TrialBalance (`Account, Debit, Credit`) · `Account.CurrentBalance` | `POST /api/books/opening rows [{ code, dr_minor, cr_minor }]` → `journal_entry` period 0 `is_opening`, Suspense 2900 takes any difference | Amounts through `money.round` → minor units (never a local ×100). Their account → our `code` through the chart mapping above. The debtors / creditors control totals are NOT posted as one line — they come in bill-wise (next row) and must sum to the trial-balance figure; a mismatch shows in Suspense, which is the right place. Dates before the ledger's first day are refused (`books.js typedDate`), so the move date must be the ledger's `enabled_at` day. |
| **Contacts** `Contact.Name · FirstName/LastName · EmailAddress · Phones · Addresses · TaxNumber (ABN) · AccountNumber · ContactNumber · IsCustomer/IsSupplier · PaymentTerms.Sales/Bills.Day · DefaultCurrency · Balances.AccountsReceivable/Payable.Outstanding` → `Customer/Vendor.DisplayName · CompanyName · Given/FamilyName · PrimaryEmailAddr · PrimaryPhone · BillAddr · PrimaryTaxIdentifier / TaxIdentifier (masked) · AcctNum · SalesTermRef/TermRef · CurrencyRef · Balance` | `identities.display_name` (+ phone/email on the identity); `customer_list` / `supplier_list` + b274 `legal_name · party_no · credit_days · state_code`; `party_tax_id (scheme, value)` through `party-fields.cleanTaxIds`; the kit's party shape `{ name, gstin, state_code }` (`zoho.js ensureParty`, `tally.js partyLedgerXML`) | `IsCustomer` / `IsSupplier` decide the list (a party on both lists is ONE party, `party_no` shared). `PaymentTerms.Sales.Day` / QBO `Term.DueDays` (needs a `Term` lookup) → `credit_days`. `AccountNumber`/`AcctNum` → `party_no` only if the shop keeps their numbering — ours is assigned from the `P` series (`party-fields.ensureNo`); otherwise no slot. **No home: ABN** — `SCHEMES = GSTIN · PAN · TAN · TRN · VAT · TIN · CIN · UDYAM` in `api:lib/party-fields.js`; adding `ABN` (11 digits, mod-89 check) is an additive widening of that list plus a check in `profile-map`. QBO masks the id in the API: it can only come from the Excel export or be typed. The contact **balance** is never stored as a balance: it is the sum of the open documents (next row), which `party_item` reproduces and `receivables.outstanding` reads. Multi-currency balances: `party_item.currency` holds one currency per row; `receivables` refuses mixed sets — a foreign-currency debtor needs the home-currency figure. |
| **Open invoices / bills** `Invoice (ACCREC, AUTHORISED).InvoiceNumber · Date · DueDate · Contact · Total · AmountDue · CurrencyCode` → `Invoice.DocNumber · TxnDate · DueDate · CustomerRef · TotalAmt · Balance`; `Invoice (ACCPAY)` → `Bill.DocNumber · TxnDate · DueDate · VendorRef · TotalAmt · Balance` | `POST /api/books/opening rows [{ code: <debtors 1300 | creditors 2100>, party_no, bill_ref: InvoiceNumber/DocNumber, due_date: DueDate, dr_minor: AmountDue/Balance }]` (customer: debit; supplier: credit) → `party_item` rows `ref_kind bill`, `kind opening_balance`, `due_date`; `receivables.js` D2: "a debit need not be a sale: sale · credit_given · opening_balance" | Take **AmountDue / Balance** (what is still owed), never `Total` — the paid part is already inside the bank balance. The document date goes with the row only as `bill_ref`; `party_item.doc_date` exists but the opening route does not take it today (small widening). **No home:** the LINE ITEMS of old invoices (description, quantity, tax per line) — the ledger starts at the move date and refuses earlier postings; keep the exported file as the attachment of record. Partly-paid and credit-noted documents are one net figure. |
| **Items** `Item.Code · Name · Description · SalesDetails.UnitPrice · SalesDetails.TaxType · PurchaseDetails.UnitPrice · PurchaseDetails.TaxType · QuantityOnHand · IsTrackedAsInventory · TotalCostPool` → `Item.Sku · Name · Description · UnitPrice · SalesTaxCodeRef · PurchaseCost · PurchaseTaxCodeRef · QtyOnHand · Type · TrackQtyOnHand` | the adapter product shape `{ name, code, unit, price, hsn, category, gst_rate, ref }` (`csv.js readProducts`) → `syncProducts` → `item_data`; `readStock { code, qty, at }` → `syncStock` (stamped); `item_data.cost` (`api:lib/item-cost.js` — "the one place an item's rough cost is read and written") | `Code`/`Sku` → `code` (the identity — keep theirs); `UnitPrice` → `price`; `PurchaseCost` / `PurchaseDetails.UnitPrice` → `item_data.cost`; `QtyOnHand` → stock with `at` = the move date. **Neither product has a unit of measure** → `unit` defaults (`'unit'` in csv.js, `'nos'` in zoho.js) and `unit_source` stays empty. **Tax:** our product carries `gst_rate` (a percentage, `api:lib/column-rules.js`); theirs carries a tax CODE (`OUTPUT`, `GST`) — resolve through `GET /TaxRates` / `select * from TaxRate` to a rate the way `zoho.js taxIdFor` does the reverse. `Type Service` / `IsTrackedAsInventory=false` → no stock row. `TotalCostPool` (Xero's average-cost pool) has no slot beyond `cost`; `api:lib/inventory.js` recomputes weighted average from movements. Category (QBO `ParentRef` category) → `category_name`. |
| **Tax rates** `TaxRate.Name · TaxType · ReportTaxType · TaxComponents[].Rate · Status` → `TaxCode.Name · Taxable · SalesTaxRateList/PurchaseTaxRateList → TaxRate.RateValue` | `api:lib/tax-packs.js PACKS` — a country entry `{ country, scheme, supply, rates, invoice_round_to, source }` | **No home today:** there is no `AU` pack (`PACKS` has `IN` only). AU is a `border` scheme (one head, 10 %), rates `[0, 10]`; a data-only addition with its test, per the file's own rule. **Still no slot even then:** the BAS reporting category (`BAS Excluded` vs `GST Free` vs `Input Taxed` are all 0 % but report differently; Xero's `ReportTaxType`, QBO's code name) — a new key on the tax slab, with its dictionary entry, is needed before BAS can be prepared from our ledger. Per-contact default tax (`AccountsReceivableTaxType`, `DefaultTaxCodeRef`) and per-item tax code: no slot. |
| **Tracking / classes** Xero `Tracking` categories; QBO `ClassRef` · `DepartmentRef` | — | No home. Not needed for the move; note it in the exported file's attachment. |
| **Bank accounts** `Account Type=BANK + BankAccountNumber` → `Account AccountType=Bank` | `profile-map` `bank_account` (one), `accounts-packs` group `bank_accounts` (1500–1599) | Several bank accounts become several ledgers under the group; the opening balance per bank account is a trial-balance row like any other. |

**What has no home in ChitBridge yet (the list IM1 must take to Athi before building):**
1. **ABN** as a party / organisation tax id (`party-fields SCHEMES`, `profile-map FIELDS`).
2. **An AU tax pack** (`tax-packs PACKS.AU`) and, separately, a **BAS reporting category** on a slab (new key, dictionary entry).
3. **An AU accounts pack** (`accounts-packs PACKS.AU`: July year start, Xero/QBO account types → groups) and the **mapping table from their account types to our groups**.
4. **Their account code** on our ledger account (`ledger_account` has no `source_ref`); today it can only be a mapping key held in the importer.
5. **Per-account, per-contact and per-item default tax codes.**
6. **Old invoice line items** — out of scope of the ledger by design (opening balances are bill-wise net figures); the file is the record.
7. **Foreign-currency open items and balances** — one currency per shop in the ledger; a home-currency figure is required.
8. **Tracking categories / classes / departments.**

**One calculation, one shape (CLAUDE.md rules 2–3).** Nothing above computes money: amounts pass through `money.round` into
`dr_minor`/`cr_minor`; tax on an opening document is NOT recomputed (`tax-lines.invoiceFor` is for live bills) — the
exported `AmountDue` is the figure; a product's `gst_rate` is read from their rate table, not inferred from a name. The
slots filled are the ones that exist: `item_data`, `party_tax_id`, the opening rows, `profile-map FIELDS`.
