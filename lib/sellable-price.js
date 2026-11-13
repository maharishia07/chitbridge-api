'use strict';
/**
 * lib/sellable-price.js — WHEN A STORED PRICE CANNOT BE SOLD (CAT-318 rule, CAT-324 second door). One rule, read by every door that carries an item's price onward.
 *
 * OWNS      fault(price) → 'unset' | 'negative' | null · unsetSaid(name) · negativeSaid(name) · soldAt(price) (the price, or null when it cannot be sold)
 * CALLED BY routes/catalogue.js throwIfUnpriced (an order line is refused in words) · routes/till.js tillItem (the counter is told "no price", never a negative one)
 * FLOW      stored item_data.price → money.priceOf → fault() → refused with a sentence (order) or sent as null (snapshot, so the till's existing unpriced path holds it back)
 * CARD      07-offers-pricing-and-combos/till-price-and-worth-an-offer
 * ⚠️ Zero IS a price (a free sample). A negative price is never clamped to 0: the counter would bill a real product for nothing, or pay the customer.
 */

/** 'unset' for a missing or unreadable price, 'negative' below zero, else null (sellable) */
function fault(price) {
  if (!Number.isFinite(price)) return 'unset';
  return price < 0 ? 'negative' : null;
}

/** the shopkeeper sentence for a price that is not set */
const unsetSaid = (name) => `Price for "${name}" is not set — order cannot be placed`;
/** the shopkeeper sentence for a stored negative price */
const negativeSaid = (name) => `The price of "${name}" is not valid, so it cannot be ordered right now — the shop needs to correct it.`;

/** the price itself, or null when it cannot be sold (null already means "no price" at the counter) */
const soldAt = (price) => (fault(price) ? null : price);

module.exports = { fault, unsetSaid, negativeSaid, soldAt };
