// src/pages/it/ITDashboard.tsx
//
// Landing page for the `it` sub-role. Read-only operational view —
// surfaces uptime, DB latency, active sessions, and recent audit events
// at a glance, with quick-jump cards to System Health, Audit Logs,
// Analytics, and Sign-In Locks.
//
// Backend reuse:
//   GET /api/admin/system-health     — uptime + db latency + cpu/mem
//   GET /api/admin/active-sessions   — token-issued counts + online users
//   GET /api/admin/audit-logs        — last N audit events (preview)
//   GET /api/admin/login-locks       — current locks (count surfaced)
//
// requireScope('it') on the backend accepts `it` and `admin`,
// so this dashboard works without any new endpoints.

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ParticleCard } from '../../components/MagicBento';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface SystemHealth {
  status: string;
  uptime: number;
  database: { status: string; latency: number };
  cpu: { loadAvg1m: number; cpuPercent?: number | null; cores?: number };
  memory: { totalMB: number; freeMB: number; usedPercent: number };
}

interface ActiveSessions {
  activeSessions: number;
  onlineUsers: number;
}

interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
  performer?: { firstName?: string; lastName?: string; email?: string };
  target?: string;
}

interface LoginLock {
  id: string;
  kind: string;
  targetId: string;
  reason?: string;
}

// ── Preview mock data (pure front-end, no backend) ──────────────────────────
const MOCK_HEALTH: SystemHealth = {
  status: 'healthy',
  uptime: 1_034_280, // ~11d 23h
  database: { status: 'connected', latency: 38 },
  cpu: { loadAvg1m: 0.74, cpuPercent: 23, cores: 8 },
  memory: { totalMB: 16_384, freeMB: 6_912, usedPercent: 57.8 },
};

const MOCK_SESSIONS: ActiveSessions = {
  activeSessions: 342,
  onlineUsers: 128,
};

const MOCK_LOGS: AuditEntry[] = [
  { id: 'aud-9012', action: 'user.login.success', createdAt: '2026-06-19T09:14:00Z', performer: { firstName: 'Mariam', lastName: 'Hassan', email: 'mariam.hassan@uniflow.edu' } },
  { id: 'aud-9011', action: 'course.grade.override', createdAt: '2026-06-19T08:52:00Z', performer: { firstName: 'Dr. Omar', lastName: 'Tarek', email: 'omar.tarek@uniflow.edu' } },
  { id: 'aud-9010', action: 'system.settings.update', createdAt: '2026-06-19T08:30:00Z', performer: { firstName: 'Admin', lastName: 'Office', email: 'admin@uniflow.edu' } },
  { id: 'aud-9009', action: 'user.password.reset', createdAt: '2026-06-19T07:48:00Z', performer: { email: 'salma.adel@uniflow.edu' } },
  { id: 'aud-9008', action: 'registration.period.open', createdAt: '2026-06-18T16:05:00Z', performer: { firstName: 'Admin', lastName: 'Office', email: 'admin@uniflow.edu' } },
  { id: 'aud-9007', action: 'user.role.assign', createdAt: '2026-06-18T15:22:00Z', performer: { firstName: 'Admin', lastName: 'Office', email: 'admin@uniflow.edu' } },
  { id: 'aud-9006', action: 'payment.refund.issued', createdAt: '2026-06-18T13:40:00Z', performer: { firstName: 'Finance', lastName: 'Desk', email: 'finance@uniflow.edu' } },
  { id: 'aud-9005', action: 'user.login.failed', createdAt: '2026-06-18T11:11:00Z', performer: { email: 'unknown@uniflow.edu' } },
];

const MOCK_LOCKS: LoginLock[] = [
  { id: 'lock-301', kind: 'user', targetId: 'youssef.nabil@uniflow.edu', reason: 'Repeated failed login attempts' },
  { id: 'lock-302', kind: 'ip', targetId: '197.45.112.8', reason: 'Suspicious activity flagged by WAF' },
  { id: 'lock-303', kind: 'user', targetId: 'hana.fathy@uniflow.edu', reason: 'Account under security review' },
];

