/**
 * user-profile / routes / auth.routes.js
 *
 * Mounted at: (no prefix — routes declare their full /api/auth/... paths)
 *
 * Endpoints:
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   POST /api/auth/refresh
 *   POST /api/auth/change-password
 *   POST /api/auth/forgot-password
 *   POST /api/auth/reset-password           (token-based)
 *   GET  /api/auth/verify
 *   POST /api/auth/send-verification
 *   POST /api/auth/verify-code
 *   POST /api/auth/resend-verification
 *   POST /api/auth/send-reset-code
 *   POST /api/auth/reset-with-code
 *   POST /api/auth/verify-code-by-email
 *   POST /api/auth/set-password
 *
 * Non-obvious decisions:
 *   - resetTokens and verificationCodes Maps are module-scoped here (not in
 *     index.js). In the full build they were also shared with the admin
 *     user-management routes; those routes are removed in the MVP build, so
 *     the Maps are now only used by the public auth flows in this file.
 *   - sessions Map (access-token quick-lookup) is also scoped here since it
 *     is only written/read in login and logout.
 *   - getPasswordStrength / generateVerificationCode / hashPassword helpers
 *     are also exported so sibling route files that need them don't duplicate.
 *   - The rate limiter (authLimiter) is passed in from index.js via the
 *     router's mount call. Actually it is simpler to import buildLimiter here
 *     directly and create it locally — that is the pattern used.
 */

'use strict';

const express  = require('express');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { z }    = require('zod');

const prisma             = require('../../../lib/prisma');
const { bootstrapPrisma } = require('../../../lib/prisma');
const { buildLimiter }   = require('../../../lib/rate-limit');
const { resolveActiveLock } = require('../../../lib/login-locks');
const log                = require('../../../lib/logger')('user-profile/auth');

const { authenticateToken, markPresent } = require('../lib/active-sessions');
const { sendEmail, buildEmail }          = require('../lib/email');

// MVP build: the theming engine (lib/brand-config) has been removed. The
// verification / reset emails used getBrandConfig to brand the wordmark; they
// already fall back to the inlined defaults inside buildEmail when brand is
// null, so this stub keeps the activation flow intact without the theming
// engine. Callers wrap this in `.catch(() => null)` and tolerate a null brand.
const getBrandConfig = async () => null;

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'uniflow-jwt-secret-key-2024';

// ── Rate limiter ───────────────────────────────────────────────────────────────

const authLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyPrefix: 'auth',
  message: { error: 'Too many requests, please try again later.' },
});

// ── Zod schemas ───────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email:    z.string().email('Invalid email format').max(255),
  password: z.string().min(1, 'Password required').max(128),
});

const changePasswordSchema = z.object({
  userId:          z.string().min(1, 'userId required'),
  currentPassword: z.string().min(1, 'currentPassword required').max(128),
  newPassword:     z.string().min(8, 'Password must be at least 8 characters').max(128),
});

// ── In-memory stores (module-scoped; imported by sibling routes that need them) ─

/** resetTokens: keyed by token (token-based flow) OR email.toLowerCase() (code flow) */
const resetTokens = new Map();

/** verificationCodes: keyed by userId */
const verificationCodes = new Map();

/** sessions: access-token → payload — for quick logout reference */
const sessions = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Hash a plaintext password with bcrypt (cost 10). */
const hashPassword = (password) => bcrypt.hashSync(password, 10);

/** Verify a plaintext password against a bcrypt hash. */
const verifyPassword = (plain, hashed) => {
  try { return bcrypt.compareSync(plain, hashed); } catch { return false; }
};

/** Generate a 6-digit OTP string. */
const generateVerificationCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

/**
 * Password strength scorer — mirrors frontend logic.
 * @returns {{ score: number, label: string, ok: boolean }}
 */
