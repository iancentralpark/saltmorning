#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('../src/bootstrapCredentials');
bootstrapCredentials();

const { google } = require('googleapis');
const { getServiceAccountAuthOptions } = require('../src/googleCredentials');

const args = process.argv.slice(2);
const idArg = args.find((a) => a.startsWith('--id='));
const spreadsheetId = (idArg ? idArg.split('=').slice(1).join('=') : '') ||
  process.env.SPREADSHEET_ID || '';
const withSeed = args.includes('--seed');

const SHEETS = [
  { name: 'Class_List', headers: ['ClassID', 'Name', 'ScheduleType', 'AllowedDays'], seed: [['C001', 'Morning Class A', 'MWF', '1,3,5']] },
  { name: 'Student_List', headers: ['StudentID', 'Name', 'ClassID', 'Status', 'LoginID', 'LoginPassword'], seed: [['S001', 'Test Student', 'C001', 'Enrolled', 'student', 'student123']] },
  { name: 'Teacher_List', headers: ['TeacherID', 'Name', 'LoginID', 'LoginPassword', 'HomeroomClassID', 'StaffRole'], seed: [['T001', 'Test Teacher', 'teacher', 'teacher123', 'C001', 'Teacher']] },
  { name: 'Class_Teachers', headers: ['ClassID', 'TeacherID', 'AssignmentType', 'Subject'], seed: [['C001', 'T001', 'Homeroom', '']] },
  { name: 'Parent_List', headers: ['ParentID', 'StudentID', 'Name', 'LoginID', 'LoginPassword', 'Phone', 'Email'], seed: [['P001', 'S001', 'Test Parent', 'parent', 'parent123', '', '']] },
  { name: 'Parent_Announcements', headers: ['AnnouncementID', 'Title', 'Body', 'PostedAt', 'PostedBy', 'Active'], seed: [['A001', 'Welcome Parents', 'Salt Academy Morning Class parent portal is now open.', new Date().toISOString(), 'Admin', 'true']] },
  { name: 'Subjects', headers: ['SubjectID', 'Name', 'SortOrder'], seed: [['SUBJ01', 'English', '1'], ['SUBJ02', 'Math', '2'], ['SUBJ03', 'Science', '3']] },
  { name: 'Student_Withdrawn', headers: ['WithdrawalID', 'StudentID', 'Name', 'ClassID', 'LoginID', 'LoginPassword', 'PreviousStatus', 'WithdrawnAt'] },
  { name: 'Student_Leave', headers: ['LeaveID', 'StudentID', 'Name', 'ClassID', 'StartDate', 'EndDate', 'Reason', 'Status', 'CreatedAt', 'EndedAt'] },
  { name: 'Student_Planned_Attendance', headers: ['NoticeID', 'StudentID', 'Name', 'ClassID', 'Date', 'Type', 'Note', 'Status', 'CreatedAt'] },
  { name: 'Attendance_Data', headers: ['Date', 'ClassID', 'StudentID', 'Attendance', 'VocabScore', 'Excuse'] },
  { name: 'Classroom_Map', headers: ['ClassID', 'CourseID', 'CourseName'] },
  { name: 'Homework_Log', headers: ['HomeworkID', 'ClassID', 'AssignedDate', 'Title', 'Description', 'ClassroomWorkId', 'PostedAt'] },
  { name: 'Homework_Items', headers: ['ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description', 'TargetStudentIDs'] },
  { name: 'Homework_Completion', headers: ['ItemID', 'StudentID', 'Completed', 'CompletedAt', 'FixNote'] },
  { name: 'Homework_Manual_Pending', headers: ['PendingID', 'ClassID', 'StudentID', 'Title', 'Description', 'CreatedAt', 'FixNote'] },
  { name: 'Student_Messages', headers: ['MessageId', 'CreatedAt', 'ClassId', 'StudentId', 'StudentName', 'Sender', 'Body', 'ReadAt', 'DeletedAt'] },
  { name: 'Grades_Daily', headers: ['RecordID', 'ClassID', 'StudentID', 'Subject', 'Date', 'Score', 'MaxScore', 'GradeType', 'TeacherID', 'Note'] },
  { name: 'ReportCard_Fields', headers: ['FieldID', 'ClassID', 'Term', 'Subject', 'FieldKey', 'Label', 'SortOrder', 'MaxScore'], seed: [
    ['RCF01', 'C001', 'Term1', 'English', 'quiz_avg', 'Daily Quiz Average', '1', '100'],
    ['RCF02', 'C001', 'Term1', 'English', 'midterm', 'Midterm', '2', '100'],
    ['RCF03', 'C001', 'Term1', 'English', 'comment', 'Teacher Comment', '3', '0']
  ] },
  { name: 'ReportCard_Entries', headers: ['EntryID', 'ClassID', 'StudentID', 'Term', 'Subject', 'FieldKey', 'Score', 'Comment', 'TeacherID', 'UpdatedAt'] },
  { name: 'Lesson_Plans', headers: ['PlanID', 'TeacherID', 'ClassID', 'Subject', 'WeekStart', 'Title', 'Objectives', 'Materials', 'Procedure', 'Homework', 'Status', 'SubmittedAt', 'CreatedAt', 'UpdatedAt'] },
  { name: 'Dollar_Balances', headers: ['StudentID', 'Balance'] },
  { name: 'Dollar_Transactions', headers: ['Timestamp', 'ClassID', 'StudentID', 'Amount', 'NewBalance', 'Reason'] },
  { name: 'Class_Textbooks', headers: ['TextbookID', 'ClassID', 'Name', 'Type', 'UnitType', 'TotalUnits', 'StartDate', 'Status', 'CompletedAt'] },
  { name: 'Textbook_Progress', headers: ['Date', 'ClassID', 'TextbookID', 'Position'] },
  { name: 'Textbook_Queue', headers: ['QueueID', 'ClassID', 'SortOrder', 'Name', 'Type', 'UnitType', 'TotalUnits', 'CreatedAt'] },
  { name: 'Class_Rules', headers: ['ClassID', 'Rules', 'UpdatedAt'] },
  { name: 'Library_Books', headers: ['BookID', 'ClassID', 'StudentID', 'Title', 'Status', 'CreatedAt', 'ReturnedAt'] },
  { name: 'Class_Announcements', headers: ['ClassID', 'Text', 'UpdatedAt'] },
  { name: 'Class_Events', headers: ['EventID', 'ClassID', 'EventDate', 'Description', 'CreatedAt'] },
  { name: 'Class_Video', headers: ['ClassID', 'VideoUrl', 'UpdatedAt'] },
  { name: 'Chambit_Daily', headers: ['Date', 'ClassID', 'StudentID'] },
  { name: 'Chambit_Combo', headers: ['StudentID', 'ComboCount', 'UpdatedAt'] },
  { name: 'Chambit_WeekAwards', headers: ['StudentID', 'WeekKey', 'AwardedAt'] },
  { name: 'Lucky_Draw_Tickets', headers: ['TicketID', 'ClassID', 'StudentID', 'Tier', 'PrizeText', 'DrawnAt'] },
  { name: 'Lucky_Draw_Tiers', headers: ['TierID', 'TierName', 'Weight', 'SortOrder', 'Active'] },
  { name: 'Lucky_Draw_Prizes', headers: ['TierID', 'PrizeText', 'SortOrder', 'Active'] },
  { name: 'Makeup_Lessons', headers: ['MakeupID', 'ClassID', 'StudentID', 'StudentName', 'Date', 'Time', 'Note', 'Status', 'CreatedAt'] }
];

async function main() {
  if (!spreadsheetId) {
    console.error('Missing SPREADSHEET_ID');
    process.exit(1);
  }
  const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
  if (!authOpts) {
    console.error('No Google credentials');
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth(authOpts);
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const toCreate = SHEETS.filter((s) => !existing.has(s.name));
  if (toCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: toCreate.map((s) => ({ addSheet: { properties: { title: s.name } } })) }
    });
    console.log('Created', toCreate.length, 'sheets');
  }
  const valueUpdates = [];
  for (const def of SHEETS) {
    valueUpdates.push({ range: `'${def.name}'!A1`, values: [def.headers] });
    if (withSeed && def.seed) {
      def.seed.forEach((row, i) => {
        valueUpdates.push({ range: `'${def.name}'!A${i + 2}`, values: [row] });
      });
    }
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data: valueUpdates }
  });
  console.log('Done —', SHEETS.length, 'sheet headers updated.');
  if (withSeed) {
    console.log('Seed logins: student/student123, parent/parent123, teacher/teacher123');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
