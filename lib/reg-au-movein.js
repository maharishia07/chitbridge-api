/* ADOPTED from chitbridge-engines v1.98.0 · reg-au-movein · sha256 d7e729a109ab07919f92f8391ed9d6bcf3b9450b51991d911917e5198e2832ae — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-au-movein. Edited ONLY in chitbridge-engines/src/reg-au-movein.js; every platform adopts a released version of it. */
/*
 * OWNS      Australia's move-in map for the regulation pack: where a Xero or QuickBooks Online account type lands in the chart (a group key), which of their system accounts is one of our role ledgers, and which of their tax codes is which GST supply kind. DATA and three small readers (groupFor, roleFor, supplyKindFor); guesses nothing.
 * CALLED BY reg-au.js (pack.moveIn: read by the api's move-in importer, lib/move-in). Moved out of reg-au.js with the one change that the GST supply kinds are handed in. (v1.98.0 file-size ceiling)
 * FLOW      reg-au.js requires this file ──▶ moveIn(TAX_AU.supplyKinds) ──▶ pack.moveIn
 * CARD      15-tax-and-country-packs/country-packs-jurisdiction
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note Australia's Xero / QBO move-in map, moved out of reg-au.js with no change of data.
  /**
   * ⭐ MOVE IN FROM XERO / QUICKBOOKS ONLINE (IM1, v1.38.0) — THE MAPPING TABLE, IN ONE PLACE, AS DATA. An Australian practice exports a client's
   * books and ChitBridge takes them in; this is where THEIR account type lands in OUR chart (a group key of GROUPS_AU), which of their system accounts
   * IS one of our role ledgers (debtors · creditors · the GST account), and which of their tax codes is which of our three supply kinds (TAX_AU.supplyKinds).
   * Sources: the Xero Accounting OpenAPI `Account.Type` / `SystemAccount` enums and the AU default tax types (developer.xero.com › Types and Codes); the
   * QBO `Account.AccountType` list (developer.intuit.com › AccountList report) and the AU GST codes (Simpler GST and the detailed list) — research record
   * chitbridge-web docs/research/XERO-QBO-EXPORTS-2026-10.md (IM0). The importer (api lib/move-in) reads this and guesses nothing of its own.
   *   groupFor(source, type)         → the group key, or null (a type with no home here — the row is SKIPPED and said, never guessed)
   *   roleFor(source, systemOrType)  → the role ledger their control account IS (Xero SystemAccount DEBTORS → 'debtors'; QBO type AccountsReceivable → 'debtors'), or null
   *   supplyKindFor(source, code)    → the supply-kind row (taxable · gst_free · input_taxed), null when the code means "no GST applies and nothing is reported"
   *                                    (BAS Excluded · Out of Scope · GST on Imports: not a supply kind — the line carries no tax and the importer says so), or
   *                                    undefined when the code is not one this table knows (the person picks)
   * ⚠️ A QBO Simpler-GST file carries `GST` · `GST free` · `Out of Scope` only; the detailed list is here too so an older file reads. Names are matched
   *    case- and space-insensitively; Xero's TaxType CODES (OUTPUT, INPUT …) and its display NAMES (GST on Income …) both resolve.
   */
  const MOVE_IN_XERO = {
    accountTypes: {
      BANK: 'bank_accounts',
      CURRENT: 'current_assets',
      CURRLIAB: 'current_liabilities',
      DEPRECIATN: 'non_current_assets',
      DIRECTCOSTS: 'cost_of_sales',
      EQUITY: 'equity',
      EXPENSE: 'operating_expenses',
      FIXED: 'non_current_assets',
      INVENTORY: 'inventory',
      LIABILITY: 'current_liabilities',
      NONCURRENT: 'non_current_assets',
      OTHERINCOME: 'other_income',
      OVERHEADS: 'operating_expenses',
      PREPAYMENT: 'advances',
      REVENUE: 'sales',
      SALES: 'sales',
      TERMLIAB: 'non_current_liabilities',
      PAYG: 'gst_and_statutory'
    },
    /* Xero SystemAccount → the role ledger it IS. GST: Xero keeps ONE net GST account; its balance lands on GST collected (BAS 1A) and the importer says so. */
    systemAccounts: {
      DEBTORS: 'debtors',
      CREDITORS: 'creditors',
      GST: 'gst_collected',
      RETAINEDEARNINGS: 'retained',
      ROUNDING: 'round_off',
      WAGEPAYABLES: 'wages_payable'
    },
    /* TaxType code or display name → supply kind id; null = no GST and not reported (not a supply kind) */
    taxCodes: {
      OUTPUT: 'taxable',
      INPUT: 'taxable',
      'GST ON INCOME': 'taxable',
      'GST ON EXPENSES': 'taxable',
      'GST ON CAPITAL': 'taxable',
      CAPEXINPUT: 'taxable',
      EXEMPTOUTPUT: 'gst_free',
      EXEMPTEXPENSES: 'gst_free',
      EXEMPTCAPITAL: 'gst_free',
      EXEMPTEXPORT: 'gst_free',
      'GST FREE INCOME': 'gst_free',
      'GST FREE EXPENSES': 'gst_free',
      'GST FREE CAPITAL': 'gst_free',
      'GST FREE EXPORTS': 'gst_free',
      INPUTTAXED: 'input_taxed',
      'INPUT TAXED': 'input_taxed',
      BASEXCLUDED: null,
      'BAS EXCLUDED': null,
      GSTONIMPORTS: null,
      'GST ON IMPORTS': null
    },
    cite: 'developer.xero.com › Types and Codes (Account types, System accounts, AU tax types); XeroAPI OpenAPI Account.Type / SystemAccount'
  };
  const MOVE_IN_QBO = {
    accountTypes: {
      BANK: 'bank_accounts',
      ACCOUNTSRECEIVABLE: 'trade_debtors',
      OTHERCURRENTASSET: 'current_assets',
      FIXEDASSET: 'non_current_assets',
      OTHERASSET: 'non_current_assets',
      ACCOUNTSPAYABLE: 'trade_creditors',
      CREDITCARD: 'current_liabilities',
      OTHERCURRENTLIABILITY: 'current_liabilities',
      LONGTERMLIABILITY: 'non_current_liabilities',
      EQUITY: 'equity',
      INCOME: 'sales',
      OTHERINCOME: 'other_income',
      COSTOFGOODSSOLD: 'cost_of_sales',
      EXPENSE: 'operating_expenses',
      OTHEREXPENSE: 'operating_expenses'
      /* the Account List report writes the type with spaces ("Accounts receivable (A/R)", "Other Current Assets"): normalised to the keys above by typeKey_ */
    },
    /* a QBO TYPE that IS one of our role ledgers (QBO has no SystemAccount flag; the type says it) */
    systemAccounts: { ACCOUNTSRECEIVABLE: 'debtors', ACCOUNTSPAYABLE: 'creditors' },
    taxCodes: {
      GST: 'taxable',
      'GST ON CAPITAL': 'taxable',
      'GST ON NON-CAPITAL': 'taxable',
      'GST ON NONCAPITAL': 'taxable',
      'GST FREE': 'gst_free',
      'GST-FREE': 'gst_free',
      'GST FREE EXPORT': 'gst_free',
      'GST-FREE CAPITAL': 'gst_free',
      'GST FREE CAPITAL': 'gst_free',
      'GST-FREE NON-CAPITAL': 'gst_free',
      'GST FREE NON-CAPITAL': 'gst_free',
      'INPUT TAX': 'input_taxed',
      'INPUT TAXED': 'input_taxed',
      'OUT OF SCOPE': null
    },
    cite: 'developer.intuit.com › AccountList report account_type values; Intuit AU "Setting up GST" (detailed codes) and "Simpler GST" (GST · GST Free · Out of Scope)'
  };
  const MOVE_IN_SOURCES = { xero: MOVE_IN_XERO, qbo: MOVE_IN_QBO };
  /** "Accounts receivable (A/R)" · "Other Current Liability" · "ACCPAY" → one key: letters and digits only, upper case, the bracketed part dropped */
  function typeKey_(s) {
    return String(s == null ? '' : s)
      .replace(/\([^)]*\)/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '');
  }
  /** the QBO Account List report writes the PLURAL ("Other Current Assets", "Fixed Assets", "Expenses", "Other Current Liabilities"); the API enum is singular — one key for both (v1.38.1) */
  function singular_(text) {
    return text.replace(/IES$/, 'Y').replace(/S$/, '');
  }
  function lookup_(table, k) {
    if (Object.prototype.hasOwnProperty.call(table, k)) return table[k];
    var s = singular_(k);
    return s !== k && Object.prototype.hasOwnProperty.call(table, s) ? table[s] : null;
  }
  function codeKey_(s) {
    return String(s == null ? '' : s)
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
  function sourceOf_(source) {
    var k = String(source == null ? '' : source)
      .trim()
      .toLowerCase();
    return Object.prototype.hasOwnProperty.call(MOVE_IN_SOURCES, k) ? MOVE_IN_SOURCES[k] : null;
  }
  function groupFor(source, type) {
    var s = sourceOf_(source);
    return s ? lookup_(s.accountTypes, typeKey_(type)) : null;
  }
  function roleFor(source, sys) {
    var s = sourceOf_(source);
    return s ? lookup_(s.systemAccounts, typeKey_(sys)) : null;
  }
  function supplyKindFor(source, code, supplyKinds) {
    var s = sourceOf_(source);
    if (!s) return undefined;
    var text = codeKey_(code),
      k2 = text.replace(/-/g, ' ');
    var t = s.taxCodes;
    var id = Object.prototype.hasOwnProperty.call(t, text) ? t[text] : Object.prototype.hasOwnProperty.call(t, k2) ? t[k2] : undefined;
    if (id === undefined) return undefined;
    return id === null ? null : supplyKinds[id];
  }
  /** the move-in map as the pack carries it (`moveIn`): the tables and readers, with the GST supply kinds (TAX_AU.supplyKinds) the tax codes resolve to */
  function moveIn(supplyKinds) {
    return {
    sources: Object.keys(MOVE_IN_SOURCES),
    xero: MOVE_IN_XERO,
    qbo: MOVE_IN_QBO,
    groupFor: groupFor,
    roleFor: roleFor,
    supplyKindFor: function (source, code) {
      return supplyKindFor(source, code, supplyKinds);
    },
    cite: 'chitbridge-web docs/research/XERO-QBO-EXPORTS-2026-10.md (IM0, official sources only)'
    };
  }


  var EXPORTS = { moveIn: moveIn };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBRegAUMoveIn (loaded before the pack that reads it). */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBRegAUMoveIn = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
