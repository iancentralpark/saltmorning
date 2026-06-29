const {
  STUDENT_LIST_SHEET,
  CLASS_LIST_SHEET,
  ATTENDANCE_SHEET,
  DOLLAR_SHEETS,
  CHAMBIT_DAILY_SHEET,
  CHAMBIT_COMBO_SHEET,
  TIMEZONE
} = require('./config');
const { getSheetRows, updateRange } = require('./sheets');
const { formatSheetDate, formatDateInTz, chambitWeekMonday, chambitWeekSunday, chambitAddDays } = require('./dateUtils');
const { getHolidayName } = require('./holiday');
const { getStudentHistory } = require('./studentService');
const { getStudentHomeworkStatus, buildClassHomeworkFromCtx } = require('./homeworkService');
const { buildRequestContext } = require('./sheets');
const { signStudentToken } = require('./studentAuth');

const LOGIN_ID_COL = 4;
const LOGIN_PW_COL = 5;

async function ensureStudentLoginColumns() {
  const data = await getSheetRows(STUDENT_LIST_SHEET);
  if (!data.length) return;
  const header = data[0] || [];
  const needsId = String(header[LOGIN_ID_COL] || '').trim() !== 'LoginID';
  const needsPw = String(header[LOGIN_PW_COL] || '').trim() !== 'LoginPassword';
  if (!needsId && !needsPw) return;
  const next = header.slice();
  while (next.length <= LOGIN_PW_COL) next.push('');
  if (needsId) next[LOGIN_ID_COL] = 'LoginID';
  if (needsPw) next[LOGIN_PW_COL] = 'LoginPassword';
  await updateRange(STUDENT_LIST_SHEET, 'A1:F1', [next]);
}

async function getClassNameMap() {
  const rows = await getSheetRows(CLASS_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    if (id) map[id] = String(rows[i][1] || id);
  }
  return map;
}

async function findStudentByLogin(loginId, password) {
  await ensureStudentLoginColumns();
  loginId = String(loginId || '').trim();
  password = String(password || '').trim();
  if (!loginId || !password) {
    throw new Error('Enter login ID and password.');
  }

  const data = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    const rowLogin = String(data[i][LOGIN_ID_COL] || '').trim();
    const rowPw = String(data[i][LOGIN_PW_COL] || '').trim();
    if (rowLogin !== loginId || rowPw !== password) continue;
    if (String(data[i][3] || '').trim() !== 'Enrolled') {
      throw new Error('This account is not active.');
    }
    return {
      studentId: String(data[i][0]),
      name: String(data[i][1] || ''),
      classId: String(data[i][2] || '')
    };
  }
  throw new Error('Login ID or password is incorrect.');
}

function chambitNormalizeAllowedDays(allowedDays) {
  if (!allowedDays) return [];
  if (Array.isArray(allowedDays)) {
    return allowedDays.map(n => Number(n)).filter(n => !isNaN(n));
  }
  return String(allowedDays).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
}

async function chambitGetRequiredDatesInWeek(weekMonday, allowedDays) {
  const days = chambitNormalizeAllowedDays(allowedDays);
  const required = [];
  for (let i = 0; i < 7; i++) {
    const ds = chambitAddDays(weekMonday, i);
    const p = ds.split('-');
    const dow = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
    if (!days.includes(dow)) continue;
    const holiday = await getHolidayName(ds);
    if (holiday) continue;
    required.push(ds);
  }
  return required;
}

async function getStudentChambit(classId, studentId, dateStr) {
  studentId = String(studentId);
  classId = String(classId);
  dateStr = dateStr || formatDateInTz(new Date(), TIMEZONE);

  let allowedDays = [1, 2, 3, 4, 5];
  const classRows = await getSheetRows(CLASS_LIST_SHEET);
  for (let i = 1; i < classRows.length; i++) {
    if (String(classRows[i][0]) === classId) {
      allowedDays = chambitNormalizeAllowedDays(classRows[i][3]);
      break;
    }
  }

  const dailyRows = await getSheetRows(CHAMBIT_DAILY_SHEET);
  const comboRows = await getSheetRows(CHAMBIT_COMBO_SHEET);
  let readToday = false;
  const weekMonday = chambitWeekMonday(dateStr);
  const weekSunday = chambitWeekSunday(weekMonday);
  const readDates = {};

  for (let i = 1; i < dailyRows.length; i++) {
    if (String(dailyRows[i][1]) !== classId || String(dailyRows[i][2]) !== studentId) continue;
    const ds = formatSheetDate(dailyRows[i][0]);
    if (ds === dateStr) readToday = true;
    if (ds >= weekMonday && ds <= weekSunday) readDates[ds] = true;
  }

  let combo = 0;
  for (let i = 1; i < comboRows.length; i++) {
    if (String(comboRows[i][0]) === studentId) {
      combo = Number(comboRows[i][1]) || 0;
      break;
    }
  }

  const weekRequired = await chambitGetRequiredDatesInWeek(weekMonday, allowedDays);
  let weekRead = 0;
  weekRequired.forEach(ds => { if (readDates[ds]) weekRead++; });

  return {
    readToday,
    combo,
    weekRead,
    weekRequired: weekRequired.length
  };
}