const getPasswordStrength = (password) => {
  if (!password) return { score: 0, label: 'Empty', ok: false };
  let score = 0;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  if (password.length >= 16) score++;
  const labels = ['Very Weak', 'Very Weak', 'Weak', 'Moderate', 'Strong', 'Very Strong'];
  return { score, label: labels[Math.min(score, 5)], ok: score >= 3 };
};

/** Generate a JWT access token (24h default, or ACCESS_TOKEN_EXPIRES_IN env var). */
const generateToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '24h' });

// ── Tenant resolver (for unauthenticated login/refresh) ───────────────────────

async function resolveTenantForRequest(req) {
  const headerCode  = req.headers['x-tenant-code'];
  const subdomain =
    req.hostname && req.hostname.includes('.') && !/^(localhost|\d+\.\d+\.\d+\.\d+)/i.test(req.hostname)
      ? req.hostname.split('.')[0]
      : null;
  const queryCode   = typeof req.query?.tenant === 'string' ? req.query.tenant : null;
  const defaultCode = (process.env.DEFAULT_TENANT_CODE || 'fcds').toLowerCase().trim();

  // Try each source in priority order. Subdomain is a guess (e.g. `uniflow`
  // from `uniflow.fly.dev` matches nothing real) so if a subdomain doesn't
  // resolve to a real tenant, fall through to the default instead of erroring.
  // Header / query are explicit — if they don't resolve, that's a real error.
  const ordered = [
    { src: 'header',    code: headerCode  ? String(headerCode).toLowerCase().trim()  : null, strict: true  },
    { src: 'subdomain', code: subdomain   ? String(subdomain).toLowerCase().trim()   : null, strict: false },
    { src: 'query',     code: queryCode   ? String(queryCode).toLowerCase().trim()   : null, strict: true  },
    { src: 'default',   code: defaultCode,                                                    strict: true  },
  ].filter((x) => x.code);

  for (const { code, strict } of ordered) {
    const tenant = await bootstrapPrisma.tenant.findUnique({ where: { code } });
    if (tenant) {
      if (!tenant.isActive) return { error: 'inactive_tenant', code, http: 403 };
      return { tenant };
    }
    // No match. If this source is strict, error out; otherwise try next source.
    if (strict) return { error: 'unknown_tenant', code, http: 404 };
  }
  return { error: 'unknown_tenant', code: defaultCode, http: 404 };
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/api/auth/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
  }
  const { email, password } = parsed.data;

  const tenantResult = await resolveTenantForRequest(req);
  if (tenantResult.error) {
    return res.status(tenantResult.http).json({
      error: tenantResult.error,
      message: tenantResult.error === 'unknown_tenant'
        ? `Unknown institution code "${tenantResult.code}".`
        : `Institution "${tenantResult.code}" is currently inactive.`,
    });
  }
  const tenant = tenantResult.tenant;

  try {
    const foundUser = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: email.toLowerCase() } },
      include: { academicProfile: { select: { level: true, department: true, program: true } } },
    });

    if (!foundUser)        return res.status(401).json({ error: 'Invalid credentials' });
    if (foundUser.deletedAt) return res.status(401).json({ error: 'Invalid credentials' });

    if (!verifyPassword(password, foundUser.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (foundUser.suspendedAt) {
      const reason = foundUser.suspendedReason
        ? `Your account is inactive: ${foundUser.suspendedReason}. Contact administration for more information.`
        : 'Your account is inactive. Contact administration for more information.';
      return res.status(403).json({
        error: 'account_inactive', message: reason, reason: foundUser.suspendedReason || null,
      });
    }

    if (!foundUser.emailVerified) {
      return res.status(403).json({
        error: 'account_not_activated',
        message: 'Your account has not been activated yet. Please check your email for the activation code.',
      });
    }

    try {
      const lock = await resolveActiveLock(prisma, foundUser);
      if (lock) {
        return res.status(403).json({
          error: 'sign_in_locked', message: lock.reason, reason: lock.reason,
          lockKind: lock.targetKind, isTimeWindow: lock.isTimeWindow, nextOpen: lock.nextOpen,
        });
      }
    } catch (lockErr) {
      log.error('[login] lock resolution failed:', lockErr.message);
    }

    const tokenPayload = {
      userId: foundUser.id, email: foundUser.email, role: foundUser.role, tenantId: foundUser.tenantId,
    };
    const sessionToken = generateToken(tokenPayload);

    sessions.set(sessionToken, {
      ...tokenPayload,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    // Single-session enforcement — revoke every active refresh token for
    // this user before issuing a new one. The previous browser tab's
    // access token keeps working until its 15-minute expiry; on its next
    // silent-refresh attempt the request 401s, the api.ts interceptor
    // clears local auth, and the tab is bounced to /login.
    // Owner directive: "do not allow multiple sign in sessions for the
    // same user". Revoke-old / allow-new is the chosen policy.
    await prisma.refreshToken.updateMany({
      where: { userId: foundUser.id, revoked: false },
      data: { revoked: true },
    }).catch((err) => log.warn('[login] previous-session revoke failed:', err.message));

    // Drop any in-process access-token bookkeeping for this user so the
    // /verify endpoint and active-sessions counters reflect the change
    // immediately (within this process; multi-instance deploys still
    // settle on the 15-min access-token expiry boundary).
    for (const [otherToken, sess] of sessions.entries()) {
      if (sess?.userId === foundUser.id) sessions.delete(otherToken);
    }

    // Owner directive: a new login from any browser kicks any previous
    // session. We revoke ALL prior RefreshTokens for this user so the
    // old browser's silent-refresh interceptor (apiFetch in
    // frontend/src/utils/api.ts) fails on the next 401 and force-logouts
    // there. The cross-tab `storage` listener in AppContext handles the
    // same-browser-different-tab case; this revoke handles the
    // different-browser / different-machine case the storage listener
    // can't see.
    await prisma.refreshToken.updateMany({
      where: { userId: foundUser.id, revoked: false },
      data: { revoked: true },
    }).catch((err) => log.warn('[login] revoke prior sessions failed:', err.message));

    // Drop anything truly expired so the refresh_tokens table doesn't
    // grow unbounded.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.refreshToken.deleteMany({
      where: {
        userId: foundUser.id,
        OR: [{ expiresAt: { lt: new Date() } }, { revoked: true, createdAt: { lt: oneDayAgo } }],
      },
    }).catch((err) => log.warn('[login] refresh-token cleanup failed:', err.message));

    const refreshToken = crypto.randomBytes(64).toString('hex');
    await prisma.refreshToken.create({
      data: {
        tenantId: foundUser.tenantId, userId: foundUser.id, token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.user.update({ where: { id: foundUser.id }, data: { lastLogin: new Date() } });

    const { password: _pw, ...safeUser } = foundUser;

    res.cookie('token', sessionToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', maxAge: 15 * 60 * 1000,
    });

    // Owner directive: instant cross-browser kick. Fire-and-forget HTTP
    // call to the notification server so any older browser's
    // notification socket receives a `session:revoked` event and
    // disconnects immediately, instead of waiting up to 15 min for the
    // access-token expiry + failed refresh round-trip. minIat = the
    // brand-new JWT's iat (in seconds since epoch); the notification
    // server only kicks sockets whose own JWT iat is strictly less,
    // protecting this new login's about-to-connect socket from being
    // self-revoked.
    setImmediate(async () => {
      try {
        const decoded = require('jsonwebtoken').decode(sessionToken);
        const minIat = decoded?.iat;
        if (!minIat) return;
        const notifUrl = process.env.NOTIFICATION_URL || 'http://localhost:4009';
        await fetch(`${notifUrl}/api/notifications/kick-stale`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ minIat }),
        }).catch(() => {});
      } catch (err) {
        log.warn('[login] cross-browser kick fan-out failed:', err.message);
      }
    });

    res.json({ success: true, message: 'Login successful', token: sessionToken, refreshToken, user: safeUser });
  } catch (error) {
    log.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/api/auth/logout', async (req, res) => {
  const { token, refreshToken } = req.body;

  if (token && sessions.has(token)) sessions.delete(token);

  if (refreshToken) {
    try {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken, revoked: false },
        data: { revoked: true },
      });
    } catch (err) {
      log.warn('[logout] failed to revoke refresh token:', err.message);
    }
  }

  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────

