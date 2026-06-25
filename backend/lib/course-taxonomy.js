/**
 * Course taxonomy — fixed enum-like sets that the admin Course Rules page
 * and the registration server's Zod validators share.
 *
 * Plan 4 Phase 2 — Articles 7 (Language of Study) and 30/31 (Faculty
 * compulsory + elective categorization). Stored as plain strings on the
 * Course model so a tenant could theoretically extend the taxonomy via the
 * DB; in practice these stay closed sets so the FCDS regulations map cleanly.
 */

const COURSE_LANGUAGES = ['en', 'ar'];

const COURSE_LANGUAGE_LABELS = Object.freeze({
  en: 'English',
  ar: 'Arabic',
});

const COURSE_CATEGORIES = [
  'university',          // University Requirement (Article 8)
  'faculty_compulsory',  // Faculty Compulsory (Article 30)
  'faculty_elective',    // Faculty Elective (Article 31)
  'program_compulsory',  // Programme Compulsory
  'program_elective',    // Programme Elective
  'training',            // Field Training (counts toward graduation, not GPA)
];

const COURSE_CATEGORY_LABELS = Object.freeze({
  university:          'University Requirement',
  faculty_compulsory:  'Faculty Compulsory',
  faculty_elective:    'Faculty Elective',
  program_compulsory:  'Programme Compulsory',
  program_elective:    'Programme Elective',
  training:            'Field Training',
});

module.exports = {
  COURSE_LANGUAGES,
  COURSE_LANGUAGE_LABELS,
  COURSE_CATEGORIES,
  COURSE_CATEGORY_LABELS,
};
