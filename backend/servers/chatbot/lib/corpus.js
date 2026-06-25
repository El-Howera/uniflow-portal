/**
 * Corpus singleton — the BM25 index built once at boot from
 * backend/corpus/*.jsonl. Routes read it via `getIndex()`; the bootstrap
 * in `index.js` populates it with `setIndex()` after rag.buildIndex
 * resolves. `isCorpusLoaded()` is the fast check route handlers use to
 * return a 503 when the corpus hasn't finished loading yet.
 *
 * Holding the index in this module (rather than in index.js) keeps the
 * routes/* files free of any reference to the bootstrap order — they
 * import a function, not a mutable export.
 */

let index = null;

function setIndex(newIndex) {
  index = newIndex;
}

function getIndex() {
  return index;
}

function isCorpusLoaded() {
  return !!index;
}

module.exports = {
  setIndex,
  getIndex,
  isCorpusLoaded,
};