router.post('/api/auth/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  try {
    const record = await prisma.refreshToken.findFirst({ where: { token: refreshToken } });
    if (!record) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    // Distinguish revoked vs. naturally expired so the client can show
    // a "signed in elsewhere" overlay instead of a generic "session expired"
    // message. revoked=true is only ever set by (a) the user logging out
    // explicitly, (b) the login handler kicking prior sessions on a new
    // login, or (c) the refresh handler rotating to a new token — so any
    // 401 with reason=session_revoked on a token the client still holds
    // is almost always case (b).
    if (record.revoked) {
      return res.status(401).json({ error: 'session_revoked', reason: 'signed_in_elsewhere' });
    }
    if (record.expiresAt <= new Date()) {
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    await prisma.refreshToken.update({ where: { id: record.id }, data: { revoked: true } });

    const newRefreshToken = crypto.randomBytes(64).toString('hex');
    await prisma.refreshToken.create({
      data: {
        tenantId: record.tenantId, userId: record.userId, token: newRefreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const user = await prisma.user.findFirst({ where: { id: record.userId } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const newAccessToken = generateToken({
      userId: user.id, email: user.email, role: user.role, tenantId: user.tenantId,
    });

    res.cookie('token', newAccessToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', maxAge: 15 * 60 * 1000,
    });

    res.json({ success: true, token: newAccessToken, refreshToken: newRefreshToken });
  } catch (error) {
    log.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// ── POST /api/auth/change-password ────────────────────────────────────────────

router.post('/api/auth/change-password', async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
  }
  const { userId, currentPassword, newPassword } = parsed.data;

  try {
    let user = await prisma.user.findFirst({ where: { email: userId } }).catch(() => null);
    if (!user) user = await prisma.user.findFirst({ where: { id: userId } }).catch(() => null);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!verifyPassword(currentPassword, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const strength = getPasswordStrength(newPassword);
    if (!strength.ok) {
      return res.status(400).json({
        error: 'Password is too weak. Please include uppercase, numbers, and symbols.',
        detail: `Current strength: ${strength.label} (score ${strength.score}/5). Need at least Moderate (3/5).`,
      });
    }

    await prisma.user.update({ where: { id: user.id }, data: { password: hashPassword(newPassword) } });
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    log.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────

router.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const foundUser = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });

    if (!foundUser) {
      return res.json({ success: true, message: 'If an account exists with this email, a reset link has been sent.' });
    }

    const resetToken = generateToken({ userId: foundUser.id, email: foundUser.email, purpose: 'reset' });
    resetTokens.set(resetToken, {
      userId: foundUser.id, email: foundUser.email,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    if (process.env.NODE_ENV === 'development') {
      log.warn(`[dev] Password reset token for ${email}: ${resetToken}`);
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a reset link has been sent.',
      ...(process.env.NODE_ENV === 'development' && { devToken: resetToken }),
    });
  } catch (error) {
    log.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────────

router.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password required' });
  }

  const resetData = resetTokens.get(token);
  if (!resetData) return res.status(400).json({ error: 'Invalid or expired reset token' });

  if (new Date(resetData.expiresAt) < new Date()) {
    resetTokens.delete(token);
    return res.status(400).json({ error: 'Reset token has expired' });
  }

  const pwStrength = getPasswordStrength(newPassword);
  if (!pwStrength.ok) {
    return res.status(400).json({
      error: 'Password is too weak. Please include uppercase, numbers, and symbols.',
      detail: `Current strength: ${pwStrength.label} (score ${pwStrength.score}/5). Need at least Moderate (3/5).`,
    });
  }

  try {
    await prisma.user.update({ where: { id: resetData.userId }, data: { password: hashPassword(newPassword) } });
    resetTokens.delete(token);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    log.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ── GET /api/auth/verify ──────────────────────────────────────────────────────

router.get('/api/auth/verify', async (req, res) => {
  const cookieToken  = req.cookies?.token;
  const headerToken  = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.replace('Bearer ', '') : null;
  const token = cookieToken || headerToken;

  if (!token) return res.status(401).json({ valid: false, error: 'No token provided' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ valid: false, error: 'User not found' });

    markPresent(user.id);

    const { password: _pw, ...safeUser } = user;
    res.json({ valid: true, user: safeUser });
  } catch (error) {
    log.error('Session verify error:', error);
    res.status(500).json({ valid: false, error: 'Server error' });
  }
});

// ── POST /api/auth/send-verification ─────────────────────────────────────────

router.post('/api/auth/send-verification', async (req, res) => {
  const { userId, email } = req.body;
  if (!userId && !email) return res.status(400).json({ error: 'userId or email required' });

  let profile = null;
  try {
    if (userId) {
      profile = await prisma.user.findFirst({ where: { id: userId } }).catch(() => null);
      if (!profile) profile = await prisma.user.findFirst({ where: { email: userId } }).catch(() => null);
    } else {
      profile = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    }
  } catch {
    return res.status(500).json({ error: 'Database error' });
  }

  if (!profile) return res.status(404).json({ error: 'User not found' });

  const code      = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  verificationCodes.set(profile.id, { code, email: profile.email, createdAt: new Date().toISOString(), expiresAt, attempts: 0 });

  // Load admin-configured brand once per send so the email matches the
  // live tenant's brand. Errors fall back to the bundled defaults inside
  // buildEmail itself, so a missing/corrupt brand_config never breaks
  // the activation flow.
  const brand = await getBrandConfig(prisma).catch(() => null);

  const emailHtml = buildEmail({
    firstName: profile.firstName,
    heading: 'Verify Your Email',
    subtitle: `Complete your ${(brand && brand.productName) || 'UniFlow'} account activation`,
    code, codeLabel: 'Verification Code',
    expiryText: 'This code expires in 10 minutes',
    ctaText: `We're excited to have you on board. Enter the verification code below in the ${(brand && brand.productName) || 'UniFlow'} portal to activate your account and get started.`,
    footerNote: 'If you didn\'t create an account, you can safely ignore this email. No action will be taken on your account.',
    brand,
  });

  const productName = (brand && brand.productName) || 'UniFlow';
  const emailResult = await sendEmail(profile.email, `${productName} — Verify Your Email Address`, emailHtml);

  if (emailResult.success) {
    res.json({
      success: true, message: 'Verification code sent to your email', expiresAt,
      ...(emailResult.mock && { devCode: code }),
    });
  } else {
    res.status(500).json({ success: false, message: 'Failed to send verification email', error: emailResult.error });
  }
});

// ── POST /api/auth/verify-code ────────────────────────────────────────────────

router.post('/api/auth/verify-code', async (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) return res.status(400).json({ error: 'userId and code required' });

  const verification = verificationCodes.get(userId);
  if (!verification) return res.status(400).json({ error: 'No verification code found. Please request a new one.' });

  if (new Date(verification.expiresAt) < new Date()) {
    verificationCodes.delete(userId);
    return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
  }

  if (verification.attempts >= 5) {
    verificationCodes.delete(userId);
    return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });
  }

  if (verification.code !== code) {
    verification.attempts++;
    verificationCodes.set(userId, verification);
    return res.status(400).json({ error: 'Invalid code', attemptsRemaining: 5 - verification.attempts });
  }

  try {
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true, activated: true, suspendedReason: null } });
  } catch {
    log.warn(`verify-code: could not update DB for userId=${userId}`);
  }

  verificationCodes.delete(userId);
  res.json({ success: true, message: 'Email verified successfully', activated: true });
});

