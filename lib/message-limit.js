'use strict';
// OWNS      how long ONE message may be (RAIL-106 part 3, the gorilla test's 100,000-character message) and the refusal in words when it is longer
// CALLED BY routes/chits.js (postMessageCopies, the one writer of every message copy; the three routes that answer its refusal) · lib/ctpreturn.js (an arrived event is held to the same limit)
// FLOW      text → tooLong(text) → null | an Error { code: MESSAGE_TOO_LONG, status: 413, refused } → the route answers 413 with the words
//           CARD 01-rail-core-the-chit/chits-routes
/**
 * One limit, one place, the same on one installation or many. It is checked where every message copy is written (postMessageCopies) so no door can skip it, and an event that arrives
 * from another installation is held to the same number. 10,000 characters is several pages of ordinary writing; a longer text is a document and belongs in an attachment (6 MB).
 */
const MESSAGE_MAX_CHARS = 10000;

/** null when the text fits, else the refusal to throw (a person can read its message) */
function tooLong(text) {
  const length = String(text == null ? '' : text).length;
  if (length <= MESSAGE_MAX_CHARS) return null;
  return Object.assign(
    new Error('That message is ' + length.toLocaleString('en') + ' characters; the most one message can hold is ' + MESSAGE_MAX_CHARS.toLocaleString('en') + '. Shorten it, or attach it as a file. Nothing was sent.'),
    { code: 'MESSAGE_TOO_LONG', status: 413, refused: true, limit: MESSAGE_MAX_CHARS, length }
  );
}

module.exports = { MESSAGE_MAX_CHARS, tooLong };
