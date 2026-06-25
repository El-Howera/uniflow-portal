/**
 * Chitchat short-circuits.
 *
 * Pure greeting / thanks / farewell / "who are you" style messages don't need
 * RAG retrieval — running them through BM25 + Mistral burns tokens and risks
 * a "I don't have enough information" refusal because the corpus doesn't talk
 * about saying hello. We detect these patterns up front and return a canned
 * reply in the right language. Anything else falls through to the regular
 * pipeline.
 */

// Match strategy: each pattern is anchored on `^` and ends with strict
// trailing punctuation only — no permissive ".{0,N}" tail, otherwise
// "hi can you list the courses" would short-circuit to a greeting reply
// and the user's real question would be lost. Multi-word forms like
// "thank you so much" / "hey there" are listed explicitly in the
// alternation. The pattern list is ordered: earliest match wins.
//
// Note on \b: JS regex \b is ASCII-only, so we don't use it on the Arabic
// side (\b at an Arabic char position behaves unpredictably). Latin
// alternations are tight enough on their own that "history" / "his" don't
// match "hi".

const PUNCT = '[\\s.!?,~]*$';

const PATTERNS_EN = [
  {
    kind: 'thanks',
    re: new RegExp(
      '^(' +
        'thanks(?:\\s+(?:a\\s*lot|so\\s*much|very\\s*much|again|man))?' +
        '|thank\\s*you(?:\\s+(?:so\\s*much|very\\s*much|a\\s*lot))?' +
        '|thank\\s*u' +
        '|thx|ty|tysm|tnx' +
        '|appreciate\\s*(?:it|that|you)' +
        '|much\\s*obliged' +
      ')' + PUNCT
    ),
    reply:
      "You're welcome! If you have more questions about the FCDS regulations — programs, study plans, grading, attendance, anything — just ask.",
  },
  {
    kind: 'farewell',
    re: new RegExp(
      '^(' +
        'bye|good\\s*bye|see\\s*ya|see\\s*you(?:\\s+later)?|cya|farewell' +
        '|take\\s*care|i\'?m\\s*done|that\'?s\\s*all|that\\s*will\\s*be\\s*all' +
      ')' + PUNCT
    ),
    reply:
      "Goodbye! Come back any time you need help with the FCDS regulations.",
  },
  {
    kind: 'how_are_you',
    re: new RegExp(
      '^(' +
        'how\'?s\\s*it\\s*going' +
        '|how\\s+(?:are\\s+(?:you|u)|r\\s*u)(?:\\s+doing|\\s+today)?' +
        '|how\\s*ya\\s*doin\'?' +
        '|what\'?s\\s*up|whats\\s*up|wassup|sup' +
      ')' + PUNCT
    ),
    reply:
      "I'm doing well, thanks for asking! What would you like to know about the FCDS regulations?",
  },
  {
    kind: 'who',
    re: new RegExp(
      '^(' +
        'who\\s+(?:are\\s+(?:you|u)|r\\s*u)' +
        '|what\\s+are\\s+you' +
        '|tell\\s+me\\s+about\\s+yourself' +
      ')' + PUNCT
    ),
    reply:
      "I'm the FCDS academic-regulations assistant for the Faculty of Computers and Data Science at Alexandria University. I can answer questions about programs, study plans, grading, attendance, registration, and other rules from the faculty regulations.",
  },
  {
    kind: 'greeting',
    re: new RegExp(
      '^(' +
        'hi(?:\\s+there)?' +
        '|hello(?:\\s+there)?' +
        '|hey(?:\\s+there)?' +
        '|hiya|howdy|yo' +
        '|good\\s*(?:morning|afternoon|evening)' +
      ')' + PUNCT
    ),
    reply:
      "Hello! I'm the FCDS regulations assistant. Ask me anything about your programs, study plans, grading, attendance, registration, graduation requirements, or any other rule from the faculty regulations.",
  },
];

const PUNCT_AR = '[\\s.!?,،؟~]*$';

const PATTERNS_AR = [
  {
    kind: 'thanks',
    re: new RegExp(
      '^(' +
        'شكر[اً]?(?:\\s+(?:جزيلا|جدا|كتير|ليك|لك))?' +
        '|شكرا\\s*ل[كي]?' +
        '|متشكر(?:\\s+جدا)?' +
        '|تسلم|تسلم\\s+ايدك' +
        '|ألف\\s*شكر|الف\\s*شكر' +
        '|يعطيك\\s*العافية' +
        '|مشكور' +
      ')' + PUNCT_AR,
      'u'
    ),
    reply:
      'العفو! إن كان لديك أي سؤال آخر عن لائحة كلية الحاسبات وعلوم البيانات — البرامج، الخطط الدراسية، التقدير، الحضور، أي شيء — اسألني.',
  },
  {
    kind: 'farewell',
    re: new RegExp(
      '^(مع\\s*السلامة|الى\\s*اللقاء|إلى\\s*اللقاء|باي|وداعا|في\\s*أمان\\s*الله)' + PUNCT_AR,
      'u'
    ),
    reply: 'مع السلامة! ارجع في أي وقت تحتاج مساعدة بشأن لائحة الكلية.',
  },
  {
    kind: 'how_are_you',
    re: new RegExp(
      '^(كيف\\s*حالك|عامل\\s*ايه|كيفك|إزيك|ازيك)' + PUNCT_AR,
      'u'
    ),
    reply: 'الحمد لله بخير! ماذا تريد أن تعرف عن لائحة الكلية؟',
  },
  {
    kind: 'who',
    re: new RegExp(
      '^(من\\s*أنت|مين\\s*انت|من\\s*انت|ما\\s*أنت|انت\\s*مين)' + PUNCT_AR,
      'u'
    ),
    reply:
      'أنا مساعد مخصص للإجابة عن أسئلة لائحة كلية الحاسبات وعلوم البيانات (FCDS) بجامعة الإسكندرية — البرامج، الخطط الدراسية، التقدير، الحضور، التسجيل، وكل ما يخص اللائحة.',
  },
  {
    kind: 'greeting',
    re: new RegExp(
      '^(' +
        'مرحبا|اهلا|أهلا|أهلاً' +
        '|السلام\\s*عليكم(?:\\s+ورحمة\\s+الله(?:\\s+وبركاته)?)?' +
        '|هلا' +
        '|صباح\\s*(?:الخير|النور)' +
        '|مساء\\s*(?:الخير|النور)' +
      ')' + PUNCT_AR,
      'u'
    ),
    reply:
      'أهلاً! أنا مساعد لائحة كلية الحاسبات وعلوم البيانات. اسألني عن البرامج، الخطط الدراسية، نظام التقدير، الحضور، التسجيل، متطلبات التخرج، أو أي قاعدة أخرى من اللائحة.',
  },
];

/**
 * Try to match a chitchat pattern against the message.
 * Returns `{ kind, reply }` on match, or `null` to fall through to RAG.
 */
function matchChitchat(message, lang) {
  if (!message) return null;
  const norm = String(message).trim().toLowerCase();
  // Cheap guard — most regulation questions are >25 chars. Skip the regex
  // run for long inputs to keep cost negligible.
  if (norm.length > 60) return null;
  const patterns = lang === 'ar' ? PATTERNS_AR : PATTERNS_EN;
  for (const p of patterns) {
    if (p.re.test(norm)) return { kind: p.kind, reply: p.reply };
  }
  return null;
}

module.exports = { matchChitchat };
