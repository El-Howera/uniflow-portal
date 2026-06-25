import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import mockDbData from '../mockDatabase.json';
import { API_URLS } from '@shared/config';
import { Logo as BrandedLogo } from '../components/Logo';
import { GlassCheckbox as BrandedCheckbox } from '../components/GlassCheckbox';
import { useAppContext } from '../context/AppContext';
import LightModeBackground from '../components/LightModeBackground';
import { useT } from '../i18n';
import { getGuideUrl } from '../utils/guideUrl';
import { startPreviewSession, PREVIEW_ROLES, PREVIEW_ROLE_LABELS, PREVIEW_ROLE_ICONS } from '../utils/previewSession';

/* Floating top-right control row: language toggle (EN/AR) + theme toggle.
   Stacked next to each other in the same notch-aware safe-area slot so they
   read as a single chrome cluster rather than two unrelated floating buttons. */
const TopRightControls: React.FC = () => {
  const { isDarkMode, toggleDarkMode, language, setLanguage } = useAppContext();
  const toggleLanguage = () => setLanguage(language === 'en' ? 'ar' : 'en');
  const langLabel = language === 'en' ? 'ع' : 'EN';
  const langTitle = language === 'en' ? 'التبديل إلى العربية' : 'Switch to English';

  return (
    <div
      className="fixed top-[calc(0.25rem+max(env(safe-area-inset-top,0px),47px))] md:top-[calc(0.25rem+env(safe-area-inset-top,0px))] right-4 z-50 flex items-center gap-2"
      // Force LTR so the language + theme buttons stay in a consistent order
      // when the rest of the page flips to RTL.
      dir="ltr"
    >
      <button
        onClick={toggleLanguage}
        aria-label={langTitle}
        title={langTitle}
        className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 dark:bg-black/40 border border-white/20 dark:border-white/10 backdrop-blur-xl text-black dark:text-white hover:bg-white/20 dark:hover:bg-black/60 transition-colors shadow-lg font-bold text-sm"
      >
        <span dir="ltr">{langLabel}</span>
      </button>
      <button
        onClick={toggleDarkMode}
        aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 dark:bg-black/40 border border-white/20 dark:border-white/10 backdrop-blur-xl text-black dark:text-white hover:bg-white/20 dark:hover:bg-black/60 transition-colors shadow-lg"
      >
        <i className={`ph-fill ${isDarkMode ? 'ph-sun' : 'ph-moon'} text-lg`} />
      </button>
    </div>
  );
};

// Backwards-compat alias — every render path imports ThemeToggleFab.
const ThemeToggleFab: React.FC = () => <TopRightControls />;

/* Theme-aware background — dark mesh in dark mode, animated pastel blobs
   (same component used across the rest of the app) in light mode. Sits in
   a `fixed inset-0` shell so it covers the viewport on every sign-in view. */
const AuthBackground: React.FC = () => {
  const { isDarkMode } = useAppContext();
  if (isDarkMode) return <MeshBackground />;
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'var(--canvas-bg, #FFFFFF)' }}>
      <LightModeBackground />
    </div>
  );
};

// Mirrors the canonical UserRole enum in AppContext + backend Prisma schema.
// Missing roles fall through to 'student' (line ~317), so adding a role here
// without listing it in `validRoles` below silently demotes that account.
type UserRole = 'student' | 'admin' | 'ta' | 'professor' | 'sa' | 'financial' | 'it';

/* ════════════════════════════════════════════════════════
 *  Small reusable pieces (pure presentation)
 * ════════════════════════════════════════════════════════ */

/* Animated mesh-gradient background */
const MeshBackground: React.FC = () => (
  <div className="fixed inset-0 overflow-hidden bg-black">
    {/* base noise */}
    <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")', backgroundRepeat: 'repeat' }} />
    {/* drifting orbs */}
    <motion.div className="absolute w-[900px] h-[900px] rounded-full blur-[160px] opacity-30 bg-[#6A3FF4]"
      style={{ top: '-20%', left: '-10%' }}
      animate={{ x: [0, 80, 0], y: [0, 60, 0], scale: [1, 1.15, 1] }}
      transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div className="absolute w-[700px] h-[700px] rounded-full blur-[140px] opacity-20 bg-[#A855F7]"
      style={{ bottom: '-15%', right: '-5%' }}
      animate={{ x: [0, -60, 0], y: [0, -80, 0], scale: [1.1, 1, 1.1] }}
      transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div className="absolute w-[500px] h-[500px] rounded-full blur-[120px] opacity-15 bg-[#7C3AED]"
      style={{ top: '40%', left: '50%', marginLeft: '-250px' }}
      animate={{ x: [0, 100, 0], y: [0, -50, 0] }}
      transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div className="absolute w-[400px] h-[400px] rounded-full blur-[100px] opacity-10 bg-[#EC4899]"
      style={{ top: '10%', right: '10%' }}
      animate={{ x: [0, -40, 0], y: [0, 40, 0], scale: [1, 1.2, 1] }}
      transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
    />
  </div>
);

/* Glass card wrapper */
const glassCard = "relative bg-white/70 dark:bg-white/[0.06] backdrop-blur-2xl border border-black/10 dark:border-white/[0.12] rounded-3xl shadow-[0_8px_64px_rgba(106,63,244,0.08),inset_0_1px_0_rgba(255,255,255,0.06)]";

/* Themed input field with hover/focus glow */
const GlassInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { icon: string; rightElement?: React.ReactNode }> = ({ icon, rightElement, className: _c, ...props }) => (
  <motion.div whileHover={{ scale: 1.015 }} whileFocus={{ scale: 1.015 }} className="relative">
    <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
      <i className={`ph ${icon} text-[#6A3FF4] text-lg`} />
    </span>
    <input
      {...props}
      className="w-full bg-black/[0.04] dark:bg-white/[0.06] text-black dark:text-white placeholder-gray-500 rounded-xl py-3.5 pl-12 pr-12 border border-black/10 dark:border-white/[0.08] focus:border-[#6A3FF4]/50 focus:outline-none focus:ring-1 focus:ring-[#6A3FF4]/30 focus:shadow-[0_0_20px_rgba(106,63,244,0.15)] transition-all duration-300 text-sm"
    />
    {rightElement && <div className="absolute inset-y-0 right-0 flex items-center pr-3.5">{rightElement}</div>}
  </motion.div>
);

