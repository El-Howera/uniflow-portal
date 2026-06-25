import React, { useState, useEffect } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { API_URLS } from '@shared/config';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface CourseOption {
    code: string;
    name: string;
}

const ProfBroadcast: React.FC = () => {
    const t = useT();
    const [myCourses, setMyCourses] = useState<CourseOption[]>([]);
    const [selectedCourse, setSelectedCourse] = useState('');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [sending, setSending] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        const email = localStorage.getItem('currentUserEmail') || '';
        const token = localStorage.getItem('authToken');
        if (!email) return;

        fetch(`${API_URLS.courseContent()}/api/professor/courses-detailed/${email}`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(res => res.ok ? res.json() : Promise.reject(res.statusText))
            .then((data: { code: string; name: string }[]) => {
                const courses = data.map(c => ({ code: c.code, name: c.name }));
                setMyCourses(courses);
                if (courses.length > 0) setSelectedCourse(courses[0].code);
            })
            .catch(() => {
                setMyCourses([]);
            });
    }, []);

    const handleSend = async () => {
        if (!title.trim() || !body.trim() || !selectedCourse) return;

        setSuccessMsg('');
        setErrorMsg('');
        setSending(true);

        const firstName = localStorage.getItem('currentUserFirstName') || '';
        const lastName = localStorage.getItem('currentUserLastName') || '';
        const email = localStorage.getItem('currentUserEmail') || '';
        const senderName = `${firstName} ${lastName}`.trim() || email;
        const token = localStorage.getItem('authToken');

        try {
            const res = await fetch(`${API_URLS.notification()}/api/notifications/broadcast`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    targetRole: 'student',
                    courseCode: selectedCourse,
                    title: title.trim(),
                    body: body.trim(),
                    senderName,
                }),
            });

            if (!res.ok) {
                const err = await res.text();
                throw new Error(err || 'Broadcast failed');
            }

            setSuccessMsg(t('professor.broadcastSentTo', { course: selectedCourse }));
            setTitle('');
            setBody('');
        } catch (err) {
            const message = err instanceof Error ? err.message : t('professor.failedToSendBroadcast');
            setErrorMsg(message);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('professor.broadcastPageTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('professor.broadcastPageSubtitle')}</p>
            </AnimateOnView>

            <AnimateOnView delay={0.1} enabled={false}>
                <div className={`${glassCardStyle} p-6 max-w-2xl`}>
                    <h3 className="text-black dark:text-white text-lg font-bold mb-5 flex items-center gap-2">
                        <i className="ph-bold ph-megaphone text-[#6A3FF4]"></i>
                        {t('professor.composeBroadcast')}
                    </h3>

                    <div className="space-y-4">
                        {/* Course Selector */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-400 mb-1.5">{t('professor.targetCourse')}</label>
                            <GlassDropdown
                                value={selectedCourse}
                                onChange={setSelectedCourse}
                                options={
                                    myCourses.length === 0
                                        ? [{ value: '', label: t('professor.noCoursesAssignedOption') }]
                                        : myCourses.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))
                                }
                                direction="up"
                                className="w-full"
                            />
                        </div>

                        {/* Title */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-400 mb-1.5">{t('professor.titleLabel')}</label>
                            <input
                                type="text"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder={t('professor.titleInputPlaceholder')}
                                className="w-full bg-white/30 dark:bg-black/20 backdrop-blur-lg border border-white/20 dark:border-white/10 rounded-xl py-2.5 px-3 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
                            />
                        </div>

                        {/* Body */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-400 mb-1.5">{t('professor.messageLabel')}</label>
                            <textarea
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                rows={5}
                                placeholder={t('professor.messagePlaceholder')}
                                className="w-full bg-white/30 dark:bg-black/20 backdrop-blur-lg border border-white/20 dark:border-white/10 rounded-xl py-2.5 px-3 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6A3FF4] resize-none"
                            />
                        </div>

                        {/* Success banner */}
                        {successMsg && (
                            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-xl text-green-500 text-sm font-medium">
                                <i className="ph-bold ph-check-circle flex-shrink-0"></i>
                                {successMsg}
                            </div>
                        )}

                        {/* Error banner */}
                        {errorMsg && (
                            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-500 text-sm font-medium">
                                <i className="ph-bold ph-warning-circle flex-shrink-0"></i>
                                {errorMsg}
                            </div>
                        )}

                        {/* Send button */}
                        <button
                            onClick={handleSend}
                            disabled={sending || !title.trim() || !body.trim() || !selectedCourse}
                            className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold py-3 rounded-xl text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {sending ? (
                                <>
                                    <i className="ph-bold ph-spinner animate-spin"></i>
                                    {t('professor.sendingBtn')}
                                </>
                            ) : (
                                <>
                                    <i className="ph-bold ph-paper-plane-tilt"></i>
                                    {t('professor.sendBroadcastBtn')}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </AnimateOnView>
        </div>
    );
};

export default ProfBroadcast;