// ── POST /api/auth/resend-verification ───────────────────────────────────────

router.post('/api/auth/resend-verification', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  let profile = null;
  try {
    profile = await prisma.user.findFirst({ where: { id: userId } }).catch(() => null);
    if (!profile) profile = await prisma.user.findFirst({ where: { email: userId } }).catch(() => null);
  } catch { /* ignore */ }

  if (!profile)           return res.status(404).json({ error: 'User not found' });
  if (profile.emailVerified) return res.status(400).json({ error: 'Email already verified' });

  const existing = verificationCodes.get(profile.id);
  if (existing) {
    const timeSinceCreated = Date.now() - new Date(existing.createdAt).getTime();
    if (timeSinceCreated < 60000) {
      const waitTime = Math.ceil((60000 - timeSinceCreated) / 1000);
      return res.status(429).json({ error: `Please wait ${waitTime} seconds before requesting a new code` });
    }
  }

  const code      = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  verificationCodes.set(profile.id, { code, email: profile.email, createdAt: new Date().toISOString(), expiresAt, attempts: 0 });

  const brand2 = await getBrandConfig(prisma).catch(() => null);
  const productName2 = (brand2 && brand2.productName) || 'UniFlow';
  const emailHtml = buildEmail({
    firstName: profile.firstName,
    heading: 'New Verification Code', subtitle: 'Here\'s your freshly generated code',
    code, codeLabel: 'Verification Code',
    expiryText: 'This code expires in 10 minutes',
    ctaText: `You requested a new verification code for your ${productName2} account. Enter it in the portal to continue your activation.`,
    footerNote: 'If you didn\'t request a new code, your previous code has been invalidated. Please contact support if you\'re concerned about unauthorized access.',
    brand: brand2,
  });

  const emailResult = await sendEmail(profile.email, `${productName2} — Your New Verification Code`, emailHtml);

  if (emailResult.success) {
    res.json({ success: true, message: 'New verification code sent', expiresAt, ...(emailResult.mock && { devCode: code }) });
  } else {
    res.status(500).json({ success: false, message: 'Failed to send verification email' });
  }
});

