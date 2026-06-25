/**
 * user-profile / lib / email.js
 *
 * Owns all outbound email concerns for the user-profile service:
 *   - Nodemailer transporter (lazy-initialised from SMTP_* env vars)
 *   - sendEmail(to, subject, html) helper
 *   - buildEmail({ … })         — 2FA-style code email (light/dark aware)
 *   - buildWelcomeEmail({ … })  — new-account onboarding email
 *   - EMAIL_LOGO_BUFFER — graduation-cap PNG read once at module load
 *
 * Templates honour the recipient's prefers-color-scheme: light is the
 * default (so legacy clients without media-query support render the safe
 * bright variant), and a @media (prefers-color-scheme: dark) override
 * flips iOS Mail / Apple Mail / modern Gmail apps to dark. Brand colours
 * and the wordmark come from getBrandConfig(prisma) — both helpers accept
 * an optional `brand` argument so the email reflects the institution's
 * live brand settings on every send.
 */

'use strict';

const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

// MVP build: the theming engine (lib/brand-config) has been removed. The
// email templates still need a brand block for their wordmark + palette, so a
// minimal static default is inlined here. Only the fields these templates read
// are kept (productName + light/dark { brandPrimary, brandSecondary,
// brandAccent, logoSegments }).
const DEFAULT_BRAND = Object.freeze({
  productName: 'UniFlow',
  light: Object.freeze({
    brandPrimary: '#6A3FF4',
    brandSecondary: '#A855F7',
    brandAccent: '#5A2AD4',
    logoSegments: null,
  }),
  dark: Object.freeze({
    brandPrimary: '#6A3FF4',
    brandSecondary: '#A855F7',
    brandAccent: '#7B5AFF',
    logoSegments: null,
  }),
});

// ── SMTP configuration ────────────────────────────────────────────────────────

