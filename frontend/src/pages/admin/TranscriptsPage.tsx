// src/pages/admin/TranscriptsPage.tsx
//
// MVP BUILD — pure front-end mockup. No backend calls. The student search
// runs over a static mock list; the "Download PDF" button simulates the
// generate flow locally (no network).
//
// Admin Transcripts search + print page. Type any part of a student's name /
// email / ID, see the matching rows, and download an official transcript PDF.
import { FC, useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-2xl backdrop-blur-xl';

const searchInputStyle =
  'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl';

interface StudentRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  odID?: string | null;
  academicProfile?: {
    level?: number | string | null;
    gpa?: number | null;
    program?: string | null;
    major?: string | null;
  } | null;
}

// ── Static mock student directory ──────────────────────────────────────────
const MOCK_STUDENTS: StudentRow[] = [
  { id: 'stu-1182', firstName: 'Mariam', lastName: 'El-Sayed', email: 'mariam.elsayed@uniflow.test', odID: 'FCDS20230012', academicProfile: { level: 3, gpa: 3.62, major: 'Computer Science', program: 'CS' } },
  { id: 'stu-1190', firstName: 'Omar', lastName: 'Hassan', email: 'omar.hassan@uniflow.test', odID: 'FCDS20220045', academicProfile: { level: 4, gpa: 2.88, major: 'Data Science', program: 'DS' } },
  { id: 'stu-1204', firstName: 'Salma', lastName: 'Farouk', email: 'salma.farouk@uniflow.test', odID: 'FCDS20230108', academicProfile: { level: 3, gpa: 3.91, major: 'Cybersecurity', program: 'CY' } },
  { id: 'stu-1212', firstName: 'Youssef', lastName: 'Ibrahim', email: 'youssef.ibrahim@uniflow.test', odID: 'FCDS20210077', academicProfile: { level: 4, gpa: 3.15, major: 'Computer Science', program: 'CS' } },
  { id: 'stu-1220', firstName: 'Nour', lastName: 'Abdelrahman', email: 'nour.abdelrahman@uniflow.test', odID: 'FCDS20240003', academicProfile: { level: 1, gpa: null, major: null, program: 'DS' } },
  { id: 'stu-1233', firstName: 'Karim', lastName: 'Mostafa', email: 'karim.mostafa@uniflow.test', odID: 'FCDS20230055', academicProfile: { level: 2, gpa: 3.40, major: 'Business Informatics', program: 'BU' } },
  { id: 'stu-1248', firstName: 'Hana', lastName: 'Gamal', email: 'hana.gamal@uniflow.test', odID: 'FCDS20220190', academicProfile: { level: 4, gpa: 3.77, major: 'Data Science', program: 'DS' } },
  { id: 'stu-1255', firstName: 'Ahmed', lastName: 'Zaki', email: 'ahmed.zaki@uniflow.test', odID: 'FCDS20240021', academicProfile: { level: 1, gpa: 2.10, major: null, program: 'CS' } },
];

