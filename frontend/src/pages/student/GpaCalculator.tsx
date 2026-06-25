import React, { useState } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { generateGPAReportPDF, GPAReportData } from '../../utils/pdfGenerator';
import { fetchTranscript } from '../../utils/userProfileService';
import { useT } from '../../i18n';
import { useGradingRules, letterToPoints } from '../../utils/gradingRules';

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

interface GPACourse {
  id: number;
  name: string;
  credits: number;
  grade: string;
}

const initialGPACourses: GPACourse[] = [
  { id: 1, name: 'Calculus I', credits: 3, grade: 'A' },
  { id: 2, name: 'Introduction to Programming', credits: 4, grade: 'B+' },
  { id: 3, name: 'English Literature', credits: 3, grade: 'A-' },
];

const creditOptions = [1, 2, 3, 4, 5];

const GPACourseRow: React.FC<{
  course: GPACourse;
  gradeOptions: string[];
  onUpdate: (id: number, field: keyof Omit<GPACourse, 'id'>, value: string | number) => void;
  onDelete: (id: number) => void;
}> = ({ course, gradeOptions, onUpdate, onDelete }) => {
  const t = useT();
  return (
    <>
      {/* Mobile (<md): stack as a card so the credits / grade pickers have
          real width to render. Course name on top with the delete button
          inline to the right (was a third grid column that pushed past the
          card's right edge). Credits + Grade fill the second row 1:1. */}
      <div className="md:hidden bg-white/30 dark:bg-black/20 border border-white/15 dark:border-white/5 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={course.name}
            placeholder={t('gpaCalculatorPage.courseName')}
            onChange={(e) => onUpdate(course.id, 'name', e.target.value)}
            className="flex-1 min-w-0 bg-white/50 dark:bg-[#0D0D0D] border border-gray-300/50 dark:border-[#363636] rounded-lg px-3 py-2 text-black dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
          />
          <button
            onClick={() => onDelete(course.id)}
            aria-label={t('gpaCalculatorPage.removeCourse')}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors duration-200"
          >
            <i className="ph-bold ph-trash text-lg"></i>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-gray-500 font-medium uppercase mb-1">{t('gpaCalculatorPage.credits')}</label>
            <GlassDropdown
              value={String(course.credits)}
              onChange={(v) => onUpdate(course.id, 'credits', parseInt(v))}
              options={creditOptions.map((c) => ({ value: String(c), label: String(c) }))}
              direction="up"
              className="w-20"
              compact
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 font-medium uppercase mb-1">{t('gpaCalculatorPage.grade')}</label>
            <GlassDropdown
              value={course.grade}
              onChange={(v) => onUpdate(course.id, 'grade', v)}
              options={gradeOptions.map((g) => ({ value: g, label: g }))}
              direction="up"
              className="w-20"
              compact
            />
          </div>
        </div>
      </div>

      {/* Desktop (md+): preserve the 12-col grid alignment with the header
          labels above. */}
      <div className="hidden md:grid grid-cols-12 gap-4 items-center">
        <div className="col-span-6">
          <input
            type="text"
            value={course.name}
            placeholder={t('gpaCalculatorPage.courseName')}
            onChange={(e) => onUpdate(course.id, 'name', e.target.value)}
            className="w-full bg-white/50 dark:bg-[#0D0D0D] border border-gray-300/50 dark:border-[#363636] rounded-lg px-4 py-2.5 text-black dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
          />
        </div>
        <div className="col-span-2">
          <GlassDropdown
            value={String(course.credits)}
            onChange={(v) => onUpdate(course.id, 'credits', parseInt(v))}
            options={creditOptions.map((c) => ({ value: String(c), label: String(c) }))}
            direction="auto"
            className="w-full"
          />
        </div>
        <div className="col-span-3">
          <GlassDropdown
            value={course.grade}
            onChange={(v) => onUpdate(course.id, 'grade', v)}
            options={gradeOptions.map((g) => ({ value: g, label: g }))}
            direction="auto"
            className="w-full"
          />
        </div>
        <div className="col-span-1 flex justify-center">
          <button onClick={() => onDelete(course.id)} className="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors duration-200">
            <i className="ph-bold ph-trash text-xl"></i>
          </button>
        </div>
      </div>
    </>
  );
};