/* Primary CTA button */
const PrimaryBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; loadingText?: string }> = ({ children, loading, loadingText, ...props }) => (
  <motion.button
    whileHover={{ scale: 1.015, boxShadow: '0 0 30px rgba(106,63,244,0.3)' }}
    whileTap={{ scale: 0.985 }}
    {...(props as any)}
    className={`w-full py-3.5 rounded-xl font-semibold text-sm text-white transition-all duration-300 flex items-center justify-center gap-2.5
      bg-gradient-to-r from-[#6A3FF4] to-[#7C3AED] hover:from-[#5B33D4] hover:to-[#6D31D4]
      shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed ${props.className || ''}`}
  >
    {loading ? <><i className="ph-bold ph-spinner animate-spin text-base" />{loadingText || 'Processing...'}</> : children}
  </motion.button>
);

/* Secondary / ghost button */
const SecondaryBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ children, ...props }) => (
  <motion.button
    whileHover={{ scale: 1.015, backgroundColor: 'rgba(255,255,255,0.06)' }}
    whileTap={{ scale: 0.985 }}
    {...(props as any)}
    className={`w-full py-3.5 rounded-xl font-semibold text-sm text-black/70 dark:text-white/80 border border-black/10 dark:border-white/[0.08] hover:border-black/20 dark:hover:border-white/[0.15] transition-all duration-300 ${props.className || ''}`}
  >
    {children}
  </motion.button>
);

/* Divider with "OR" */
const Divider: React.FC = () => (
  <div className="flex items-center gap-4 my-6">
    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    <span className="text-[11px] uppercase tracking-[0.15em] text-black/40 dark:text-white/25 font-medium">or</span>
    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
  </div>
);

/* Logo cluster — icon + branded wordmark (Plan 8 Phase 1: text reads from
   BrandContext so the auth screen reflects the configured productName). */
const Logo: React.FC<{ icon?: string }> = ({ icon = 'ph-graduation-cap' }) => (
  <div className="flex items-center justify-center gap-3 mb-2">
    <i className={`ph-fill ${icon} text-[#6A3FF4] text-4xl drop-shadow-[0_0_12px_rgba(106,63,244,0.4)]`} />
    <h1 className="text-2xl font-bold tracking-tight text-black dark:text-white">
      <BrandedLogo />
    </h1>
  </div>
);

/* Slide-in card transition variants */
const cardVariants = {
  enter: { opacity: 0, x: 40, scale: 0.97 },
  center: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: -40, scale: 0.97 },
};

/* ═══ Password Strength ═══ */
const getPasswordStrength = (pw: string): { score: number; label: string; color: string; tailwind: string } => {
  if (!pw) return { score: 0, label: '', color: '', tailwind: '' };
  let score = 0;
  if (/[a-z]/.test(pw)) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (pw.length >= 16) score++;

  if (score <= 1) return { score, label: 'Very Weak', color: '#ef4444', tailwind: 'bg-red-500' };
  if (score === 2) return { score, label: 'Weak', color: '#f97316', tailwind: 'bg-orange-500' };
  if (score === 3) return { score, label: 'Moderate', color: '#eab308', tailwind: 'bg-yellow-400' };
  return { score, label: 'Strong', color: '#22c55e', tailwind: 'bg-green-500' };
};

const PasswordStrengthBar: React.FC<{ password: string }> = ({ password }) => {
  const { score, label, color, tailwind } = getPasswordStrength(password);
  if (!password) return null;

  const segments = 4;
  const filled = Math.min(score, segments);

  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2.5 space-y-1.5">
      <div className="flex gap-1.5">
        {Array.from({ length: segments }).map((_, i) => (
          <div key={i} className="flex-1 h-1 rounded-full bg-black/[0.08] dark:bg-white/[0.06] overflow-hidden backdrop-blur-sm">
            <motion.div
              className={`h-full rounded-full ${i < filled ? tailwind : ''}`}
              initial={{ width: 0 }}
              animate={{ width: i < filled ? '100%' : '0%' }}
              transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              style={i < filled ? { boxShadow: `0 0 8px ${color}40` } : {}}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <motion.div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }}
          animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
        <span className="text-[11px] font-medium" style={{ color }}>{label}</span>
      </div>
    </motion.div>
  );
};

