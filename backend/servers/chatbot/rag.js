/**
 * Lightweight RAG over the FCDS regulations corpus.
 * BM25 + character-n-gram boost + phrase bonus.
 * No external embedding model — search is fully token-based.
 *
 * Corpus files (JSON Lines):
 *   backend/corpus/regulations_en.jsonl
 *   backend/corpus/regulations_ar.jsonl
 *
 * Each line: { id, type, article_number?, header, title, text, metadata }
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { expandTokens } = require('./synonyms');

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const NGRAM_N = 4;

// Paragraph-level chunking — split each article into smaller windows so the
// retriever can rank a specific clause higher than a generic 2 kB article
// blob. Each chunk inherits its parent doc's metadata + id (with `#chunk-N`
// suffix) so citations still point at the same article number.
const CHUNK_TARGET_CHARS = 480;       // ~80–110 tokens, fits a single rule/clause
const CHUNK_MAX_CHARS = 700;          // hard cap before forcing a split
const CHUNK_MIN_CHARS = 160;          // shorter than this → don't split off
const CHUNK_OVERLAP_CHARS = 90;       // ~20% overlap to keep cross-boundary context

// Cross-language ranking weight — query language gets full BM25 score, the
// other language is included at half score so a question in English can still
// surface an Arabic passage if it's clearly the best match (and vice versa).
const CROSS_LANG_WEIGHT = 0.5;

const STOPWORDS_EN = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'but', 'if', 'while', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'as', 'that', 'this', 'it', 'its', 'has', 'have', 'had',
  'do', 'does', 'did', 'i', 'you', 'he', 'she', 'we', 'they', 'what',
  'which', 'who', 'how', 'why', 'when', 'where', 'can', 'could', 'should',
  'would', 'will', 'shall', 'may', 'might',
]);

// Arabic stopwords — pronouns + common particles. Excluded from BM25 so they
// don't drag down IDF for content words. Sourced from the standard Arabic
// stopword lists used in Lucene/ES "arabic_normalizer". Keeping it short on
// purpose — over-zealous stopwords would also drop tokens that carry meaning
// in our regulation corpus (e.g. "كل" / "بعد" / "قبل").
const STOPWORDS_AR = new Set([
  'في', 'من', 'إلى', 'الى', 'على', 'عن', 'هو', 'هي', 'هم', 'هن',
  'أنا', 'انا', 'أنت', 'انت', 'نحن', 'أنتم', 'انتم',
  'هذا', 'هذه', 'ذلك', 'تلك', 'هؤلاء', 'أولئك',
  'الذي', 'التي', 'الذين', 'اللاتي',
  'ما', 'ماذا', 'متى', 'أين', 'كيف', 'لماذا', 'هل',
  'كان', 'كانت', 'يكون', 'تكون',
  'و', 'أو', 'ثم', 'لكن', 'إذا', 'لو',
]);

// Arabic morphological normalisation. Two passes:
//
// 1. Letter normalisation — collapse the alef/yaa/taa-marbuta variants that
//    Arabic writers use inconsistently. "الغياب" / "الغيآب" / "الغياب" all
//    end up identical; "حضرة" and "حضره" match. Diacritics are stripped.
//
// 2. Light stemming — strip the `ال` (and variants `وال`, `بال`, `كال`, `فال`,
//    `لل`) definite-article prefix from any token longer than 3 chars. This
//    is what fixes the "الغياب vs غياب" retrieval gap: both now collapse to
//    the same token "غياب" in the BM25 index, so a query for "الغياب" hits
//    Article 16 (which uses "غياب") with full score.
//
// Trailing weak-suffix stripping (ون / ين / ات / ه / ها) is intentionally
// NOT done — it over-stems for our short corpus and starts conflating
// unrelated tokens.
const AR_DIACRITICS = /[ً-ْٰ]/g;
function normaliseArToken(t) {
  let s = t.replace(AR_DIACRITICS, '');
  s = s
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه');
  if (s.length > 4) {
    // Strip the most common definite-article-bearing prefixes (longest
    // first so "وال" / "بال" win over plain "ال").
    s = s.replace(/^(?:وال|بال|كال|فال|لل|ال)/, '');
  }
  return s;
}

function isArabicToken(t) {
  // Cheap: if the first code-point is in the Arabic block, treat as AR.
  if (!t) return false;
  const c = t.codePointAt(0);
  return c >= 0x0600 && c <= 0x06ff;
}

function tokenize(text) {
  if (!text) return [];
  const raw = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const out = [];
  for (const t of raw) {
    if (isArabicToken(t)) {
      if (STOPWORDS_AR.has(t)) continue;
      const norm = normaliseArToken(t);
      if (!norm || norm.length < 2 || STOPWORDS_AR.has(norm)) continue;
      out.push(norm);
    } else {
      if (STOPWORDS_EN.has(t)) continue;
      out.push(t);
    }
  }
  return out;
}

function ngrams(text, n = NGRAM_N) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  if (s.length < n) return new Set([s]);
  const out = new Set();
  for (let i = 0; i <= s.length - n; i++) out.add(s.slice(i, i + n));
  return out;
}

function detectLanguage(text) {
  if (!text) return 'en';
  let arCount = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0x0600 && code <= 0x06ff) arCount++;
  }
  return arCount > text.length * 0.15 ? 'ar' : 'en';
}

/**
 * Split a single document's text into ~CHUNK_TARGET_CHARS pieces with
 * CHUNK_OVERLAP_CHARS overlap between consecutive chunks. Splits happen at
 * paragraph (`\n\n`) boundaries first, falling back to sentence breaks
 * (`. `, `؟ `, `، `, `; `) and finally a hard slice if a paragraph is too
 * long for the cap.
 */
