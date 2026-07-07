require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1bGFVn46o5TtQBkNNyKVuH5CtazR3p-Wnp7fWvKrK93U';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Seoul';
const PORT = Number(process.env.PORT) || 8790;
const AUTH_SECRET = process.env.AUTH_SECRET || 'salt-morning-dev-secret';

module.exports = {
  SPREADSHEET_ID,
  TIMEZONE,
  PORT,
  AUTH_SECRET,
  CLASS_LIST_SHEET: 'Class_List',
  STUDENT_LIST_SHEET: 'Student_List',
  TEACHER_LIST_SHEET: 'Teacher_List',
  CLASS_TEACHERS_SHEET: 'Class_Teachers',
  PARENT_LIST_SHEET: 'Parent_List',
  PARENT_ANNOUNCEMENTS_SHEET: 'Parent_Announcements',
  ATTENDANCE_SHEET: 'Attendance_Data',
  STUDENT_PLANNED_ATTENDANCE_SHEET: 'Student_Planned_Attendance',
  MESSAGES_SHEET: 'Student_Messages',
  GRADES_DAILY_SHEET: 'Grades_Daily',
  REPORT_CARD_FIELDS_SHEET: 'ReportCard_Fields',
  REPORT_CARD_ENTRIES_SHEET: 'ReportCard_Entries',
  LESSON_PLANS_SHEET: 'Lesson_Plans',
  SUBJECTS_SHEET: 'Subjects'
};
