// Schedule Policy — admin-editable timetable grid config.
//
// Drives the auto-scheduler in /admin/timetable/wizard. Working days
// (weekend exclusion), slot length (1hr / 2hr / etc.), and the day window
// (when classes can start / end) are all chosen here.

import React, { useState } from 'react';
import { AnimateOnView } from '../../../components/AnimateOnView';
import { GlassDropdown } from '../../../components/GlassDropdown';
import { resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle, inputStyle } from './_shared';

const labelStyle = 'block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider';

interface Policy {
    workingDays: string[];
    slotMinutes: number;
    dayStart: string;
    dayEnd: string;
}

const ALL_DAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// MVP build — FCDS default schedule policy (Sun–Thu, 60-min slots, 08:00–20:00).
const DEFAULT_POLICY: Policy = {
    workingDays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
    slotMinutes: 60,
    dayStart: '08:00',
    dayEnd: '20:00',
};

function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

function previewSlots(p: Policy): { day: string; startTime: string; endTime: string }[] {
    if (toMinutes(p.dayStart) >= toMinutes(p.dayEnd)) return [];
    const slots: { day: string; startTime: string; endTime: string }[] = [];
    const start = toMinutes(p.dayStart);
    const end = toMinutes(p.dayEnd);
    for (const day of p.workingDays) {
        for (let t = start; t + p.slotMinutes <= end; t += p.slotMinutes) {
            const sh = Math.floor(t / 60).toString().padStart(2, '0');
            const sm = (t % 60).toString().padStart(2, '0');
            const eh = Math.floor((t + p.slotMinutes) / 60).toString().padStart(2, '0');
            const em = ((t + p.slotMinutes) % 60).toString().padStart(2, '0');
            slots.push({ day, startTime: `${sh}:${sm}`, endTime: `${eh}:${em}` });
        }
    }
    return slots;
}

const SchedulePolicyPage: React.FC = () => {
    const t = useT();
    const institution = useInstitutionConfig();
    const [policy, setPolicy] = useState<Policy | null>({ ...DEFAULT_POLICY });
    const [defaults] = useState<Policy | null>(DEFAULT_POLICY);
    const [loading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);

    const update = (patch: Partial<Policy>) => setPolicy((p) => (p ? { ...p, ...patch } : p));

    const toggleDay = (day: string) => {
        if (!policy) return;
        const has = policy.workingDays.includes(day);
        const next = has ? policy.workingDays.filter((d) => d !== day) : [...policy.workingDays, day];
        update({ workingDays: next });
    };

    const save = () => {
        if (!policy) return;
        setSaving(true);
        setError(null);
        setFlash(null);
        // MVP build — local-only save, no network.
        setFlash('Saved.');
        setTimeout(() => setFlash(null), 2500);
        setSaving(false);
    };

    const resetDefaults = () => {
        if (defaults) setPolicy({ ...defaults });
    };

    if (loading || !policy) return <div className="p-12 text-center text-gray-500 animate-pulse">{t('admin.apLoadingDots')}</div>;

    const slots = previewSlots(policy);
    const slotsPerDay = policy.workingDays.length > 0 ? slots.length / policy.workingDays.length : 0;

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white mb-2">{t('admin.apSchedulePolicyTitle')}</h1>
                <p className="text-black dark:text-gray-300 text-sm">
                    {t('admin.schedulePolicySubtitle')}
                </p>
            </AnimateOnView>

            {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>
            )}
            {flash && (
                <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm">{flash}</div>
            )}

            <div className={`${glassCardStyle} p-6 space-y-6`}>
                <div>
                    <label className={labelStyle}>{t('admin.workingDays')}</label>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {ALL_DAYS.map((d) => {
                            const active = policy.workingDays.includes(d);
                            return (
                                <button
                                    key={d}
                                    onClick={() => toggleDay(d)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                                        active
                                            ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                                            : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                                    }`}
                                >
                                    {d}
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                        Inactive days are weekends — the scheduler skips them. Click to toggle.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className={labelStyle}>{t('admin.slotDuration')}</label>
                        <GlassDropdown
                            value={String(policy.slotMinutes)}
                            onChange={(v) => update({ slotMinutes: Number(v) })}
                            options={[30, 45, 60, 90, 120, 180].map((m) => ({
                                value: String(m),
                                label: m === 60 ? t('admin.slotOneHour') : m === 120 ? t('admin.slotTwoHours') : m === 180 ? t('admin.slotThreeHours') : t('admin.slotMinutes', { n: m }),
                                icon: 'ph-clock',
                            }))}
                        />
                    </div>
                    {/* Day start / end time inputs — full-width is too
                        wide on mobile (looks stretched in a single-column
                        grid cell). Constrain to ~10rem on mobile and
                        center horizontally; restore full-width at md+
                        where the 3-column grid keeps them naturally
                        compact. */}
                    <div className="text-center md:text-left">
                        <label className={labelStyle}>{t('admin.dayStart')}</label>
                        <input
                            type="time"
                            value={policy.dayStart}
                            onChange={(e) => update({ dayStart: e.target.value })}
                            className={`${inputStyle} [color-scheme:dark] max-w-[10rem] md:max-w-none mx-auto md:mx-0`}
                        />
                    </div>
                    <div className="text-center md:text-left">
                        <label className={labelStyle}>{t('admin.dayEnd')}</label>
                        <input
                            type="time"
                            value={policy.dayEnd}
                            onChange={(e) => update({ dayEnd: e.target.value })}
                            className={`${inputStyle} [color-scheme:dark] max-w-[10rem] md:max-w-none mx-auto md:mx-0`}
                        />
                    </div>
                </div>

                <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-xs text-gray-300">
                    <p className="font-bold mb-2 text-[#7B5AFF]">{t('admin.livePreview')}</p>
                    <p>
                        {policy.workingDays.length} working day{policy.workingDays.length === 1 ? '' : 's'} ·{' '}
                        {policy.slotMinutes}-minute slots · {policy.dayStart}–{policy.dayEnd} ·{' '}
                        <strong className="text-white">{slotsPerDay} slots/day</strong> ·{' '}
                        <strong className="text-white">{slots.length} slots/week</strong>
                    </p>
                    {slots.length === 0 && (
                        <p className="mt-2 text-amber-400">
                            {t('admin.daySpanValidation')}
                        </p>
                    )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button
                        onClick={resetDefaults}
                        className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-black dark:text-white text-sm hover:bg-white/10"
                    >
                        {resetLabel(institution)}
                    </button>
                    <button
                        onClick={save}
                        disabled={saving || slots.length === 0 || policy.workingDays.length === 0}
                        className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 disabled:opacity-50"
                    >
                        {saving ? t('admin.saving') : t('admin.savePolicy')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SchedulePolicyPage;