function chunkText(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_MAX_CHARS) return [clean];

  // 1. Split on paragraph breaks first.
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // 2. For each paragraph that's still too long, split on sentence boundaries.
  const sentenceSplit = (s) => {
    if (s.length <= CHUNK_MAX_CHARS) return [s];
    const parts = s.split(/(?<=[.!?؟])\s+|(?<=[،;:])\s+/);
    const out = [];
    for (const part of parts) {
      if (part.length <= CHUNK_MAX_CHARS) {
        out.push(part);
      } else {
        // Hard slice with overlap so we don't drop content
        let i = 0;
        while (i < part.length) {
          const end = Math.min(part.length, i + CHUNK_MAX_CHARS);
          out.push(part.slice(i, end));
          if (end === part.length) break;
          i = end - CHUNK_OVERLAP_CHARS;
        }
      }
    }
    return out;
  };

  // 3. Greedy re-pack: combine adjacent small pieces up to TARGET, with
  //    overlap between successive chunks. Single paragraphs stay whole when
  //    they fit; long ones cascade through sentenceSplit above.
  const pieces = [];
  for (const p of paragraphs) pieces.push(...sentenceSplit(p));

  const chunks = [];
  let buf = '';
  for (const piece of pieces) {
    if (buf.length === 0) {
      buf = piece;
      continue;
    }
    if (buf.length + 1 + piece.length <= CHUNK_TARGET_CHARS) {
      buf += '\n\n' + piece;
    } else {
      chunks.push(buf);
      const overlap = buf.length > CHUNK_OVERLAP_CHARS ? buf.slice(-CHUNK_OVERLAP_CHARS) : '';
      buf = (overlap ? overlap + '\n\n' : '') + piece;
    }
  }
  if (buf) chunks.push(buf);

  // 4. Merge tiny tail chunks into the previous one when below MIN.
  const merged = [];
  for (const c of chunks) {
    if (merged.length > 0 && c.length < CHUNK_MIN_CHARS) {
      merged[merged.length - 1] += '\n\n' + c;
    } else {
      merged.push(c);
    }
  }
  return merged;
}

/**
 * Expand a single article-level doc into one row per chunk. Each chunk row
 * keeps the parent's `article_number`, `header`, `title`, `metadata`, and a
 * suffixed id so the index stays unique. Short docs (< CHUNK_MAX_CHARS) pass
 * through unchanged (single chunk = whole doc).
 */
function expandToChunks(rawDoc) {
  const chunks = chunkText(rawDoc.text || '');
  if (chunks.length <= 1) return [rawDoc];
  return chunks.map((chunkText, i) => ({
    ...rawDoc,
    id: `${rawDoc.id}#c${i + 1}`,
    parentId: rawDoc.id,
    chunkIndex: i + 1,
    chunkCount: chunks.length,
    text: chunkText,
  }));
}

