/**
 * Query-time synonym expansion for the FCDS RAG chatbot.
 *
 * Why: BM25 is exact-match-on-tokens. When a student asks "what happens
 * if I switch programmes" the corpus uses "تغيير البرنامج" / "change
 * programme" (Article 23), so the query word "switch" / "انتقل" /
 * "transfer" misses entirely and Article 23 doesn't surface. We fix this
 * by expanding each query token to its known synonyms before BM25 search.
 *
 * Source: paraphrase mismatches observed during Plan 13 Phase 4 tuning
 * + ports of the legacy Python implementation's ~30-entry table.
 *
 * Design:
 *   - Each entry maps one canonical token → an array of synonyms (also
 *     tokens, NOT phrases — multi-word entries would require re-tokenising
 *     the query and aren't worth the complexity for this corpus size).
 *   - Expansion is symmetric: if `switch → [change, transfer]`, then
 *     queries containing "change" also pick up "switch" + "transfer" via
 *     the bidirectional map built in `buildBidirectional()`.
 *   - Tokens are stored in their POST-stemming form (so AR entries are
 *     the bare root, no `ال` prefix). This matches what `rag.js → tokenize()`
 *     produces.
 *   - Expansion ADDS synonyms to the BM25 query; it never replaces.
 *     Original tokens still match the corpus directly.
 */

const RAW_AR = {
  // Programme change / transfer (Article 23 vocab)
  'تغيير': ['انتقل', 'انتقال', 'تحول', 'تحويل', 'نقل', 'تبديل', 'يغير'],
  'برنامج': ['تخصص', 'قسم', 'مسار'],
  // Common / shared / overlap
  'مشترك': ['مشتركه', 'متشابه', 'نفس', 'مماثل', 'متطابق', 'مكرر'],
  // Retake / repeat (Article 18 vocab)
  'اعاده': ['يعيد', 'تكرار', 'تكرر', 'يكرر', 'تعيد'],
  // Course / module
  'مقرر': ['ماده', 'مواد', 'كورس', 'مقررات'],
  // Hour / credit
  'ساعه': ['ساعات', 'ساعتان', 'ساعتين'],
  // Semester
  'فصل': ['فصول', 'فصلين', 'سمستر', 'ترم'],
  // Attendance / absence (Article 16 vocab)
  'غياب': ['غياب', 'تغيب', 'مواظبه', 'حضور', 'تأخر'],
  // Exam
  'امتحان': ['اختبار', 'تقييم', 'تحريري'],
  // Grade / mark
  'تقدير': ['درجه', 'علامه', 'تقييم'],
  // Probation / dismissal (Article 19 vocab)
  'متعثر': ['مراقبه', 'انذار', 'احتمال'],
  // Withdrawal (Article 15 vocab)
  'انسحاب': ['سحب', 'يسحب', 'منسحب'],
  // Graduation (Article 8/22 vocab)
  'تخرج': ['خريج', 'تخرجت', 'الانتهاء'],
  // GPA
  'معدل': ['تراكمي', 'cgpa', 'gpa'],
  // Honors
  'شرف': ['مرتبه', 'تفوق', 'متميز'],
  // Suspension (Article 20)
  'ايقاف': ['تعليق', 'توقف'],
  // Add/drop (Article 14)
  'حذف': ['اضافه', 'تعديل'],
  // Registration
  'تسجيل': ['قيد', 'اشتراك'],
  // Programs (proper nouns — alternative phrasings)
  'سيبراني': ['cybersecurity', 'سايبر', 'سيبر'],
  'بيانات': ['data', 'علوم'],
  'تحليلات': ['analytics', 'تحليل'],
  'ذكيه': ['intelligent', 'ذكاء'],
  'اعمال': ['business', 'تجاريه'],
  'وسائط': ['media', 'وسائل'],
  'صحيه': ['healthcare', 'صحه', 'طبيه'],
};

