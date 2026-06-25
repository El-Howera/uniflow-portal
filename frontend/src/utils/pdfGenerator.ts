    // PDF Generation Utility for UniFlow
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { apiFetch } from './api';
import { API_URLS } from '@shared/config';

// Extend jsPDF type for autoTable
interface jsPDFWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY: number };
}

// UniFlow brand colors
const BRAND_COLOR: [number, number, number] = [106, 63, 244]; // #6A3FF4
const DARK_TEXT: [number, number, number] = [33, 33, 33];
const GRAY_TEXT: [number, number, number] = [107, 114, 128];

// Helper to add UniFlow header to all PDFs
const addHeader = (doc: jsPDF, title: string) => {
  // Get page width for proper header stretching (handles both portrait and landscape)
  const pageWidth = doc.internal.pageSize.getWidth();

  // Logo area - use full page width
  doc.setFillColor(...BRAND_COLOR);
  doc.rect(0, 0, pageWidth, 35, 'F');

  // UniFlow branding
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('UniFlow', 20, 22);

  // Title
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(title, 20, 30);

  // Date on right side
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  })}`, pageWidth - 15, 22, { align: 'right' });

  return 45; // Return Y position after header
};

// Helper to add footer
const addFooter = (doc: jsPDF) => {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...GRAY_TEXT);
    doc.text(
      `Page ${i} of ${pageCount} | UniFlow University Portal | Confidential Document`,
      105,
      290,
      { align: 'center' }
    );
  }
};

// ==================== TRANSCRIPT PDF ====================

/**
 * Per-component grade row inside a category bucket (Assignments, Quizzes,
 * Midterm, Final, etc.). `earned` is the actual score, `max` the cap.
 */
export interface TranscriptBreakdownAssignment {
  name: string;
  earned: number | null;
  max: number;
}

/**
 * Category bucket grouping per-component rows for one course (e.g.
 * "Assignments" subtotal 24/30, with each individual assignment listed).
 */
export interface TranscriptBreakdownCategory {
  title: string;
  assignments: TranscriptBreakdownAssignment[];
  subtotalEarned: number | null;
  subtotalMax: number;
}

export interface TranscriptCourse {
  code: string;
  name: string;
  credits: number;
  grade: string;
  semester: string;
  // Per-course breakdown — when present, the PDF renders an indented
  // sub-table for each category with the individual components.
  breakdown?: TranscriptBreakdownCategory[];
  totalEarned?: number | null;
  totalMax?: number;
}

export interface StudentInfo {
  name: string;
  studentId: string;
  major: string;
  email: string;
  enrollmentDate: string;
  expectedGraduation: string;
}

export interface TranscriptData {
  student: StudentInfo;
  courses: TranscriptCourse[];
  cumulativeGPA: number;
  totalCredits: number;
  totalEarned: number;
}

export const generateTranscriptPDF = (data: TranscriptData): void => {
  const doc: jsPDFWithAutoTable = new jsPDF();
  let yPos = addHeader(doc, 'Official Academic Transcript');

  // Student Information Section
  doc.setFontSize(14);
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.text('Student Information', 20, yPos);

  yPos += 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const studentInfo = [
    ['Name:', data.student.name, 'Student ID:', data.student.studentId],
    ['Major:', data.student.major, 'Email:', data.student.email],
    ['Enrolled:', data.student.enrollmentDate, 'Expected Grad:', data.student.expectedGraduation],
  ];

  studentInfo.forEach((row) => {
    doc.setFont('helvetica', 'bold');
    doc.text(row[0], 20, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(row[1], 45, yPos);
    doc.setFont('helvetica', 'bold');
    doc.text(row[2], 110, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(row[3], 145, yPos);
    yPos += 6;
  });

  yPos += 10;

  // Course Table
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Academic Record', 20, yPos);
  yPos += 5;

  // Group courses by semester
  const semesters = Array.from(new Set(data.courses.map(c => c.semester)));

  semesters.forEach((semester) => {
    const semesterCourses = data.courses.filter(c => c.semester === semester);

    autoTable(doc, {
      startY: yPos,
      head: [[{ content: semester, colSpan: 4, styles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255] } }]],
      body: [],
      theme: 'plain',
      margin: { left: 20, right: 20 },
    });

    yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY || yPos + 10;

    // Course summary row — code / name / credits / grade — same as before.
    // We render each course as its own table so the per-course breakdown
    // (when present) can be rendered RIGHT BELOW its parent row without
    // disrupting the striped colouring of the summary line.
    semesterCourses.forEach((course) => {
      autoTable(doc, {
        startY: yPos,
        head: [['Course Code', 'Course Name', 'Credits', 'Grade']],
        body: [[
          course.code,
          course.name,
          course.credits.toString(),
          course.grade,
        ]],
        theme: 'striped',
        headStyles: {
          fillColor: [240, 240, 240],
          textColor: DARK_TEXT,
          fontStyle: 'bold',
        },
        styles: { fontSize: 9 },
        margin: { left: 20, right: 20 },
      });
      yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY || yPos + 10;

      // Per-course breakdown — only renders when the backend included it
      // (`tc.breakdowns` populated on the transcript_courses row). One inner
      // table per category bucket (Assignments, Quizzes, Midterm, Final…)
      // with the individual components + earned/max columns + a subtotal
      // strip. Indented + smaller font so it's clearly a sub-detail of the
      // course summary above.
      if (Array.isArray(course.breakdown) && course.breakdown.length > 0) {
        course.breakdown.forEach((cat) => {
          if (!cat.assignments || cat.assignments.length === 0) return;
          const fmt = (n: number | null | undefined) =>
            (typeof n === 'number' && Number.isFinite(n))
              ? (Number.isInteger(n) ? n.toString() : n.toFixed(1))
              : '—';
          const body = cat.assignments.map((a) => [
            a.name,
            fmt(a.earned),
            fmt(a.max),
          ]);
          // Subtotal strip — sits in the table footer so it always reads
          // as the closing line of the bucket regardless of pagination.
          autoTable(doc, {
            startY: yPos + 1,
            head: [[
              { content: cat.title, colSpan: 1, styles: { fontStyle: 'bold' } },
              { content: 'Score', styles: { halign: 'right' } },
              { content: 'Max', styles: { halign: 'right' } },
            ]],
            body,
            foot: [[
              { content: 'Subtotal', styles: { fontStyle: 'bold' } },
              { content: fmt(cat.subtotalEarned), styles: { halign: 'right', fontStyle: 'bold' } },
              { content: fmt(cat.subtotalMax), styles: { halign: 'right', fontStyle: 'bold' } },
            ]],
            theme: 'plain',
            headStyles: {
              fillColor: [248, 246, 255],
              textColor: BRAND_COLOR,
              fontSize: 8,
            },
            footStyles: {
              fillColor: [248, 246, 255],
              textColor: DARK_TEXT,
              fontSize: 8,
            },
            styles: { fontSize: 8, textColor: DARK_TEXT },
            columnStyles: {
              0: { cellWidth: 'auto' },
              1: { halign: 'right', cellWidth: 22 },
              2: { halign: 'right', cellWidth: 22 },
            },
            margin: { left: 20, right: 20 },
          });
          yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY || yPos + 8;
        });

        // Course-total row when the backend provided one. Bold purple strip
        // anchored at the same left margin as the breakdown sub-tables.
        if (typeof course.totalEarned === 'number' && typeof course.totalMax === 'number') {
          const totalStr = course.totalMax > 0
            ? `${Number.isInteger(course.totalEarned) ? course.totalEarned : course.totalEarned.toFixed(1)} / ${course.totalMax}`
            : '—';
          autoTable(doc, {
            startY: yPos + 1,
            body: [[
              { content: 'Course Total', styles: { fontStyle: 'bold' } },
              { content: totalStr, styles: { halign: 'right', fontStyle: 'bold' } },
              { content: course.grade, styles: { halign: 'right', fontStyle: 'bold', textColor: BRAND_COLOR } },
            ]],
            theme: 'plain',
            styles: { fontSize: 8, textColor: DARK_TEXT, fillColor: [240, 235, 255] },
            columnStyles: {
              0: { cellWidth: 'auto' },
              1: { halign: 'right', cellWidth: 30 },
              2: { halign: 'right', cellWidth: 18 },
            },
            margin: { left: 20, right: 20 },
          });
          yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY || yPos + 8;
        }
        yPos += 3;
      }
    });

    yPos += 5;
  });

  // Summary Section
  yPos += 5;
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(20, yPos, 170, 30, 3, 3, 'F');

  yPos += 10;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Academic Summary', 30, yPos);

  yPos += 8;
  doc.setFontSize(10);
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'normal');
  doc.text(`Cumulative GPA: ${data.cumulativeGPA.toFixed(2)}`, 30, yPos);
  doc.text(`Total Credits Attempted: ${data.totalCredits}`, 90, yPos);
  doc.text(`Credits Earned: ${data.totalEarned}`, 150, yPos);

  addFooter(doc);
  doc.save(`UniFlow_Transcript_${data.student.name.replace(/\s+/g, '_')}.pdf`);
};

// ==================== PAYMENT RECEIPT PDF ====================
export interface PaymentInfo {
  receiptNumber: string;
  date: string;
  studentName: string;
  studentId: string;
  items: { description: string; amount: number }[];
  paymentMethod: string;
  totalAmount: number;
  status: 'Paid' | 'Pending' | 'Overdue';
}

export const generatePaymentReceiptPDF = (payment: PaymentInfo): void => {
  const doc: jsPDFWithAutoTable = new jsPDF();
  let yPos = addHeader(doc, 'Payment Receipt');

  // Receipt Info Box
  doc.setFillColor(250, 250, 250);
  doc.roundedRect(20, yPos, 170, 35, 3, 3, 'F');
  doc.setDrawColor(...BRAND_COLOR);
  doc.roundedRect(20, yPos, 170, 35, 3, 3, 'S');

  yPos += 10;
  doc.setFontSize(10);
  doc.setTextColor(...DARK_TEXT);

  // Row 1: Receipt # and Status
  doc.setFont('helvetica', 'bold');
  doc.text('Receipt #:', 25, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(payment.receiptNumber, 55, yPos);

  doc.setFont('helvetica', 'bold');
  doc.text('Status:', 140, yPos);

  // Status badge
  const statusColors: { [key: string]: [number, number, number] } = {
    'Paid': [34, 197, 94],
    'Pending': [234, 179, 8],
    'Overdue': [239, 68, 68],
  };
  doc.setTextColor(...(statusColors[payment.status] || DARK_TEXT));
  doc.setFont('helvetica', 'bold');
  doc.text(payment.status, 160, yPos);

  // Row 2: Date
  yPos += 8;
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.text('Date:', 25, yPos);
  doc.setFont('helvetica', 'normal');
  // Date may arrive as an ISO timestamp; format human-readably.
  const formattedDate = (() => {
    try {
      const d = new Date(payment.date);
      if (isNaN(d.getTime())) return String(payment.date);
      return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return String(payment.date);
    }
  })();
  doc.text(formattedDate, 55, yPos);

  // Row 3: Student
  yPos += 8;
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.text('Student:', 25, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(`${payment.studentName} (${payment.studentId})`, 55, yPos);

  yPos += 20;

  // Coerce amounts safely — Prisma Decimals arrive as strings over JSON.
  const num = (v: unknown): number => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v == null) return 0;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
  };
  const fmtEGP = (v: unknown) => `EGP ${num(v).toFixed(2)}`;

  // Payment Items Table
  autoTable(doc, {
    startY: yPos,
    head: [['Description', 'Amount (EGP)']],
    body: payment.items.map(item => [
      item.description,
      fmtEGP(item.amount)
    ]),
    foot: [[
      { content: 'Total', styles: { fontStyle: 'bold' } },
      { content: fmtEGP(payment.totalAmount), styles: { fontStyle: 'bold', textColor: BRAND_COLOR } }
    ]],
    theme: 'striped',
    headStyles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255] },
    footStyles: { fillColor: [245, 245, 245] },
    styles: { fontSize: 10 },
    margin: { left: 20, right: 20 },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 50, halign: 'right' }
    }
  });

  yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY || yPos + 50;
  yPos += 15;

  // Payment Method
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Method:', 20, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(payment.paymentMethod, 60, yPos);

  // Thank you note / Status message
  yPos += 20;

  // Different messages based on status
  let footerMessage = '';
  let footerColor: [number, number, number] = BRAND_COLOR;

  if (payment.status === 'Paid') {
    footerMessage = 'Thank you for your payment!';
    footerColor = [34, 197, 94]; // Green
  } else if (payment.status === 'Pending') {
    footerMessage = 'Payment pending - Please complete your payment soon.';
    footerColor = [234, 179, 8]; // Yellow/Orange
  } else if (payment.status === 'Overdue') {
    footerMessage = 'Payment overdue - Please settle this balance immediately.';
    footerColor = [239, 68, 68]; // Red
  } else {
    footerMessage = 'Thank you for using UniFlow!';
    footerColor = BRAND_COLOR;
  }

  doc.setFillColor(...footerColor);
  doc.roundedRect(20, yPos, 170, 20, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'italic');
  doc.text(footerMessage, 105, yPos + 12, { align: 'center' });

  addFooter(doc);
  doc.save(`UniFlow_Receipt_${payment.receiptNumber}.pdf`);
};

// ==================== TIMETABLE PDF ====================
export interface TimetableSlot {
  day: string;
  time: string;
  course: string;
  instructor: string;
  room: string;
}

export interface TimetableData {
  studentName: string;
  semester: string;
  slots: TimetableSlot[];
}

// Admin grid PDF — same layout as the on-screen Timetable. The PDF top
// area shows ONE label for the whole grid (filter context: dept + level +
// semester) and each cell stacks every section sharing that (day, time)
// using compact `Course — Lec/Lab — Hall` lines.
export interface AdminTimetableSlot {
  day: string;
  startTime: string;     // 'HH:MM'
  endTime: string;       // 'HH:MM'
  courseCode: string;
  type: 'Lecture' | 'Lab' | 'Tutorial' | 'Seminar';
  hallName?: string | null;
}

export interface AdminTimetableData {
  scopeLabel: string;          // e.g. "Department: CS · Level 2"
  semester?: string | null;    // optional sub-label
  workingDays: string[];       // full names, e.g. ['Sunday','Monday',...]
  timeSlots: string[];         // 'HH:MM' starts in display order
  items: AdminTimetableSlot[];
}

const SHORT_DAY: Record<string, string> = {
  Saturday: 'Sat', Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue',
  Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri',
};

const TYPE_SHORT: Record<string, string> = {
  Lecture: 'Lec', Lab: 'Lab', Tutorial: 'Tut', Seminar: 'Sem',
};

export const generateAdminTimetablePDF = (data: AdminTimetableData): void => {
  const doc: jsPDFWithAutoTable = new jsPDF('landscape');
  let yPos = addHeader(doc, 'Timetable');

  // Top-of-page scope banner — the SINGLE label for the whole grid.
  doc.setFontSize(13);
  doc.setTextColor(...BRAND_COLOR);
  doc.setFont('helvetica', 'bold');
  doc.text(data.scopeLabel || 'Admin Timetable', 20, yPos + 4);
  if (data.semester) {
    doc.setFontSize(10);
    doc.setTextColor(...GRAY_TEXT);
    doc.setFont('helvetica', 'normal');
    doc.text(data.semester, 20, yPos + 11);
    yPos += 17;
  } else {
    yPos += 10;
  }

  // Group items by (day, startTime) so each cell stacks its sections.
  const cellIndex = new Map<string, AdminTimetableSlot[]>();
  for (const it of data.items) {
    const k = `${it.day}|${it.startTime}`;
    const list = cellIndex.get(k) ?? [];
    list.push(it);
    cellIndex.set(k, list);
  }

  // Header row: Time + each working day (3-letter abbreviation).
  const headers = ['Time', ...data.workingDays.map((d) => SHORT_DAY[d] ?? d)];

  // Body rows — one per time slot. Each cell text is the joined list of
  // sections at (day, time): `Course — Lec/Lab — Hall`.
  const body = data.timeSlots.map((time) => {
    const row: string[] = [time];
    for (const day of data.workingDays) {
      const list = cellIndex.get(`${day}|${time}`) ?? [];
      if (list.length === 0) {
        row.push('');
      } else {
        row.push(
          list
            .map((it) =>
              `${it.courseCode} — ${TYPE_SHORT[it.type] ?? it.type} — ${it.hallName ?? '—'}`
            )
            .join('\n')
        );
      }
    }
    return row;
  });

  autoTable(doc, {
    startY: yPos,
    head: [headers],
    body,
    theme: 'grid',
    headStyles: {
      fillColor: BRAND_COLOR,
      textColor: [255, 255, 255],
      halign: 'center',
      fontStyle: 'bold',
      fontSize: 9,
    },
    styles: {
      fontSize: 8,
      cellPadding: 2,
      valign: 'top',
      lineColor: [220, 220, 220],
    },
    columnStyles: {
      0: { fontStyle: 'bold', halign: 'right', cellWidth: 22, fontSize: 8 },
    },
    didParseCell: (cellData) => {
      // Mirror the on-screen colors: Lecture green, Lab orange. Detection
      // by substring is cheap and avoids a parallel typed body array.
      if (cellData.section !== 'body' || cellData.column.index === 0) return;
      const text = String(cellData.cell.text || '');
      const hasLec = /—\s*Lec\s*—/.test(text);
      const hasLab = /—\s*Lab\s*—/.test(text);
      if (hasLec && !hasLab) {
        cellData.cell.styles.textColor = [21, 128, 61];   // green-700 — print-readable
      } else if (hasLab && !hasLec) {
        cellData.cell.styles.textColor = [194, 65, 12];   // orange-700
      }
      // Mixed cells (a Lec + a Lab in the same slot) keep the default
      // text color so neither type's tint is misleading.
    },
    margin: { left: 12, right: 12 },
  });

  addFooter(doc);
  const safeLabel = (data.scopeLabel || 'Admin')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .slice(0, 40);
  doc.save(`UniFlow_Timetable_${safeLabel}.pdf`);
};

export const generateTimetablePDF = (data: TimetableData): void => {
  const doc: jsPDFWithAutoTable = new jsPDF('landscape');
  let yPos = addHeader(doc, `Class Schedule - ${data.semester}`);

  // Student info
  doc.setFontSize(11);
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.text('Student:', 20, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(data.studentName, 45, yPos);

  yPos += 10;

  // Create timetable grid - All 7 days (Saturday to Friday)
  const days = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const times = Array.from(new Set(data.slots.map(s => s.time))).sort();

  // Build table data
  const tableData = times.map(time => {
    const row: string[] = [time];
    days.forEach(day => {
      const slot = data.slots.find(s => s.day === day && s.time === time);
      if (slot) {
        row.push(`${slot.course}\n${slot.instructor}\n${slot.room}`);
      } else {
        row.push('-');
      }
    });
    return row;
  });

  autoTable(doc, {
    startY: yPos,
    head: [['Time', ...days]],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: BRAND_COLOR,
      textColor: [255, 255, 255],
      halign: 'center',
      fontStyle: 'bold',
      fontSize: 9
    },
    styles: {
      fontSize: 7,
      cellPadding: 3,
      halign: 'center',
      valign: 'middle',
      minCellHeight: 18
    },
    columnStyles: {
      0: { cellWidth: 25, fontStyle: 'bold', fillColor: [250, 250, 250] }
    },
    margin: { left: 10, right: 10 },
    alternateRowStyles: { fillColor: [252, 252, 252] }
  });

  addFooter(doc);
  doc.save(`UniFlow_Timetable_${data.semester.replace(/\s+/g, '_')}.pdf`);
};

// ==================== GPA REPORT PDF ====================
export interface GPACourse {
  name: string;
  credits: number;
  grade: string;
  points: number;
}

export interface GPAReportData {
  studentName: string;
  courses: GPACourse[];
  calculatedGPA: number;
  totalCredits: number;
  totalPoints: number;
}

export const generateGPAReportPDF = (data: GPAReportData): void => {
  const doc: jsPDFWithAutoTable = new jsPDF();
  let yPos = addHeader(doc, 'GPA Calculation Report');

  // Student info
  doc.setFontSize(11);
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.text('Student:', 20, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(data.studentName, 45, yPos);
  yPos += 15;

  // Course Table
  autoTable(doc, {
    startY: yPos,
    head: [['Course Name', 'Credits', 'Grade', 'Grade Points', 'Quality Points']],
    body: data.courses.map(course => [
      course.name,
      course.credits.toString(),
      course.grade,
      course.points.toFixed(1),
      (course.credits * course.points).toFixed(2)
    ]),
    theme: 'striped',
    headStyles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255] },
    styles: { fontSize: 10 },
    margin: { left: 20, right: 20 },
  });

  yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY || yPos + 50;
  yPos += 15;

  // GPA Summary Box
  doc.setFillColor(245, 240, 255);
  doc.roundedRect(20, yPos, 170, 45, 5, 5, 'F');
  doc.setDrawColor(...BRAND_COLOR);
  doc.roundedRect(20, yPos, 170, 45, 5, 5, 'S');

  yPos += 12;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('GPA Calculation Summary', 105, yPos, { align: 'center' });

  yPos += 12;
  doc.setFontSize(10);
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'normal');
  doc.text(`Total Credits: ${data.totalCredits}`, 40, yPos);
  doc.text(`Total Quality Points: ${data.totalPoints.toFixed(2)}`, 100, yPos);

  yPos += 10;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text(`Calculated GPA: ${data.calculatedGPA.toFixed(2)}`, 105, yPos, { align: 'center' });

  // GPA Scale Reference
  yPos += 25;
  doc.setFontSize(10);
  doc.setTextColor(...GRAY_TEXT);
  doc.setFont('helvetica', 'normal');
  doc.text('GPA Scale: A=4.0, A-=3.7, B+=3.3, B=3.0, B-=2.7, C+=2.3, C=2.0, C-=1.7, D+=1.3, D=1.0, F=0.0', 105, yPos, { align: 'center' });

  addFooter(doc);
  doc.save(`UniFlow_GPA_Report_${data.studentName.replace(/\s+/g, '_')}.pdf`);
};

// ==================== PAYSLIP PDF ====================
// Phase 10. Same visual language as the rest of the project's PDFs:
//   • Purple full-width brand bar at the top via addHeader()
//   • Brand-colored table headers / accent in summary box
//   • Footer page-numbers via addFooter()
// Server returns payslip JSON (admin or self-service); the frontend builds
// the PDF locally so styling stays in sync with transcript / receipt / GPA.

export interface PayslipPdfData {
  period: string;            // "2026-04"
  status: string;            // "draft" | "finalized" | "paid" | "cancelled"
  currency: string;          // ISO 4217 — "EGP"
  generatedAt: string;       // ISO timestamp
  employee: {
    name: string;
    email: string;
    odId?: string | null;
    position?: string | null;
    payrollId?: string | null;
  };
  gross: number;
  deductions: { type: string; amount: number; description?: string | null }[];
  deductionsTotal: number;
  net: number;
  notes?: string | null;
}

export const generatePayslipPDF = (data: PayslipPdfData): void => {
  const doc: jsPDFWithAutoTable = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = addHeader(doc, `Payslip — ${data.period}`);

  const num = (v: unknown): number => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v ?? 0));
    return Number.isFinite(n) ? n : 0;
  };
  const fmt = (v: unknown) => `${data.currency} ${num(v).toFixed(2)}`;

  // ── Status pill — drawn between the brand bar and the employee box ──
  // Positioned on its own row so the pill rectangle can't bleed into the
  // box drawn directly below.
  const statusColors: Record<string, [number, number, number]> = {
    paid:      [34, 197, 94],
    finalized: [59, 130, 246],
    draft:     [234, 179, 8],
    cancelled: [239, 68, 68],
  };
  const statusColor = statusColors[data.status] ?? GRAY_TEXT;
  const pillW = 40;
  const pillH = 9;
  const pillX = pageWidth - 20 - pillW; // right-aligned with 20mm right margin
  const pillY = yPos;
  doc.setFillColor(...statusColor);
  doc.roundedRect(pillX, pillY, pillW, pillH, 2.5, 2.5, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(data.status.toUpperCase(), pillX + pillW / 2, pillY + pillH / 2 + 1.5, { align: 'center' });
  doc.setTextColor(...DARK_TEXT);

  // Push yPos past the pill + a small gap before the employee box.
  yPos += pillH + 4;

  // ── Employee information box ────────────────────────────────────────
  doc.setFillColor(250, 250, 250);
  doc.roundedRect(20, yPos, 170, 38, 3, 3, 'F');
  doc.setDrawColor(...BRAND_COLOR);
  doc.roundedRect(20, yPos, 170, 38, 3, 3, 'S');

  yPos += 9;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Employee', 25, yPos);

  yPos += 7;
  doc.setFontSize(10);
  doc.setTextColor(...DARK_TEXT);

  const labelX = 25;
  const valueX = 60;
  const right2 = 115;
  const right2Val = 145;

  doc.setFont('helvetica', 'bold'); doc.text('Name:', labelX, yPos);
  doc.setFont('helvetica', 'normal'); doc.text(data.employee.name, valueX, yPos);
  if (data.employee.position) {
    doc.setFont('helvetica', 'bold'); doc.text('Position:', right2, yPos);
    doc.setFont('helvetica', 'normal'); doc.text(data.employee.position, right2Val, yPos);
  }

  yPos += 7;
  doc.setFont('helvetica', 'bold'); doc.text('Email:', labelX, yPos);
  doc.setFont('helvetica', 'normal'); doc.text(data.employee.email, valueX, yPos);
  if (data.employee.odId) {
    doc.setFont('helvetica', 'bold'); doc.text('Staff ID:', right2, yPos);
    doc.setFont('helvetica', 'normal'); doc.text(data.employee.odId, right2Val, yPos);
  }

  yPos += 7;
  doc.setFont('helvetica', 'bold'); doc.text('Period:', labelX, yPos);
  doc.setFont('helvetica', 'normal'); doc.text(data.period, valueX, yPos);
  if (data.employee.payrollId) {
    doc.setFont('helvetica', 'bold'); doc.text('Payroll ID:', right2, yPos);
    doc.setFont('helvetica', 'normal'); doc.text(data.employee.payrollId, right2Val, yPos);
  }

  yPos += 18;

  // ── Earnings + Deductions table ─────────────────────────────────────
  const dedRows = data.deductions.length === 0
    ? [['—', 'No deductions', '']]
    : data.deductions.map((d) => [
        d.type.toUpperCase(),
        d.description || '',
        fmt(d.amount),
      ]);

  autoTable(doc, {
    startY: yPos,
    head: [[{ content: 'Earnings', colSpan: 3, styles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255], halign: 'left' } }]],
    body: [
      ['', 'Gross Salary', { content: fmt(data.gross), styles: { halign: 'right', fontStyle: 'bold' } }],
    ],
    theme: 'striped',
    headStyles: { fontStyle: 'bold', fontSize: 11 },
    styles: { fontSize: 10 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 100 },
      2: { cellWidth: 40, halign: 'right' },
    },
    margin: { left: 20, right: 20 },
  });
  yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY ?? yPos;
  yPos += 4;

  autoTable(doc, {
    startY: yPos,
    head: [[
      { content: 'Type',         styles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255] } },
      { content: 'Description',  styles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255] } },
      { content: 'Amount',       styles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255], halign: 'right' } },
    ]],
    body: [
      [{ content: 'Deductions', colSpan: 3, styles: { fontStyle: 'bold', fillColor: [245, 245, 245], textColor: DARK_TEXT } }],
      ...dedRows,
    ],
    foot: [[
      { content: 'Total Deductions', colSpan: 2, styles: { fontStyle: 'bold' } },
      { content: fmt(data.deductionsTotal), styles: { fontStyle: 'bold', halign: 'right', textColor: [239, 68, 68] } },
    ]],
    theme: 'striped',
    styles: { fontSize: 10 },
    footStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 100 },
      2: { cellWidth: 40, halign: 'right' },
    },
    margin: { left: 20, right: 20 },
  });
  yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY ?? yPos;
  yPos += 12;

  // ── Net pay highlight box ───────────────────────────────────────────
  doc.setFillColor(245, 240, 255);
  doc.roundedRect(20, yPos, 170, 24, 4, 4, 'F');
  doc.setDrawColor(...BRAND_COLOR);
  doc.roundedRect(20, yPos, 170, 24, 4, 4, 'S');

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Net Pay', 30, yPos + 15);

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(fmt(data.net), 180, yPos + 15, { align: 'right' });

  yPos += 32;

  // ── Notes (optional) ────────────────────────────────────────────────
  if (data.notes) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY_TEXT);
    doc.text(`Notes: ${data.notes}`, 20, yPos);
    yPos += 6;
  }

  // ── Issued line ─────────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setTextColor(...GRAY_TEXT);
  doc.setFont('helvetica', 'italic');
  doc.text(
    `Issued: ${(() => {
      try { return new Date(data.generatedAt).toLocaleString('en-GB'); } catch { return data.generatedAt; }
    })()}`,
    20,
    yPos
  );

  addFooter(doc);
  doc.save(`UniFlow_Payslip_${data.period}_${data.employee.name.replace(/\s+/g, '_')}.pdf`);
};

/**
 * One-call helper used by every "Download Transcript PDF" button.
 * Fetches the transcript JSON from user-profile (:4007) via apiFetch
 * (silent-refresh aware), shapes the response into the existing
 * `TranscriptData` form that `generateTranscriptPDF` expects, then triggers
 * the client-side PDF render. Optional `studentMeta` lets callers pass in
 * the student's display name / email up-front so the PDF header is correct
 * even if those fields aren't on the transcript payload itself.
 *
 * Returns true on success. On HTTP error, surfaces a one-line alert so
 * the user knows why nothing happened.
 */
export async function downloadTranscriptPdf(
  userId: string,
  studentMeta?: {
    name?: string;
    studentId?: string;
    major?: string;
    email?: string;
    enrollmentDate?: string;
    expectedGraduation?: string;
    /** When true, fetch the current-semester gradebook via the admin endpoint
     *  instead of the /me path. Set automatically when admin generates a PDF
     *  for another student from TranscriptsPage / UserEditPage. */
    isAdmin?: boolean;
  },
): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_URLS.userProfile()}/api/academic/transcript/${userId}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert(`Could not load transcript (HTTP ${res.status}): ${body?.error ?? ''}`);
      return false;
    }
    const data = await res.json() as {
      gpa?: number;
      totalCredits?: number;
      semesters?: Array<{
        name: string;
        courses: Array<{
          code: string;
          title: string;
          credits: number;
          grade: string;
          totalEarned?: number | null;
          totalMax?: number;
          breakdown?: TranscriptBreakdownCategory[];
        }>;
      }>;
    };
    const semesters = Array.isArray(data.semesters) ? data.semesters : [];
    const historicalCourses = semesters.flatMap((sem) =>
      (Array.isArray(sem.courses) ? sem.courses : []).map((c) => ({
        code: c.code,
        name: c.title,
        credits: c.credits,
        grade: c.grade,
        semester: sem.name,
        totalEarned: c.totalEarned,
        totalMax: c.totalMax,
        breakdown: c.breakdown,
      })),
    );

    // Plan 5 follow-up — also fetch current-semester (in-progress) courses so
    // the PDF mirrors what the student sees on FullTranscript. Live rows show
    // grade='IP'. Fail-open: if the endpoint is unreachable / 403, the PDF
    // just omits the current-semester block instead of refusing to render.
    const currentSemesterUrl = studentMeta?.isAdmin
      ? `${API_URLS.courseContent()}/api/admin/users/${userId}/gradebook/current-semester`
      : `${API_URLS.courseContent()}/api/me/gradebook/current-semester`;
    let liveCourses: Array<{
      code: string;
      name: string;
      credits: number;
      grade: string;
      semester: string;
      totalEarned?: number | null;
      totalMax?: number;
      breakdown?: TranscriptBreakdownCategory[];
    }> = [];
    try {
      const liveRes = await apiFetch(currentSemesterUrl);
      if (liveRes.ok) {
        // Build per-course breakdowns from the live gradebook columns +
        // scores. The endpoint returns `columns: [{key,label,type,maxScore}]`
        // and `scores: {key→number|null}`; we fold them into the same
        // category buckets (Assignments / Quizzes / Exams) the historical
        // path uses so the PDF render path doesn't need to special-case
        // in-progress courses.
        const liveData = await liveRes.json() as {
          courses?: Array<{
            courseCode: string;
            courseTitle: string;
            credits: number;
            columns?: Array<{
              key: string;
              label: string;
              type: 'assignment' | 'quiz' | 'midterm' | 'final';
              maxScore: number;
            }>;
            scores?: Record<string, number | null>;
          }>;
        };
        const TITLE_FOR: Record<string, string> = {
          assignment: 'Assignments',
          quiz: 'Quizzes',
          midterm: 'Exams',
          final: 'Exams',
        };
        liveCourses = (Array.isArray(liveData.courses) ? liveData.courses : []).map((c) => {
          const buckets = new Map<string, TranscriptBreakdownCategory>();
          for (const col of c.columns ?? []) {
            const title = TITLE_FOR[col.type] || 'Other';
            if (!buckets.has(title)) {
              buckets.set(title, { title, assignments: [], subtotalEarned: 0, subtotalMax: 0 });
            }
            const bucket = buckets.get(title)!;
            const earned = c.scores?.[col.key];
            const earnedNum = (typeof earned === 'number' && Number.isFinite(earned)) ? earned : null;
            bucket.assignments.push({
              name: col.label,
              earned: earnedNum,
              max: col.maxScore,
            });
            if (earnedNum != null) {
              bucket.subtotalEarned = (bucket.subtotalEarned ?? 0) + earnedNum;
            }
            bucket.subtotalMax += col.maxScore;
          }
          // Mark subtotals null when no component in the bucket has been
          // scored yet — keeps the rendered PDF honest instead of showing
          // a misleading 0 / 100.
          for (const b of buckets.values()) {
            const anyScored = b.assignments.some((a) => a.earned != null);
            if (!anyScored) b.subtotalEarned = null;
          }
          const breakdown = Array.from(buckets.values());
          const allScored = breakdown.flatMap((b) => b.assignments).filter((a) => a.earned != null);
          const totalEarned = allScored.length > 0
            ? allScored.reduce((s, a) => s + (a.earned ?? 0), 0)
            : null;
          const totalMax = breakdown.reduce((s, b) => s + b.subtotalMax, 0);
          return {
            code: c.courseCode,
            name: c.courseTitle,
            credits: c.credits,
            grade: 'IP',
            semester: 'Current Semester',
            totalEarned,
            totalMax,
            breakdown: breakdown.length > 0 ? breakdown : undefined,
          };
        });
      }
    } catch { /* current-semester is best-effort */ }

    const courses = [...historicalCourses, ...liveCourses];

    generateTranscriptPDF({
      student: {
        name: studentMeta?.name ?? 'Student',
        studentId: studentMeta?.studentId ?? userId,
        major: studentMeta?.major ?? 'Undeclared',
        email: studentMeta?.email ?? '',
        enrollmentDate: studentMeta?.enrollmentDate ?? '',
        expectedGraduation: studentMeta?.expectedGraduation ?? '',
      },
      courses,
      cumulativeGPA: typeof data.gpa === 'number' ? data.gpa : 0,
      totalCredits: typeof data.totalCredits === 'number' ? data.totalCredits : 0,
      totalEarned: typeof data.totalCredits === 'number' ? data.totalCredits : 0,
    });
    return true;
  } catch (err) {
    window.alert(err instanceof Error ? err.message : 'Network error');
    return false;
  }
}

/**
 * One-call helper used by every "Download PDF" button on a payslip row.
 *   • `scope: 'admin'` → fetches via /api/admin/payroll/payslips/:id
 *   • `scope: 'me'`    → fetches via /api/me/payslips/:id (ownership-gated)
 *
 * Returns true on success. On HTTP error, surfaces a one-line alert so
 * the user knows why nothing happened.
 */
export async function downloadPayslipPdf(
  payslipId: string,
  scope: 'admin' | 'me' = 'admin',
): Promise<boolean> {
  const path = scope === 'admin'
    ? `/api/admin/payroll/payslips/${payslipId}`
    : `/api/me/payslips/${payslipId}`;
  try {
    const res = await apiFetch(`${API_URLS.payments()}${path}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert(`Could not load payslip (HTTP ${res.status}): ${body?.error ?? ''}`);
      return false;
    }
    const json = await res.json();
    generatePayslipPDF(json.payslip as PayslipPdfData);
    return true;
  } catch (err) {
    window.alert(err instanceof Error ? err.message : 'Network error');
    return false;
  }
}