async function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[rag] corpus file missing: ${filePath}`);
    return [];
  }
  const docs = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      docs.push(JSON.parse(trimmed));
    } catch {
      console.warn(`[rag] skipping malformed line ${lineNo} in ${filePath}`);
    }
  }
  return docs;
}

class RagIndex {
  constructor(docs) {
    this.docs = docs.map((d) => {
      const text = [d.header, d.title, d.text].filter(Boolean).join(' ');
      const tokens = tokenize(text);
      // Title+header tokens are tracked separately so query terms that match
      // them get a boost. Without this, a doc whose TITLE is "Computing and
      // Data Sciences Study Plan" scores no higher on "data science study
      // plan" than a generic doc that mentions "data" once in its body.
      const titleText = [d.header, d.title].filter(Boolean).join(' ');
      const titleTokens = new Set(tokenize(titleText));
      return {
        ...d,
        _text: text,
        _tokens: tokens,
        _tf: this._termFreq(tokens),
        _len: tokens.length,
        _ngrams: ngrams(text),
        _titleTokens: titleTokens,
        _lang: d.metadata?.language || detectLanguage(text),
      };
    });

    // Reconstruct full parent text from all chunks. Multi-chunk articles
    // (e.g. fcds_article_33_program1_electives_list#c1 + #c2) lose half
    // their content under chunk dedup; the search method now returns the
    // joined parent text so the LLM sees the full article. Chunk overlaps
    // are stripped by joining only on chunk-1's prefix + the second half
    // of subsequent chunks (we keep the simpler approach: concatenate
    // unique sentence content, deduping the overlap heuristically).
    this._parentText = new Map(); // parentId → reconstructed full text
    const chunksByParent = new Map();
    for (const d of this.docs) {
      const pid = d.parentId;
      if (!pid) continue;
      if (!chunksByParent.has(pid)) chunksByParent.set(pid, []);
      chunksByParent.get(pid).push(d);
    }
    for (const [pid, list] of chunksByParent.entries()) {
      list.sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
      // De-overlap: each chunk after the first overlaps the prior chunk's
      // tail by ~CHUNK_OVERLAP_CHARS. Strip the leading 90 chars of every
      // chunk after #1 so we don't repeat content.
      let combined = list[0].text || '';
      for (let i = 1; i < list.length; i++) {
        const next = list[i].text || '';
        const overlapStrip = Math.min(CHUNK_OVERLAP_CHARS, Math.floor(next.length / 4));
        combined += '\n' + next.slice(overlapStrip);
      }
      this._parentText.set(pid, combined);
    }
    this._avgLen = this.docs.length
      ? this.docs.reduce((s, d) => s + d._len, 0) / this.docs.length
      : 1;
    this._idf = this._computeIdf();
  }

  _termFreq(tokens) {
    const tf = Object.create(null);
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    return tf;
  }

  _computeIdf() {
    const N = this.docs.length || 1;
    const df = Object.create(null);
    for (const d of this.docs) {
      for (const t of Object.keys(d._tf)) df[t] = (df[t] || 0) + 1;
    }
    const idf = Object.create(null);
    for (const [t, n] of Object.entries(df)) {
      idf[t] = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    }
    return idf;
  }

  _bm25(queryTokens, doc) {
    let score = 0;
    for (const q of queryTokens) {
      const tf = doc._tf[q] || 0;
      if (!tf) continue;
      const idf = this._idf[q] || 0;
      const norm = 1 - BM25_B + (BM25_B * doc._len) / this._avgLen;
      score += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm));
    }
    return score;
  }

  search(query, { topK = 6, lang } = {}) {
    const baseTokens = tokenize(query);
    if (baseTokens.length === 0) return [];
    // Synonym expansion (Plan 13 Phase 4 follow-up). For each query token,
    // add registered synonyms BEFORE BM25 so an indirect phrasing like
    // "انتقلت إلى الأمن السيبراني" picks up Article 23 (which uses "تغيير
    // البرنامج"). The original tokens stay in the list so direct matches
    // still hit; synonyms are pure additive recall.
    const tokens = expandTokens(baseTokens, lang || 'en');
    const qNgrams = ngrams(query);
    const qNorm = String(query).toLowerCase().trim();
    const scored = [];
    for (const doc of this.docs) {
      const bm = this._bm25(tokens, doc);
      if (bm <= 0) continue;
      let overlap = 0;
      for (const g of qNgrams) if (doc._ngrams.has(g)) overlap++;
      const ngramBonus = qNgrams.size ? (overlap / qNgrams.size) * 0.3 : 0;
      const phraseBonus = qNorm.length > 4 && doc._text.toLowerCase().includes(qNorm) ? 4 : 0;
      // Title/header boost: +4 per query token that hits the doc's title or
      // header, plus +6 if title contains the full query phrase. Lifts
      // program-specific study-plan docs above generic body mentions when
      // the user asks about a particular program.
      let titleHits = 0;
      if (doc._titleTokens && doc._titleTokens.size > 0) {
        for (const t of tokens) if (doc._titleTokens.has(t)) titleHits++;
      }
      const titleText = [(doc.header || ''), (doc.title || '')].join(' ').toLowerCase();
      const titlePhraseBonus =
        qNorm.length > 4 && titleText.includes(qNorm) ? 6 : 0;
      const titleBonus = titleHits * 4 + titlePhraseBonus;
      // Soft cross-language: query-language docs full score, other-language
      // docs at CROSS_LANG_WEIGHT so they can still surface when they're a
      // genuine match, but don't dominate.
      const langWeight =
        !lang || !doc._lang || doc._lang === lang ? 1 : CROSS_LANG_WEIGHT;
      scored.push({ doc, score: (bm + ngramBonus + phraseBonus + titleBonus) * langWeight });
    }
    scored.sort((a, b) => b.score - a.score);

    // De-duplicate chunks from the same parent article, keeping only the
    // best-scoring chunk per parent so the LLM sees varied sources.
    const seenParents = new Set();
    const finalists = [];
    for (const item of scored) {
      const parent = item.doc.parentId || item.doc.id;
      if (seenParents.has(parent)) continue;
      seenParents.add(parent);
      finalists.push(item);
      if (finalists.length >= topK) break;
    }

    // Sibling pull-in: when the user asks about a study plan / program, the
    // BM25 ranking surfaces 2–3 semesters but misses the rest because they
    // all share a title. If ≥2 finalists share a `program##` family, pull
    // in every sibling — semester docs (`fcds_program##_*`) AND program-tied
    // articles (`fcds_article_*_program{N}_*`, e.g. electives_list,
    // compulsory_content). Capped at topK*2 total.
    //
    // Scoring: pulled-in articles whose title mentions a query topic word
    // (e.g. "Elective Courses for…" when the query mentions electives) get
    // promoted to ~the family's best score so they fit in the LLM context
    // budget. Plain semester siblings get a small floor score so they sit
    // at the bottom but stay retrievable.
    const familyRe = /^fcds_program(\d+)_/;
    const families = new Map();
    const familyBestScore = new Map();
    for (const item of finalists) {
      const m = familyRe.exec(item.doc.id || '');
      if (!m) continue;
      const fam = m[1];
      families.set(fam, (families.get(fam) || 0) + 1);
      const prev = familyBestScore.get(fam) ?? 0;
      if (item.score > prev) familyBestScore.set(fam, item.score);
    }
    const inFinalists = new Set(finalists.map((f) => f.doc.parentId || f.doc.id));
    const queryTopicTerms = new Set(tokens); // e.g. ['data','science','program','electives']
    for (const [fam, count] of families.entries()) {
      if (count < 2) continue;
      // Match both `fcds_program01_*` (semesters/summers) and
      // `fcds_article_*_program1_*` (articles tied to this program — note
      // the article-id form drops the leading zero on the program number).
      const famInt = parseInt(fam, 10);
      const sibIdRe = new RegExp(
        `^fcds_program${fam}_|_program0?${famInt}_`
      );
      const bestScore = familyBestScore.get(fam) || 5;
      const siblings = this.docs.filter((d) => {
        if (!d.id || !sibIdRe.test(d.id)) return false;
        return !inFinalists.has(d.parentId || d.id);
      });
      for (const sib of siblings) {
        const id = sib.parentId || sib.id;
        if (inFinalists.has(id)) continue;
        inFinalists.add(id);
        // Topic match: if the sibling's title shares any token with the
        // query (e.g. "electives", "compulsory", "elective courses"), score
        // it just below the family's best so it rides into the LLM context
        // alongside its siblings instead of getting truncated out at the
        // 9000-char cap.
        let topicMatch = false;
        if (sib._titleTokens) {
          for (const t of queryTopicTerms) {
            if (sib._titleTokens.has(t)) { topicMatch = true; break; }
          }
        }
        const sibScore = topicMatch ? bestScore - 0.5 : 0.5;
        finalists.push({ doc: sib, score: sibScore });
        if (finalists.length >= topK * 2) break;
      }
      if (finalists.length >= topK * 2) break;
    }
    // Re-sort after sibling pull-in so promoted topic-matched siblings move
    // to their proper rank position.
    finalists.sort((a, b) => b.score - a.score);

    return finalists.map(({ doc, score }) => {
      // If this doc was a chunk, return the FULL reconstructed parent text
      // so the LLM sees the complete article. Chunk-only retrieval was
      // dropping half the content of multi-chunk articles (e.g. article 33
      // electives list lost courses 5–8 under dedup), causing Mistral to
      // hallucinate the missing rows.
      const fullText = doc.parentId && this._parentText.has(doc.parentId)
        ? this._parentText.get(doc.parentId)
        : doc.text;
      return {
        id: doc.parentId || doc.id,
        chunkId: doc.parentId ? doc.id : null,
        chunkIndex: doc.chunkIndex ?? null,
        article_number: doc.article_number ?? null,
        title: doc.title || doc.header,
        header: doc.header,
        text: fullText,
        metadata: doc.metadata || {},
        score,
        lang: doc._lang,
      };
    });
  }
}

