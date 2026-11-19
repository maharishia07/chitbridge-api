'use strict';
// @stage tested
// @stage-note A pure EMVCo QR payload encoder, tested (tests/emvco-qr.test.js); no route calls it yet.
/**
 * emvco-qr.js — the EMVCo merchant-presented QR payload (TLV + CRC16) as a pure string encoder.
 * OWNS      the payload string only: data-object encoding, the CRC, the top-level parse. Nothing else.
 * OWNER     payments (jurisdiction pay schemes)
 * CALLED BY nothing yet. Next step is the PAY_SCHEMES 'emvco' row in lib/jurisdiction.js (encodes: 'emvco-mpm'); the national profiles (PIX, PayNow, ...) differ only in the
 *           merchant-account template (tags 26-51) they put in `accounts`. tests/emvco-qr.test.js
 * FLOW      encode({ accounts, mcc, currency, country, name, city }) ──▶ checkMerchant ──▶ encodeDataObject per tag ──▶ '6304' + crc16 hex ──▶ payload string
 *           parse(payload) ──▶ { tags, crcOk }
 * RISK      a wrong length or CRC makes every bank app refuse the QR; bad input is refused (throws), never encoded half-right.
 * CARD      28-platform-and-operations/emvco-qr
 * Spec: EMV QR Code Specification for Payment Systems, Merchant-Presented Mode, v1.1. Every data object is ID(2) + LENGTH(2 digits) + VALUE. Tag 63 is last: CRC-16/CCITT-FALSE over everything before its value.
 */

const MAX_VALUE_LENGTH = 99;
const ACCOUNT_TAG_FIRST = 26;
const ACCOUNT_TAG_LAST = 51;

/** one data object: ID(2) + LENGTH(2 digits) + VALUE; a value over 99 characters is refused */
function encodeDataObject(id, value) {
  const text = String(value);
  if (text.length > MAX_VALUE_LENGTH) throw new Error('emvco: value too long for tag ' + id);
  return id + (text.length < 10 ? '0' : '') + text.length + text;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the characters of `text` */
function crc16(text) {
  let checksum = 0xFFFF;
  for (let i = 0; i < text.length; i++) {
    checksum ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum & 0x8000) ? ((checksum << 1) ^ 0x1021) & 0xFFFF : (checksum << 1) & 0xFFFF;
  }
  return checksum;
}

/** the CRC as four upper-case hex digits */
function hex4(number) { return ('0000' + number.toString(16).toUpperCase()).slice(-4); }

/** the merchant-account tags (26-51) present in `accounts`, sorted; throws when there is none */
function accountTags(accounts) {
  const tags = Object.keys(accounts).filter((key) => +key >= ACCOUNT_TAG_FIRST && +key <= ACCOUNT_TAG_LAST).sort();
  if (!tags.length) throw new Error('emvco: a merchant account (tag 26-51) is required');
  return tags;
}

/** the amount, when present, is a decimal string such as 140.00 (the caller formats money with the money engine) */
function checkAmount(amount) {
  if (amount != null && !/^\d{1,10}(\.\d{1,3})?$/.test(String(amount))) throw new Error('emvco: amount must be a decimal string such as 140.00');
}

/** refuses a payload input the spec does not allow (mcc, currency, country, name, city, amount) */
function checkMerchant(input) {
  if (!/^\d{4}$/.test(String(input.mcc || ''))) throw new Error('emvco: mcc must be 4 digits');
  if (!/^\d{3}$/.test(String(input.currency || ''))) throw new Error('emvco: currency must be the 3-digit ISO 4217 number');
  if (!/^[A-Z]{2}$/.test(String(input.country || ''))) throw new Error('emvco: country must be ISO 3166 alpha-2');
  checkAmount(input.amount);
  if (!input.name || !input.city) throw new Error('emvco: merchant name and city are required');
}

/**
 * encode({ accounts: {'26': 'inner TLV string', ...}, mcc, currency (ISO 4217 numeric), amount? (a decimal STRING such as '140.00' formatted by the money engine: this file does no money arithmetic), country (ISO 3166 alpha-2), name, city, dynamic? }) → payload string.
 * Mandatory per the spec: 00 format, 01 method, a merchant account (26-51), 52, 53, 58, 59, 60, 63.
 */
function encode(input) {
  const merchant = input || {};
  const accounts = merchant.accounts || {};
  const tags = accountTags(accounts);
  checkMerchant(merchant);
  let payload = encodeDataObject('00', '01') + encodeDataObject('01', merchant.dynamic ? '12' : '11');
  tags.forEach((tag) => { payload += encodeDataObject(tag, accounts[tag]); });
  payload += encodeDataObject('52', merchant.mcc) + encodeDataObject('53', merchant.currency);
  if (merchant.amount != null) payload += encodeDataObject('54', merchant.amount);
  payload += encodeDataObject('58', merchant.country) + encodeDataObject('59', String(merchant.name).slice(0, 25)) + encodeDataObject('60', String(merchant.city).slice(0, 15));
  payload += '6304';
  return payload + hex4(crc16(payload));
}

/** parse(payload) → { tags, crcOk } for the top level; used by tests and by any scanner-side check. */
function parse(payload) {
  const tags = {};
  let position = 0;
  while (position < payload.length) {
    const id = payload.substr(position, 2);
    const length = +payload.substr(position + 2, 2);
    tags[id] = payload.substr(position + 4, length);
    position += 4 + length;
  }
  return { tags, crcOk: hex4(crc16(payload.slice(0, -4))) === payload.slice(-4) };
}

module.exports = { encode, parse, crc16 };