async function getStudentDollars(studentId) {
  studentId = String(studentId);
  let balance = 0;
  const balRows = await getSheetRows(DOLLAR_SHEETS.BALANCES);
  for (let i = 1; i < balRows.length; i++) {
    if (String(balRows[i][0]) === studentId) {
      balance = Number(balRows[i][1]) || 0;
      break;
    }
  }

  const txRows = await getSheetRows(DOLLAR_SHEETS.TRANSACTIONS);
  const transactions = [];
  for (let i = txRows.length - 1; i >= 1 && transactions.length < 15; i--) {
    if (String(txRows[i][2]) !== studentId) continue;
    transactions.push({
      at: String(txRows[i][0] || ''),
      amount: Number(txRows[i][3]) || 0,
      balance: Number(txRows[i][4]) || 0,
      reason: String(txRows[i][5] || '')
    });
  }

  return { balance, transactions };
}

function filterHomeworkItemsForStudent(items, studentId) {
  studentId = String(studentId);
  return (items || []).filter(it => {
    if (it.isChambit) return false;
    const ids = it.studentIds || [];
    if (!ids.length) return true;
    return ids.map(String).includes(studentId);
  });
}

async function studentLogin(loginId, password) {
  const student = await findStudentByLogin(loginId, password);
  const classNames = await getClassNameMap();
  const token = signStudentToken(student);
  return {
    token,
    student: {
      id: student.studentId,
      name: student.name,
      classId: student.classId,
      className: classNames[student.classId] || student.classId
    }
  };
}

async function getStudentDashboard(studentId, classId) {
  studentId = String(studentId);
  classId = String(classId);
  const today = formatDateInTz(new Date(), TIMEZONE);
  const classNames = await getClassNameMap();

  const data = await getSheetRows(STUDENT_LIST_SHEET);
  let name = studentId;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentId) {
      name = String(data[i][1] || studentId);
      break;
    }
  }

  const [attendance, homeworkStatus, chambit, dollars] = await Promise.all([
    getStudentHistory(classId, studentId),
    getStudentHomeworkStatus(classId, studentId),
    getStudentChambit(classId, studentId, today),
    getStudentDollars(studentId)
  ]);

  const ctx = await buildRequestContext(classId);
  const hwPanel = await buildClassHomeworkFromCtx(ctx, today);
  const todayItems = filterHomeworkItemsForStudent(hwPanel.todayItems || [], studentId);
  const lastHw = hwPanel.lastHomework || null;
  const lastItems = lastHw && lastHw.items
    ? filterHomeworkItemsForStudent(
      lastHw.items.map(it => ({
        title: it.title,
        description: it.description,
        studentIds: it.targetStudentIds || [],
        isChambit: false
      })),
      studentId
    )
    : [];

  let todayTitle = '';
  const logRows = await ctx.sheetRows('Homework_Log');
  for (let i = 1; i < logRows.length; i++) {
    if (String(logRows[i][1]) !== classId) continue;
    const d = formatSheetDate(logRows[i][2]);
    if (d === today) {
      todayTitle = String(logRows[i][3] || '');
      break;
    }
  }

  let attend = 0; let tardy = 0; let absent = 0;
  let sum = 0; let scoreCount = 0;
  attendance.forEach(r => {
    if (r.attendance === '출석') attend++;
    else if (r.attendance === '지각') tardy++;
    else if (r.attendance === '결석') absent++;
    if (r.vocabScore != null && r.vocabScore > 0) {
      sum += r.vocabScore;
      scoreCount++;
    }
  });

  return {
    profile: {
      id: studentId,
      name,
      classId,
      className: classNames[classId] || classId
    },
    summary: {
      present: attend,
      tardy,
      absent,
      avgVocab: scoreCount ? Math.round((sum / scoreCount) * 10) / 10 : null,
      pendingHomework: (homeworkStatus.pending || []).length,
      dollars: dollars.balance,
      chambitCombo: chambit.combo
    },
    attendance,
    homework: {
      todayTitle,
      todayDate: today,
      todayItems,
      lastTitle: lastHw ? lastHw.title : '',
      lastDate: lastHw ? lastHw.assignedDate : '',
      lastItems,
      pending: homeworkStatus.pending || [],
      completed: homeworkStatus.completed || []
    },
    chambit,
    dollars
  };
}

module.exports = {
  ensureStudentLoginColumns,
  studentLogin,
  getStudentDashboard
};