const formatUptime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const latencyTone = (ms: number | undefined): string => {
  if (ms == null) return '#9CA3AF';
  if (ms < 50) return '#22C55E';
  if (ms < 150) return '#F59E0B';
  return '#EF4444';
};

const StatTile: React.FC<{
  label: string;
  value: string;
  hint: string;
  icon: string;
  toPath: string;
  accent?: string;
  loading?: boolean;
}> = ({ label, value, hint, icon, toPath, accent = '#6A3FF4', loading }) => {
  const navigate = useNavigate();
  return (
    <ParticleCard
      className={`${glassCardStyle} p-6 flex flex-col justify-between h-full cursor-pointer`}
      enableTilt={false}
      enableMagnetism={false}
      clickEffect
      particleCount={8}
      glowColor="132, 0, 255"
    >
      <div className="flex justify-between items-start" onClick={() => navigate(toPath)}>
        <div className="flex items-center gap-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${accent}33` }}
          >
            <i className={`ph-fill ${icon} text-xl`} style={{ color: accent }} />
          </div>
          <span className="text-black dark:text-gray-300 font-bold text-sm uppercase tracking-wider">
            {label}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(toPath);
          }}
          className="w-8 h-8 rounded-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all group"
        >
          <i className="ph-bold ph-arrow-right text-black dark:text-gray-300 group-hover:text-white transition-colors" />
        </button>
      </div>
      <div className="my-3">
        {loading ? (
          <div className="h-10 w-32 bg-white/10 animate-pulse rounded-lg" />
        ) : (
          <span className="text-black dark:text-white font-bold text-2xl sm:text-3xl">{value}</span>
        )}
      </div>
      <p className="text-black dark:text-gray-300 text-xs leading-relaxed">{hint}</p>
    </ParticleCard>
  );
};

const QuickAction: React.FC<{
  title: string;
  description: string;
  icon: string;
  toPath: string;
}> = ({ title, description, icon, toPath }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(toPath)}
      className={`${glassCardStyle} p-5 text-left hover:border-[#6A3FF4]/40 transition-all group`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#6A3FF4]/20 flex items-center justify-center flex-shrink-0 group-hover:bg-[#6A3FF4] transition-colors">
          <i className={`ph-fill ${icon} text-xl text-[#6A3FF4] group-hover:text-white transition-colors`} />
        </div>
        <div className="min-w-0">
          <p className="text-black dark:text-white font-semibold text-sm">{title}</p>
          <p className="text-gray-600 dark:text-gray-400 text-xs mt-1 leading-relaxed">{description}</p>
        </div>
        <i className="ph-bold ph-arrow-right text-gray-500 group-hover:text-[#6A3FF4] transition-colors ml-auto flex-shrink-0" />
      </div>
    </button>
  );
};