const GpaCalculator: React.FC = () => {
  const t = useT();
  const rules = useGradingRules();
  const gradeOptions = rules.scale.map((row) => row.letter);
  const [courses, setCourses] = useState<GPACourse[]>(initialGPACourses);
  const [gpa, setGpa] = useState<string>('-');

  const handleUpdateCourse = (id: number, field: keyof Omit<GPACourse, 'id'>, value: string | number) => {
    setCourses(courses.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleDeleteCourse = (id: number) => {
    setCourses(courses.filter(c => c.id !== id));
  };

  const handleAddCourse = () => {
    const newId = courses.length > 0 ? Math.max(...courses.map(c => c.id)) + 1 : 1;
    setCourses([...courses, { id: newId, name: '', credits: 3, grade: 'A' }]);
  };

  const handleLoadTranscript = async () => {
    try {
      const studentId = localStorage.getItem('currentUserEmail') || '';
      const data = await fetchTranscript(studentId);
      if (data && data.semesters && data.semesters.length > 0) {
        // Flatten EVERY semester's courses into the calculator. Per owner
        // directive: the GPA calculator is a "what-if my entire record"
        // tool, not just the last term. Previous behaviour loaded only the
        // most-recent semester which made cumulative-style calculations
        // impossible without re-typing every prior course.
        let idCounter = 1;
        const newCourses = data.semesters.flatMap((sem) =>
          sem.courses.map((c) => ({
            id: idCounter++,
            // Prefix the semester so duplicate course codes across terms
            // (re-takes etc.) stay distinguishable in the editor.
            name: sem.name ? `${sem.name} · ${c.title}` : c.title,
            credits: c.credits,
            grade: c.grade,
          })),
        );
        setCourses(newCourses);
      } else {
        alert(t('gpaCalculatorPage.transcriptNotFound'));
      }
    } catch (error) {
      console.error('Failed to load transcript', error);
      alert(t('gpaCalculatorPage.transcriptLoadFailed'));
    }
  };

  const handleReset = () => {
    setCourses(initialGPACourses);
    setGpa('-');
  };

  const handleCalculate = () => {
    const totalCredits = courses.reduce((sum, course) => sum + Number(course.credits), 0);
    if (totalCredits === 0) {
      setGpa('0.00');
      return;
    }
    const totalPoints = courses.reduce((sum, course) => {
      return sum + (letterToPoints(course.grade, rules) * Number(course.credits));
    }, 0);

    const calculatedGpa = totalPoints / totalCredits;
    setGpa(calculatedGpa.toFixed(2));
  };

  const handleExportPDF = () => {
    const totalCredits = courses.reduce((sum, course) => sum + Number(course.credits), 0);
    const totalPoints = courses.reduce((sum, course) => {
      return sum + (letterToPoints(course.grade, rules) * Number(course.credits));
    }, 0);
    const calculatedGpa = totalCredits > 0 ? totalPoints / totalCredits : 0;

    const reportData: GPAReportData = {
      studentName: 'Saira Goodman',
      courses: courses.map(course => ({
        name: course.name || 'Unnamed Course',
        credits: course.credits,
        grade: course.grade,
        points: letterToPoints(course.grade, rules),
      })),
      calculatedGPA: calculatedGpa,
      totalCredits: totalCredits,
      totalPoints: totalPoints
    };
    generateGPAReportPDF(reportData);
  };

  return (
    <div className="pb-24 md:pb-16">
      <AnimateOnView>
        <div className="mb-4 sm:mb-6">
          <h2 className="text-black dark:text-white text-2xl sm:text-3xl font-bold mb-1.5">{t('gpaCalculatorPage.title')}</h2>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">{t('gpaCalculatorPage.subtitle')}</p>
        </div>
      </AnimateOnView>

      <AnimateOnView delay={0.1}>
        <div className={`${glassCardStyle} p-4 sm:p-6 md:p-8`}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-gray-300/50 dark:border-[#363636] pb-4 gap-3 md:gap-4">
            <h2 className="text-lg sm:text-xl font-bold text-black dark:text-white">{t('coursesPage.title')}</h2>
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              <button onClick={handleAddCourse} className="flex-1 md:flex-none whitespace-nowrap flex items-center justify-center gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-black dark:text-white rounded-lg bg-white/50 dark:bg-[#2d2d2d] hover:bg-gray-300/50 dark:hover:bg-[#3d3d3d] transition-colors border border-gray-300/50 dark:border-[#363636]">
                <i className="ph-bold ph-plus"></i> {t('gpaCalculatorPage.addCourse')}
              </button>
              <button onClick={handleLoadTranscript} className="flex-1 md:flex-none whitespace-nowrap flex items-center justify-center gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white rounded-lg bg-[#6A3FF4] hover:bg-[#5a32d4] transition-colors shadow-lg shadow-purple-500/20">
                <i className="ph-bold ph-download-simple"></i> {t('gpaCalculatorPage.loadMyTranscript')}
              </button>
            </div>
          </div>

          <div className="hidden md:grid grid-cols-12 gap-4 mb-4 px-0">
            <label className="col-span-6 text-xs text-gray-600 dark:text-[#98A2B3] font-medium uppercase tracking-wider">{t('gpaCalculatorPage.courseName')}</label>
            <label className="col-span-2 text-xs text-gray-600 dark:text-[#98A2B3] font-medium uppercase tracking-wider">{t('gpaCalculatorPage.credits')}</label>
            <label className="col-span-3 text-xs text-gray-600 dark:text-[#98A2B3] font-medium uppercase tracking-wider">{t('gpaCalculatorPage.grade')}</label>
            <div className="col-span-1"></div>
          </div>

          <div className="space-y-3 mb-8">
            {courses.map(course => (
              <GPACourseRow key={course.id} course={course} gradeOptions={gradeOptions} onUpdate={handleUpdateCourse} onDelete={handleDeleteCourse} />
            ))}
          </div>

          <div className="border-t border-gray-300/50 dark:border-[#363636] pt-6 sm:pt-8 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 md:gap-6">
            {/* Result panel — full-width on mobile (with the GPA number
                prominent), inline at the right on desktop. Result first
                on mobile so it's visible above the action buttons. */}
            <div className="md:order-2 flex items-center justify-between sm:justify-center gap-4 bg-white/50 dark:bg-[#0D0D0D] border border-gray-300/50 dark:border-[#363636] rounded-xl px-6 py-3 sm:px-8 sm:py-4 md:min-w-[200px] shadow-lg">
              <span className="text-gray-600 dark:text-gray-400 font-medium text-sm sm:text-base">{t('gpaCalculatorPage.resultLabel')}</span>
              {gpa === '-' ? (
                <div className="w-16 h-1.5 bg-gray-300 dark:bg-[#2d2d2d] rounded-full"></div>
              ) : (
                <p className="text-3xl sm:text-4xl font-bold text-black dark:text-white bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] bg-clip-text dark:text-transparent">{gpa}</p>
              )}
            </div>
            <div className="md:order-1 grid grid-cols-3 md:flex md:flex-wrap md:justify-start gap-2 sm:gap-3 md:gap-4">
              <button onClick={handleReset} className="px-3 sm:px-5 py-2.5 text-xs sm:text-sm font-semibold text-black dark:text-white rounded-lg border border-gray-300/50 dark:border-[#363636] hover:bg-gray-300/50 dark:hover:bg-[#2a2a2a] transition-colors duration-200">
                {t('gpaCalculatorPage.reset')}
              </button>
              <button onClick={handleCalculate} className="px-3 sm:px-8 py-2.5 text-xs sm:text-sm font-semibold text-white rounded-lg bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 transition-opacity duration-200 shadow-lg shadow-purple-500/20">
                {t('gpaCalculatorPage.calculate')}
              </button>
              <button onClick={handleExportPDF} className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2.5 text-xs sm:text-sm font-semibold text-white rounded-lg bg-[#6A3FF4] hover:bg-[#5a32d4] transition-colors duration-200 shadow-lg shadow-purple-500/20">
                <i className="ph-bold ph-file-pdf"></i>
                <span className="hidden sm:inline">{t('gpaCalculatorPage.exportPdf')}</span>
                <span className="sm:hidden">PDF</span>
              </button>
            </div>
          </div>
        </div>
      </AnimateOnView>
    </div>
  );
};

export default GpaCalculator;
