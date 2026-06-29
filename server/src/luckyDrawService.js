const { LUCKY_DRAW_SHEET, TIMEZONE } = require('./config');
const { getSheetRows, appendRows, deleteRows } = require('./sheets');
const { formatDateTimeNow } = require('./dateUtils');

async function ensureLuckyDrawSheet() {
  let data;
  try {
    data = await getSheetRows(LUCKY_DRAW_SHEET);
  } catch (e) {
    const { google } = require('googleapis');
    const { SPREADSHEET_ID } = require('./config');
    const { getServiceAccountAuthOptions } = require('./googleCredentials');
    const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
    const auth = new google.auth.GoogleAuth(authOpts);
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: LUCKY_DRAW_SHEET } } }]
      }
    });
    await appendRows(LUCKY_DRAW_SHEET, [[
      'TicketID', 'ClassID', 'StudentID', 'Tier', 'PrizeText', 'DrawnAt'
    ]]);
    return;
  }
  if (!data.length || String(data[0][0]) !== 'TicketID') {
    if (!data.length) {
      await appendRows(LUCKY_DRAW_SHEET, [[
        'TicketID', 'ClassID', 'StudentID', 'Tier', 'PrizeText', 'DrawnAt'
      ]]);
    }
  }
}

async function saveLuckyDrawTicket(classId, studentId, tier, prizeText) {
  await ensureLuckyDrawSheet();
  classId = String(classId);
  studentId = String(studentId);
  tier = String(tier || '').trim();
  prizeText = String(prizeText || '').trim();
  if (!classId || !studentId || !prizeText) {
    throw new Error('classId, studentId, and prize are required.');
  }
  const ticketId = 'LDT_' + classId + '_' + studentId + '_' + Date.now();
  const drawnAt = formatDateTimeNow(TIMEZONE);
  await appendRows(LUCKY_DRAW_SHEET, [[ticketId, classId, studentId, tier, prizeText, drawnAt]]);
  return { ticketId, tier, prizeText, drawnAt };
}

async function listStudentLuckyTickets(classId, studentId) {
  await ensureLuckyDrawSheet();
  classId = String(classId);
  studentId = String(studentId);
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  const tickets = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId || String(data[i][2]) !== studentId) continue;
    tickets.push({
      ticketId: String(data[i][0]),
      classId,
      studentId,
      tier: String(data[i][3] || ''),
      prizeText: String(data[i][4] || ''),
      drawnAt: String(data[i][5] || '')
    });
  }
  tickets.sort((a, b) => (a.drawnAt < b.drawnAt ? 1 : a.drawnAt > b.drawnAt ? -1 : 0));
  return tickets;
}

async function redeemLuckyTicket(ticketId) {
  await ensureLuckyDrawSheet();
  ticketId = String(ticketId);
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === ticketId) {
      await deleteRows(LUCKY_DRAW_SHEET, [i + 1]);
      return {
        message: 'Ticket removed.',
        ticketId,
        studentId: String(data[i][2]),
        remainingCount: await countStudentTickets(String(data[i][1]), String(data[i][2]))
      };
    }
  }
  throw new Error('Ticket not found.');
}

async function countStudentTickets(classId, studentId) {
  const tickets = await listStudentLuckyTickets(classId, studentId);
  return tickets.length;
}

async function getLuckyDrawCountsByClass(classId) {
  await ensureLuckyDrawSheet();
  classId = String(classId);
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  const counts = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId) continue;
    const sid = String(data[i][2]);
    counts[sid] = (counts[sid] || 0) + 1;
  }
  return counts;
}

module.exports = {
  saveLuckyDrawTicket,
  listStudentLuckyTickets,
  redeemLuckyTicket,
  getLuckyDrawCountsByClass,
  countStudentTickets
};