const EMAIL_CONFIG = {
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'UniFlow Portal';

const isEmailConfigured =
  EMAIL_CONFIG.auth.user &&
  EMAIL_CONFIG.auth.pass &&
  EMAIL_CONFIG.auth.user !== 'your-email@gmail.com';

let transporter = null;
if (isEmailConfigured) {
  try {
    transporter = nodemailer.createTransport(EMAIL_CONFIG);
    if (process.env.NODE_ENV === 'development') {
      console.log(`[user-profile] email configured: ${EMAIL_CONFIG.auth.user}`);
    }
  } catch (error) {
    console.warn('[user-profile] email transporter error:', error.message);
  }
} else {
  if (process.env.NODE_ENV === 'development') {
    console.log('[user-profile] email not configured - using mock mode (set SMTP_USER and SMTP_PASS to enable)');
  }
}

// ── Logo asset ────────────────────────────────────────────────────────────────

const EMAIL_LOGO_PATH = path.join(__dirname, '..', 'public', 'email-logo.png');
let EMAIL_LOGO_BUFFER = null;
try {
  EMAIL_LOGO_BUFFER = fs.readFileSync(EMAIL_LOGO_PATH);
} catch (_e) {
  // Logo missing — emails will show alt text. Not a fatal error.
}

// ── sendEmail ─────────────────────────────────────────────────────────────────

/**
 * sendEmail(to, subject, html)
 *
 * Sends an HTML email. In mock mode (no SMTP credentials) just logs the
 * recipient + subject (never the body — it may contain reset tokens/PII).
 *
 * @returns {{ success: boolean, messageId?: string, mock?: boolean, error?: string }}
 */
const sendEmail = async (to, subject, html) => {
  if (!transporter || !isEmailConfigured) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[MOCK EMAIL] To: ${to} Subject: ${subject}`);
    }
    return { success: true, mock: true };
  }

  const attachments = [];
  if (EMAIL_LOGO_BUFFER) {
    attachments.push({
      filename:    'uniflow-logo.png',
      content:     EMAIL_LOGO_BUFFER,
      contentType: 'image/png',
      cid:         'uniflow-logo',
    });
  }

  try {
    const info = await transporter.sendMail({
      from:        `"${SMTP_FROM_NAME}" <${EMAIL_CONFIG.auth.user}>`,
      to,
      subject,
      html,
      attachments,
    });
    if (process.env.NODE_ENV === 'development') {
      console.log(`[user-profile] email sent to ${to}: ${info.messageId}`);
    }
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email error:', error.message);
    return { success: false, error: error.message };
  }
};

// ── Brand helpers (used by both buildEmail and buildWelcomeEmail) ─────────────

/**
 * Normalise the brand parameter. Falls back to DEFAULT_BRAND so callers that
 * forget to pass `brand` still get a working email. Both light + dark themes
 * are always returned.
 */
function resolveBrand(brand) {
  if (brand && brand.productName && brand.light && brand.dark) return brand;
  return DEFAULT_BRAND;
}

/**
 * Render the wordmark inside the email header (e.g. "UniFlow" or whatever
 * the admin set in productName). Uses logoSegments to split the word into
 * coloured pieces — mirrors the in-app Logo component. The segments accept
 * EITHER a literal hex (`#7B5AFF`) OR a token reference
 * (`brandPrimary`/`brandSecondary`/`brandAccent`) resolved against the theme
 * block. When no segments are configured we fall back to a 50/50 split
 * (brand primary then ink) which matches the default UI wordmark.
 *
 * Returns two HTML strings — one for light, one for dark — so the @media
 * dark-mode rule can swap them.
 */
function renderWordmark(brand, theme /* 'light' | 'dark' */) {
  const productName = brand.productName || 'UniFlow';
  const block = brand[theme] || brand.dark;
  const ink = theme === 'light' ? '#1A1530' : '#FFFFFF';

  const resolveColor = (token) => {
    if (!token) return null;
    if (token.startsWith('#')) return token;
    if (token === 'brandPrimary') return block.brandPrimary || ink;
    if (token === 'brandSecondary') return block.brandSecondary || ink;
    if (token === 'brandAccent') return block.brandAccent || ink;
    return token;
  };

  const segments = Array.isArray(block.logoSegments) && block.logoSegments.length > 0
    ? block.logoSegments
    : null;

  let html = '';
  if (segments) {
    for (const seg of segments) {
      const text = String(seg.text ?? '').trim();
      if (!text) continue;
      const color = resolveColor(seg.color) || block.brandPrimary || ink;
      html += `<span style="color:${color};">${escapeHtml(text)}</span>`;
    }
  } else {
    // Default split: first half brand-primary, second half ink.
    const mid = Math.ceil(productName.length / 2);
    html += `<span style="color:${block.brandPrimary || ink};">${escapeHtml(productName.slice(0, mid))}</span>`;
    html += `<span style="color:${ink};">${escapeHtml(productName.slice(mid))}</span>`;
  }
  return html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Inline SVG icon helpers. Emojis were dropped in favour of clean SVG
 * marks so the emails stay professional in mixed-language clients (some
 * email clients render emoji at native font sizes that clash with the
 * surrounding 13px text). The SVG is 16x16 with currentColor strokes so
 * the icon picks up the parent `.uf-detail-text` colour automatically —
 * meaning the icon flips with the light/dark @media swap for free.
 * Outlook desktop strips inline SVG; in that client the icon space
 * collapses to a tiny gap, leaving the text intact and readable.
 *
 * `iconWrap` returns a 24x24 square cell with the icon centred so every
 * row in a detail block aligns to the same baseline.
 */
function iconWrap(svgPaths) {
  return `<span style="display:inline-block;width:16px;height:16px;vertical-align:middle;line-height:1;margin-right:8px;color:inherit;">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">
      ${svgPaths}
    </svg>
  </span>`;
}
const ICONS = {
  clock: iconWrap(`
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.25" />
    <path d="M8 4.5V8L10.25 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
  `),
  shield: iconWrap(`
    <path d="M8 1.75L3 3.5V8C3 11 5 13.25 8 14.25C11 13.25 13 11 13 8V3.5L8 1.75Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" />
    <path d="M6 8.25L7.5 9.75L10.5 6.75" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
  `),
  envelope: iconWrap(`
    <rect x="2" y="3.5" width="12" height="9" rx="1.25" stroke="currentColor" stroke-width="1.25" />
    <path d="M2.5 4.5L8 9L13.5 4.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
  `),
  lifebuoy: iconWrap(`
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.25" />
    <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.25" />
    <path d="M3.8 3.8L6.25 6.25M9.75 9.75L12.2 12.2M3.8 12.2L6.25 9.75M9.75 6.25L12.2 3.8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
  `),
  arrowRight: iconWrap(`
    <path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  `),
};

/**
 * Build the universal email shell. Accepts the inner content as a raw HTML
 * string and the brand block; the rest (header, container, gradient bar,
 * footer, light/dark @media query) is identical between welcome and 2FA
 * emails, so we factor it out here.
 */
function renderShell({ brand, title, preheader, innerHtml }) {
  const b = resolveBrand(brand);
  const lightPrimary = b.light.brandPrimary || '#5A2AD4';
  const lightAccent  = b.light.brandAccent  || lightPrimary;
  const lightSecondary = b.light.brandSecondary || '#A855F7';
  const darkPrimary  = b.dark.brandPrimary  || '#6A3FF4';
  const darkAccent   = b.dark.brandAccent   || darkPrimary;
  const darkSecondary = b.dark.brandSecondary || '#A855F7';
  const lightWordmark = renderWordmark(b, 'light');
  const darkWordmark  = renderWordmark(b, 'dark');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(title)}</title>
  <style>
    /* ------------------------------------------------------------------
       Light mode is the default — most legacy email clients ignore the
       prefers-color-scheme media query, and a bright variant is the
       safer baseline. Clients that DO support the query (Apple Mail,
       iOS Mail, modern Gmail apps, Outlook 2019+ on macOS) flip to dark
       via the override block below.
       ------------------------------------------------------------------ */
    body { margin:0; padding:0; background:#F4F0FF; }
    .uf-canvas { background:#F4F0FF; }
    .uf-card { background:#FFFFFF; border:1px solid rgba(26,21,48,0.08); }
    .uf-heading { color:#1A1530; }
    .uf-subtitle { color:rgba(26,21,48,0.55); }
    .uf-greeting { color:rgba(26,21,48,0.7); }
    .uf-greeting strong { color:#1A1530; }
    .uf-body { color:rgba(26,21,48,0.65); }
    .uf-feature-bg { background:rgba(${hexToRgb(lightPrimary)},0.06); border:1px solid rgba(${hexToRgb(lightPrimary)},0.18); }
    .uf-feature-label { color:rgba(26,21,48,0.45); }
    .uf-feature-value { color:${lightPrimary}; }
    .uf-detail-bg { background:rgba(26,21,48,0.035); }
    .uf-detail-text { color:rgba(26,21,48,0.55); }
    .uf-footer-note { color:rgba(26,21,48,0.4); }
    .uf-branding { color:rgba(26,21,48,0.4); }
    .uf-branding-soft { color:rgba(26,21,48,0.28); }
    .uf-branding-rule { background:rgba(26,21,48,0.1); }
    .uf-cta { background:${lightPrimary}; color:#FFFFFF !important; }
    .uf-wordmark-light { display:inline; }
    .uf-wordmark-dark { display:none; }

    @media (prefers-color-scheme: dark) {
      body { background:#0A0710 !important; }
      .uf-canvas { background:#0A0710 !important; }
      .uf-card { background:#141118 !important; border:1px solid rgba(255,255,255,0.08) !important; }
      .uf-heading { color:#FFFFFF !important; }
      .uf-subtitle { color:rgba(255,255,255,0.5) !important; }
      .uf-greeting { color:rgba(255,255,255,0.72) !important; }
      .uf-greeting strong { color:#FFFFFF !important; }
      .uf-body { color:rgba(255,255,255,0.6) !important; }
      .uf-feature-bg { background:rgba(${hexToRgb(darkPrimary)},0.1) !important; border:1px solid rgba(${hexToRgb(darkPrimary)},0.25) !important; }
      .uf-feature-label { color:rgba(255,255,255,0.4) !important; }
      .uf-feature-value { color:${darkPrimary} !important; }
      .uf-detail-bg { background:rgba(255,255,255,0.04) !important; }
      .uf-detail-text { color:rgba(255,255,255,0.5) !important; }
      .uf-footer-note { color:rgba(255,255,255,0.32) !important; }
      .uf-branding { color:rgba(255,255,255,0.32) !important; }
      .uf-branding-soft { color:rgba(255,255,255,0.16) !important; }
      .uf-branding-rule { background:rgba(255,255,255,0.08) !important; }
      .uf-cta { background:${darkPrimary} !important; }
      .uf-wordmark-light { display:none !important; }
      .uf-wordmark-dark { display:inline !important; }
    }
  </style>
</head>
<body class="uf-canvas" style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none;font-size:1px;color:transparent;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${escapeHtml(preheader || '')}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="uf-canvas" style="min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;width:100%;">

          <!-- Logo + wordmark -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;width:52px;height:52px;">
                    <img src="cid:uniflow-logo" width="52" height="52" alt="${escapeHtml(b.productName)}" style="display:block;border:0;" />
                  </td>
                  <td style="padding-left:14px;font-size:28px;font-weight:700;letter-spacing:-0.5px;vertical-align:middle;">
                    <span class="uf-wordmark-light">${lightWordmark}</span>
                    <span class="uf-wordmark-dark">${darkWordmark}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td class="uf-card" style="border-radius:24px;overflow:hidden;">
              <!-- Gradient accent bar -->
              <div style="height:3px;background:linear-gradient(90deg,${darkPrimary},${darkSecondary},${darkAccent});"></div>
              ${innerHtml}
            </td>
          </tr>

          <!-- Bottom branding -->
          <tr>
            <td style="padding:32px 0 0 0;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <div class="uf-branding-rule" style="width:40px;height:1px;margin:0 auto 20px auto;"></div>
                    <p class="uf-branding" style="margin:0;font-size:12px;line-height:1.5;">
                      Faculty of Computers &amp; Data Science
                    </p>
                    <p class="uf-branding" style="margin:4px 0 0 0;font-size:12px;line-height:1.5;">
                      Alexandria University &bull; Egypt
                    </p>
                    <p class="uf-branding-soft" style="margin:16px 0 0 0;font-size:11px;line-height:1.5;">
                      This is an automated message from the ${escapeHtml(b.productName)} Portal.<br>
                      &copy; ${new Date().getFullYear()} ${escapeHtml(b.productName)}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function hexToRgb(hex) {
  // Accept 6-digit or 3-digit; default fallback if malformed.
  const m = /^#?([a-f\d]{3}|[a-f\d]{6})$/i.exec(hex || '');
  if (!m) return '106,63,244';
  const v = m[1];
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

// ── buildEmail (2FA / verification code) ──────────────────────────────────────

/**
 * buildEmail({ firstName, heading, subtitle, code, codeLabel, expiryText,
 *              footerNote, ctaText, brand })
 *
 * Email containing a one-time code (verification, password reset, 2FA).
 * Light/dark adaptive via @media (prefers-color-scheme). Brand colours +
 * wordmark are taken from the `brand` parameter when provided, otherwise
 * fall back to DEFAULT_BRAND. Callers should pass `brand` from
 * getBrandConfig(prisma) so the email matches the live institution brand.
 */
const buildEmail = ({
  firstName, heading, subtitle, code, codeLabel,
  expiryText, footerNote, ctaText, brand,
}) => {
  const innerHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:40px 40px 0 40px;">
          <h1 class="uf-heading" style="margin:0;font-size:26px;font-weight:700;letter-spacing:-0.3px;line-height:1.2;">
            ${escapeHtml(heading)}
          </h1>
          <p class="uf-subtitle" style="margin:8px 0 0 0;font-size:15px;line-height:1.5;">
            ${escapeHtml(subtitle)}
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding:28px 40px 0 40px;">
          <p class="uf-greeting" style="margin:0;font-size:15px;line-height:1.6;">
            Hello <strong>${escapeHtml(firstName || '')}</strong>,
          </p>
          <p class="uf-body" style="margin:8px 0 0 0;font-size:15px;line-height:1.6;">
            ${escapeHtml(ctaText || 'Use the code below to complete your request. This code is single-use and time-sensitive.')}
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding:24px 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td class="uf-feature-bg" style="border-radius:16px;padding:28px 20px;text-align:center;">
                <p class="uf-feature-label" style="margin:0 0 8px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;">
                  ${escapeHtml(codeLabel)}
                </p>
                <p class="uf-feature-value" style="margin:0;font-size:40px;font-weight:800;letter-spacing:10px;font-variant-numeric:tabular-nums;">
                  ${escapeHtml(code)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:0 40px 12px 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td class="uf-detail-bg" style="border-radius:12px;padding:16px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td class="uf-detail-text" style="font-size:13px;line-height:1.5;">
                      ${ICONS.clock}${escapeHtml(expiryText)}
                    </td>
                  </tr>
                  <tr>
                    <td class="uf-detail-text" style="font-size:13px;line-height:1.5;padding-top:6px;">
                      ${ICONS.shield}Never share this code with anyone
                    </td>
                  </tr>
                  <tr>
                    <td class="uf-detail-text" style="font-size:13px;line-height:1.5;padding-top:6px;">
                      ${ICONS.envelope}${escapeHtml(brand?.productName || 'UniFlow')} will never ask for your password via email
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 40px 36px 40px;">
          <p class="uf-footer-note" style="margin:0;font-size:13px;line-height:1.5;">
            ${escapeHtml(footerNote || '')}
          </p>
        </td>
      </tr>
    </table>
  `;

  return renderShell({
    brand,
    title: heading,
    preheader: `${subtitle} — ${codeLabel}: ${code}`,
    innerHtml,
  });
};

// ── buildWelcomeEmail (new account onboarding, no code) ──────────────────────

/**
 * buildWelcomeEmail({ firstName, role, email, signInUrl,
 *                     subtitle, footerNote, brand })
 *
 * Welcome email sent the moment an admin creates a new user. The account
 * is intentionally left in pending state — the user clicks "Activate New
 * Account" in the portal, then enters their email to receive the 2FA
 * code. Including a code here would be pointless because they'd receive
 * another one the moment they begin activation.
 *
 * The email tells the user the account exists, explains how to activate,
 * and gives them a CTA button that opens the portal.
 */
const buildWelcomeEmail = ({
  firstName, role, email, signInUrl,
  subtitle, footerNote, brand,
}) => {
  const b = resolveBrand(brand);
  const innerHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:40px 40px 0 40px;">
          <h1 class="uf-heading" style="margin:0;font-size:26px;font-weight:700;letter-spacing:-0.3px;line-height:1.2;">
            Welcome to ${escapeHtml(b.productName)}
          </h1>
          <p class="uf-subtitle" style="margin:8px 0 0 0;font-size:15px;line-height:1.5;">
            ${escapeHtml(subtitle || 'An administrator has set up an account for you')}
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding:28px 40px 0 40px;">
          <p class="uf-greeting" style="margin:0;font-size:15px;line-height:1.6;">
            Hello <strong>${escapeHtml(firstName || '')}</strong>,
          </p>
          <p class="uf-body" style="margin:8px 0 0 0;font-size:15px;line-height:1.6;">
            A ${role ? `<strong>${escapeHtml(role)}</strong>` : 'new'} account has been created for you on ${escapeHtml(b.productName)}. Your account is currently pending — finish setting it up by activating it from the sign-in page. Activation only takes a minute.
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding:24px 40px 0 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td class="uf-feature-bg" style="border-radius:16px;padding:24px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td class="uf-feature-label" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;padding-bottom:6px;">
                      Your account
                    </td>
                  </tr>
                  <tr>
                    <td class="uf-heading" style="font-size:15px;font-weight:600;padding-bottom:14px;word-break:break-all;">
                      ${escapeHtml(email)}
                    </td>
                  </tr>
                  <tr>
                    <td class="uf-feature-label" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;padding-bottom:6px;">
                      Status
                    </td>
                  </tr>
                  <tr>
                    <td class="uf-feature-value" style="font-size:15px;font-weight:700;letter-spacing:0.3px;">
                      Pending activation
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${signInUrl ? `
      <tr>
        <td style="padding:24px 40px 0 40px;text-align:center;">
          <a href="${escapeHtml(signInUrl)}" class="uf-cta" style="display:inline-block;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
            Activate your account
          </a>
        </td>
      </tr>
      ` : ''}

      <tr>
        <td style="padding:24px 40px 0 40px;">
          <p class="uf-feature-label" style="margin:0 0 8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">
            How to activate
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td class="uf-detail-bg" style="border-radius:12px;padding:18px 20px;">
                <ol style="margin:0;padding-left:22px;color:inherit;" class="uf-detail-text">
                  <li style="font-size:13px;line-height:1.6;">Open the ${escapeHtml(b.productName)} sign-in page.</li>
                  <li style="font-size:13px;line-height:1.6;padding-top:4px;">Click <strong>Activate New Account</strong>.</li>
                  <li style="font-size:13px;line-height:1.6;padding-top:4px;">Enter <strong>${escapeHtml(email)}</strong>; we'll send a 6-digit code.</li>
                  <li style="font-size:13px;line-height:1.6;padding-top:4px;">Type the code and choose your password — you're in.</li>
                </ol>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:18px 40px 12px 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td class="uf-detail-bg" style="border-radius:12px;padding:16px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td class="uf-detail-text" style="font-size:13px;line-height:1.5;">
                      ${ICONS.envelope}${escapeHtml(b.productName)} will never ask for your password via email
                    </td>
                  </tr>
                  <tr>
                    <td class="uf-detail-text" style="font-size:13px;line-height:1.5;padding-top:6px;">
                      ${ICONS.lifebuoy}Need help? Contact your faculty's Student Affairs team
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 40px 36px 40px;">
          <p class="uf-footer-note" style="margin:0;font-size:13px;line-height:1.5;">
            ${escapeHtml(footerNote || 'If you didn\'t expect this account, please contact your faculty administration. You can safely ignore this email if you\'re not the intended recipient.')}
          </p>
        </td>
      </tr>
    </table>
  `;

  return renderShell({
    brand,
    title: `Welcome to ${b.productName}`,
    preheader: `Your ${b.productName} account is ready to activate — sign in with ${email}.`,
    innerHtml,
  });
};

module.exports = {
  sendEmail,
  buildEmail,
  buildWelcomeEmail,
  EMAIL_CONFIG,
  transporter,
  isEmailConfigured,
};
