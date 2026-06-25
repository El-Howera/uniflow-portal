/**
 * user-profile / routes / admin-system-settings.routes.js  (MVP build — trimmed)
 *
 * Mounted at: (no prefix — routes declare their full /api/... paths)
 *
 * Endpoints (3):
 *   GET   /api/public-settings              (public)
 *   GET   /api/public-settings/institution  (public)
 *   GET   /api/public-settings/holidays     (public)
 *
 * MVP build notes:
 *   - All admin-guarded handlers (PATCH /api/admin/system-settings, role CRUD,
 *     role-permissions, restore-defaults) have been removed — the MVP build
 *     keeps a real backend only for student & professor.
 *   - GET /api/public-settings/brand and the theming engine (lib/brand-config)
 *     have been removed; brandConfig no longer appears in public-settings.
 *   - public-settings performs lazy imports inside the route handler to avoid
 *     circular-import issues with the many policy lib/* modules it fans out to.
 *   - Falls through to all-defaults on any DB error (read-only; safe to degrade).
 */

'use strict';

const express = require('express');

const prisma = require('../../../lib/prisma');

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const INSTITUTION_DEFAULTS = {
  institutionName: 'UniFlow',
  productName: 'UniFlow',
  articleRefsVisible: false,
  regulatoryFramework: '',
  brandedResetLabels: false,
};

// ── GET /api/public-settings ──────────────────────────────────────────────────
// Aggregate endpoint — all policy defaults + institution config in one call.
// Lazy-requires the policy libs to avoid circular imports.

router.get('/api/public-settings', async (req, res) => {
  const { DEFAULT_RULES: ATTEND_DEFAULTS } = require('../../../lib/attendance-rules');
  const { DEFAULT_POLICY: CREDIT_DEFAULTS, getCreditLimitPolicy } = require('../../../lib/credit-limits');
  const { DEFAULT_POLICY: LEVEL_DEFAULTS, getLevelProgression } = require('../../../lib/level-progression');
  const {
    DEFAULT_GRADUATION_POLICY: GRAD_DEFAULTS,
    DEFAULT_SEMESTER_DURATIONS: SEM_DEFAULTS,
    getGraduationPolicy,
    getSemesterDurations,
  } = require('../../../lib/graduation-policy');
  const { DEFAULT_POLICY: WINDOWS_DEFAULTS, getWindowsPolicy } = require('../../../lib/registration-windows');
  const { DEFAULT_POLICY: INCOMPLETE_DEFAULTS, getIncompletePolicy } = require('../../../lib/incomplete-policy');
  const { DEFAULT_POLICY: REPETITION_DEFAULTS, getRepetitionPolicy } = require('../../../lib/repetition-policy');
  const { DEFAULT_HONORS_POLICY: HONORS_DEFAULTS, getHonorsPolicy } = require('../../../lib/academic-standing');
  const { DEFAULT_POLICY: SUSP_DEFAULTS, getSuspensionPolicy } = require('../../../lib/suspension-policy');
  const { DEFAULT_POLICY: MOBILITY_DEFAULTS, getMobilityPolicy } = require('../../../lib/mobility-policy');
  const { DEFAULT_POLICY: ADVISOR_DEFAULTS, getAdvisorPolicy } = require('../../../lib/advisor-policy');
  const { DEFAULT_DEFINITION: CHD_DEFAULTS, getCreditHourDefinition } = require('../../../lib/credit-hour-definition');
  const { DEFAULT_POLICY: SCHED_DEFAULTS, getSchedulePolicy } = require('../../../lib/schedule-policy');

  try {
    const [s, creditPolicy, levelProgression, graduationPolicy, semesterDurations, windowsPolicy,
           incompletePolicy, repetitionPolicy, honorsPolicy, suspensionPolicy, mobilityPolicy,
           advisorPolicy, creditHourDefinition, schedulePolicy] = await Promise.all([
      prisma.systemSettings.findFirst(),
      getCreditLimitPolicy(prisma),
      getLevelProgression(prisma),
      getGraduationPolicy(prisma),
      getSemesterDurations(prisma),
      getWindowsPolicy(prisma),
      getIncompletePolicy(prisma),
      getRepetitionPolicy(prisma),
      getHonorsPolicy(prisma),
      getSuspensionPolicy(prisma),
      getMobilityPolicy(prisma),
      getAdvisorPolicy(prisma),
      getCreditHourDefinition(prisma),
      getSchedulePolicy(prisma),
    ]);
    res.json({
      currency: s?.currency || 'EGP',
      appName: s?.appName || 'UniFlow',
      language: s?.language || 'en',
      timezone: s?.timezone || 'Africa/Cairo',
      numberOfAcademicLevels: s?.numberOfAcademicLevels || 4,
      attendanceRules: s?.attendanceRules || ATTEND_DEFAULTS,
      creditLimitPolicy: creditPolicy,
      levelProgression,
      graduationPolicy,
      semesterDurations,
      windowsPolicy,
      incompletePolicy,
      repetitionPolicy,
      honorsPolicy,
      suspensionPolicy,
      mobilityPolicy,
      advisorPolicy,
      creditHourDefinition,
      schedulePolicy,
      institutionConfig: s?.institutionConfig || INSTITUTION_DEFAULTS,
      holidays: Array.isArray(s?.holidays) ? s.holidays : [],
    });
  } catch (error) {
    res.json({
      currency: 'EGP',
      appName: 'UniFlow',
      language: 'en',
      timezone: 'Africa/Cairo',
      numberOfAcademicLevels: 4,
      attendanceRules: ATTEND_DEFAULTS,
      creditLimitPolicy: CREDIT_DEFAULTS,
      levelProgression: LEVEL_DEFAULTS,
      graduationPolicy: GRAD_DEFAULTS,
      semesterDurations: SEM_DEFAULTS,
      windowsPolicy: WINDOWS_DEFAULTS,
      incompletePolicy: INCOMPLETE_DEFAULTS,
      repetitionPolicy: REPETITION_DEFAULTS,
      honorsPolicy: HONORS_DEFAULTS,
      suspensionPolicy: SUSP_DEFAULTS,
      mobilityPolicy: MOBILITY_DEFAULTS,
      advisorPolicy: ADVISOR_DEFAULTS,
      creditHourDefinition: CHD_DEFAULTS,
      schedulePolicy: SCHED_DEFAULTS,
      institutionConfig: INSTITUTION_DEFAULTS,
      holidays: [],
    });
  }
});

// ── GET /api/public-settings/institution ─────────────────────────────────────

router.get('/api/public-settings/institution', async (req, res) => {
  try {
    const settings = await prisma.systemSettings.findFirst();
    const inst = settings?.institutionConfig || {};
    res.json({ institution: { ...INSTITUTION_DEFAULTS, ...inst } });
  } catch (error) {
    res.json({ institution: INSTITUTION_DEFAULTS });
  }
});

// ── GET /api/public-settings/holidays ────────────────────────────────────────

router.get('/api/public-settings/holidays', async (req, res) => {
  try {
    const settings = await prisma.systemSettings.findFirst();
    const holidays = Array.isArray(settings?.holidays) ? settings.holidays : [];
    res.json({ holidays });
  } catch (error) {
    res.json({ holidays: [] });
  }
});

module.exports = router;