async function buildIndex(corpusDir) {
  const enPath = path.join(corpusDir, 'regulations_en.jsonl');
  const arPath = path.join(corpusDir, 'regulations_ar.jsonl');
  const en = await readJsonl(enPath);
  const ar = await readJsonl(arPath);
  const seen = new Set();
  const merged = [];
  for (const d of [...en, ...ar]) {
    if (!d?.id || seen.has(d.id)) continue;
    seen.add(d.id);
    merged.push(d);
  }
  // Expand each article into paragraph-level chunks so retrieval can rank a
  // specific clause higher than a 2 kB article blob.
  const chunked = merged.flatMap(expandToChunks);
  console.log(
    `[rag] indexed ${chunked.length} chunks from ${merged.length} docs ` +
      `(en=${en.length}, ar=${ar.length})`
  );
  return new RagIndex(chunked);
}

const SYSTEM_PROMPT_EN = `You are an academic advisor for the Faculty of Computers and Data Science (FCDS) at Alexandria University.

RULES:
1. Answer regulation questions ONLY from the regulation texts provided below.
2. When the user asks personal questions (their grades, attendance, balance, courses, GPA), use the STUDENT CONTEXT block at the top. Quote the numbers verbatim and tell them what those numbers mean per the regulations.
3. If the regulation texts only partially answer, give the partial answer with what's relevant; only say "I don't have enough information" if the topic is genuinely absent from all provided texts AND not in the student context.
4. Never fabricate, guess, or invent rules, numbers, course codes, or grades.
5. Reply in English. Cite regulation sources as [1], [2], etc. (student context doesn't need citation).
6. Be thorough — include credit hours, GPA thresholds, deadlines, and exceptions when present.
7. If you stated the answer, do NOT also say "I don't have enough information." Either answer OR say you don't know — never both.
8. This is a multi-turn conversation. Use prior turns to resolve follow-ups.
9. When greeting the student, use their first name (e.g. "Hi Elfares,"). Keep it warm but brief.`;

