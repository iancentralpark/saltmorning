const { getClassLabel } = require('./messageService');
const { getBuddyStatus } = require('./englishBuddyService');
const { getUnreadCount } = require('./messageService');
const { getStudentDollars } = require('./dollarService');
const { getStudentHomeworkStatus } = require('./homeworkService');
const { getStudentVocabSummary } = require('./vocabShared');

/**
 * Student home dashboard.
 */
async function getStudentDashboard(session) {
  const studentId = String(session.studentId || '');
  const classId = String(session.classId || '');
  const name = String(session.name || '');

  let className = '';
  let unreadMessages = 0;
  let buddy = null;
  let dollars = { available: false, balance: 0, transactions: [] };
  let homework = { available: false, today: [], pending: [], completed: [] };
  let vocab = {
    available: false,
    status: 'coming_soon',
    message: 'Vocab Booster is coming next.'
  };

  try {
    className = classId ? await getClassLabel(classId) : '';
  } catch (e) { /* ignore */ }

  try {
    unreadMessages = await getUnreadCount({
      role: 'student',
      studentId,
      classId,
      name
    });
  } catch (e) { /* ignore */ }

  try {
    buddy = getBuddyStatus(studentId);
  } catch (e) {
    buddy = { configured: false, dailyLimit: 0, usedToday: 0, remaining: 0 };
  }

  try {
    dollars = await getStudentDollars(studentId);
  } catch (e) {
    dollars = { available: false, balance: 0, transactions: [] };
  }

  try {
    homework = await getStudentHomeworkStatus(studentId, classId);
  } catch (e) {
    homework = { available: false, today: [], pending: [], completed: [] };
  }

  try {
    vocab = await getStudentVocabSummary(studentId, classId);
  } catch (e) {
    vocab = { available: false, message: 'Vocab Booster unavailable.' };
  }

  return {
    profile: {
      studentId,
      name,
      classId,
      className: className || classId || '—'
    },
    summary: {
      unreadMessages: Number(unreadMessages) || 0,
      pendingHomework: (homework.pending || []).length,
      dollars: dollars.available ? dollars.balance : null,
      vocabReady: !!(vocab && vocab.available)
    },
    homework,
    dollars,
    vocab,
    buddy: {
      name: 'English Buddy',
      ...buddy
    }
  };
}

module.exports = { getStudentDashboard };