/* ═══ OTP Input ═══ (untouched logic) */
const OtpInput: React.FC<{ otp: string[]; setOtp: React.Dispatch<React.SetStateAction<string[]>> }> = ({ otp, setOtp }) => {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const hasAutoFocused = useRef(false);

  useEffect(() => {
    if (!hasAutoFocused.current && inputRefs.current[0]) {
      inputRefs.current[0].focus();
      hasAutoFocused.current = true;
    }
  }, []);

  const focusInput = (index: number) => {
    if (index >= 0 && index < 6 && inputRefs.current[index]) inputRefs.current[index]?.focus();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const value = e.target.value;
    if (value && !/^\d$/.test(value.slice(-1))) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) focusInput(index + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const newOtp = [...otp];
      if (otp[index]) { newOtp[index] = ''; setOtp(newOtp); }
      else if (index > 0) { newOtp[index - 1] = ''; setOtp(newOtp); focusInput(index - 1); }
    } else if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); focusInput(index - 1); }
    else if (e.key === 'ArrowRight' && index < 5) { e.preventDefault(); focusInput(index + 1); }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (paste.length > 0) {
      const newOtp = [...otp];
      for (let i = 0; i < paste.length && i < 6; i++) newOtp[i] = paste[i];
      setOtp(newOtp);
      const nextEmpty = newOtp.findIndex(v => !v);
      focusInput(nextEmpty === -1 ? 5 : nextEmpty);
    }
  };

  return (
    <div className="flex justify-center gap-2.5 mb-5">
      {otp.map((data, index) => (
        <motion.input
          key={index}
          whileFocus={{ scale: 1.08, borderColor: 'rgba(106,63,244,0.6)' }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={data}
          onChange={(e) => handleChange(e, index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onPaste={handlePaste}
          ref={(el) => { inputRefs.current[index] = el; }}
          className="w-12 h-14 bg-black/[0.04] dark:bg-white/[0.06] border border-black/15 dark:border-white/[0.1] rounded-xl text-center text-black dark:text-white text-xl font-semibold focus:outline-none focus:ring-1 focus:ring-[#6A3FF4]/40 focus:border-[#6A3FF4]/50 focus:shadow-[0_0_16px_rgba(106,63,244,0.15)] transition-all duration-300"
        />
      ))}
    </div>
  );
};

/* ════════════════════════════════════════════════════════
 *  Main AuthPage — ALL logic is preserved exactly as-is
 * ════════════════════════════════════════════════════════ */
export const AuthPage: React.FC<{ onLogin: (role: UserRole) => void }> = ({ onLogin }) => {
  const t = useT();

  interface MockUser {
    id: string; email: string; firstName: string; lastName: string; password: string; activated?: boolean; role?: UserRole;
  }

  const initialMockDb: MockUser[] = (mockDbData as unknown) as MockUser[];
  let mockDatabase: MockUser[] = [...initialMockDb];

  const [view, setView] = useState<'login' | 'activate' | 'verify' | 'createPassword' | 'accountActivated' | 'forgotPassword' | 'resetPassword'>('login');

  const findUserByEmail = (email: string): MockUser | undefined =>
    mockDatabase.find((u) => u.email.toLowerCase() === email.toLowerCase());

  // Login State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Facebook-style remembered profile. Persisted in localStorage under
  // `uniflow:remembered-user` on successful sign-in when rememberMe is
  // checked. Clicking the card calls /api/auth/refresh with the stored
  // refreshToken to get a fresh access token + new refresh token, then
  // signs the user in — no password prompt.
  interface RememberedProfile {
    email: string;
    firstName: string;
    lastName: string;
    picture?: string;
    role?: string;
    userId?: string;
    odId?: string;
    refreshToken?: string;
    savedAt?: string;
  }
  const [remembered, setRemembered] = useState<RememberedProfile | null>(() => {
    try {
      const raw = localStorage.getItem('uniflow:remembered-user');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.email === 'string') return parsed as RememberedProfile;
      return null;
    } catch { return null; }
  });
  const [continueLoading, setContinueLoading] = useState(false);
  const forgetRememberedUser = () => {
    try { localStorage.removeItem('uniflow:remembered-user'); } catch { /* ignore */ }
    setRemembered(null);
  };
  /**
   * Facebook-style click handler. Calls /api/auth/refresh with the
   * saved refresh token. On success: stores the new access + refresh
   * pair + the live-session localStorage keys, rotates the remembered
   * payload with the new refresh token (so the chain keeps working
   * across multiple Continue as cycles), and calls onLogin to drop the
   * user on their dashboard. On failure (revoked / expired refresh
   * token, network error): falls back to pre-filling the email + a
   * helpful error message so the user can type their password.
   */
  const continueAsRemembered = async (profile: RememberedProfile) => {
    setEmail(profile.email);
    setLoginError('');
    setLoginErrorKind('generic');

    if (!profile.refreshToken) {
      // Legacy payload (saved before this feature) — degrade to
      // password-prompt flow.
      setTimeout(() => {
        const pw = document.querySelector(
          'form input[type="password"], form input[type="text"][name="password"]',
        ) as HTMLInputElement | null;
        pw?.focus();
      }, 80);
      return;
    }

    setContinueLoading(true);
    try {
      const res = await fetch(`${API_URLS.userProfile()}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: profile.refreshToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) {
        // Refresh token was revoked (cross-browser kick) or expired.
        // Clear the card so the user falls through to manual login,
        // and tell them why.
        forgetRememberedUser();
        setLoginError(t('auth.rememberedExpired'));
        setLoginErrorKind('structured');
        return;
      }
      // Live-session keys — same set the password login writes so the
      // rest of the app (NotificationContext, AppContext, etc.) sees
      // the user as fully authenticated.
      localStorage.setItem('currentUserEmail', profile.email);
      localStorage.setItem('currentUserFirstName', profile.firstName || '');
      localStorage.setItem('currentUserLastName', profile.lastName || '');
      localStorage.setItem('currentUserRole', profile.role || 'student');
      localStorage.setItem('currentUserId', profile.userId || '');
      localStorage.setItem('currentUserOdId', profile.odId || '');
      localStorage.setItem('authToken', data.token);
      // Sync the header avatar straight away — picture URL comes from the
      // remembered payload (saved at the last full sign-in). Same pattern
      // as the password-login branch above.
      localStorage.setItem('currentUserPicture', profile.picture || '');
      const picV = Number(localStorage.getItem('currentUserPictureV') || '0') + 1;
      localStorage.setItem('currentUserPictureV', String(picV));
      window.dispatchEvent(new CustomEvent('uniflow:profile-updated'));
      if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken);
        // Rotate the remembered payload too so the next Continue as
        // click has a fresh, non-revoked token.
        try {
          const updated: RememberedProfile = { ...profile, refreshToken: data.refreshToken };
          localStorage.setItem('uniflow:remembered-user', JSON.stringify(updated));
        } catch { /* ignore */ }
      }
      const userRole = (profile.role as UserRole) || 'student';
      onLogin(userRole);
    } catch (err) {
      console.error('Continue as error:', err);
      setLoginError(t('auth.rememberedRefreshFailed'));
      setLoginErrorKind('generic');
    } finally {
      setContinueLoading(false);
    }
  };
  const [loginError, setLoginError] = useState('');
  // Plan 5 Phase 4 — structured error variants (account_inactive,
  // account_not_activated, sign_in_locked) get an amber banner instead of
  // the red text-line used for generic credential failures.
  const [loginErrorKind, setLoginErrorKind] = useState<'generic' | 'structured' | 'success'>('generic');

  // Activation State
  const [activationEmail, setActivationEmail] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [otp, setOtp] = useState<string[]>(new Array(6).fill(''));
  const [errorMessage, setErrorMessage] = useState('');
  const [emailCheckError, setEmailCheckError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Create Password State
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Forgot Password State
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [isPasswordReset, setIsPasswordReset] = useState(false);

  const startResendCountdown = () => {
    setResendCountdown(60);
    const timer = setInterval(() => {
      setResendCountdown(prev => { if (prev <= 1) { clearInterval(timer); return 0; } return prev - 1; });
    }, 1000);
  };

  /* ─── Handlers (100% preserved) ─── */
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginErrorKind('generic');
    setIsLoading(true);

    try {
      // Query backend API (PostgreSQL database) instead of mockDatabase
      const response = await fetch(`${API_URLS.userProfile()}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        // Plan 5 Phase 4 — structured login errors carry a `message` text
        // surfaced verbatim. They use a different banner style (amber) to
        // distinguish a policy decision from a credentials failure.
        const STRUCTURED = ['account_inactive', 'account_not_activated', 'account_deleted', 'sign_in_locked'];
        if (data?.error && STRUCTURED.includes(data.error)) {
          setLoginError(data.message || data.error);
          setLoginErrorKind('structured');
        } else {
          setLoginError(data.error || 'Login failed');
          setLoginErrorKind('generic');
        }
        setIsLoading(false);
        return;
      }

      const user = data.user;
      // Plan 5 sub-roles (financial, it) MUST be in this list or they fall
      // through to 'student' and the user lands on the wrong dashboard.
      // Keep in sync with backend Prisma enum UserRole. (Plan 22: `superuser`
      // removed.)
      const validRoles: UserRole[] = ['student', 'professor', 'ta', 'sa', 'admin', 'financial', 'it'];
      const userRole: UserRole = user.role && validRoles.includes(user.role as UserRole) ? (user.role as UserRole) : 'student';

      // Store in localStorage
      localStorage.setItem('currentUserEmail', user.email);
      localStorage.setItem('currentUserFirstName', user.firstName || '');
      localStorage.setItem('currentUserLastName', user.lastName || '');
      localStorage.setItem('currentUserRole', userRole);
      localStorage.setItem('currentUserId', user.id);
      localStorage.setItem('currentUserOdId', user.odId || '');
      localStorage.setItem('authToken', data.token || '');
      localStorage.setItem('refreshToken', data.refreshToken || '');
      // Persist the profile picture URL + bump its cache-busting version
      // so the header avatar refreshes immediately. Without this, the
      // header reads an empty string and falls back to gradient initials
      // until the user manually navigates to /profile (the page does the
      // sync as a side-effect). Mirrored in the Continue-as branch below.
      const picUrl = user.profilePicture || user.picture || '';
      localStorage.setItem('currentUserPicture', picUrl);
      const picV = Number(localStorage.getItem('currentUserPictureV') || '0') + 1;
      localStorage.setItem('currentUserPictureV', String(picV));
      window.dispatchEvent(new CustomEvent('uniflow:profile-updated'));
      // Facebook-style "Remember me" — save a minimal profile so the next
      // visit to /login can offer a one-click "Continue as Elfares" card.
      // We persist independently from the live-session keys so a sign-out
      // doesn't wipe it (the user EXPECTS to find the remembered card
      // after they sign out). Forgetting happens explicitly via the X
      // button on the card.
      //
      // Owner directive (2026-06-09): clicking the card should SIGN IN
      // not prefill — Facebook-style. We persist the just-issued refresh
      // token alongside the profile so the card's click handler can call
      // /api/auth/refresh to get a fresh access token and complete the
      // login without a password prompt. The refresh-token rotation
      // means each Continue as click invalidates the previous saved one
      // and gets a new pair; we update the stored payload after the
      // rotation so the chain keeps working.
      if (rememberMe) {
        try {
          const profilePicture = user.profilePicture || user.picture || '';
          const payload = {
            email: user.email,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            picture: profilePicture,
            role: userRole,
            userId: user.id,
            odId: user.odId || '',
            refreshToken: data.refreshToken || '',
            savedAt: new Date().toISOString(),
          };
          localStorage.setItem('uniflow:remembered-user', JSON.stringify(payload));
        } catch { /* localStorage write blocked — silently skip */ }
      } else {
        try { localStorage.removeItem('uniflow:remembered-user'); } catch { /* ignore */ }
      }

      setIsLoading(false);
      onLogin(userRole);
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Failed to connect to server. Make sure backend is running on port 4007');
      setIsLoading(false);
    }
  };

  const sendVerificationCodeViaAPI = async (email: string): Promise<{ success: boolean; message: string; devCode?: string }> => {
    try {
      const response = await fetch(`${API_URLS.userProfile()}/api/auth/send-verification`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      return await response.json();
    } catch (error) { console.error('API error:', error); return { success: false, message: 'Failed to connect to server' }; }
  };

  const verifyCodeViaAPI = async (email: string, code: string): Promise<{ success: boolean; message: string; userId?: string }> => {
    try {
      const response = await fetch(`${API_URLS.userProfile()}/api/auth/verify-code-by-email`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
      return await response.json();
    } catch (error) { console.error('API error:', error); return { success: false, message: 'Failed to connect to server' }; }
  };

  const setPasswordViaAPI = async (email: string, password: string): Promise<{ success: boolean; message: string }> => {
    try {
      const response = await fetch(`${API_URLS.userProfile()}/api/auth/set-password`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      return await response.json();
    } catch (error) { console.error('API error:', error); return { success: false, message: 'Failed to connect to server' }; }
  };

  const sendResetCodeViaAPI = async (email: string): Promise<{ success: boolean; message: string; devCode?: string }> => {
    try {
      const response = await fetch(`${API_URLS.userProfile()}/api/auth/send-reset-code`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      return await response.json();
    } catch (error) { console.error('API error:', error); return { success: false, message: 'Failed to connect to server' }; }
  };

  const resetPasswordViaAPI = async (email: string, code: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    try {
      const response = await fetch(`${API_URLS.userProfile()}/api/auth/reset-with-code`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, newPassword }) });
      return await response.json();
    } catch (error) { console.error('API error:', error); return { success: false, message: 'Failed to connect to server' }; }
  };

  // Plan 5 — the activate flow used a static `mockDatabase` JSON to check
  // existence. That meant accounts created by admin via the User Management
  // page didn't show up. We now go straight to the real backend
  // /api/auth/send-verification — it does the DB lookup itself and returns
  // 404 on missing user / 400 on already-activated. The user message reflects
  // the real backend response.
  const handleCheckEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailCheckError('');
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URLS.userProfile()}/api/auth/send-verification`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: activationEmail }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const map: Record<number, string> = {
          404: 'Email not found in our database. Please contact your administrator.',
          400: result?.error || 'This account cannot be activated right now.',
        };
        setEmailCheckError(map[response.status] || result?.error || 'Failed to send verification code.');
        return;
      }
      setVerificationEmail(activationEmail);
      setOtp(new Array(6).fill(''));
      setIsPasswordReset(false);
      startResendCountdown();
      setView('verify');
      if (result.devCode && process.env.NODE_ENV !== 'production') {
        console.log('Verification code (dev):', result.devCode);
      }
    } catch {
      setEmailCheckError('Failed to connect to server. Make sure the backend is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const otpCode = otp.join('');
    if (otpCode.length !== 6) { setErrorMessage('Please enter all 6 digits'); return; }
    setIsLoading(true);
    const result = await verifyCodeViaAPI(verificationEmail, otpCode);
    setIsLoading(false);
    if (result.success) { setOtp(new Array(6).fill('')); setErrorMessage(''); setView('createPassword'); }
    else { setErrorMessage(result.message || 'Invalid verification code'); }
  };

  const handleResendCode = async () => {
    if (resendCountdown > 0) return;
    setIsLoading(true); setErrorMessage('');
    const result = isPasswordReset ? await sendResetCodeViaAPI(verificationEmail) : await sendVerificationCodeViaAPI(verificationEmail);
    setIsLoading(false);
    if (result.success) {
      startResendCountdown();
      setErrorMessage('New code sent to ' + verificationEmail);
      setOtp(new Array(6).fill(''));
      if (result.devCode && process.env.NODE_ENV !== 'production') {
        console.log('New verification code (dev):', result.devCode);
      }
    }
    else { setErrorMessage(result.message || 'Failed to resend code'); }
  };

  const handleCreatePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setPasswordError('');
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmNewPassword) { setPasswordError('Passwords do not match'); return; }
    setIsLoading(true);
    const result = await setPasswordViaAPI(verificationEmail, newPassword);
    setIsLoading(false);
    if (result.success) {
      const user = findUserByEmail(verificationEmail);
      if (user) { user.activated = true; user.password = newPassword; }
      setNewPassword(''); setConfirmNewPassword(''); setView('accountActivated');
    } else { setPasswordError(result.message || 'Failed to set password'); }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault(); setForgotError(''); setForgotSuccess('');
    if (!forgotEmail) { setForgotError('Please enter your email address'); return; }
    setIsLoading(true);
    const result = await sendResetCodeViaAPI(forgotEmail);
    setIsLoading(false);
    if (result.success) {
      setVerificationEmail(forgotEmail); setOtp(new Array(6).fill('')); setIsPasswordReset(true); startResendCountdown(); setView('resetPassword');
      if (result.devCode && process.env.NODE_ENV !== 'production') {
        console.log('Reset code (dev):', result.devCode);
      }
    } else { setForgotSuccess('If an account exists with this email, a reset code has been sent.'); }
  };

  const handleResetPassword = async () => {
    const otpCode = otp.join('');
    if (otpCode.length !== 6) { setErrorMessage('Please enter all 6 digits'); return; }
    if (newPassword.length < 8) { setErrorMessage('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmNewPassword) { setErrorMessage('Passwords do not match'); return; }
    setIsLoading(true);
    const result = await resetPasswordViaAPI(verificationEmail, otpCode, newPassword);
    setIsLoading(false);
    if (result.success) {
      const user = findUserByEmail(verificationEmail);
      if (user) user.password = newPassword;
      setOtp(new Array(6).fill('')); setNewPassword(''); setConfirmNewPassword(''); setErrorMessage(''); setLoginError(''); setEmail(verificationEmail); setView('login');
      setLoginError('Password reset successful! Please log in with your new password.');
    } else { setErrorMessage(result.message || 'Failed to reset password'); }
  };

  /* ─── Features list ─── (computed each render so language toggles re-translate) */
  const features = [
    { icon: 'ph-lightbulb-filament', title: t('auth.featureSmartLearningTitle'),   text: t('auth.featureSmartLearningText') },
    { icon: 'ph-timer',              title: t('auth.featureFlexibleScheduleTitle'), text: t('auth.featureFlexibleScheduleText') },
    { icon: 'ph-globe-simple',       title: t('auth.featureConnectedCampusTitle'),  text: t('auth.featureConnectedCampusText') },
  ];

  /* ═══════════════════════════════════════════════════════
   *  Account Activated View
   * ═══════════════════════════════════════════════════════ */
  if (view === 'accountActivated') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 font-sans">
        <AuthBackground />
        <ThemeToggleFab />
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center max-w-6xl mx-auto w-full">
          {/* card */}
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 22 }}
            className={`${glassCard} p-10 max-w-md mx-auto w-full`}
          >
            <Logo />
            <div className="w-20 h-20 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mt-6 mb-5">
              <motion.i animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="ph-fill ph-check-circle text-emerald-400 text-5xl" />
            </div>
            <h2 className="text-2xl font-bold text-black dark:text-white text-center mb-2">{t('auth.accountActivated')}</h2>
            <p className="text-black/55 dark:text-white/40 text-sm text-center mb-8">{t('auth.activatedRedirect')}</p>
            <PrimaryBtn onClick={() => { setView('login'); setActivationEmail(''); setOtp(new Array(6).fill('')); setErrorMessage(''); setEmail(verificationEmail); }}>
              {t('auth.signIn')}
            </PrimaryBtn>
          </motion.div>

          {/* right marketing */}
          <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, duration: 0.6 }} className="hidden lg:block max-w-lg mx-auto">
            <h2 className="text-5xl font-extrabold text-black dark:text-white mb-10 leading-tight">
              {t('auth.welcomeTo')}<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-[#6A3FF4] to-[#A855F7]">UniFlow</span>
            </h2>
            <ul className="space-y-6">
              {features.map((f, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.1 }} className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#6A3FF4] to-[#A855F7] flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/20">
                    <i className={`ph-fill ${f.icon} text-white text-lg`} />
                  </div>
                  <div>
                    <p className="text-black dark:text-white font-semibold text-sm">{f.title}</p>
                    <p className="text-black/55 dark:text-white/40 text-sm">{f.text}</p>
                  </div>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════
   *  Main Layout (login / activate / verify / createPassword / forgotPassword / resetPassword)
   * ═══════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans">
      <AuthBackground />
      <ThemeToggleFab />

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center max-w-6xl mx-auto w-full">

        {/* ── LEFT: Glass card ── */}
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 22 }}
          className={`${glassCard} p-8 sm:p-10 max-w-md mx-auto w-full overflow-hidden`}
        >
          <AnimatePresence mode="wait">

            {/* ─────── LOGIN ─────── */}
            {view === 'login' && (
              <motion.div key="login" variants={cardVariants} initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
                <Logo />
                <h2 className="text-2xl font-bold text-black dark:text-white text-center mt-4 mb-1">{t('auth.welcomeBack')}</h2>
                <p className="text-black/50 dark:text-white/35 text-sm text-center mb-8">{t('auth.signInContinue')}</p>

                {/* Facebook-style "Continue as X" card — shown only when
                    the user previously checked Remember me. Click anywhere
                    on the card to sign in via the saved refresh token (no
                    password). The X in the inline-end corner forgets the
                    saved profile. RTL: gap/text/icon all use logical
                    properties so the layout mirrors when document.dir=rtl. */}
                {remembered && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="relative mb-6"
                  >
                    <button
                      type="button"
                      onClick={() => continueAsRemembered(remembered)}
                      disabled={continueLoading}
                      className="w-full flex items-center gap-4 p-4 pe-12 rounded-2xl bg-white/[0.06] dark:bg-white/[0.04] border border-white/15 hover:border-[#6A3FF4]/50 hover:bg-[#6A3FF4]/10 transition-all text-start ring-1 ring-inset ring-white/5 group disabled:opacity-70 disabled:cursor-default"
                    >
                      {/* Avatar — picture if we have it, else gradient initials. */}
                      {remembered.picture ? (
                        <img
                          src={remembered.picture}
                          alt={`${remembered.firstName} ${remembered.lastName}`}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          className="w-12 h-12 rounded-full object-cover flex-shrink-0 border border-white/20"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] text-white font-bold flex items-center justify-center flex-shrink-0 text-base">
                          {(remembered.firstName?.[0] || '').toUpperCase()}
                          {(remembered.lastName?.[0] || '').toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wider text-[#6A3FF4] font-bold mb-0.5">
                          {t('auth.continueAs')}
                        </div>
                        <div className="text-black dark:text-white font-bold text-base truncate group-hover:text-[#6A3FF4] dark:group-hover:text-[#c89eff] transition-colors">
                          {`${remembered.firstName || ''} ${remembered.lastName || ''}`.trim() || remembered.email}
                        </div>
                        <div className="text-black/45 dark:text-white/40 text-xs truncate">
                          {remembered.email}
                        </div>
                      </div>
                      {/* Arrow: ph-arrow-left in RTL, ph-arrow-right in LTR
                          so it consistently points "forward in reading
                          direction" toward the next page. */}
                      <i
                        className={`ph-bold ${
                          continueLoading
                            ? 'ph-spinner-gap animate-spin'
                            : (typeof document !== 'undefined' && document.documentElement.dir === 'rtl')
                              ? 'ph-arrow-left'
                              : 'ph-arrow-right'
                        } text-gray-400 group-hover:text-[#6A3FF4] transition-colors flex-shrink-0`}
                      ></i>
                    </button>
                    {/* X to forget the saved profile. Anchored to the
                        inline-end edge (right in LTR, left in RTL) via
                        `end-2` (Tailwind logical inset). */}
                    <button
                      type="button"
                      onClick={forgetRememberedUser}
                      title={t('auth.forgetThisAccount')}
                      aria-label={t('auth.forgetThisAccount')}
                      className="absolute top-2 end-2 w-7 h-7 rounded-full bg-white/5 hover:bg-red-500/15 text-gray-400 hover:text-red-400 transition-colors flex items-center justify-center"
                    >
                      <i className="ph-bold ph-x text-xs"></i>
                    </button>
                  </motion.div>
                )}

                <form className="space-y-5" onSubmit={handleLoginSubmit}>
                  <div>
                    <label className="block text-xs font-medium text-black/55 dark:text-white/40 mb-2 tracking-wide uppercase">{t('auth.email')}</label>
                    <GlassInput icon="ph-at" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.placeholderEmail')} />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-black/55 dark:text-white/40 mb-2 tracking-wide uppercase">{t('auth.password')}</label>
                    <GlassInput
                      icon="ph-lock"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('auth.password')}
                      rightElement={
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-black/45 dark:text-white/30 hover:text-black/60 dark:text-white/60 transition-colors">
                          <i className={`ph ${showPassword ? 'ph-eye' : 'ph-eye-slash'} text-lg`} />
                        </button>
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={() => setRememberMe(!rememberMe)}
                    >
                      <BrandedCheckbox checked={rememberMe} onChange={setRememberMe} size="sm" />
                      <span className="text-black/55 dark:text-white/40 group-hover:text-black/60 dark:text-white/60 transition-colors">{t('auth.rememberMe')}</span>
                    </div>
                    <button type="button" onClick={() => { setView('forgotPassword'); setForgotEmail(''); setForgotError(''); setForgotSuccess(''); }}
                      className="text-[#6A3FF4] hover:text-[#A855F7] font-medium transition-colors">
                      {t('auth.forgotPassword')}
                    </button>
                  </div>

                  {loginError && loginErrorKind === 'structured' && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                      <i className="ph-bold ph-warning-circle text-base mt-0.5 flex-shrink-0" />
                      <span className="leading-relaxed">{loginError}</span>
                    </motion.div>
                  )}
                  {loginError && loginErrorKind !== 'structured' && (
                    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      className={`text-xs font-medium ${loginError.includes('successful') ? 'text-emerald-400' : 'text-red-400'}`}>{loginError}</motion.p>
                  )}

                  <PrimaryBtn type="submit">
                    <i className="ph-bold ph-sign-in text-base" /> {t('auth.signIn')}
                  </PrimaryBtn>
                </form>

                <Divider />
                <p className="text-center text-xs text-black/45 dark:text-white/30 mb-3">{t('auth.newToUniflow')}</p>
                <SecondaryBtn onClick={() => setView('activate')}>{t('auth.activateNew')}</SecondaryBtn>

                {/* User Guide — static site served by nginx at /userguide.
                    Real anchor (full-page load), opens in a new tab so the
                    sign-in form state is preserved. Accessible BEFORE login. */}
                <a
                  href={getGuideUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center justify-center gap-2 text-xs font-medium text-[#6A3FF4] hover:text-[#A855F7] transition-colors"
                >
                  <i className="ph-bold ph-question text-base" />
                  {t('auth.guideHint')}
                </a>

                {/* ─────── PREVIEW DASHBOARDS (mock, no backend) ───────
                    The TA / Student Affairs / Admin / Financial / IT
                    dashboards are front-end previews in this MVP. These
                    buttons start a client-only preview session (no auth call)
                    and drop straight into the chosen dashboard. The student
                    and professor dashboards above are the only ones backed
                    by a real server — sign in with an account for those. */}
                <div className="mt-6 pt-5 border-t border-black/10 dark:border-white/10">
                  <p className="text-center text-[11px] uppercase tracking-wide text-black/45 dark:text-white/30 mb-3">
                    Preview a dashboard
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {PREVIEW_ROLES.map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => { startPreviewSession(role); onLogin(role); }}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2.5 text-xs font-medium text-black/70 dark:text-white/70 hover:border-[#6A3FF4] hover:text-[#6A3FF4] transition-colors ${role === 'it' ? 'col-span-2' : ''}`}
                      >
                        <i className={`ph-bold ${PREVIEW_ROLE_ICONS[role]} text-sm`} />
                        {PREVIEW_ROLE_LABELS[role]}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ─────── ACTIVATE ─────── */}
            {view === 'activate' && (
              <motion.div key="activate" variants={cardVariants} initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
                <Logo icon="ph-user-plus" />
                <h2 className="text-2xl font-bold text-black dark:text-white text-center mt-4 mb-1">{t('auth.activateTitle')}</h2>
                <p className="text-black/50 dark:text-white/35 text-sm text-center mb-8">{t('auth.activateSubtitle')}</p>

                <form className="space-y-5" onSubmit={handleCheckEmail}>
                  <div>
                    <label className="block text-xs font-medium text-black/55 dark:text-white/40 mb-2 tracking-wide uppercase">{t('auth.universityEmail')}</label>
                    <GlassInput icon="ph-at" type="email" value={activationEmail} onChange={(e) => { setActivationEmail(e.target.value); setEmailCheckError(''); }} placeholder={t('auth.placeholderEmailGeneric')} />
                    {emailCheckError && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs mt-2">{emailCheckError}</motion.p>}
                  </div>
                  <PrimaryBtn type="submit" disabled={isLoading} loading={isLoading} loadingText={t('auth.sending')}>
                    <i className="ph-bold ph-envelope text-base" /> {t('auth.sendCode')}
                  </PrimaryBtn>
                </form>

                <Divider />
                <SecondaryBtn onClick={() => { setView('login'); setActivationEmail(''); setEmailCheckError(''); }}>{t('auth.backToSignIn')}</SecondaryBtn>
              </motion.div>
            )}

            {/* ─────── VERIFY OTP ─────── */}
            {view === 'verify' && (
              <motion.div key="verify" variants={cardVariants} initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
                <Logo icon="ph-lock-key" />
                <h2 className="text-2xl font-bold text-black dark:text-white text-center mt-4 mb-1">{t('auth.verifyTitle')}</h2>
                <p className="text-black/50 dark:text-white/35 text-sm text-center mb-6">
                  {t('auth.verifySubtitle')} <span className="text-black/70 dark:text-white/80 font-medium">{verificationEmail}</span>
                </p>

                <OtpInput otp={otp} setOtp={setOtp} />
                {errorMessage && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center mb-4">{errorMessage}</motion.p>}

                <div className="space-y-3">
                  <PrimaryBtn onClick={handleVerifyOtp} disabled={isLoading} loading={isLoading} loadingText={t('auth.verifying')}>{t('auth.verifyCode')}</PrimaryBtn>
                  <SecondaryBtn onClick={handleResendCode} disabled={resendCountdown > 0 || isLoading}>
                    {resendCountdown > 0 ? `${t('auth.resend')} (${resendCountdown}s)` : t('auth.resend')}
                  </SecondaryBtn>
                  <SecondaryBtn onClick={() => { setView('activate'); setErrorMessage(''); setOtp(new Array(6).fill('')); }}>{t('common.back')}</SecondaryBtn>
                </div>
              </motion.div>
            )}

            {/* ─────── CREATE PASSWORD ─────── */}
            {view === 'createPassword' && (
              <motion.div key="createPassword" variants={cardVariants} initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
                <Logo icon="ph-key" />
                <h2 className="text-2xl font-bold text-black dark:text-white text-center mt-4 mb-1">{t('auth.createPwdTitle')}</h2>
                <p className="text-black/50 dark:text-white/35 text-sm text-center mb-8">{t('auth.createPwdSubtitle')}</p>

                <form className="space-y-5" onSubmit={handleCreatePassword}>
                  <div>
                    <label className="block text-xs font-medium text-black/55 dark:text-white/40 mb-2 tracking-wide uppercase">{t('auth.newPassword')}</label>
                    <GlassInput icon="ph-lock" type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('auth.placeholderPasswordCreate')}
                      rightElement={
                        <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="text-black/45 dark:text-white/30 hover:text-black/60 dark:text-white/60 transition-colors">
                          <i className={`ph ${showNewPassword ? 'ph-eye' : 'ph-eye-slash'} text-lg`} />
                        </button>
                      }
                    />
                    <PasswordStrengthBar password={newPassword} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black/55 dark:text-white/40 mb-2 tracking-wide uppercase">{t('auth.confirmPassword')}</label>
                    <GlassInput icon="ph-lock" type={showNewPassword ? 'text' : 'password'} value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder={t('auth.confirmPassword')} />
                  </div>
                  {passwordError && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs">{passwordError}</motion.p>}
                  <PrimaryBtn type="submit" disabled={isLoading || getPasswordStrength(newPassword).score < 3} loading={isLoading} loadingText={t('auth.activating')}>
                    <i className="ph-bold ph-check text-base" /> {t('auth.activate')}
                  </PrimaryBtn>
                </form>
              </motion.div>
            )}

            {/* ─────── FORGOT PASSWORD ─────── */}
            {view === 'forgotPassword' && (
              <motion.div key="forgotPassword" variants={cardVariants} initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
                <Logo icon="ph-lock-key" />
                <h2 className="text-2xl font-bold text-black dark:text-white text-center mt-4 mb-1">{t('auth.resetTitle')}</h2>
                <p className="text-black/50 dark:text-white/35 text-sm text-center mb-8">{t('auth.resetSubtitle')}</p>

                <form className="space-y-5" onSubmit={handleForgotPassword}>
                  <div>
                    <label className="block text-xs font-medium text-black/55 dark:text-white/40 mb-2 tracking-wide uppercase">{t('auth.emailAddress')}</label>
                    <GlassInput icon="ph-at" type="email" value={forgotEmail} onChange={(e) => { setForgotEmail(e.target.value); setForgotError(''); setForgotSuccess(''); }} placeholder={t('auth.placeholderEmailGeneric')} />
                    {forgotError && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs mt-2">{forgotError}</motion.p>}
                    {forgotSuccess && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-emerald-400 text-xs mt-2">{forgotSuccess}</motion.p>}
                  </div>
                  <PrimaryBtn type="submit" disabled={isLoading} loading={isLoading} loadingText={t('auth.sending')}>
                    <i className="ph-bold ph-envelope text-base" /> {t('auth.sendCode')}
                  </PrimaryBtn>
                </form>

                <Divider />
                <SecondaryBtn onClick={() => { setView('login'); setForgotEmail(''); setForgotError(''); setForgotSuccess(''); }}>{t('auth.backToSignIn')}</SecondaryBtn>
              </motion.div>
            )}

            {/* ─────── RESET PASSWORD ─────── */}
            {view === 'resetPassword' && (
              <motion.div key="resetPassword" variants={cardVariants} initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
                <Logo icon="ph-key" />
                <h2 className="text-2xl font-bold text-black dark:text-white text-center mt-4 mb-1">{t('auth.resetYourPwd')}</h2>
                <p className="text-black/50 dark:text-white/35 text-sm text-center mb-6">
                  {t('auth.resetEnterCode')} <span className="text-black/70 dark:text-white/80 font-medium">{verificationEmail}</span>
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-black/55 dark:text-white/40 mb-2 tracking-wide uppercase">{t('auth.verificationCode')}</label>
                    <OtpInput otp={otp} setOtp={setOtp} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black/55 dark:text-white/40 mb-2 tracking-wide uppercase">{t('auth.newPassword')}</label>
                    <GlassInput icon="ph-lock" type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('auth.newPassword')}
                      rightElement={
                        <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="text-black/45 dark:text-white/30 hover:text-black/60 dark:text-white/60 transition-colors">
                          <i className={`ph ${showNewPassword ? 'ph-eye' : 'ph-eye-slash'} text-lg`} />
                        </button>
                      }
                    />
                    <PasswordStrengthBar password={newPassword} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black/55 dark:text-white/40 mb-2 tracking-wide uppercase">{t('auth.confirmPassword')}</label>
                    <GlassInput icon="ph-lock" type={showNewPassword ? 'text' : 'password'} value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder={t('auth.confirmPassword')} />
                  </div>
                  {errorMessage && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center">{errorMessage}</motion.p>}
                  <PrimaryBtn onClick={handleResetPassword} disabled={isLoading || getPasswordStrength(newPassword).score < 3} loading={isLoading} loadingText={t('auth.sending')}>
                    <i className="ph-bold ph-check text-base" /> {t('auth.setNewPassword')}
                  </PrimaryBtn>
                  <SecondaryBtn onClick={handleResendCode} disabled={resendCountdown > 0 || isLoading}>
                    {resendCountdown > 0 ? `${t('auth.resend')} (${resendCountdown}s)` : t('auth.resend')}
                  </SecondaryBtn>
                  <SecondaryBtn onClick={() => { setView('forgotPassword'); setErrorMessage(''); setOtp(new Array(6).fill('')); setNewPassword(''); setConfirmNewPassword(''); }}>{t('common.back')}</SecondaryBtn>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </motion.div>

        {/* ── RIGHT: Marketing side ── */}
        <motion.div
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="hidden lg:flex flex-col max-w-lg mx-auto"
        >
          <h2 className="text-5xl font-extrabold text-black dark:text-white leading-[1.1] mb-4">
            {t('auth.heroTaglineLine1')}<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#6A3FF4] via-[#A855F7] to-[#6A3FF4]">{t('auth.heroTaglineLine2')}</span>
          </h2>
          <p className="text-black/45 dark:text-white/30 text-base mb-10">{t('auth.heroTaglineSubtitle')}</p>

          <ul className="space-y-5">
            {features.map((f, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.1, type: 'spring', stiffness: 200, damping: 20 }}
                className="flex items-start gap-4 group"
              >
                <div className="w-11 h-11 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] backdrop-blur-sm border border-black/10 dark:border-white/[0.08] flex items-center justify-center flex-shrink-0 group-hover:bg-[#6A3FF4]/20 group-hover:border-[#6A3FF4]/30 transition-all duration-300">
                  <i className={`ph-fill ${f.icon} text-[#6A3FF4] text-lg`} />
                </div>
                <div>
                  <p className="text-black dark:text-white font-semibold text-sm">{f.title}</p>
                  <p className="text-black/50 dark:text-white/35 text-sm leading-relaxed">{f.text}</p>
                </div>
              </motion.li>
            ))}
          </ul>

          {/* Floating stats */}
          <div className="flex gap-3 mt-10">
            {[
              { n: '5+', l: 'Dashboards' },
              { n: '24/7', l: 'AI Assistant' },
              { n: '100%', l: 'Real-time' },
            ].map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.1 }}
                className="flex-1 bg-black/[0.03] dark:bg-white/[0.04] backdrop-blur-sm border border-black/10 dark:border-white/[0.06] rounded-xl p-3 text-center">
                <p className="text-black dark:text-white font-bold text-lg">{s.n}</p>
                <p className="text-black/45 dark:text-white/30 text-[11px]">{s.l}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

      </div>
    </div>
  );
};

export default AuthPage;

