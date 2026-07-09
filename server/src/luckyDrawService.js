const { LUCKY_DRAW_SHEET, TIMEZONE, STUDENT_LIST_SHEET, LUCKY_DRAW_PURCHASE_COST } = require('./config');
const { getSheetRows, appendRows, deleteRows, updateRange, invalidateSheetRowsCache } = require('./sheets');
const { formatDateTimeNow } = require('./dateUtils');
const { getStudentDollarBalance, applyDollarAdjustment } = require('./dollarService');
const { invalidateWorkCache } = require('./sessionService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

function afterLuckyDrawWrite(classId) {
  if (classId) invalidateWorkCache(classId);
  invalidateSheetRowsCache(LUCKY_DRAW_SHEET);
}

function groupLuckyTickets(tickets) {
  const map = new Map();
  const order = [];
  for (const t of tickets) {
    const key = String(t.tier || '').trim() + '\0' + String(t.prizeText || '').trim();
    if (!map.has(key)) {
      map.set(key, {
        tier: t.tier,
        prizeText: t.prizeText,
        count: 0,
        ticketIds: [],
        drawnAt: t.drawnAt || ''
      });
      order.push(key);
    }
    const g = map.get(key);
    g.count += 1;
    g.ticketIds.push(t.ticketId);
    if ((t.drawnAt || '') > (g.drawnAt || '')) g.drawnAt = t.drawnAt;
  }
  return order.map((k) => map.get(k));
}

async function ensureLuckyDrawSheet() {
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) return;
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

async function purchaseLuckyDrawTicket(classId, studentId, tier, prizeText, cost) {
  cost = Number(cost);
  if (!Number.isFinite(cost) || cost <= 0) {
    cost = LUCKY_DRAW_PURCHASE_COST;
  }
  classId = String(classId);
  studentId = String(studentId);
  await assertStudentInClass_(classId, studentId);
  const balance = await getStudentDollarBalance(studentId);
  if (balance < cost) {
    const err = new Error('Not enough dollars. Lucky Draw costs $' + cost + ' (balance: $' + balance + ').');
    err.code = 'INSUFFICIENT_DOLLARS';
    err.balance = balance;
    err.cost = cost;
    throw err;
  }
  const { newBalance } = await applyDollarAdjustment(
    classId,
    studentId,
    -cost,
    'Lucky Draw purchase ($' + cost + ')'
  );
  const ticket = await saveLuckyDrawTicket(classId, studentId, tier, prizeText);
  afterLuckyDrawWrite(classId);
  return {
    ticket,
    cost,
    previousBalance: balance,
    newBalance
  };
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
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error: readErr } = await db.from('lucky_draw_tickets')
      .select('class_id, student_id')
      .eq('ticket_id', ticketId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!data) throw new Error('Ticket not found.');
    const classId = String(data.class_id);
    const studentId = String(data.student_id);
    const { error } = await db.from('lucky_draw_tickets').delete().eq('ticket_id', ticketId);
    if (error) throw new Error(error.message);
    afterLuckyDrawWrite(classId);
    return {
      message: 'Ticket removed.',
      ticketId,
      studentId,
      remainingCount: await countStudentTickets(classId, studentId)
    };
  }
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === ticketId) {
      const classId = String(data[i][1]);
      const studentId = String(data[i][2]);
      await deleteRows(LUCKY_DRAW_SHEET, [i + 1]);
      afterLuckyDrawWrite(classId);
      return {
        message: 'Ticket removed.',
        ticketId,
        studentId,
        remainingCount: await countStudentTickets(classId, studentId)
      };
    }
  }
  throw new Error('Ticket not found.');
}

async function countStudentTickets(classId, studentId) {
  const tickets = await listStudentLuckyTickets(classId, studentId);
  return tickets.length;
}

async function findTicketRow_(ticketId) {
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === ticketId) {
      return {
        row: i + 1,
        ticketId: String(data[i][0]),
        classId: String(data[i][1]),
        studentId: String(data[i][2]),
        tier: String(data[i][3] || ''),
        prizeText: String(data[i][4] || ''),
        drawnAt: String(data[i][5] || '')
      };
    }
  }
  return null;
}

async function assertStudentInClass_(classId, studentId) {
  classId = String(classId);
  studentId = String(studentId);
  const data = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== studentId) continue;
    if (String(data[i][2]) !== classId) {
      throw new Error('Student is not in this class.');
    }
    if (String(data[i][3] || '').trim() !== 'Enrolled') {
      throw new Error('Student is not enrolled.');
    }
    return String(data[i][1] || studentId);
  }
  throw new Error('Student not found.');
}

async function transferLuckyTicket(ticketId, toStudentId) {
  await ensureLuckyDrawSheet();
  ticketId = String(ticketId);
  toStudentId = String(toStudentId);
  const row = await findTicketRow_(ticketId);
  if (!row) throw new Error('Ticket not found.');
  if (row.studentId === toStudentId) {
    throw new Error('This student already owns the ticket.');
  }
  await assertStudentInClass_(row.classId, toStudentId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('lucky_draw_tickets').update({ student_id: toStudentId }).eq('ticket_id', ticketId);
    if (error) throw new Error(error.message);
  } else {
    await updateRange(LUCKY_DRAW_SHEET, 'C' + row.row, [[toStudentId]]);
  }
  afterLuckyDrawWrite(row.classId);
  return {
    message: 'Ticket transferred.',
    ticketId,
    classId: row.classId,
    fromStudentId: row.studentId,
    toStudentId,
    tier: row.tier,
    prizeText: row.prizeText,
    fromRemainingCount: await countStudentTickets(row.classId, row.studentId),
    toRemainingCount: await countStudentTickets(row.classId, toStudentId)
  };
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
  groupLuckyTickets,
  saveLuckyDrawTicket,
  purchaseLuckyDrawTicket,
  listStudentLuckyTickets,
  redeemLuckyTicket,
  transferLuckyTicket,
  getLuckyDrawCountsByClass,
  countStudentTickets
};
