import { isNativeApp } from '../shared/config';

// The interactive User Guide is a static site served by nginx at /userguide on
// the production origin (https://www.uni-flow.tech/userguide).
//
//   - Web / PWA  → relative `/userguide` (same origin) works.
//   - Electron   → loads the production origin directly, so `/userguide` is
//                  same-origin too; main.ts opens it in an in-app window.
//   - Capacitor  → the app runs from a LOCAL webview origin
//                  (capacitor://localhost / https://localhost), so a relative
//                  `/userguide` would 404. Use the absolute production URL.
//
// REACT_APP_GUIDE_URL overrides everything (e.g. point dev at the Vite dev
// server on :5173).
const PROD_GUIDE_URL = 'https://www.uni-flow.tech/userguide';

export const getGuideUrl = (): string => {
  if (process.env.REACT_APP_GUIDE_URL) return process.env.REACT_APP_GUIDE_URL;
  if (isNativeApp()) return PROD_GUIDE_URL;
  return '/userguide';
};