const ITDashboard: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [sessions, setSessions] = useState<ActiveSessions | null>(null);
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [locks, setLocks] = useState<LoginLock[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // MVP build: populate from inline mock data, no backend.
    setHealth(MOCK_HEALTH);
    setSessions(MOCK_SESSIONS);
    setLogs(MOCK_LOGS);
    setLocks(MOCK_LOCKS);
    setIsLoading(false);
  }, []);

  const dbLatency = health?.database.latency;
  const memUsed = health?.memory.usedPercent ?? 0;

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-black dark:text-white mb-1 flex items-center gap-2">
          <i className="ph-fill ph-wrench text-[#6A3FF4]" />
          {t('it.dashboardTitle')}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {t('it.dashboardSubtitle')}
        </p>
      </motion.div>

      {/* Top KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label={t('it.uptime')}
          value={formatUptime(health?.uptime ?? 0)}
          hint={t('it.uptimeHint')}
          icon="ph-clock-clockwise"
          toPath="/it/system-health"
          loading={isLoading}
        />
        <StatTile
          label={t('it.dbLatency')}
          value={dbLatency != null ? `${dbLatency} ms` : '—'}
          hint={t('it.dbLatencyHint')}
          icon="ph-pulse"
          toPath="/it/system-health"
          accent={latencyTone(dbLatency)}
          loading={isLoading}
        />
        <StatTile
          label={t('it.activeSessions')}
          value={String(sessions?.activeSessions ?? 0)}
          hint={t('it.sessionsHint', { n: sessions?.onlineUsers ?? 0 })}
          icon="ph-users-three"
          toPath="/it/audit-logs"
          accent="#22C55E"
          loading={isLoading}
        />
        <StatTile
          label={t('it.memoryUsage')}
          value={`${Math.round(memUsed)}%`}
          hint={t('it.memHint', { mb: (health?.memory.freeMB ?? 0).toLocaleString() })}
          icon="ph-cpu"
          toPath="/it/system-health"
          accent={memUsed > 85 ? '#EF4444' : memUsed > 70 ? '#F59E0B' : '#A855F7'}
          loading={isLoading}
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickAction
          title={t('it.viewSystemHealth')}
          description={t('it.qaHealthDesc')}
          icon="ph-thermometer"
          toPath="/it/system-health"
        />
        <QuickAction
          title={t('it.viewAuditLogs')}
          description={t('it.qaAuditDesc')}
          icon="ph-file-magnifying-glass"
          toPath="/it/audit-logs"
        />
        <QuickAction
          title={t('it.qaAnalyticsTitle')}
          description={t('it.qaAnalyticsDesc')}
          icon="ph-chart-pie-slice"
          toPath="/it/analytics"
        />
        <QuickAction
          title={t('it.signInLocksLink')}
          description={t('it.qaLocksDesc', { n: locks.length })}
          icon="ph-lock"
          toPath="/it/signin-locks"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent audit log preview */}
        <div className={`${glassCardStyle} p-6`}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-black dark:text-white text-lg font-bold flex items-center">
              <i className="ph-bold ph-file-magnifying-glass mr-2 text-[#6A3FF4]" />
              {t('it.recentAudit')}
            </h2>
            <button
              onClick={() => navigate('/it/audit-logs')}
              className="text-sm text-black dark:text-gray-300 border border-white/20 dark:border-white/10 rounded-lg px-4 py-1.5 hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all"
            >
              {t('common.viewAll')}
            </button>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 w-full bg-white/5 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-10 text-gray-500 italic text-sm">
              {t('it.noAuditEvents')}
            </div>
          ) : (
            <div className="space-y-2">
              {logs.slice(0, 6).map((log) => {
                const performer = log.performer
                  ? `${log.performer.firstName ?? ''} ${log.performer.lastName ?? ''}`.trim() ||
                    log.performer.email ||
                    t('it.systemActor')
                  : t('it.systemActor');
                return (
                  <div
                    key={log.id}
                    className="flex items-center justify-between gap-3 p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[#6A3FF4] font-mono text-xs truncate">{log.action}</p>
                      <p className="text-gray-500 text-xs truncate">
                        {performer} · {new Date(log.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sign-in locks preview */}
        <div className={`${glassCardStyle} p-6`}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-black dark:text-white text-lg font-bold flex items-center">
              <i className="ph-bold ph-lock mr-2 text-[#6A3FF4]" />
              {t('it.signInLocksLink')}
            </h2>
            <button
              onClick={() => navigate('/it/signin-locks')}
              className="text-sm text-black dark:text-gray-300 border border-white/20 dark:border-white/10 rounded-lg px-4 py-1.5 hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all"
            >
              {t('staff.update')}
            </button>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 w-full bg-white/5 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : locks.length === 0 ? (
            <div className="text-center py-10 text-gray-500 italic text-sm">
              {t('it.noLocks')}
            </div>
          ) : (
            <div className="space-y-2">
              {locks.slice(0, 6).map((lock) => (
                <div
                  key={lock.id}
                  className="flex items-center justify-between gap-3 p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#6A3FF4]/20 text-[#6A3FF4] uppercase">
                        {lock.kind}
                      </span>
                      <span className="text-black dark:text-white text-sm font-medium truncate">
                        {lock.targetId}
                      </span>
                    </div>
                    {lock.reason && (
                      <p className="text-gray-500 text-xs mt-1 truncate" title={lock.reason}>
                        {lock.reason}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ITDashboard;