// ── POST /api/auth/send-reset-code ────────────────────────────────────────────

router.post('/api/auth/send-reset-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  let profile = null;
  try {
    profile = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
  } catch { /* ignore */ }

  if (!profile) {
    return res.json({ success: true, message: 'If an account exists with this email, a reset code has been sent.' });
  }

  const code      = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  resetTokens.set(email.toLowerCase(), {
    code, userId: profile.id, createdAt: new Date().toISOString(), expiresAt, attempts: 0,
  });

  const brand3 = await getBrandConfig(prisma).catch(() => null);
  const productName3 = (brand3 && brand3.productName) || 'UniFlow';
  const emailHtml = buildEmail({
    firstName: profile.firstName,
    heading: 'Reset Your Password', subtitle: 'A password reset was requested for your account',
    code, codeLabel: 'Reset Code',
    expiryText: 'This code expires in 15 minutes',
    ctaText: `We received a request to reset the password for your ${productName3} account. Enter the code below along with your new password to regain access.`,
    footerNote: 'If you didn\'t request a password reset, your account is still secure — no changes have been made. You can safely ignore this email.',
    brand: brand3,
  });

  const emailResult = await sendEmail(email, `${productName3} — Password Reset Code`, emailHtml);

  res.json({
    success: true,
    message: 'If an account exists with this email, a reset code has been sent.',
    ...(emailResult.mock && { devCode: code }),
  });
});

