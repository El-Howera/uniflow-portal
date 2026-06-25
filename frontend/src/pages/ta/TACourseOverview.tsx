import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface Course {
    id: string;
    name: string;
    code: string;
    students: number;
    nextLecture: string;
    nextLectureTime: string;
    professor: string;
    newMessages: number;
}

// --- Static preview data ---
const MOCK_COURSES: Course[] = [
    { id: 'c1', name: 'Data Structures', code: 'CS201', students: 48, nextLecture: 'Monday', nextLectureTime: '09:00 AM', professor: 'Dr. Karim Mansour', newMessages: 3 },
    { id: 'c2', name: 'Linear Algebra', code: 'MA205', students: 56, nextLecture: 'Tuesday', nextLectureTime: '11:00 AM', professor: 'Dr. Hala Sabry', newMessages: 0 },
    { id: 'c3', name: 'Intro to Programming', code: 'CS101', students: 38, nextLecture: 'Wednesday', nextLectureTime: '02:00 PM', professor: 'Dr. Ahmed Zaki', newMessages: 5 },
];

// Hover transition kept snappy on purpose — the previous default spring
// took ~400 ms to settle, which read as "delayed" on a card grid where
// the user is moving the cursor quickly. A 0.18 s tween + immediate
// border/shadow change gives instant feedback.
const CARD_HOVER_TRANSITION = { duration: 0.18, ease: 'easeOut' as const };

const CourseCard: React.FC<{ course: Course; onClick: () => void }> = ({ course, onClick }) => {
    const t = useT();
    return (
    <motion.div
        whileHover={{ y: -4, scale: 1.015 }}
        whileTap={{ scale: 0.99 }}
        transition={CARD_HOVER_TRANSITION}
        onClick={onClick}
        className={`${glassCardStyle} p-5 flex flex-col justify-between cursor-pointer transition-[border-color,box-shadow,background-color] duration-150 ease-out hover:border-[#6A3FF4]/60 hover:shadow-purple-500/20 hover:bg-white/15 dark:hover:bg-black/30`}
    >
        <div>
            <div className="flex items-start justify-between mb-4">
                <h3 className="text-black dark:text-white font-bold text-base leading-tight">{course.name}</h3>
                <span className="text-[10px] font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 px-2 py-0.5 rounded-full flex-shrink-0 ml-2">{course.code}</span>
            </div>
            <div className="space-y-2.5 text-sm text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-2"><i className="ph-fill ph-users text-[#6A3FF4]"></i><span>{t('ta.studentsLabel')}: <strong className="text-black dark:text-white">{course.students}</strong></span></div>
                <div className="flex items-center gap-2"><i className="ph-fill ph-calendar text-[#6A3FF4]"></i><span>{t('ta.nextLectureLabel')}: <strong className="text-black dark:text-white">{course.nextLecture}, {course.nextLectureTime}</strong></span></div>
                <div className="flex items-center gap-2"><i className="ph-fill ph-chalkboard-teacher text-[#6A3FF4]"></i><span>{t('staff.instructor')}: <strong className="text-black dark:text-white">{course.professor}</strong></span></div>
            </div>
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10 dark:border-white/5">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <i className="ph-fill ph-identification-badge text-[#6A3FF4]"></i>
                <span>{t('ta.teachingAssistantBadge')}</span>
            </div>
            {course.newMessages > 0 && (
                <span className="flex items-center gap-1 text-xs font-bold bg-[#6A3FF4] text-white px-2.5 py-1 rounded-full">
                    <i className="ph-fill ph-chat-circle-dots"></i>{t('ta.newMessages', { n: course.newMessages })}
                </span>
            )}
        </div>
    </motion.div>
    );
};

const TACourseOverview: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState('name');
    const [courses, setCourses] = useState<Course[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // MVP build — populate from static mock data, no backend calls.
        setCourses(MOCK_COURSES);
        setIsLoading(false);
    }, []);

    const filtered = courses
        .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.code.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a, b) => {
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'students') return b.students - a.students;
            if (sortBy === 'code') return a.code.localeCompare(b.code);
            return 0;
        });

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('ta.coursesTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('ta.coursesSubtitle')}</p>
            </AnimateOnView>

            <AnimateOnView delay={0.1} enabled={false}>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <div className="relative flex-1 max-w-sm">
                        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                        <input type="text" placeholder={t('ta.searchCoursesPlaceholder')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                            className="w-full bg-white/30 dark:bg-black/20 backdrop-blur-lg border border-white/20 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 shadow-lg focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
                        />
                    </div>
                    <div className="min-w-[180px]">
                        <GlassDropdown
                            value={sortBy}
                            onChange={setSortBy}
                            options={[
                                { value: 'name', label: t('ta.sortByName'), icon: 'ph-text-aa' },
                                { value: 'students', label: t('ta.sortByStudents'), icon: 'ph-users' },
                                { value: 'code', label: t('ta.sortByCode'), icon: 'ph-hash' },
                            ]}
                            direction="auto"
                            className="w-full"
                        />
                    </div>
                </div>
            </AnimateOnView>

            {isLoading ? (
                <div className="text-center py-20"><i className="ph-duotone ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    <AnimatePresence mode="popLayout">
                        {filtered.map((course, i) => (
                            <AnimateOnView key={course.id} delay={0.1 + i * 0.05} enabled={false}>
                                <CourseCard course={course} onClick={() => navigate('/ta/courses/' + course.code)} />
                            </AnimateOnView>
                        ))}
                    </AnimatePresence>
                    {filtered.length === 0 && (
                        <div className={`col-span-full ${glassCardStyle} p-12 text-center`}>
                            <i className="ph-bold ph-magnifying-glass text-4xl text-gray-400 mb-3 block"></i>
                            <p className="text-gray-500 dark:text-gray-400">{searchTerm ? t('ta.noCoursesMatchSearch') : t('ta.noCoursesAssignedYet')}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default TACourseOverview;
