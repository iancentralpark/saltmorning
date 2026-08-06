'use strict';
/** Lucky Draw is Mr. Park-only; Morning Class never grants tickets. */
async function rollLuckyPrize() {
  return { tier: null, prizeText: null };
}
async function saveLuckyDrawTicket() {
  return null;
}
async function grantVocabMasteryTicket() {
  return null;
}
module.exports = { rollLuckyPrize, saveLuckyDrawTicket, grantVocabMasteryTicket };