// ── POST /api/auth/reset-with-code ────────────────────────────────────────────

router.post('/api/auth/reset-with-code', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code, and new password required' });
  }

  const emailLower = email.toLowerCase();
  const resetData  = resetTokens.get(emailLower);
  if (!resetData) return res.status(400).json({ error: 'Invalid or expired reset code' });

  if (new Date(resetData.expiresAt) < new Date()) {
    resetTokens.delete(emailLower);
    return res.status(400).json({ error: 'Reset code expired. Please request a new one.' });
  }

  if (resetData.attempts >= 5) {
    resetTokens.delete(emailLower);
    return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });
  }

  if (resetData.code !== code) {
    resetData.attempts++;
    resetTokens.set(emailLower, resetData);
    return res.status(400).json({ error: 'Invalid code', attemptsRemaining: 5 - resetData.attempts });
  }

  const strength = getPasswordStrength(newPassword);
  if (!strength.ok) {
    return res.status(400).json({
      error: 'Password is too weak. Please include uppercase, numbers, and symbols.',
      detail: `Current strength: ${strength.label} (score ${strength.score}/5). Need at least Moderate (3/5).`,
    });
  }

  try {
    await prisma.user.update({ where: { id: resetData.userId }, data: { password: hashPassword(newPassword) } });
    resetTokens.delete(emailLower);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    log.error('reset-with-code DB update error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// ── POST /api/auth/verify-code-by-email ──────────────────────────────────────

router.post('/api/auth/verify-code-by-email', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

  let profile = null;
  try {
    profile = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
  } catch { /* ignore */ }

  if (!profile) return res.status(404).json({ error: 'User not found' });

  const foundUserId = profile.id;

  let verification = null;
  verificationCodes.forEach((v) => {
    if (v.email.toLowerCase() === email.toLowerCase()) verification = v;
  });

  if (!verification) return res.status(400).json({ error: 'No verification code found. Please request a new one.' });

  if (new Date(verification.expiresAt) < new Date()) {
    verificationCodes.delete(foundUserId);
    return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
  }

  if (verification.attempts >= 5) {
    verificationCodes.delete(foundUserId);
    return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });
  }

  if (verification.code !== code) {
    verification.attempts++;
    return res.status(400).json({ error: 'Invalid code', attemptsRemaining: 5 - verification.attempts });
  }

  try {
    await prisma.user.update({ where: { id: foundUserId }, data: { emailVerified: true, suspendedReason: null } });
  } catch {
    log.warn(`verify-code-by-email: DB update failed for ${email}`);
  }

  verificationCodes.delete(foundUserId);
  res.json({ success: true, message: 'Email verified successfully', userId: foundUserId });
});