const TranscriptsPage: FC = () => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 300ms debounce so we don't filter on every keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Filter the mock directory when the debounced query changes. An empty
  // query keeps the results panel in its hint state.
  useEffect(() => {
    if (!debouncedQuery) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      const q = debouncedQuery.toLowerCase();
      const list = MOCK_STUDENTS.filter((s) => {
        const name = `${s.firstName} ${s.lastName}`.toLowerCase();
        return (
          name.includes(q) ||
          s.email.toLowerCase().includes(q) ||
          (s.odID ?? '').toLowerCase().includes(q)
        );
      });
      setRows(list);
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [debouncedQuery]);

  // Local-only "download" — simulate the PDF generation with a brief busy
  // state. No backend call.
  const handleDownload = (student: StudentRow) => {
    setBusyId(student.id);
    window.setTimeout(() => {
      setBusyId(null);
      window.alert(
        `Transcript PDF generated for ${`${student.firstName} ${student.lastName}`.trim() || 'Student'} (preview).`,
      );
    }, 900);
  };

  const hasQuery = debouncedQuery.length > 0;

  // Pretty-print level + GPA cells; null-safe.
  const fmtLevel = (lvl: StudentRow['academicProfile'] extends infer T ? (T extends null | undefined ? never : T) : never): string => {
    if (!lvl || lvl.level === null || lvl.level === undefined || lvl.level === '') return '—';
    return String(lvl.level);
  };
  const fmtGpa = (gpa: number | null | undefined): string => {
    if (gpa === null || gpa === undefined) return '—';
    const n = Number(gpa);
    return Number.isFinite(n) ? n.toFixed(2) : '—';
  };
  const fmtProgram = (ap: StudentRow['academicProfile']): string => {
    if (!ap) return '—';
    return ap.major || ap.program || '—';
  };

  // Result body — three render states: loading / list (with empty sub-state).
  // Initial pre-query state lives outside this memo.
  const resultsBody = useMemo(() => {
    if (loading) {
      return (
        <div className="py-12 text-center text-sm text-gray-400">
          <i className="ph-bold ph-spinner-gap animate-spin text-2xl mr-2" />
          {t('admin.transcriptsLoadingStudents')}
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div className="py-12 text-center text-sm text-gray-400">
          {t('admin.transcriptsNoMatch')}
        </div>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-gray-400 border-b border-white/10">
              <th className="py-3 px-3 text-left font-bold">{t('admin.colName')}</th>
              <th className="py-3 px-3 text-left font-bold">{t('admin.colEmail')}</th>
              <th className="py-3 px-3 text-left font-bold">{t('admin.colLevel')}</th>
              <th className="py-3 px-3 text-left font-bold">{t('admin.colGpa')}</th>
              <th className="py-3 px-3 text-left font-bold">{t('admin.colProgram')}</th>
              <th className="py-3 px-3 text-right font-bold">{t('admin.colActionTr')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const fullName = `${s.firstName} ${s.lastName}`.trim() || '—';
              const isBusy = busyId === s.id;
              return (
                <tr
                  key={s.id}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  <td className="py-3 px-3 text-black dark:text-white font-medium">
                    {fullName}
                  </td>
                  <td className="py-3 px-3 text-gray-400">{s.email}</td>
                  <td className="py-3 px-3 text-gray-300">{fmtLevel(s.academicProfile as never)}</td>
                  <td className="py-3 px-3 text-gray-300">{fmtGpa(s.academicProfile?.gpa)}</td>
                  <td className="py-3 px-3 text-gray-300">{fmtProgram(s.academicProfile)}</td>
                  <td className="py-3 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDownload(s)}
                      disabled={isBusy}
                      className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                    >
                      {isBusy ? (
                        <>
                          <i className="ph-bold ph-spinner-gap animate-spin" />
                          {t('admin.generatingDots')}
                        </>
                      ) : (
                        <>
                          <i className="ph-bold ph-file-pdf" />
                          {t('admin.downloadPdfBtn')}
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
    // handleDownload is stable enough for this small page; busyId is the
    // only piece of action-time state that needs to refresh the table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows, busyId]);

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      {/* Page header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-black dark:text-white flex items-center gap-3">
          <i className="ph-bold ph-graduation-cap text-[#6A3FF4]" />
          {t('admin.transcriptsTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          {t('admin.transcriptsPageSubtitle')}
        </p>
      </div>

      {/* Search card */}
      <div className={`${glassCardStyle} p-5`}>
        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
          {t('admin.findAStudent')}
        </label>
        <div className="relative">
          <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.transcriptsSearchPlaceholder')}
            className={searchInputStyle}
            autoFocus
          />
        </div>
      </div>

      {/* Results card */}
      <div className={`${glassCardStyle} p-5`}>
        {!hasQuery ? (
          <div className="py-12 text-center text-sm text-gray-400">
            <i className="ph-bold ph-magnifying-glass text-2xl mb-2 block text-[#6A3FF4]/70" />
            {t('admin.transcriptsEmptyHint')}
          </div>
        ) : (
          resultsBody
        )}
      </div>
    </div>
  );
};

export default TranscriptsPage;
