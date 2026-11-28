'use strict';
/**
 * @stage tested
 * lib/home-facts-network.js — the Home card `network`: the requests to connect that wait for the OWNER's answer
 * OWNER     cb-network
 * RISK      plain
 * OWNS      network(ctx) → { lines, figures, state } for GET /api/facts/network
 * CALLED BY lib/home-facts.js (CARDS)
 * FLOW      owner seat → lib/connect-asks asksOf (the one reader the bell and GET /api/network/asks read too) → one line, tone dn while a request waits
 * CARD      26-reporting-mis-and-bi/home-facts
 */
const { plural } = require('./home-facts-sold');

/**
 * the Network card (Do first): the requests to connect that wait for the OWNER's answer, from lib/connect-asks (the one reader the bell and GET /api/network/asks read too).
 * Firms only (28 Nov ruling). A staff seat and a key read 0: the answer is the owner's alone. A request is a need until it is answered, so a waiting one is tone 'dn' (state needs_you).
 */
async function network(ctx) {
  const { isOwner } = require('./owner');
  const mine = ctx.req ? isOwner(ctx.req) : true;
  const { to_me: toMe, by_me: byMe } = mine ? await require('./connect-asks').asksOf(ctx.entity) : { to_me: [], by_me: [] };
  if (!toMe.length && !byMe.length) return { lines: [{ text: 'No requests to connect', value: 0 }], figures: { requests: 0, waiting: 0 }, state: 'not_started' };
  const lines = toMe.length ? [{ text: plural(toMe.length, 'request') + ' to connect', value: toMe.length, tone: 'dn' }] : [{ text: 'Waiting for ' + plural(byMe.length, 'answer'), value: byMe.length }];
  return { lines, figures: { requests: toMe.length, waiting: byMe.length } };
}
module.exports = { network };