// ── POST /api/auth/set-password ───────────────────────────────────────────────

router.post('/api/auth/set-password', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const strength = getPasswordStrength(password);
  if (!strength.ok) {
    return res.status(400).json({
      error: 'Password is too weak. Please include uppercase, numbers, and symbols.',
      detail: `Current strength: ${strength.label} (score ${strength.score}/5). Need at least Moderate (3/5).`,
    });
  }

  try {
    const profile = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    if (!profile) return res.status(404).json({ error: 'User not found' });

    if (!profile.emailVerified) return res.status(400).json({ error: 'Please verify your email first' });

    if (profile.activated && profile.password) {
      return res.status(400).json({ error: 'Account already activated. Use forgot password to reset.' });
    }

    await prisma.user.update({
      where: { id: profile.id },
      data: { password: hashPassword(password), activated: true, suspendedReason: null },
    });

    res.json({ success: true, message: 'Account activated successfully' });
  } catch (error) {
    log.error('set-password error:', error);
    res.status(500).json({ error: 'Failed to activate account' });
  }
});

module.exports = router;
module.exports.resetTokens         = resetTokens;
module.exports.verificationCodes   = verificationCodes;
module.exports.sessions            = sessions;
module.exports.hashPassword        = hashPassword;
module.exports.verifyPassword      = verifyPassword;
module.exports.generateVerificationCode = generateVerificationCode;
module.exports.getPasswordStrength = getPasswordStrength;
module.exports.generateToken       = generateToken;
module.exports.authLimiter         = authLimiter;