const SYSTEM_PROMPT_AR = `أنت مساعد أكاديمي متخصص في لوائح كلية الحاسبات وعلوم البيانات بجامعة الإسكندرية.

القواعد:
1. أجب عن أسئلة اللائحة حصرياً من النصوص المقدمة أدناه.
2. عندما يسأل الطالب أسئلة شخصية (درجاته، حضوره، رصيده، مقرراته، معدله)، استخدم بيانات الطالب في كتلة "STUDENT CONTEXT" بالأعلى. اقتبس الأرقام كما هي واشرح معناها وفق اللائحة.
3. إذا لم تجد الإجابة في النصوص ولا في بيانات الطالب، قل: "لا تتوفر لدي معلومات كافية في اللائحة للإجابة."
4. لا تخترع قواعد أو أرقام أو رموز مقررات أو درجات.
5. أجب بالعربية فقط. استشهد بمصادر اللائحة مثل [1] أو [2] (لا حاجة للاستشهاد ببيانات الطالب).
6. كن دقيقاً واذكر التفاصيل: عدد الساعات، المعدلات، المواعيد، والاستثناءات.
7. إذا أجبت لا تضف "لا تتوفر لدي معلومات". إما أجب أو قل لا أعرف، ليس الاثنين.
8. هذه محادثة متعددة الأدوار، استخدم السياق السابق لفهم الأسئلة المتابعة.
9. عند تحية الطالب، استخدم اسمه الأول (مثلاً "أهلاً يا الفارس،"). أبقِ التحية ودودة وموجزة.`;

