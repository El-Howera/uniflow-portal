import { PageNotification } from '../types';

export const pageNotificationsData: PageNotification[] = [
  { 
    id: 1, type: 'critical', title: 'Payment Overdue', 
    content: 'Your outstanding tuition fee payment is due tomorrow. Please settle it to avoid late charges.', 
    extraDetails: 'Reference #9923. Amount Due: $1,250.00. Please visit the Bursar office or pay via the online portal before 5:00 PM EST.',
    timestamp: '2 hours ago', isUnread: true, timeGroup: 'Today' 
  },
  { 
    id: 2, type: 'announcement', title: 'University Holiday', 
    content: 'University-wide holiday on November 25th for Fall Break. All classes are cancelled.', 
    extraDetails: 'Library and gym facilities will remain open with reduced hours (10 AM - 4 PM). Regular schedule resumes on Nov 26th.',
    timestamp: '4 hours ago', isUnread: true, timeGroup: 'Today'
  },
  { 
    id: 3, type: 'message', title: 'New Grade Posted', 
    content: 'Your grade for "Database Systems" has been posted. Check your transcript for details.', 
    timestamp: '1 day ago', isUnread: false, timeGroup: 'Yesterday'
  },
  { 
    id: 4, type: 'announcement', title: 'Registration Opens', 
    content: 'Spring 2024 course registration opens on December 1st at 9:00 AM.', 
    timestamp: '2 days ago', isUnread: false, timeGroup: 'Older'
  },
];

