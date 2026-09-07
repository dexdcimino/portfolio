/* The dictionary lives here, off the main thread.
 *
 * Parsing 81,000 Hunspell entries takes a second or two, and Typo's suggest()
 * for a long word can take a hundred milliseconds: neither belongs on the
 * thread that is drawing the caret. Messages: { id, op: 'check', words } ->
 * { id, result: [bool] }; { id, op: 'suggest', word } -> { id, result: [] }.
 */

/* global Typo, importScripts */
importScripts('/notes/vendor/typo.js');

let typo = null;
const ready = Promise.all([
  fetch('/notes/vendor/en_US.aff').then((r) => r.text()),
  fetch('/notes/vendor/en_US.dic').then((r) => r.text()),
]).then(([aff, dic]) => {
  typo = new Typo('en_US', aff, dic);
  postMessage({ ready: true });
}).catch((err) => {
  postMessage({ ready: false, error: String(err && err.message || err) });
});

function ok(word) {
  if (!typo) return true;
  if (typo.check(word)) return true;
  const lower = word.toLowerCase();
  if (lower !== word && typo.check(lower)) return true;
  // "URL" and "OK" style words: all caps of a known word are fine.
  if (word === word.toUpperCase() && typo.check(word[0] + lower.slice(1))) return true;
  return false;
}

onmessage = async (e) => {
  const { id, op } = e.data;
  await ready;
  if (op === 'check') {
    postMessage({ id, result: e.data.words.map(ok) });
  } else if (op === 'suggest') {
    let out = [];
    try { out = typo ? typo.suggest(e.data.word, e.data.limit || 6) : []; } catch { out = []; }
    postMessage({ id, result: out });
  }
};
