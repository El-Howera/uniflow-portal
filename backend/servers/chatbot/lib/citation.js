/**
 * Citation enforcement helpers — Plan 13 Phase 7.
 *
 * Every non-chitchat / non-OOS answer should reference its source(s).
 * Responses without any inline `[N]` marker get a soft footer appended
 * pointing at the top retrieval passage so the user always sees a
 * verifiable source.
 *
 * Refusals (`I don't have enough information` / `لا تتوفر...`) explicitly
 * skip the footer — there's no source to ground in, and a footer there
 * would lie about the answer being supported.
 */

function hasInlineCitation(text) {
  return /\[\d{1,2}\]/.test(String(text || ''));
}

// Matches both the canned OOS short-circuit text and the LLM's own paraphrased
// refusals in EN and AR. Case-insensitive lowercasing for ASCII paths.
function isRefusalAnswer(text) {
  const s = String(text || '').toLowerCase();
  return (
    /i\s+don['’]t\s+have\s+(?:enough\s+)?information/.test(s) ||
    /i\s+couldn['’]t\s+find/.test(s) ||
    /not\s+enough\s+information\s+in\s+the\s+regulations/.test(s) ||
    /لا\s*(?:أ|ا)?تتوفر\s*لدي\s*معلومات\s*كافية/u.test(s) ||
    /لم\s*أتمكن\s*من\s*العثور/u.test(s) ||
    /لا\s*أمتلك\s*معلومات\s*كافية/u.test(s)
  );
}

function appendCitationFooter(answer, passages, lang) {
  if (!passages || passages.length === 0) return answer;
  const top = passages[0];
  const label = top.header || top.title || top.id || 'passage 1';
  const footer =
    lang === 'ar'
      ? `\n\n(المصدر: ${label} [1])`
      : `\n\n(Source: ${label} [1])`;
  return answer + footer;
}

/**
 * Strip fake markdown URLs from the LLM's output. We never supply URLs to
 * the model — citations are numeric `[N]` references into the passages
 * array. So any `[text](http://...)` markdown link is a hallucination
 * (Mistral often invents `https://www.example.com` URLs when it sees
 * something that looks like a citation candidate). Keep the visible text,
 * drop the bogus URL.
 *
 * Also strips bare URL syntax `<https://www.example.com>` that the model
 * occasionally produces.
 */
function stripFakeUrls(text) {
  let out = String(text || '');
  // Markdown link: [label](http(s)://...) → label
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1');
  // Bare angle-bracketed URL: <http(s)://...> → drop entirely
  out = out.replace(/<https?:\/\/[^>]+>/g, '');
  return out;
}

module.exports = {
  hasInlineCitation,
  isRefusalAnswer,
  appendCitationFooter,
  stripFakeUrls,
};
