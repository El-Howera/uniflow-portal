/**
 * user-profile / routes / settings.routes.js
 *
 * Mounted at: (no prefix — routes declare their full /api/... paths)
 *
 * Endpoints:
 *   GET   /api/settings/:userId
 *   PATCH /api/settings/:userId
 *
 * Non-obvious decisions:
 *   - Both endpoints are deliberately unauthenticated (no authenticateToken)
 *     matching the original. The userId param is either a UUID or an email
 *     string resolved via resolveUser.
 *   - The in-memory Map (userSettings) provides a fallback when the DB
 *     UserSettings table is unavailable. This is carried over from the
 *     original for backward compatibility.
 *   - formatSettings and flattenSettings are kept private to this file since
 *     no other route file needs them.
 */

'use strict';

const express = require('express');
const prisma  = require('../../../lib/prisma');
const { resolveUser } = require('../../../lib/users');

const router = express.Router();

// In-memory fallback (DB-primary; this catches DB errors only)
const userSettings = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatSettings = (row) => ({
  userId: row.userId,
  appearance: { theme: row.theme, fontSize: row.fontSize, compactMode: row.compactMode },
  notifications: {
    email: row.notifEmail, push: row.notifPush, sms: row.notifSms,
    announcements: row.notifAnnouncements, grades: row.notifGrades,
    assignments: row.notifAssignments, messages: row.notifMessages, reminders: row.notifReminders,
  },
  privacy: {
    showEmail: row.showEmail, showPhone: row.showPhone,
    showProfile: row.showProfile, allowMessages: row.allowMessages,
  },
  language: row.language,
  timezone: row.timezone,
});

const flattenSettings = (updates) => {
  const flat = {};
  if (updates.appearance) {
    const a = updates.appearance;
    if (a.theme !== undefined)       flat.theme = a.theme;
    if (a.fontSize !== undefined)    flat.fontSize = a.fontSize;
    if (a.compactMode !== undefined) flat.compactMode = a.compactMode;
  }
  if (updates.notifications) {
    const n = updates.notifications;
    if (n.email !== undefined)         flat.notifEmail = n.email;
    if (n.push !== undefined)          flat.notifPush = n.push;
    if (n.sms !== undefined)           flat.notifSms = n.sms;
    if (n.announcements !== undefined) flat.notifAnnouncements = n.announcements;
    if (n.grades !== undefined)        flat.notifGrades = n.grades;
    if (n.assignments !== undefined)   flat.notifAssignments = n.assignments;
    if (n.messages !== undefined)      flat.notifMessages = n.messages;
    if (n.reminders !== undefined)     flat.notifReminders = n.reminders;
  }
  if (updates.privacy) {
    const p = updates.privacy;
    if (p.showEmail !== undefined)    flat.showEmail = p.showEmail;
    if (p.showPhone !== undefined)    flat.showPhone = p.showPhone;
    if (p.showProfile !== undefined)  flat.showProfile = p.showProfile;
    if (p.allowMessages !== undefined) flat.allowMessages = p.allowMessages;
  }
  if (updates.language !== undefined) flat.language = updates.language;
  if (updates.timezone !== undefined) flat.timezone = updates.timezone;
  return flat;
};

// ── GET /api/settings/:userId ─────────────────────────────────────────────────

router.get('/api/settings/:userId', async (req, res) => {
  const resolved = await resolveUser(req.params.userId);
  const userId   = resolved ? resolved.id : req.params.userId;

  try {
    const row = await prisma.userSettings.upsert({
      where: { userId }, update: {}, create: { userId },
    });
    return res.json(formatSettings(row));
  } catch (err) {
    console.warn('[settings GET] DB error, falling back to in-memory:', err.message);
    let settings = userSettings.get(userId);
    if (!settings) {
      settings = {
        userId,
        appearance: { theme: 'system', fontSize: 16, compactMode: false },
        notifications: { email: true, push: true, sms: false, announcements: true, grades: true, assignments: true, messages: true, reminders: true },
        privacy: { showEmail: false, showPhone: false, showProfile: true, allowMessages: true },
        language: 'en',
        timezone: 'Africa/Cairo',
      };
      userSettings.set(userId, settings);
    }
    return res.json(settings);
  }
});

// ── PATCH /api/settings/:userId ───────────────────────────────────────────────

router.patch('/api/settings/:userId', async (req, res) => {
  const resolved   = await resolveUser(req.params.userId);
  const userId     = resolved ? resolved.id : req.params.userId;
  const updates    = req.body;
  const flatFields = flattenSettings(updates);

  try {
    const row = await prisma.userSettings.upsert({
      where: { userId }, update: flatFields, create: { userId, ...flatFields },
    });
    return res.json({ success: true, message: 'Settings updated successfully', settings: formatSettings(row) });
  } catch (err) {
    console.warn('[settings PATCH] DB error, falling back to in-memory:', err.message);
    let settings = userSettings.get(userId) || { userId };
    const deepMerge = (target, source) => {
      for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          target[key] = target[key] || {};
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
      return target;
    };
    deepMerge(settings, updates);
    userSettings.set(userId, settings);
    return res.json({ success: true, message: 'Settings updated successfully', settings });
  }
});

module.exports = router;
