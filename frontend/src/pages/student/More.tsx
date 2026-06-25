import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { useTr } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

const More: React.FC = () => {
    const navigate = useNavigate();
    const { userRole, setIsAuthenticated } = useAppContext();
    const tr = useTr();

    const menuSections = [
        {
            title: 'Academics',
            items: [
                { label: 'Assignments', icon: 'ph-clipboard-text', color: '#6A3FF4', path: `/${userRole}/assignments` },
                { label: 'Quizzes', icon: 'ph-exam', color: '#14B8A6', path: `/${userRole}/quizzes` },
                { label: 'Online Lectures', icon: 'ph-video-camera', color: '#F59E0B', path: `/${userRole}/online-lectures` },
                { label: 'Attendance', icon: 'ph-check-circle', color: '#22C55E', path: `/${userRole}/attendance` },
                { label: 'Mark Attendance', icon: 'ph-qr-code', color: '#10B981', path: `/${userRole}/mark-attendance` },
            ],
        },
        {
            title: 'Records',
            items: [
                { label: 'GPA Calculator', icon: 'ph-chart-bar', color: '#8B5CF6', path: `/${userRole}/gpa-calculator` },
                { label: 'Transcript', icon: 'ph-graduation-cap', color: '#F59E0B', path: `/${userRole}/full-transcript` },
                { label: 'Registration', icon: 'ph-user-plus', color: '#6366F1', path: `/${userRole}/registrations` },
                { label: 'Payments', icon: 'ph-credit-card', color: '#EF4444', path: `/${userRole}/payments` },
            ],
        },
        {
            title: 'Support',
            items: [
                { label: 'Student Affairs', icon: 'ph-users', color: '#06B6D4', path: `/${userRole}/student-affairs` },
                { label: 'Announcements', icon: 'ph-megaphone', color: '#F97316', path: `/${userRole}/announcements` },
                { label: 'Notifications', icon: 'ph-bell', color: '#3B82F6', path: `/${userRole}/notifications` },
                { label: 'FAQ Chatbot', icon: 'ph-robot', color: '#A855F7', path: `/${userRole}/faq-chatbot` },
            ],
        },
        {
            title: 'Account',
            items: [
                { label: 'My Profile', icon: 'ph-user-circle', color: '#6A3FF4', path: `/${userRole}/view-profile` },
                { label: 'Settings', icon: 'ph-gear', color: '#6B7280', path: `/${userRole}/settings` },
            ],
        },
    ];

    return (
        <div className="space-y-6 pb-28">
            <div>
                <h1 className="text-2xl font-bold text-black dark:text-white">{tr('Menu')}</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{tr('All features at your fingertips')}</p>
            </div>

            {menuSections.map((section) => (
                <div key={section.title}>
                    <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3 px-1">{tr(section.title)}</h3>
                    <div className={`${glassCardStyle} divide-y divide-gray-200/50 dark:divide-white/5 overflow-hidden`}>
                        {section.items.map((item) => (
                            <button
                                key={item.label}
                                onClick={() => navigate(item.path)}
                                className="flex items-center w-full px-4 py-3.5 hover:bg-white/20 dark:hover:bg-white/5 transition-colors active:bg-white/30 dark:active:bg-white/10"
                            >
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center mr-3 flex-shrink-0" style={{ backgroundColor: `${item.color}15` }}>
                                    <i className={`ph-fill ${item.icon} text-lg`} style={{ color: item.color }}></i>
                                </div>
                                <span className="text-sm font-medium text-black dark:text-white flex-1 text-left">{tr(item.label)}</span>
                                <i className="ph-bold ph-caret-right text-xs text-gray-400 dark:text-gray-500"></i>
                            </button>
                        ))}
                    </div>
                </div>
            ))}

            <button
                onClick={() => setIsAuthenticated(false)}
                className={`${glassCardStyle} w-full p-4 flex items-center justify-center gap-3 text-red-500 hover:bg-red-500/10 transition-all active:bg-red-500/20`}
            >
                <i className="ph-bold ph-sign-out text-xl"></i>
                <span className="font-semibold">{tr('Sign Out')}</span>
            </button>
        </div>
    );
};

export default More;