// ==================== STUDENT REPORT (DOSSIER) PDF ====================
// Renders the full ReportsPage dossier (identity + standing + warnings +
// per-semester GPA + attendance + financials + cases + registrations).
// Uses the same data shape returned by GET /api/admin/reports/student/:id.

export interface StudentReportPdfData {
  user: {
    id: string; firstName: string; lastName: string; email: string;
    suspendedAt: string | null;
  };
  academic: {
    studentId: string | null;
    gpa: number; totalCredits: number; completedCredits: number;
    level: number | null; program: string | null;
    academicStanding: 'good' | 'warning' | 'probation' | 'dismissed';
    honorsEligible: 'none' | 'honors' | 'high_honors' | 'disqualified';
  };
  warnings: {
    totalWarnings: number;
    currentConsecutive: number;
    maxConsecutiveEver: number;
    consecutiveDismissalThreshold: number;
    nonConsecutiveDismissalThreshold: number;
    probationFloor: number;
    dismissalFloor: number;
  };
  semesters: Array<{
    semesterCode: string | null;
    semesterName: string | null;
    year: number | null;
    gpa: number;
    cumulativeGpa: number;
    credits: number;
    isBelowProbation: boolean;
    isBelowDismissal: boolean;
  }>;
  attendance: {
    present: number; late: number; absent: number; excused: number;
    totalSessions: number; overallRate: number;
    perCourse: Array<{
      courseCode: string;
      present: number; late: number; absent: number; excused: number;
      total: number; attendanceRate: number;
    }>;
  };
  financial: {
    balance: number; totalPaid: number; totalCharged: number;
    invoiceCount: number;
    lastPaymentAt: string | null;
    lastPaymentAmount: number | null;
    lastPaymentMethod: string | null;
  };
  cases: {
    openComplaints: number;
    openRequests: number;
    openNameChanges: number;
  };
  registrations: Array<{
    courseCode: string | null;
    courseTitle: string | null;
    credits: number | null;
    sectionType: string | null;
    status: string;
  }>;
  currency: string; // ISO 4217 from useCurrency() — caller supplies
}

