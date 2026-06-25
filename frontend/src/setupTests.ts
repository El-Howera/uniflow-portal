// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// React Router v7 requires TextEncoder / TextDecoder which jsdom (Node <18) doesn't expose.
// Polyfill from Node's built-in util module.
import { TextEncoder, TextDecoder } from 'util';
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder as unknown as typeof global.TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder;
}

// jsdom does not implement scrollIntoView — add a no-op stub so components
// that call element.scrollIntoView() (e.g. chat scroll-to-bottom) don't throw.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}

// ────────────────────────────────────────────────────────────────────────────
// Test console noise filter.
//
// Several tests deliberately exercise error paths in the source code:
//   - registration.test.tsx asserts the "Could not connect to registration
//     server" fallback, which triggers `console.error('Error fetching ...')`
//     inside RegistrationContext.
//   - chatbot.test.tsx clicks send when the streaming-mock throws, triggering
//     `console.warn('[chatbot] stream error, falling back to /api/chat:')`
//     inside Chatbot.tsx.
//   - auth.test.tsx's 401-credentials test surfaces a jsdom-internal
//     AggregateError via the virtual console (jsdom XHR plumbing).
//
// None are failures. They make the CI log noisy and bury real warnings.
// Filter ONLY the known-intentional patterns — legitimate React warnings
// (key prop missing, ref forwarding bugs, hook-rule violations, etc.) still
// pass through.
// ────────────────────────────────────────────────────────────────────────────

const SILENCED_PATTERNS = [
  /Error fetching courses:/,
  /\[chatbot\] stream error/,
  /Error: AggregateError/,  // jsdom XHR plumbing
];

function isSilenced(args: unknown[]): boolean {
  for (const a of args) {
    const msg = typeof a === 'string' ? a : String((a as { message?: string })?.message || '');
    if (SILENCED_PATTERNS.some((p) => p.test(msg))) return true;
  }
  return false;
}

const originalError = console.error.bind(console);
const originalWarn = console.warn.bind(console);

console.error = (...args: unknown[]) => {
  if (isSilenced(args)) return;
  originalError(...(args as Parameters<typeof console.error>));
};
console.warn = (...args: unknown[]) => {
  if (isSilenced(args)) return;
  originalWarn(...(args as Parameters<typeof console.warn>));
};
