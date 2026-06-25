/**
 * Plan 5 Phase 4 — Login lock resolution.
 *
 * The login handler (POST /api/auth/login in user-profile) calls
 * resolveActiveLock(prisma, user) AFTER the password check passes but BEFORE
 * issuing the JWT. If a lock is active for the user (directly, by level,
 * by department, by role, or by program), the handler returns a structured
 * 403 with the lock's `reason` text — surfaced verbatim at the login screen.
 *
 * Lock types
 *   - permanent lock      isTimeWindow=false, expiresAt=null
 *   - expiring lock       isTimeWindow=false, expiresAt=<future>
 *   - time-window lock    isTimeWindow=true, openFrom/openTo set
 *                         (lock ACTIVE outside the [openFrom, openTo] window)
 *
 * Lock target precedence (most specific wins)
 *   1. user
 *   2. department
 *   3. level
 *   4. program
 *   5. role
 *
 * Released locks (releasedAt set) are ignored.
 */

const KIND_RANK = { user: 0, department: 1, level: 2, program: 3, role: 4 };

/**
 * Decide whether a lock row is currently active.
 * Fail-closed: a misconfigured time-window lock (missing openFrom/openTo)
 * is treated as ACTIVE rather than silently letting the user in.
 */
function isLockActive(lock, now = new Date()) {
  if (!lock) return false;
  if (lock.releasedAt) return false;

  if (lock.isTimeWindow) {
    if (!lock.openFrom || !lock.openTo) return true; // misconfig → fail closed
    return !(now >= lock.openFrom && now <= lock.openTo);
  }

  if (lock.expiresAt && now > lock.expiresAt) return false;
  return true;
}

/**
 * Hint when the lock will next allow access.
 *   - time-window: the next openFrom (if in the future)
 *   - expiring:    the expiresAt boundary
 *   - permanent:   null
 */
function nextOpenFor(lock, now = new Date()) {
  if (!lock) return null;
  if (lock.isTimeWindow && lock.openFrom && now < lock.openFrom) return lock.openFrom;
  if (!lock.isTimeWindow && lock.expiresAt && now < lock.expiresAt) return lock.expiresAt;
  return null;
}

/**
 * Find the most-specific active lock for `user`. Returns null if no lock
 * applies. The user object must include academicProfile (level + department
 * + program) to evaluate non-user locks.
 *
 * `targetId` values (matching the strings stored on the user/profile):
 *   user        -> User.id
 *   department  -> AcademicProfile.department (free-text in this schema —
 *                  typically the department code or name; admin must use the
 *                  exact value stored on student profiles)
 *   level       -> academic level as text ('1','2','3','4')
 *   program     -> AcademicProfile.program (free-text)
 *   role        -> UserRole enum value ('student','professor', etc.)
 */
async function resolveActiveLock(prisma, user) {
  if (!prisma || !user) return null;
  const now = new Date();

  const academicLevel = user.academicProfile?.level != null
    ? String(user.academicProfile.level) : '';
  const department = user.academicProfile?.department || '';
  const program = user.academicProfile?.program || '';

  const targetClauses = [
    { targetKind: 'user', targetId: user.id },
  ];
  if (department) targetClauses.push({ targetKind: 'department', targetId: department });
  if (academicLevel) targetClauses.push({ targetKind: 'level', targetId: academicLevel });
  if (program) targetClauses.push({ targetKind: 'program', targetId: program });
  if (user.role) targetClauses.push({ targetKind: 'role', targetId: user.role });

  const candidates = await prisma.loginLock.findMany({
    where: {
      releasedAt: null,
      OR: targetClauses,
    },
  });

  // Sort by KIND_RANK (most specific first), then by createdAt desc for stable
  // precedence when two locks share the same kind.
  candidates.sort((a, b) => {
    const ra = KIND_RANK[a.targetKind] ?? 99;
    const rb = KIND_RANK[b.targetKind] ?? 99;
    if (ra !== rb) return ra - rb;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  for (const lock of candidates) {
    if (isLockActive(lock, now)) {
      return { ...lock, nextOpen: nextOpenFor(lock, now) };
    }
  }
  return null;
}

module.exports = {
  resolveActiveLock,
  isLockActive,
  nextOpenFor,
  KIND_RANK,
};