const RAW_EN = {
  // Programme change (Article 23)
  change: ['switch', 'transfer', 'move', 'swap'],
  programme: ['program', 'major', 'specialization', 'specialisation', 'track'],
  department: ['dept', 'division'],
  // Common / shared
  common: ['shared', 'overlap', 'overlapping', 'same', 'identical', 'transferable'],
  // Retake / repeat (Article 18)
  retake: ['repeat', 'redo', 'retry', 'restudy'],
  // Course
  course: ['class', 'subject', 'module'],
  // Hour / credit
  credit: ['hour', 'cr', 'hrs', 'credits'],
  // Semester
  semester: ['term', 'session', 'fall', 'spring'],
  // Attendance / absence
  attendance: ['attend', 'presence', 'absent', 'absence', 'miss'],
  // Exam
  exam: ['examination', 'test', 'final', 'midterm'],
  // Grade / mark / score
  grade: ['mark', 'score', 'points', 'gpa', 'cgpa'],
  // Probation
  probation: ['monitoring', 'warning', 'struggling', 'low'],
  // Withdrawal
  withdraw: ['drop', 'leave', 'quit'],
  // Graduation
  graduate: ['graduation', 'finish', 'complete', 'degree'],
  // Honors
  honors: ['honours', 'distinction', 'merit'],
  // Suspension
  suspend: ['pause', 'hold', 'halt'],
  // Add/drop
  add: ['register', 'enroll', 'enroll'],
  drop: ['remove', 'deregister', 'unregister'],
  // Money / fees
  fee: ['payment', 'cost', 'tuition'],
  // Schedule
  schedule: ['timetable', 'calendar'],
  // Major / minor / overall
  required: ['mandatory', 'compulsory'],
  elective: ['optional', 'choice'],
  // Specific programmes
  cybersecurity: ['cyber', 'security', 'سيبراني'],
  data: ['analytics', 'science', 'sciences'],
  intelligent: ['ai', 'artificial', 'smart'],
  media: ['multimedia', 'press'],
  healthcare: ['medical', 'health', 'clinical'],
  business: ['ba', 'commerce'],
};

/** Build a symmetric map: every member of a synonym group resolves to the full group. */
function buildBidirectional(raw) {
  const out = new Map();
  for (const [canonical, syns] of Object.entries(raw)) {
    const group = new Set([canonical, ...syns]);
    for (const word of group) {
      const existing = out.get(word) || new Set();
      for (const member of group) {
        if (member !== word) existing.add(member);
      }
      out.set(word, existing);
    }
  }
  return out;
}

const MAP_AR = buildBidirectional(RAW_AR);
const MAP_EN = buildBidirectional(RAW_EN);

/**
 * Expand a token list with synonyms. Each input token contributes itself
 * plus the synonyms registered for it (if any). The output is deduped.
 *
 * @param {string[]} tokens
 * @param {'en'|'ar'} lang
 * @returns {string[]} expanded token list (always a superset of input)
 */
function expandTokens(tokens, lang) {
  const map = lang === 'ar' ? MAP_AR : MAP_EN;
  const out = new Set(tokens);
  for (const t of tokens) {
    const group = map.get(t);
    if (!group) continue;
    for (const s of group) out.add(s);
  }
  return Array.from(out);
}

/**
 * Sugar: expand a query string into a string with synonyms inlined.
 * Used by code paths that need the raw expanded query (e.g. n-gram
 * computation in rag.js).
 *
 * @param {string} query
 * @param {string[]} originalTokens — tokens AFTER tokenize+stem
 * @param {'en'|'ar'} lang
 * @returns {string} space-joined original-query + synonym-token list
 */
function expandQuery(query, originalTokens, lang) {
  const expanded = expandTokens(originalTokens, lang);
  const extras = expanded.filter((t) => !originalTokens.includes(t));
  if (extras.length === 0) return query;
  return `${query} ${extras.join(' ')}`;
}

module.exports = { expandTokens, expandQuery, RAW_AR, RAW_EN };
