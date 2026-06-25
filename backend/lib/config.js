/**
 * Centralized config loader for all backend services.
 * Validates required environment variables and provides typed access.
 * Can be imported and used in any backend service or startup script.
 */

require('dotenv').config({ silent: true });

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Helper to get and validate env vars
const getEnv = (key, defaultValue = null, required = false) => {
  const value = process.env[key];
  if (!value && required) {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue;
};

const config = {
  // ===== DATABASE =====
  database: {
    url: getEnv('DATABASE_URL', null, true),
    directUrl: getEnv('DIRECT_URL'),
  },

  // ===== JWT =====
  jwt: {
    secret: getEnv('JWT_SECRET', null, true),
    expiresIn: getEnv('JWT_EXPIRES_IN', '7d'),
  },

  // ===== SMTP EMAIL =====
  email: {
    host: getEnv('SMTP_HOST'),
    port: parseInt(getEnv('SMTP_PORT', '587'), 10),
    secure: getEnv('SMTP_SECURE', 'false').toLowerCase() === 'true',
    user: getEnv('SMTP_USER'),
    pass: getEnv('SMTP_PASS'),
    fromName: getEnv('SMTP_FROM_NAME', 'UniFlow Portal'),
  },

  // ===== SERVER PORTS =====
  ports: {
    ws: parseInt(getEnv('WS_PORT', '4001'), 10),
    registration: parseInt(getEnv('REG_PORT', '4002'), 10),
    attendance: parseInt(getEnv('ATTENDANCE_PORT', '4003'), 10),
    payments: parseInt(getEnv('PAYMENTS_PORT', '4004'), 10),
    contentServer: parseInt(getEnv('CONTENT_PORT', '4005'), 10),
    affairs: parseInt(getEnv('AFFAIRS_PORT', '4006'), 10),
    userProfile: parseInt(getEnv('PORT_PROFILE', '4007'), 10),
    chatbot: parseInt(getEnv('CHATBOT_PORT', '4008'), 10),
    notification: parseInt(getEnv('NOTIFICATION_PORT', '4009'), 10),
    chat: parseInt(getEnv('CHAT_PORT', '4010'), 10),
  },

  // ===== MISTRAL AI (chatbot) =====
  mistral: {
    apiKey: getEnv('MISTRAL_API_KEY'),
    model: getEnv('MISTRAL_MODEL', 'mistral-medium-latest'),
    baseUrl: getEnv('MISTRAL_BASE_URL', 'https://api.mistral.ai/v1'),
  },

  // ===== LIVEKIT (video conferencing) =====
  livekit: {
    url: getEnv('LIVEKIT_URL', 'wss://localhost:7880'),
    apiKey: getEnv('LIVEKIT_API_KEY'),
    apiSecret: getEnv('LIVEKIT_API_SECRET'),
  },

  // ===== JITSI (legacy) =====
  jitsi: {
    meetingUrlBase: getEnv('MEETING_URL_BASE', 'https://meet.jit.si/uniflow-'),
  },

  // ===== FIREBASE (optional) =====
  firebase: {
    serviceAccountKey: getEnv('FIREBASE_SERVICE_ACCOUNT_KEY'),
    projectId: getEnv('FIREBASE_PROJECT_ID'),
  },

  // ===== CORS =====
  cors: {
    origin: getEnv('CORS_ORIGIN', 'http://localhost:3000'),
  },

  // ===== FRONTEND (React) =====
  frontend: {
    chatbotUrl: getEnv('REACT_APP_CHATBOT_URL', 'http://localhost:4008/api'),
    wsUrl: getEnv('REACT_APP_WS_URL', 'http://localhost:4001'),
    apiUrl: getEnv('REACT_APP_API_URL', 'http://localhost'),
  },
};

// Validate required LiveKit config for video sessions
const validateLiveKit = () => {
  if (!config.livekit.apiKey || !config.livekit.apiSecret) {
    return {
      isValid: false,
      error: 'LiveKit credentials missing. Set LIVEKIT_API_KEY + LIVEKIT_API_SECRET in .env. See docker/livekit/README.md for self-hosting or sign up at https://livekit.io.',
    };
  }
  return { isValid: true, error: null };
};

// Validate required Firebase config for push notifications (optional but recommended)
const validateFirebase = () => {
  const hasFirebaseConfig = config.firebase.serviceAccountKey && config.firebase.projectId;
  return {
    isConfigured: hasFirebaseConfig,
    warning: !hasFirebaseConfig ? 'Firebase not configured. Push notifications will be disabled.' : null,
  };
};

module.exports = {
  config,
  getEnv,
  validateLiveKit,
  validateFirebase,
  ConfigError,
};