const MAX_CONTEXT_CHARS = 9000;
const TOP_DOC_CHARS = 2400;
const SECONDARY_DOC_CHARS = 1500;

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('، '), cut.lastIndexOf(', '));
  return (lastBreak > max * 0.6 ? cut.slice(0, lastBreak + 1) : cut) + '…';
}

function buildContext(passages) {
  if (passages.length === 0) return '';
  const parts = [];
  let used = 0;
  for (let i = 0; i < passages.length; i++) {
    const p = passages[i];
    const cap = i === 0 ? TOP_DOC_CHARS : SECONDARY_DOC_CHARS;
    const tag = `[${i + 1}] ${p.header || p.title || p.id}`;
    const body = truncate(p.text || '', cap);
    const block = `${tag}\n${body}`;
    if (used + block.length > MAX_CONTEXT_CHARS) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join('\n\n');
}

function buildMessages({ question, passages, history = [], lang = 'en', userContext = null }) {
  // System prompt + optional STUDENT CONTEXT block. The user context lives
  // INSIDE the system message rather than as a separate user turn so it
  // doesn't get clipped by the recent-history window.
  let sys = lang === 'ar' ? SYSTEM_PROMPT_AR : SYSTEM_PROMPT_EN;
  if (userContext) {
    sys = `${sys}\n\n${userContext}`;
  }
  const messages = [{ role: 'system', content: sys }];
  for (const turn of history.slice(-5)) {
    messages.push({ role: 'user', content: truncate(turn.question, 800) });
    messages.push({ role: 'assistant', content: truncate(turn.answer, 800) });
  }
  const ctx = buildContext(passages);
  const tail =
    lang === 'ar'
      ? `=== نصوص اللائحة ===\n${ctx}\n=== انتهى ===\n\nسؤال الطالب: ${question}\n\nالإجابة:`
      : `=== REGULATION TEXTS ===\n${ctx}\n=== END ===\n\nStudent question: ${question}\n\nAnswer:`;
  messages.push({ role: 'user', content: tail });
  return messages;
}

function buildCitations(passages) {
  return passages.map((p, i) => ({
    index: i + 1,
    id: p.id,
    article_number: p.article_number,
    title: p.title || p.header || p.id,
    excerpt: truncate(p.text || '', 700),
  }));
}

function fallbackAnswer(passages, lang) {
  if (passages.length === 0) {
    return lang === 'ar'
      ? 'عذراً، لم أجد معلومات ذات صلة في اللائحة. يرجى إعادة صياغة السؤال.'
      : "Sorry, I couldn't find relevant information in the regulations. Try rephrasing.";
  }
  const heading =
    lang === 'ar'
      ? '⚠️ خدمة الذكاء الاصطناعي غير متاحة. النصوص ذات الصلة:'
      : '⚠️ LLM offline. Relevant texts:';
  const blocks = passages.slice(0, 3).map((p, i) => {
    const tag = `[${i + 1}] ${p.header || p.title || p.id}`;
    return `${tag}\n${truncate(p.text || '', 600)}`;
  });
  return `${heading}\n\n${blocks.join('\n\n')}`;
}

module.exports = {
  buildIndex,
  detectLanguage,
  buildMessages,
  buildCitations,
  fallbackAnswer,
  truncate,
};
