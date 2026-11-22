/**
 * lib/books-moved-role.js — F-66 (batch 1126): a country pack MOVED a ledger to a new code (wages 5100 → 6015, engines v1.102.0) and a shop's chart still holds the OLD
 * code under the role. The role is unique per shop (ledger_account_role_uq), so the old ledger gives its role up — it keeps its code, name and every posted row (insert-only
 * books; the engine reads its code as the pack's `retired` row, an operating expense on the same statement line) — and the pack's new code takes the role on first use.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      free (hand the role of every pack-retired ledger back, one statement) · holderOf (the ledger a line's role names, unless that is a retired code)
 * CALLED BY lib/books.js (seedChart · ledgerOnFirstUse · composeLines)
 * FLOW      a pack lists a retired code ──▶ the shop's ledger on it gives up its role (one statement, a change-log line each) ──▶ the pack's new code takes the role on first use
 * CARD      16-finance/books-posting
 */
'use strict';

/** the codes the pack has retired (never seeded, never free for a shop ledger) */
const retiredCodes = (pack) => ((pack && pack.retired) || []).map((item) => String(item.code));

/** the ledger a line's ROLE names — unless the shop holds that role on a code the pack has RETIRED: then null, so the line lands on the pack's new code (added on first use) */
function holderOf(pack, chartIndex, line) {
  const held = line.account ? chartIndex.byRole.get(line.account) : null;
  if (!held || !line.code || String(held.code) === String(line.code)) return held || null;
  return retiredCodes(pack).includes(String(held.code)) ? null : held;
}

/** one statement: every ledger of this shop on a retired code gives up its role (a change-log line each) → how many; nothing to do when the pack retired nothing */
async function free(handle, entity, pack) {
  const codes = retiredCodes(pack);
  if (!codes.length) return 0;
  const S = require('./books-store'), freed = await S.freeRetiredRoles(handle, entity, codes);
  for (const row of freed) await S.logChange(handle, entity, { by: null, table_name: 'ledger_account', row_id: row.account_id, field: 'role', old: row.role, new: '(handed to the pack\'s new code for ' + row.code + ')' });
  return freed.length;
}

module.exports = { holderOf, free, retiredCodes };
