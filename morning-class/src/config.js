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
  STUDENT_PROFILE_SHEET: 'Student_Profile',
  STUDENT_PROFILE_FIELDS_SHEET: 'Student_Profile_Fields',
  TEACHER_LIST_SHEET: 'Teacher_List',
  CLASS_TEACHERS_SHEET: 'Class_Teachers',
  PARENT_LIST_SHEET: 'Parent_List',
  PARENT_ANNOUNCEMENTS_SHEET: 'Parent_Announcements',
  ATTENDANCE_SHEET: 'Attendance_Data',
  STUDENT_PLANNED_ATTENDANCE_SHEET: 'Student_Planned_Attendance',
  MESSAGES_SHEET: 'Student_Messages',
  GRADES_DAILY_SHEET: 'Grades_Daily',
  GRADE_ASSESSMENTS_SHEET: 'Grade_Assessments',
  GRADE_WEIGHTS_SHEET: 'Grade_Weights',
  GRADE_TERMS_SHEET: 'Grade_Terms',
  REPORT_CARD_FIELDS_SHEET: 'ReportCard_Fields',
  REPORT_CARD_ENTRIES_SHEET: 'ReportCard_Entries',
  LESSON_PLANS_SHEET: 'Lesson_Plans',
  ADMIN_LIST_SHEET: 'Admin_List',
  SUBJECTS_SHEET: 'Subjects',
  TEACHER_CLASS_SUBJECTS_SHEET: 'Teacher_Class_Subjects',
  TEACHER_SUBJECT_STYLES_SHEET: 'Teacher_Subject_Styles',
  TIMETABLE_ENTRIES_SHEET: 'Timetable_Entries',
  BELL_SCHEDULE_SHEET: 'Bell_Schedule',
  TIMETABLE_REQUIREMENTS_SHEET: 'Timetable_Requirements',
  TIMETABLE_SOLVER_URL: process.env.TIMETABLE_SOLVER_URL || 'http://127.0.0.1:8791'
};
