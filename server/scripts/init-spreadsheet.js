#!/usr/bin/env node
/**
 * Salt Academy Morning Class — spreadsheet bootstrap
 *
 * Creates all required tabs + header rows. Optionally seeds sample class/student rows.
 *
 * Usage:
 *   SPREADSHEET_ID=<id> npm run init-sheets
 *   npm run init-sheets -- --id=<spreadsheet_id>
 *   npm run init-sheets -- --id=<spreadsheet_id> --seed
 *
 * Before running: share the spreadsheet with your service-account client_email (Editor).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('../src/bootstrapCredentials');
bootstrapCredentials();

const { google } = require('googleapis');
const { getServiceAccountAuthOptions } = require('../src/googleCredentials');

const args = process.argv.slice(2);
const idArg = args.find((a) => a.startsWith('--id='));
const spreadsheetId = (idArg ? idArg.split('=').slice(1).join('=') : '') ||
  process.env.SPREADSHEET_ID ||
  '';
const withSeed = args.includes('--seed');

/** @type {{ name: string, headers: string[], seed?: string[][] }[]} */
const SHEETS = [
  {
    name: 'Class_List',
    headers: ['ClassID', 'Name', 'ScheduleType', 'AllowedDays'],
    seed: [['C001', 'Morning Class A', 'MWF', '1,3,5']]
  },
  {
    name: 'Student_List',
    headers: ['StudentID', 'Name', 'ClassID', 'Status', 'LoginID', 'LoginPassword'],
    seed: [['S001', 'Test Student', 'C001', 'Enrolled', 'test', '1234']]
  },
  { name: 'Student_Withdrawn', headers: ['WithdrawalID', 'StudentID', 'Name', 'ClassID', 'LoginID', 'LoginPassword', 'PreviousStatus', 'WithdrawnAt'] },
  { name: 'Student_Leave', headers: ['LeaveID', 'StudentID', 'Name', 'ClassID', 'StartDate', 'EndDate', 'Reason', 'Status', 'CreatedAt', 'EndedAt'] },
  { name: 'Student_Planned_Attendance', headers: ['NoticeID', 'StudentID', 'Name', 'ClassID', 'Date', 'Type', 'Note', 'Status', 'CreatedAt'] },
  { name: 'Attendance_Data', headers: ['Date', 'ClassID', 'StudentID', 'Attendance', 'VocabScore'] },
  { name: 'Classroom_Map', headers: ['ClassID', 'CourseID', 'CourseName'] },
  { name: 'Homework_Log', headers: ['HomeworkID', 'ClassID', 'AssignedDate', 'Title', 'Description', 'ClassroomWorkId', 'PostedAt'] },
  { name: 'Homework_Items', headers: ['ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description', 'TargetStudentIDs'] },
  { name: 'Homework_Completion', headers: ['ItemID', 'StudentID', 'Completed', 'CompletedAt', 'FixNote'] },
  { name: 'Homework_Manual_Pending', headers: ['PendingID', 'ClassID', 'StudentID', 'Title', 'Description', 'CreatedAt', 'FixNote'] },
  { name: 'Student_Messages', headers: ['MessageId', 'CreatedAt', 'ClassId', 'StudentId', 'StudentName', 'Sender', 'Body', 'ReadAt', 'DeletedAt'] },
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
    console.error('\nMissing spreadsheet ID.');
    console.error('Set SPREADSHEET_ID in server/.env or pass --id=<spreadsheet_id>\n');
    process.exit(1);
  }

  const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
  if (!authOpts) {
    console.error('\nNo Google credentials found.');
    console.error('Save service-account.json in server/ or set GOOGLE_SERVICE_ACCOUNT_JSON.\n');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth(authOpts);
  const sheets = google.sheets({ version: 'v4', auth });

  let meta;
  try {
    meta = await sheets.spreadsheets.get({ spreadsheetId });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/permission|403|404/i.test(msg)) {
      console.error('\nCannot open spreadsheet. Check:');
      console.error('  1. SPREADSHEET_ID is correct');
      console.error('  2. Service account email is invited as Editor on the spreadsheet\n');
    } else {
      console.error('\nError:', msg, '\n');
    }
    process.exit(1);
  }

  const title = meta.data.properties && meta.data.properties.title;
  console.log('\nSalt Academy — init spreadsheet');
  console.log('  Title:', title || '(unknown)');
  console.log('  ID:   ', spreadsheetId);
  console.log('  Seed: ', withSeed ? 'yes' : 'no (headers only)\n');

  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const toCreate = SHEETS.filter((s) => !existing.has(s.name));

  if (toCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: toCreate.map((s) => ({
          addSheet: { properties: { title: s.name } }
        }))
      }
    });
    console.log('Created', toCreate.length, 'sheet(s):', toCreate.map((s) => s.name).join(', '));
  } else {
    console.log('All sheets already exist — updating headers only where needed.');
  }

  const valueUpdates = [];
  for (const def of SHEETS) {
    valueUpdates.push({
      range: `'${def.name}'!A1`,
      values: [def.headers]
    });
    if (withSeed && def.seed && def.seed.length) {
      def.seed.forEach((row, i) => {
        valueUpdates.push({
          range: `'${def.name}'!A${i + 2}`,
          values: [row]
        });
      });
    }
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: valueUpdates
    }
  });

  console.log('\nDone. Header rows written for', SHEETS.length, 'sheets.');
  if (withSeed) {
    console.log('Sample class C001 + student S001 (login: test / 1234) added.');
  }
  console.log('\nNext:');
  console.log('  1. Set SPREADSHEET_ID=' + spreadsheetId + ' in server/.env');
  console.log('  2. npm run dev');
  console.log('  3. Open http://localhost:8787/api/health\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
