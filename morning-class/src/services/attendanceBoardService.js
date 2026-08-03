const { getClassRoster } = require('./teacherPortalService');
const { listClassDollarBalances } = require('./dollarService');
const { listBuddyMonitorForClass } = require('./englishBuddyService');
const { getClassVocabOverview } = require('./vocabService');

/**
 * Per-student extras for Attendance board.
 * Buddy / Vocab Booster monitors are for homeroom teachers only.
 */
async function getAttendanceBoardExtras(classId, opts) {
  classId = String(classId || '');
  const includeMonitors = !!(opts && opts.includeMonitors);
  const roster = await getClassRoster(classId);
  const dollars = await listClassDollarBalances(classId, roster).catch(() =>
    roster.map((s) => ({ studentId: s.studentId, name: s.name, balance: 0 }))
  );

  const byId = {};
  roster.forEach((s) => {
    byId[s.studentId] = {
      studentId: s.studentId,
      name: s.name,
      dollars: 0,
      buddy: null,
      vocab: null
    };
  });
  dollars.forEach((d) => {
    if (byId[d.studentId]) byId[d.studentId].dollars = Number(d.balance) || 0;
  });

  if (includeMonitors) {
    try {
      const buddy = await listBuddyMonitorForClass(classId);
      (buddy.students || []).forEach((b) => {
        if (!byId[b.studentId]) return;
        byId[b.studentId].buddy = {
          used: b.used,
          remaining: b.remaining,
          limit: b.limit,
          locked: !!b.locked,
          strikes: b.strikes || 0
        };
      });
    } catch (e) { /* ignore */ }

    try {
      const vocab = await getClassVocabOverview(classId);
      (vocab.students || []).forEach((v) => {
        if (!byId[v.studentId]) return;
        byId[v.studentId].vocab = {
          placementDone: !!v.placementDone,
          gradeLevel: v.placementDone ? v.gradeLevel : null,
          tier: v.placementDone ? (v.tier || null) : null,
          questDone: !!v.questDone,
          streak: v.streak || 0,
          lastActive: v.lastActive || ''
        };
      });
    } catch (e) { /* ignore */ }
  }

  return {
    includeMonitors,
    students: Object.values(byId)
  };
}

module.exports = { getAttendanceBoardExtras };