export const generateStudentReportPDF = (data: StudentReportPdfData): void => {
  const doc: jsPDFWithAutoTable = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const fullName = `${data.user.firstName} ${data.user.lastName}`.trim();
  let yPos = addHeader(doc, `Student Report — ${fullName}`);

  const fmt = (n: number) => `${data.currency} ${n.toFixed(2)}`;
  const pct = (n: number) => `${Math.round(n)}%`;

  // Standing pill — drawn between brand bar and identity box on its own row.
  const standingColors: Record<string, [number, number, number]> = {
    good:      [34, 197, 94],
    warning:   [234, 179, 8],
    probation: [249, 115, 22],
    dismissed: [239, 68, 68],
  };
  const standingColor = standingColors[data.academic.academicStanding] ?? GRAY_TEXT;
  const standingLabel = data.academic.academicStanding.toUpperCase();
  const pillW = 50;
  const pillH = 9;
  const pillX = pageWidth - 20 - pillW;
  doc.setFillColor(...standingColor);
  doc.roundedRect(pillX, yPos, pillW, pillH, 2.5, 2.5, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(standingLabel, pillX + pillW / 2, yPos + pillH / 2 + 1.5, { align: 'center' });
  doc.setTextColor(...DARK_TEXT);
  yPos += pillH + 4;

  // ── Identity box ────────────────────────────────────────────────────
  doc.setFillColor(250, 250, 250);
  doc.roundedRect(20, yPos, 170, 32, 3, 3, 'F');
  doc.setDrawColor(...BRAND_COLOR);
  doc.roundedRect(20, yPos, 170, 32, 3, 3, 'S');

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Student', 25, yPos + 8);

  doc.setFontSize(10);
  doc.setTextColor(...DARK_TEXT);
  const labelX = 25, valueX = 55, right2 = 115, right2Val = 145;

  doc.setFont('helvetica', 'bold'); doc.text('Name:', labelX, yPos + 16);
  doc.setFont('helvetica', 'normal'); doc.text(fullName, valueX, yPos + 16);
  doc.setFont('helvetica', 'bold'); doc.text('Email:', right2, yPos + 16);
  doc.setFont('helvetica', 'normal'); doc.text(data.user.email, right2Val, yPos + 16);

  doc.setFont('helvetica', 'bold'); doc.text('Student ID:', labelX, yPos + 23);
  doc.setFont('helvetica', 'normal'); doc.text(data.academic.studentId ?? '—', valueX, yPos + 23);
  doc.setFont('helvetica', 'bold'); doc.text('Program:', right2, yPos + 23);
  doc.setFont('helvetica', 'normal'); doc.text(data.academic.program ?? '—', right2Val, yPos + 23);

  doc.setFont('helvetica', 'bold'); doc.text('Level:', labelX, yPos + 30);
  doc.setFont('helvetica', 'normal'); doc.text(data.academic.level != null ? String(data.academic.level) : '—', valueX, yPos + 30);
  if (data.academic.honorsEligible !== 'none') {
    doc.setFont('helvetica', 'bold'); doc.text('Honors:', right2, yPos + 30);
    doc.setFont('helvetica', 'normal'); doc.text(data.academic.honorsEligible.replace('_', ' '), right2Val, yPos + 30);
  }
  yPos += 38;

  // ── KPI summary (4 boxes in a row) ──────────────────────────────────
  const kpiW = 40, kpiH = 22, kpiGap = 3;
  const kpis: { label: string; value: string; sub: string }[] = [
    { label: 'GPA', value: data.academic.gpa.toFixed(2), sub: `${data.academic.completedCredits}/${data.academic.totalCredits} cr` },
    { label: 'Attendance', value: pct(data.attendance.overallRate), sub: `${data.attendance.totalSessions} sessions` },
    { label: 'Outstanding', value: fmt(data.financial.balance), sub: `${data.financial.invoiceCount} inv.` },
    { label: 'Open Cases', value: String(data.cases.openComplaints + data.cases.openRequests + data.cases.openNameChanges), sub: `${data.cases.openComplaints}c/${data.cases.openRequests}r/${data.cases.openNameChanges}n` },
  ];
  let kpiX = 20;
  kpis.forEach((k) => {
    doc.setFillColor(245, 240, 255);
    doc.roundedRect(kpiX, yPos, kpiW, kpiH, 2, 2, 'F');
    doc.setDrawColor(...BRAND_COLOR);
    doc.roundedRect(kpiX, yPos, kpiW, kpiH, 2, 2, 'S');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GRAY_TEXT);
    doc.text(k.label.toUpperCase(), kpiX + 3, yPos + 5);
    doc.setFontSize(11);
    doc.setTextColor(...DARK_TEXT);
    doc.text(k.value, kpiX + 3, yPos + 13);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_TEXT);
    doc.text(k.sub, kpiX + 3, yPos + 18);
    kpiX += kpiW + kpiGap;
  });
  yPos += kpiH + 8;

  // ── Academic warnings counters + policy ─────────────────────────────
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Academic Warnings', 20, yPos);
  yPos += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK_TEXT);
  const w = data.warnings;
  doc.text(`Probation floor: cum GPA < ${w.probationFloor.toFixed(2)} · Dismissal floor: cum GPA < ${w.dismissalFloor.toFixed(2)}`, 20, yPos);
  yPos += 5;
  doc.text(`Dismissal triggers: ${w.consecutiveDismissalThreshold} consecutive or ${w.nonConsecutiveDismissalThreshold} non-consecutive warnings.`, 20, yPos);
  yPos += 6;
  doc.setFont('helvetica', 'bold');
  doc.text(`Current consecutive: ${w.currentConsecutive} / ${w.consecutiveDismissalThreshold}    Total warnings: ${w.totalWarnings} / ${w.nonConsecutiveDismissalThreshold}    Max ever: ${w.maxConsecutiveEver}`, 20, yPos);
  yPos += 8;

  // Per-semester GPA table
  if (data.semesters.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [['Semester', 'Year', 'GPA', 'Cumulative', 'Credits', 'Status']],
      body: data.semesters.map((s) => [
        s.semesterName ?? s.semesterCode ?? '—',
        s.year != null ? String(s.year) : '—',
        s.gpa.toFixed(2),
        s.cumulativeGpa.toFixed(2),
        String(s.credits),
        s.isBelowDismissal ? 'Dismiss-low' : s.isBelowProbation ? 'Warning' : 'OK',
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255], fontSize: 9 },
      styles: { fontSize: 9 },
      margin: { left: 20, right: 20 },
    });
    yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY ?? yPos;
    yPos += 8;
  } else {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY_TEXT);
    doc.text('No semester GPA records yet.', 20, yPos);
    yPos += 8;
  }

  // ── Attendance section ──────────────────────────────────────────────
  if (yPos > 230) { doc.addPage(); yPos = 20; }
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Attendance', 20, yPos);
  yPos += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK_TEXT);
  const a = data.attendance;
  doc.text(`Present: ${a.present}    Late: ${a.late}    Absent: ${a.absent}    Excused: ${a.excused}    Total: ${a.totalSessions}    Overall: ${pct(a.overallRate)}`, 20, yPos);
  yPos += 6;

  if (a.perCourse.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [['Course', 'Present', 'Late', 'Absent', 'Excused', 'Total', 'Rate']],
      body: a.perCourse.map((c) => [
        c.courseCode,
        String(c.present),
        String(c.late),
        String(c.absent),
        String(c.excused),
        String(c.total),
        pct(c.attendanceRate),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255], fontSize: 9 },
      styles: { fontSize: 9 },
      margin: { left: 20, right: 20 },
    });
    yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY ?? yPos;
    yPos += 8;
  } else {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY_TEXT);
    doc.text('No attendance records yet.', 20, yPos);
    yPos += 8;
  }

  // ── Financial summary ───────────────────────────────────────────────
  if (yPos > 240) { doc.addPage(); yPos = 20; }
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Financial Summary', 20, yPos);
  yPos += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK_TEXT);
  const f = data.financial;
  doc.text(`Outstanding balance: ${fmt(f.balance)}    Total paid: ${fmt(f.totalPaid)}    Invoices: ${f.invoiceCount}`, 20, yPos);
  yPos += 5;
  if (f.lastPaymentAt) {
    const lp = `${new Date(f.lastPaymentAt).toLocaleDateString()} — ${f.lastPaymentAmount != null ? fmt(f.lastPaymentAmount) : '—'}${f.lastPaymentMethod ? ` (${f.lastPaymentMethod})` : ''}`;
    doc.text(`Last payment: ${lp}`, 20, yPos);
    yPos += 5;
  }
  yPos += 4;

  // ── Current registrations + open cases ──────────────────────────────
  if (yPos > 240) { doc.addPage(); yPos = 20; }
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Current Registrations', 20, yPos);
  yPos += 6;
  if (data.registrations.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [['Course', 'Title', 'Credits', 'Type', 'Status']],
      body: data.registrations.map((r) => [
        r.courseCode ?? '—',
        r.courseTitle ?? '—',
        r.credits != null ? String(r.credits) : '—',
        r.sectionType ?? '—',
        r.status,
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255], fontSize: 9 },
      styles: { fontSize: 9 },
      margin: { left: 20, right: 20 },
    });
    yPos = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY ?? yPos;
    yPos += 8;
  } else {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY_TEXT);
    doc.text('No active registrations.', 20, yPos);
    yPos += 8;
  }

  if (yPos > 270) { doc.addPage(); yPos = 20; }
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Open SA Cases', 20, yPos);
  yPos += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK_TEXT);
  doc.text(`Complaints: ${data.cases.openComplaints}    Requests: ${data.cases.openRequests}    Name changes: ${data.cases.openNameChanges}`, 20, yPos);

  addFooter(doc);
  doc.save(`UniFlow_StudentReport_${fullName.replace(/\s+/g, '_')}.pdf`);
};

/** One-call helper: fetch dossier JSON, render PDF. */
export async function downloadStudentReportPdf(
  userId: string,
  currency: string,
): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_URLS.userProfile()}/api/admin/reports/student/${userId}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert(`Could not load report (HTTP ${res.status}): ${(body as { error?: string })?.error ?? ''}`);
      return false;
    }
    const json = await res.json();
    generateStudentReportPDF({ ...(json as Omit<StudentReportPdfData, 'currency'>), currency });
    return true;
  } catch (err) {
    window.alert(err instanceof Error ? err.message : 'Network error');
    return false;
  }
}

