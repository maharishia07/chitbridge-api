'use strict';
/**
 * OWNS: the EMVCo merchant-presented QR payload (TLV + CRC16) as a pure string encoder. Nothing else.
 * CALLED BY: nothing yet. Next step is the PAY_SCHEMES 'emvco' row in lib/jurisdiction.js (encodes: 'emvco-mpm'); the national profiles (PIX, PayNow, ...) differ only in the
 *   merchant-account template (tags 26-51) they put in `accounts`.
 * Spec: EMV QR Code Specification for Payment Systems, Merchant-Presented Mode, v1.1. Every data object is ID(2) + LENGTH(2 digits) + VALUE. Tag 63 is last: CRC-16/CCITT-FALSE over everything before its value.
 */
function tlv(id, value) {
  var v = String(value);
  if (v.length > 99) throw new Error('emvco: value too long for tag ' + id);
  return id + (v.length < 10 ? '0' : '') + v.length + v;
}
function crc16(s) {
  var crc = 0xFFFF;
  for (var i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (var b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}
function hex4(n) { return ('0000' + n.toString(16).toUpperCase()).slice(-4); }
/**
 * encode({ accounts: {'26': 'inner TLV string', ...}, mcc, currency (ISO 4217 numeric), amount?, country (ISO 3166 alpha-2), name, city, dynamic? }) → payload string.
 * Mandatory per the spec: 00 format, 01 method, a merchant account (26-51), 52, 53, 58, 59, 60, 63.
 */
function encode(o) {
  o = o || {};
  var acc = o.accounts || {}, ids = Object.keys(acc).filter(function (k) { return +k >= 26 && +k <= 51; }).sort();
  if (!ids.length) throw new Error('emvco: a merchant account (tag 26-51) is required');
  if (!/^\d{4}$/.test(String(o.mcc || ''))) throw new Error('emvco: mcc must be 4 digits');
  if (!/^\d{3}$/.test(String(o.currency || ''))) throw new Error('emvco: currency must be the 3-digit ISO 4217 number');
  if (!/^[A-Z]{2}$/.test(String(o.country || ''))) throw new Error('emvco: country must be ISO 3166 alpha-2');
  if (!o.name || !o.city) throw new Error('emvco: merchant name and city are required');
  var s = tlv('00', '01') + tlv('01', o.dynamic ? '12' : '11');
  ids.forEach(function (k) { s += tlv(k, acc[k]); });
  s += tlv('52', o.mcc) + tlv('53', o.currency);
  if (o.amount != null) s += tlv('54', Number(o.amount).toFixed(2));
  s += tlv('58', o.country) + tlv('59', String(o.name).slice(0, 25)) + tlv('60', String(o.city).slice(0, 15));
  s += '6304';
  return s + hex4(crc16(s));
}
/** parse(payload) → { tags, crcOk } for the top level; used by tests and by any scanner-side check. */
function parse(p) {
  var tags = {}, i = 0;
  while (i < p.length) { var id = p.substr(i, 2), n = +p.substr(i + 2, 2); tags[id] = p.substr(i + 4, n); i += 4 + n; }
  return { tags: tags, crcOk: hex4(crc16(p.slice(0, -4))) === p.slice(-4) };
}
module.exports = { encode: encode, parse: parse, crc16: crc16 };
