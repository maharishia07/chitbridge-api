/* ADOPTED from chitbridge-engines v1.99.0 · reg-in-bank · sha256 c388d77f0d28f176c01d42168aca2678213e32d6770873e61b61b0bd91f7f8f8 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-in-bank. Edited ONLY in chitbridge-engines/src/reg-in-bank.js; every platform adopts a released version of it. */
/*
 * OWNS      India's bank-statement data for the regulation pack: the amount prefixes, the minor unit, the header cells each bank prints (presets, verify:true until checked against a real file) and the whole words a narration uses. DATA only; no code path.
 * CALLED BY reg-in.js (pack.bank: read by bank-recon.js parse, match and suggest). Moved out of reg-in.js unchanged (v1.98.0 file-size ceiling).
 * FLOW      reg-in.js requires this file ──▶ BANK ──▶ pack.bank
 * CARD      15-tax-and-country-packs/country-packs-jurisdiction
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note India's bank presets and keywords, moved out of reg-in.js with no change of data.
  /* ⭐ BANK STATEMENTS (b7) — India's banks: the header cells each prints (PRESETS, verify:true until checked against a real file) and the whole words a narration uses (RULES), moved verbatim from bank-recon. */
  const BANK_PRESETS = {
    sbi: {
      bank: 'State Bank of India',
      verify: true,
      note: 'Txn Date · Value Date · Description · Ref No./Cheque No. · Debit · Credit · Balance',
      map: {
        date: ['Txn Date'],
        value_date: ['Value Date'],
        narration: ['Description'],
        ref: ['Ref No./Cheque No.', 'Ref No'],
        debit: ['Debit'],
        credit: ['Credit'],
        balance: ['Balance']
      }
    },
    hdfc: {
      bank: 'HDFC Bank',
      verify: true,
      note: 'Date · Narration · Chq./Ref.No. · Value Dt · Withdrawal Amt. · Deposit Amt. · Closing Balance',
      map: {
        date: ['Date'],
        narration: ['Narration'],
        ref: ['Chq./Ref.No.', 'Chq/Ref No'],
        value_date: ['Value Dt'],
        debit: ['Withdrawal Amt.'],
        credit: ['Deposit Amt.'],
        balance: ['Closing Balance']
      }
    },
    icici: {
      bank: 'ICICI Bank',
      verify: true,
      note: 'S No. · Value Date · Transaction Date · Cheque Number · Transaction Remarks · Withdrawal Amount (INR ) · Deposit Amount (INR ) · Balance (INR )',
      map: {
        date: ['Transaction Date'],
        value_date: ['Value Date'],
        cheque_no: ['Cheque Number'],
        narration: ['Transaction Remarks'],
        debit: ['Withdrawal Amount (INR )'],
        credit: ['Deposit Amount (INR )'],
        balance: ['Balance (INR )']
      }
    },
    axis: {
      bank: 'Axis Bank',
      verify: true,
      note: 'SRL NO · Tran Date · CHQNO · PARTICULARS · DR · CR · BAL · SOL',
      map: { date: ['Tran Date'], cheque_no: ['CHQNO'], narration: ['PARTICULARS'], debit: ['DR'], credit: ['CR'], balance: ['BAL'] }
    },
    kotak: {
      bank: 'Kotak Mahindra Bank',
      verify: true,
      note: 'Sl. No. · Transaction Date · Value Date · Description · Chq / Ref No. · Debit · Credit · Dr / Cr · Balance (balance carries a Dr / Cr marker)',
      map: {
        date: ['Transaction Date'],
        value_date: ['Value Date'],
        narration: ['Description'],
        ref: ['Chq / Ref No.', 'Chq/Ref No'],
        debit: ['Debit'],
        credit: ['Credit'],
        balance: ['Balance']
      }
    }
  };
  const BANK_KEYWORDS = {
    default: {
      charges: [
        'CHRG',
        'CHRGS',
        'CHARGES',
        'CHARGE',
        'CHG',
        'CHGS',
        'SMS CHG',
        'GST ON CHG',
        'GST ON CHARGES',
        'SERVICE CHARGE',
        'AMC',
        'ANNUAL FEE',
        'DEBIT CARD FEE',
        'MIN BAL',
        'MAINTENANCE CHARGES'
      ],
      interest: ['INT', 'INTEREST', 'INTEREST CR', 'INT CR', 'INT.PD', 'INT PD', 'CREDIT INTEREST', 'SB INT', 'INT PAID'],
      atm: ['ATM', 'ATM WDL', 'CASH WDL', 'CASH WITHDRAWAL', 'NFS', 'ATM CASH', 'SELF WITHDRAWAL'],
      cash_deposit: ['CASH DEPOSIT', 'CASH DEP', 'CDM', 'BY CASH'],
      cheque_return: ['RTN', 'RETURN', 'RETURNED', 'CHQ RET', 'CHQ RTN', 'CHEQUE RETURN', 'INWARD RETURN', 'I/W RETURN', 'BOUNCE', 'DISHONOUR', 'DISHONOURED'],
      transfer: ['UPI', 'NEFT', 'IMPS', 'RTGS']
    },
    sbi: { charges: ['SMS ALERT CHARGES', 'ATM AMC'], interest: ['CREDIT INTEREST'] },
    hdfc: { charges: ['CHQ BOOK ISSUE', 'FUNDS TRANSFER CHARGES'], interest: ['INT.PD'] },
    icici: { charges: ['GST-', 'SMS CHARGES'], interest: ['INT.PD'] },
    axis: { charges: ['SERVICE CHRG'], interest: ['INT.PD'] },
    kotak: { charges: ['CHG'], interest: ['INTEREST CREDITED'] }
  };
  const BANK = { amountPrefixes: ['₹', 'rs.', 'rs', 'inr'], minorUnit: 'paise', presets: BANK_PRESETS, keywords: BANK_KEYWORDS };

  var EXPORTS = BANK;
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBRegINBank (loaded before the pack that reads it). */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBRegINBank = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
