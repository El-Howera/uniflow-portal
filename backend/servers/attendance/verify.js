/**
 * Attendance server modularisation verification script.
 * Run: node verify.js
 * Monkey-patches app.listen to bind an ephemeral port and close immediately.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// Monkey-patch require('../../lib/prisma') to return a stub
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('lib/prisma') || request.endsWith('lib\\prisma')) {
    return { $disconnect: async () => {} };
  }
  if (request.endsWith('lib/cors') || request.endsWith('lib\\cors')) {
    return (req, res, next) => next();
  }
  if (request.endsWith('lib/errors') || request.endsWith('lib\\errors')) {
    class AppError extends Error {
      constructor(msg, status) { super(msg); this.status = status; }
    }
    return {
      AppError,
      asyncHandler: (fn) => (req, res, next) => fn(req, res, next).catch(next),
      errorHandler: (err, req, res, next) => res.status(err.status || 500).json({ error: err.message }),
    };
  }
  if (request.endsWith('lib/auth') || request.endsWith('lib\\auth')) {
    return {
      requireAuth: (req, res, next) => next(),
      requireRole: () => (req, res, next) => next(),
    };
  }
  if (request.endsWith('lib/tenant-resolver') || request.endsWith('lib\\tenant-resolver')) {
    return { tenantResolver: () => (req, res, next) => next() };
  }
  if (request.endsWith('lib/tenant-context') || request.endsWith('lib\\tenant-context')) {
    return {
      restoreTenantContext: (req, res, next) => next(),
      runWithTenant: async (ctx, fn) => fn(),
    };
  }
  if (request.endsWith('lib/users') || request.endsWith('lib\\users')) {
    return { resolveUser: async (id) => ({ id }) };
  }
  if (request.endsWith('lib/attendance-rules') || request.endsWith('lib\\attendance-rules')) {
    return { getHolidays: async () => [], effectiveMeetingCount: (r) => r, isHoliday: () => false };
  }
  if (request.endsWith('lib/graduation-policy') || request.endsWith('lib\\graduation-policy')) {
    return { getSemesterDurations: async () => ({ fallWeeks: 15, springWeeks: 15, summerWeeks: 8 }) };
  }
  if (request.endsWith('lib/course-eligibility') || request.endsWith('lib\\course-eligibility')) {
    return { extractTermName: () => 'Fall' };
  }
  if (request.endsWith('lib/finalized-courses') || request.endsWith('lib\\finalized-courses')) {
    return { getFinalizedCourseIds: async () => new Set() };
  }
  return originalLoad.apply(this, arguments);
};

const http = require('http');
const express = require('express');

// Load route files and verify they export routers
const files = [
  './routes/sessions.routes.js',
  './routes/records.routes.js',
  './routes/public.routes.js',
  './routes/excuses.routes.js',
  './routes/admin.routes.js',
  './lib/qr.js',
  './lib/restrictions.js',
];

let allOk = true;
const results = [];

for (const f of files) {
  try {
    const mod = require(f);
    const type = f.endsWith('.routes.js') ? 'router' : 'module';
    if (type === 'router') {
      const stackLen = (mod.stack || mod.router?.stack || []).length;
      results.push({ file: f, ok: true, stackLen });
    } else {
      const keys = Object.keys(mod);
      results.push({ file: f, ok: true, exports: keys });
    }
  } catch (e) {
    results.push({ file: f, ok: false, error: e.message });
    allOk = false;
  }
}

console.log('\n=== Module load results ===');
for (const r of results) {
  if (r.ok) {
    const detail = r.stackLen !== undefined ? `stack=${r.stackLen}` : `exports=[${r.exports}]`;
    console.log(`  OK  ${r.file}  (${detail})`);
  } else {
    console.error(`  FAIL  ${r.file}  — ${r.error}`);
  }
}

// Boot test: load index.js with monkey-patched listen
console.log('\n=== Boot test ===');
const origListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (port, host, cb) {
  // Bind 0 = ephemeral port
  const fn = typeof cb === 'function' ? cb : (typeof host === 'function' ? host : () => {});
  return origListen.call(this, 0, '127.0.0.1', () => {
    const addr = this.address();
    console.log(`  Boot OK — listening on :${addr && addr.port} (ephemeral)`);
    this.close(() => {
      console.log('  Server closed cleanly.');
    });
    fn();
  });
};

try {
  require('./index.js');
} catch (e) {
  console.error('  Boot FAILED:', e.message);
  allOk = false;
}

setTimeout(() => {
  console.log('\n=== Verification ' + (allOk ? 'PASSED' : 'FAILED') + ' ===\n');
  process.exit(allOk ? 0 : 1);
}, 1000);
