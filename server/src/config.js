require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1XNZYW16PWijfNZPe3knwLnTw5Be_x_BoCeL3G1WO7jg';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Seoul';
const PORT = Number(process.env.PORT) || 8787;

const TEACHER_GATE_PASSWORD = process.env.TEACHER_GATE_PASSWORD || '';
const TEACHER_APP_URL = process.env.TEACHER_APP_URL ||
  'https://script.google.com/macros/s/AKfycbynz8z_cX8GeKSzZNWt0cUg2PRyOlDHhZE1_XMoEMhlbdnNaHFZ9cfjrrabfB5odDleVQ/exec';

module.exports = {
  SPREADSHEET_ID,
  TIMEZONE,
  PORT,
  TEACHER_GATE_PASSWORD,
  TEACHER_APP_URL,
  DOLLAR_SHEETS: { BALANCES: 'Dollar_Balances', TRANSACTIONS: 'Dollar_Transactions' },
  TEXTBOOK_SHEETS: {
    BOOKS: 'Class_Textbooks',
    PROGRESS: 'Textbook_Progress',
    QUEUE: 'Textbook_Queue'
  },
  HOMEWORK_SHEETS: {
    MAP: 'Classroom_Map',
    LOG: 'Homework_Log',
    ITEMS: 'Homework_Items',
    COMPLETION: 'Homework_Completion'
  },
  RULES_SHEET: 'Class_Rules',
  LIBRARY_SHEET: 'Library_Books',
  ANNOUNCE_SHEET: 'Class_Announcements',
  EVENTS_SHEET: 'Class_Events',
  VIDEO_SHEET: 'Class_Video',
  CHAMBIT_DAILY_SHEET: 'Chambit_Daily',
  CHAMBIT_COMBO_SHEET: 'Chambit_Combo',
  CHAMBIT_WEEK_SHEET: 'Chambit_WeekAwards',
  LUCKY_DRAW_SHEET: 'Lucky_Draw_Tickets',
  LUCKY_DRAW_TIERS_SHEET: 'Lucky_Draw_Tiers',
  LUCKY_DRAW_PRIZES_SHEET: 'Lucky_Draw_Prizes',
  MANUAL_PENDING_SHEET: 'Homework_Manual_Pending',
  CLASS_LIST_SHEET: 'Class_List',
  STUDENT_LIST_SHEET: 'Student_List',
  STUDENT_WITHDRAWN_SHEET: 'Student_Withdrawn',
  STUDENT_LEAVE_SHEET: 'Student_Leave',
  STUDENT_PLANNED_ATTENDANCE_SHEET: 'Student_Planned_Attendance',
  ATTENDANCE_SHEET: 'Attendance_Data',
  MAKEUP_SHEET: 'Makeup_Lessons',
  MESSAGES_SHEET: 'Student_Messages',
  CLASS_LOG_SPREADSHEET_ID: process.env.CLASS_LOG_SPREADSHEET_ID ||
    '1kUbo820pEzNThBmIQmwVi5MCd1O888y1rtuxz2IH4H4',
  CLASS_LOG_TAB_BY_CLASS_ID: {
    C002: { tab: '5Days', layout: 'combined', label: '5Days' },
    C003: { tab: ' MWF 3:20 ', layout: 'combined', label: 'MWF' },
    C005: { tab: 'MW 5:30 ', layout: 'split', label: 'MW', nameRowLabel: '이름' },
    C004: { tab: 'TTH 4:10', layout: 'split', label: 'TTH', nameRowLabel: '이름' }
  },
  DEFAULT_YOUTUBE_VIDEO_ID: 'gmqG2h84_Cs',
  KR_HOLIDAY_CALENDAR_ID: 'ko.south_korea#holiday@group.v.calendar.google.com',
  LUCKY_DRAW_PURCHASE_COST: 3,
  CACHE_SEC: { SIDEBAR: 300, HOLIDAY: 21600, CLASSES: 600 }
};
