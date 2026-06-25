// Route mapping function
// FIX: Added 'role' parameter defaulting to 'student' to ensure paths are absolute and correct
export const getRoutePath = (label: string, role: string = 'student'): string => {
    // Normalize the role to ensure it's lowercase
    const prefix = `/${role.toLowerCase()}`;

    const routeMap: { [key: string]: string } = {
        'Dashboard': `${prefix}/dashboard`,
        'Courses': `${prefix}/courses`,
        'Timetable': `${prefix}/timetable`,
        'Assignments': `${prefix}/assignments`,
        'Online Lectures': `${prefix}/online-lectures`,
        'Attendance': `${prefix}/attendance`,
        'GPA Calculator': `${prefix}/gpa-calculator`,
        'Payments': `${prefix}/payments`,
        'Registrations': `${prefix}/registrations`,
        'Student Affairs': `${prefix}/student-affairs`,
        'Announcements': `${prefix}/announcements`,
        'FAQ ChatBot': `${prefix}/faq-chatbot`,
        'Notifications': `${prefix}/notifications`,
        'View Profile': `${prefix}/view-profile`,
        'Settings': `${prefix}/settings`,
        'Mark Attendance': `${prefix}/mark-attendance`,
        'Full Transcript': `${prefix}/full-transcript`,
        'View Course': `${prefix}/view-course`,
    };

    return routeMap[label] || `${prefix}/dashboard`;
};