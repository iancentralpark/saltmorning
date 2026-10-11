# Salt Morning Class — Timetable Source Bundle

For discussion with Gemini. Generated 2026-08-04T14:48Z.

## Architecture overview

```
Admin UI (timetable-setup.js + timetable.js)
  ↓ API /api/admin/timetable/*
Node services:
  bellScheduleService.js
  timetableRequirementsService.js
  timetableGenerateService.js  → HTTP POST solver /solve
  timetableService.js (Sheets CRUD)
  ↓
Python OR-Tools CP-SAT (solver/main.py :8791)
```

## File list

1. `morning-class/solver/main.py`
2. `morning-class/solver/requirements.txt`
3. `morning-class/src/services/timetableGenerateService.js`
4. `morning-class/src/services/timetableRequirementsService.js`
5. `morning-class/src/services/bellScheduleService.js`
6. `morning-class/src/services/timetableService.js`
7. `morning-class/public/js/timetable-setup.js`
8. `morning-class/public/js/timetable.js`
9. `morning-class/src/routes.js` (timetable routes excerpt)


---

## FILE: `morning-class/solver/main.py`

```python
"""
OR-Tools CP-SAT school timetable solver for Salt Morning Class.
Run: python main.py  (port 8791)
"""
from __future__ import annotations

import os
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

app = FastAPI(title="Salt Timetable Solver", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Period(BaseModel):
    periodId: str
    label: str = ""
    periodType: str = "lesson"
    startTime: str
    endTime: str
    sortOrder: int = 0


class Activity(BaseModel):
    id: str
    classId: str
    subject: str
    teacherId: str
    periodsPerWeek: int = Field(ge=1, le=40)
    room: str = ""


class ForbiddenSlot(BaseModel):
    teacherId: str
    day: int
    lessonSlotIndex: int


class SolveRequest(BaseModel):
    days: List[int] = [1, 2, 3, 4, 5]
    periods: List[Period]
    activities: List[Activity]
    forbidden: List[ForbiddenSlot] = []
    timeLimitSeconds: int = 30


class Assignment(BaseModel):
    activityId: str
    classId: str
    subject: str
    teacherId: str
    room: str
    day: int
    periodId: str
    lessonSlotIndex: int
    startTime: str
    endTime: str


class SolveResponse(BaseModel):
    status: str
    assignments: List[Assignment] = []
    message: str = ""


@app.get("/health")
def health():
    return {"ok": True, "service": "salt-timetable-solver"}


@app.post("/solve", response_model=SolveResponse)
def solve(req: SolveRequest):
    if not req.activities:
        raise HTTPException(status_code=400, detail="No activities to schedule.")

    sorted_periods = sorted(req.periods, key=lambda p: (p.sortOrder, p.startTime))
    lesson_slots: List[tuple[int, Period]] = [
        (i, p) for i, p in enumerate(sorted_periods) if p.periodType == "lesson"
    ]
    if not lesson_slots:
        raise HTTPException(status_code=400, detail="No lesson periods in bell schedule.")

    days = sorted(set(req.days))
    if not days:
        raise HTTPException(status_code=400, detail="No school days configured.")

    total_needed = sum(a.periodsPerWeek for a in req.activities)
    total_capacity = len(days) * len(lesson_slots)
    if total_needed > total_capacity:
        return SolveResponse(
            status="INFEASIBLE",
            message=(
                f"Need {total_needed} lesson slots but only {total_capacity} available "
                f"({len(days)} days × {len(lesson_slots)} periods)."
            ),
        )

    model = cp_model.CpModel()
    acts = req.activities
    n_act = len(acts)
    n_day = len(days)
    n_slot = len(lesson_slots)

    # assign[a][d][s] = activity a on day days[d] at lesson slot s
    assign = {}
    for a in range(n_act):
        for d in range(n_day):
            for s in range(n_slot):
                assign[(a, d, s)] = model.NewBoolVar(f"a{a}_d{d}_s{s}")

    # Each activity exact periods per week
    for a, act in enumerate(acts):
        model.Add(
            sum(assign[(a, d, s)] for d in range(n_day) for s in range(n_slot))
            == act.periodsPerWeek
        )

    # One subject per class slot
    for d in range(n_day):
        for s in range(n_slot):
            model.Add(sum(assign[(a, d, s)] for a in range(n_act)) <= 1)

    # Teacher no clash
    teachers = sorted(set(act.teacherId for act in acts))
    teacher_indices: dict[str, list[int]] = {t: [] for t in teachers}
    for a, act in enumerate(acts):
        teacher_indices[act.teacherId].append(a)

    for t in teachers:
        for d in range(n_day):
            for s in range(n_slot):
                idxs = teacher_indices[t]
                if len(idxs) > 1:
                    model.Add(sum(assign[(a, d, s)] for a in idxs) <= 1)

    # Forbidden slots (other classes already using teacher)
    day_to_idx = {day: i for i, day in enumerate(days)}
    for f in req.forbidden:
        d_idx = day_to_idx.get(f.day)
        if d_idx is None:
            continue
        if f.lessonSlotIndex < 0 or f.lessonSlotIndex >= n_slot:
            continue
        for a, act in enumerate(acts):
            if act.teacherId == f.teacherId:
                model.Add(assign[(a, d_idx, f.lessonSlotIndex)] == 0)

    # Spread subjects: minimize same activity on consecutive slots same day
    penalties = []
    for a in range(n_act):
        for d in range(n_day):
            for s in range(n_slot - 1):
                both = model.NewBoolVar(f"consec_a{a}_d{d}_s{s}")
                model.Add(assign[(a, d, s)] + assign[(a, d, s + 1)] <= 1 + both)
                model.AddBoolOr([assign[(a, d, s)].Not(), both])
                model.AddBoolOr([assign[(a, d, s + 1)].Not(), both])
                penalties.append(both)

    if penalties:
        model.Minimize(sum(penalties))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(req.timeLimitSeconds)
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveResponse(
            status="INFEASIBLE",
            message=(
                "Could not find a valid timetable. Check periods/week, teacher clashes, "
                "or bell schedule capacity."
            ),
        )

    assignments: List[Assignment] = []
    for a, act in enumerate(acts):
        for d in range(n_day):
            for s in range(n_slot):
                if solver.Value(assign[(a, d, s)]):
                    slot_idx, period = lesson_slots[s]
                    assignments.append(
                        Assignment(
                            activityId=act.id,
                            classId=act.classId,
                            subject=act.subject,
                            teacherId=act.teacherId,
                            room=act.room,
                            day=days[d],
                            periodId=period.periodId,
                            lessonSlotIndex=s,
                            startTime=period.startTime,
                            endTime=period.endTime,
                        )
                    )

    assignments.sort(key=lambda x: (x.day, x.startTime, x.subject))
    return SolveResponse(status="OK", assignments=assignments, message="Timetable generated.")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("TIMETABLE_SOLVER_PORT", "8791"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")

```


---

## FILE: `morning-class/solver/requirements.txt`

```text
fastapi>=0.115.0
uvicorn>=0.32.0
ortools>=9.10.4067
pydantic>=2.0.0

```


---

## FILE: `morning-class/src/services/timetableGenerateService.js`

```javascript
const { TIMETABLE_SOLVER_URL } = require('../config');
const { getBellSchedule } = require('./bellScheduleService');
const { listRequirements } = require('./timetableRequirementsService');
const { getClassRoster } = require('./teacherPortalService');
const {
  loadAllEntries,
  saveTimetable,
  newId: newEntryId,
  isoNow,
  sortEntries
} = require('./timetableService');

async function callSolver(payload) {
  const url = (TIMETABLE_SOLVER_URL || 'http://127.0.0.1:8791').replace(/\/$/, '') + '/solve';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    throw new Error(
      'Timetable solver is not running. Start it with: cd morning-class/solver && pip install -r requirements.txt && python main.py'
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || data.message || 'Solver request failed.');
  return data;
}

async function collectForbiddenSlots(excludeClassId) {
  const all = await loadAllEntries();
  const forbidden = [];
  const seen = new Set();

  all.forEach((e) => {
    if (e.ownerType !== 'class') return;
    if (excludeClassId && e.classId === excludeClassId) return;
    if (!e.teacherId) return;

    const lessonIdx = Number(e.sortOrder);
    if (!Number.isInteger(lessonIdx)) return;
    const key = e.teacherId + ':' + e.dayOfWeek + ':' + lessonIdx;
    if (seen.has(key)) return;
    seen.add(key);
    forbidden.push({
      teacherId: e.teacherId,
      day: e.dayOfWeek,
      lessonSlotIndex: lessonIdx
    });
  });
  return forbidden;
}

async function generateClassTimetable(classId) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const [{ periods, lessonPeriods }, requirements, forbidden, roster] = await Promise.all([
    getBellSchedule(),
    listRequirements(classId),
    collectForbiddenSlots(classId),
    getClassRoster(classId)
  ]);

  if (!requirements.length) {
    throw new Error('No subject requirements for this class. Import from assignments or add manually.');
  }

  const activities = requirements.map((r) => ({
    id: r.reqId || ('act_' + r.subject),
    classId,
    subject: r.subject,
    teacherId: r.teacherId,
    periodsPerWeek: r.periodsPerWeek,
    room: r.room || ''
  }));

  const result = await callSolver({
    days: [1, 2, 3, 4, 5],
    periods,
    activities,
    forbidden,
    timeLimitSeconds: 45
  });

  if (result.status !== 'OK' || !result.assignments || !result.assignments.length) {
    throw new Error(result.message || 'Solver could not generate a timetable.');
  }

  const now = isoNow();
  const classEntries = result.assignments.map((a, idx) => ({
    entryId: newEntryId('tte'),
    ownerType: 'class',
    ownerId: classId,
    classId,
    dayOfWeek: a.day,
    startTime: a.startTime,
    endTime: a.endTime,
    subject: a.subject,
    teacherId: a.teacherId,
    room: a.room || '',
    notes: 'auto-generated',
    sortOrder: a.lessonSlotIndex,
    updatedAt: now
  }));

  await saveTimetable('class', classId, classEntries);

  const teacherIds = [...new Set(result.assignments.map((a) => a.teacherId))];
  for (const teacherId of teacherIds) {
    await rebuildTeacherTimetable(teacherId);
  }

  for (const student of roster) {
    await saveTimetable('student', student.studentId, classEntries.map((e) => ({
      ...e,
      entryId: newEntryId('tte'),
      ownerType: 'student',
      ownerId: student.studentId,
      updatedAt: now
    })));
  }

  return {
    classId,
    assignmentCount: result.assignments.length,
    studentsUpdated: roster.length,
    teachersUpdated: teacherIds.length,
    message: result.message
  };
}

async function rebuildTeacherTimetable(teacherId) {
  const all = await loadAllEntries();
  const classEntries = all.filter((e) => e.ownerType === 'class' && e.teacherId === teacherId);
  const entries = sortEntries(classEntries.map((e) => ({
    entryId: newEntryId('tte'),
    ownerType: 'teacher',
    ownerId: teacherId,
    classId: e.classId,
    dayOfWeek: e.dayOfWeek,
    startTime: e.startTime,
    endTime: e.endTime,
    subject: e.subject,
    teacherId,
    room: e.room,
    notes: e.notes,
    sortOrder: e.sortOrder,
    updatedAt: isoNow()
  })));
  await saveTimetable('teacher', teacherId, entries);
}

module.exports = { generateClassTimetable, callSolver, collectForbiddenSlots, rebuildTeacherTimetable };

```


---

## FILE: `morning-class/src/services/timetableRequirementsService.js`

```javascript
const crypto = require('crypto');
const {
  TIMETABLE_REQUIREMENTS_SHEET,
  CLASS_TEACHERS_SHEET,
  TEACHER_CLASS_SUBJECTS_SHEET,
  TEACHER_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getClassNameMap } = require('./teacherPortalService');

const HEADERS = ['ReqID', 'ClassID', 'Subject', 'TeacherID', 'TeacherName', 'PeriodsPerWeek', 'Room', 'Notes'];
const COL = {
  reqId: 0, classId: 1, subject: 2, teacherId: 3, teacherName: 4,
  periodsPerWeek: 5, room: 6, notes: 7
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

async function ensureRequirementsSheet() {
  await ensureSheet(TIMETABLE_REQUIREMENTS_SHEET, HEADERS);
}

function rowToReq(row) {
  if (!row || !row[COL.classId]) return null;
  return {
    reqId: String(row[COL.reqId] || ''),
    classId: String(row[COL.classId]),
    subject: String(row[COL.subject] || ''),
    teacherId: String(row[COL.teacherId] || ''),
    teacherName: String(row[COL.teacherName] || ''),
    periodsPerWeek: Number(row[COL.periodsPerWeek]) || 0,
    room: String(row[COL.room] || ''),
    notes: String(row[COL.notes] || '')
  };
}

async function teacherNameMap() {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    map[String(rows[i][0])] = String(rows[i][1] || '');
  }
  return map;
}

async function listRequirements(classId) {
  await ensureRequirementsSheet();
  const rows = await getSheetRows(TIMETABLE_REQUIREMENTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rowToReq(rows[i]);
    if (!r) continue;
    if (classId && r.classId !== String(classId)) continue;
    out.push(r);
  }
  out.sort((a, b) => a.classId.localeCompare(b.classId) || a.subject.localeCompare(b.subject));
  return out;
}

async function saveRequirements(classId, requirements) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');
  if (!Array.isArray(requirements)) throw new Error('Requirements array is required.');

  const names = await teacherNameMap();
  const normalized = requirements.map((r) => {
    const subject = String(r.subject || '').trim();
    const teacherId = String(r.teacherId || '').trim();
    const ppw = Number(r.periodsPerWeek);
    if (!subject) throw new Error('Subject is required.');
    if (!teacherId) throw new Error('Teacher is required for ' + subject + '.');
    if (!ppw || ppw < 1) throw new Error('Periods per week must be at least 1 for ' + subject + '.');
    return [
      String(r.reqId || '').trim() || newId('req'),
      classId,
      subject,
      teacherId,
      names[teacherId] || String(r.teacherName || ''),
      String(ppw),
      String(r.room || '').trim(),
      String(r.notes || '').trim()
    ];
  });

  const allRows = await getSheetRows(TIMETABLE_REQUIREMENTS_SHEET, { skipCache: true });
  const kept = [];
  for (let i = 1; i < allRows.length; i++) {
    if (String(allRows[i][COL.classId]) !== classId) kept.push(allRows[i]);
  }
  const combined = kept.concat(normalized);
  const oldCount = Math.max(0, allRows.length - 1);
  const width = HEADERS.length;

  if (!combined.length && !oldCount) return listRequirements(classId);
  if (!oldCount && combined.length) {
    await appendRows(TIMETABLE_REQUIREMENTS_SHEET, combined);
  } else {
    const maxRows = Math.max(oldCount, combined.length);
    const toWrite = [];
    for (let i = 0; i < maxRows; i++) {
      toWrite.push(i < combined.length ? combined[i] : new Array(width).fill(''));
    }
    await updateRange(TIMETABLE_REQUIREMENTS_SHEET, `A2:H${maxRows + 1}`, toWrite);
  }
  invalidateSheetRowsCache(TIMETABLE_REQUIREMENTS_SHEET);
  return listRequirements(classId);
}

async function importRequirementsFromAssignments(classId) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const names = await teacherNameMap();
  const seen = new Set();
  const requirements = [];

  const assignRows = await getSheetRows(CLASS_TEACHERS_SHEET);
  for (let i = 1; i < assignRows.length; i++) {
    if (String(assignRows[i][0]) !== classId) continue;
    const teacherId = String(assignRows[i][1] || '');
    const subject = String(assignRows[i][3] || '').trim() || 'Homeroom';
    const key = teacherId + ':' + subject;
    if (!teacherId || seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      subject,
      teacherId,
      teacherName: names[teacherId] || '',
      periodsPerWeek: 5,
      room: '',
      notes: 'Imported from class assignment'
    });
  }

  const customRows = await getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET);
  for (let i = 1; i < customRows.length; i++) {
    if (String(customRows[i][1]) !== classId) continue;
    const teacherId = String(customRows[i][0] || '');
    const subject = String(customRows[i][2] || '').trim();
    const key = teacherId + ':' + subject;
    if (!teacherId || !subject || seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      subject,
      teacherId,
      teacherName: names[teacherId] || '',
      periodsPerWeek: 5,
      room: '',
      notes: 'Imported from teacher subject'
    });
  }

  if (!requirements.length) {
    throw new Error('No teacher assignments found for this class. Add assignments first.');
  }

  return saveRequirements(classId, requirements);
}

async function listRequirementsWithClassNames(classId) {
  const classNames = await getClassNameMap();
  const reqs = await listRequirements(classId);
  return reqs.map((r) => ({
    ...r,
    className: classNames[r.classId] || r.classId
  }));
}

module.exports = {
  ensureRequirementsSheet,
  listRequirements,
  listRequirementsWithClassNames,
  saveRequirements,
  importRequirementsFromAssignments
};

```


---

## FILE: `morning-class/src/services/bellScheduleService.js`

```javascript
const crypto = require('crypto');
const { BELL_SCHEDULE_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');

const HEADERS = ['PeriodID', 'Label', 'PeriodType', 'StartTime', 'EndTime', 'SortOrder'];
const COL = { periodId: 0, label: 1, periodType: 2, startTime: 3, endTime: 4, sortOrder: 5 };

const DEFAULT_PERIODS = [
  ['P01', '1st period', 'lesson', '09:00', '09:50', '0'],
  ['P02', '2nd period', 'lesson', '10:00', '10:50', '1'],
  ['R01', 'Recess', 'recess', '10:50', '11:10', '2'],
  ['P03', '3rd period', 'lesson', '11:10', '12:00', '3'],
  ['L01', 'Lunch', 'lunch', '12:00', '13:00', '4'],
  ['P04', '4th period', 'lesson', '13:00', '13:50', '5'],
  ['P05', '5th period', 'lesson', '14:00', '14:50', '6']
];

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(4).toString('hex');
}

function normalizeTime(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('Time must be HH:MM.');
  return String(Number(m[1])).padStart(2, '0') + ':' + m[2];
}

function rowToPeriod(row) {
  if (!row || !row[COL.periodId]) return null;
  return {
    periodId: String(row[COL.periodId]),
    label: String(row[COL.label] || ''),
    periodType: String(row[COL.periodType] || 'lesson').trim() || 'lesson',
    startTime: String(row[COL.startTime] || ''),
    endTime: String(row[COL.endTime] || ''),
    sortOrder: Number(row[COL.sortOrder]) || 0
  };
}

async function ensureBellScheduleSheet() {
  await ensureSheet(BELL_SCHEDULE_SHEET, HEADERS);
  const rows = await getSheetRows(BELL_SCHEDULE_SHEET, { skipCache: true });
  if (rows.length <= 1) {
    await appendRows(BELL_SCHEDULE_SHEET, DEFAULT_PERIODS);
    invalidateSheetRowsCache(BELL_SCHEDULE_SHEET);
  }
}

async function getBellSchedule() {
  await ensureBellScheduleSheet();
  const rows = await getSheetRows(BELL_SCHEDULE_SHEET);
  const periods = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rowToPeriod(rows[i]);
    if (p) periods.push(p);
  }
  periods.sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime));
  const lessonPeriods = periods.filter((p) => p.periodType === 'lesson');
  return { periods, lessonPeriods };
}

async function saveBellSchedule(periods) {
  if (!Array.isArray(periods) || !periods.length) {
    throw new Error('At least one period is required.');
  }

  await ensureBellScheduleSheet();
  const rows = periods.map((p, idx) => {
    const startTime = normalizeTime(p.startTime);
    const endTime = normalizeTime(p.endTime);
    if (endTime <= startTime) throw new Error('End time must be after start for ' + (p.label || 'period'));
    const periodType = String(p.periodType || 'lesson').trim();
    if (!['lesson', 'recess', 'lunch', 'break'].includes(periodType)) {
      throw new Error('Invalid period type: ' + periodType);
    }
    return [
      String(p.periodId || '').trim() || newId('per'),
      String(p.label || '').trim() || ('Period ' + (idx + 1)),
      periodType,
      startTime,
      endTime,
      String(Number(p.sortOrder) || idx)
    ];
  });

  const existing = await getSheetRows(BELL_SCHEDULE_SHEET, { skipCache: true });
  const oldCount = Math.max(0, existing.length - 1);
  const width = HEADERS.length;

  if (!oldCount) {
    await appendRows(BELL_SCHEDULE_SHEET, rows);
  } else {
    const maxRows = Math.max(oldCount, rows.length);
    const toWrite = [];
    for (let i = 0; i < maxRows; i++) {
      toWrite.push(i < rows.length ? rows[i] : new Array(width).fill(''));
    }
    await updateRange(BELL_SCHEDULE_SHEET, `A2:F${maxRows + 1}`, toWrite);
  }
  invalidateSheetRowsCache(BELL_SCHEDULE_SHEET);
  return getBellSchedule();
}

module.exports = { ensureBellScheduleSheet, getBellSchedule, saveBellSchedule, DEFAULT_PERIODS };

```


---

## FILE: `morning-class/src/services/timetableService.js`

```javascript
const crypto = require('crypto');
const {
  TIMETABLE_ENTRIES_SHEET,
  SUBJECTS_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getTeacherStudentIds } = require('./studentRegistryService');
const { getBellSchedule } = require('./bellScheduleService');

const HEADERS = [
  'EntryID', 'OwnerType', 'OwnerID', 'ClassID', 'DayOfWeek',
  'StartTime', 'EndTime', 'Subject', 'TeacherID', 'Room', 'Notes', 'SortOrder', 'UpdatedAt'
];

const COL = {
  entryId: 0, ownerType: 1, ownerId: 2, classId: 3, dayOfWeek: 4,
  startTime: 5, endTime: 6, subject: 7, teacherId: 8, room: 9, notes: 10,
  sortOrder: 11, updatedAt: 12
};

const DAY_LABELS = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday',
  6: 'Saturday', 0: 'Sunday'
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function isoNow() {
  return new Date().toISOString();
}

function normalizeTime(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('Time must be HH:MM (e.g. 09:00).');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error('Invalid time.');
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function normalizeDay(value) {
  const d = Number(value);
  if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error('Day of week must be 0–6 (Mon=1).');
  return d;
}

function rowToEntry(row) {
  if (!row || !row[COL.entryId]) return null;
  let teacherId = '';
  let room = '';
  let notes = '';
  let sortOrder = 0;
  let updatedAt = '';
  if (row.length >= 13) {
    teacherId = String(row[COL.teacherId] || '');
    room = String(row[COL.room] || '');
    notes = String(row[COL.notes] || '');
    sortOrder = Number(row[COL.sortOrder]) || 0;
    updatedAt = String(row[COL.updatedAt] || '');
  } else {
    room = String(row[8] || '');
    notes = String(row[9] || '');
    sortOrder = Number(row[10]) || 0;
    updatedAt = String(row[11] || '');
  }
  return {
    entryId: String(row[COL.entryId]),
    ownerType: String(row[COL.ownerType] || ''),
    ownerId: String(row[COL.ownerId] || ''),
    classId: String(row[COL.classId] || ''),
    dayOfWeek: Number(row[COL.dayOfWeek]),
    dayLabel: DAY_LABELS[Number(row[COL.dayOfWeek])] || '',
    startTime: String(row[COL.startTime] || ''),
    endTime: String(row[COL.endTime] || ''),
    subject: String(row[COL.subject] || ''),
    teacherId,
    room,
    notes,
    sortOrder,
    updatedAt
  };
}

function sortEntries(entries) {
  return entries.slice().sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.sortOrder - b.sortOrder;
  });
}

function groupByDay(entries) {
  const grouped = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  sortEntries(entries).forEach((e) => {
    if (grouped[e.dayOfWeek]) grouped[e.dayOfWeek].push(e);
  });
  return grouped;
}

function enrichWithBellBreaks(entries, bell) {
  const breaks = (bell && bell.periods) ? bell.periods.filter((p) => p.periodType !== 'lesson') : [];
  if (!breaks.length) return { entries, byDay: groupByDay(entries), breaks: [] };

  const byDay = groupByDay(entries);
  breaks.forEach((br) => {
    [1, 2, 3, 4, 5].forEach((day) => {
      if (!byDay[day]) return;
      byDay[day].push({
        entryId: 'bell_' + br.periodId,
        ownerType: 'bell',
        ownerId: '',
        classId: '',
        dayOfWeek: day,
        dayLabel: DAY_LABELS[day],
        startTime: br.startTime,
        endTime: br.endTime,
        subject: br.label,
        teacherId: '',
        room: '',
        notes: br.periodType,
        sortOrder: br.sortOrder - 0.5,
        isBreak: true,
        periodType: br.periodType
      });
    });
    Object.keys(byDay).forEach((day) => {
      byDay[day].sort((a, b) => {
        const ta = a.startTime || '';
        const tb = b.startTime || '';
        return ta.localeCompare(tb) || (a.sortOrder - b.sortOrder);
      });
    });
  });

  const merged = [];
  Object.keys(byDay).forEach((day) => { merged.push(...byDay[day]); });
  return { entries: sortEntries(merged), byDay, breaks };
}

async function ensureTimetableSheet() {
  await ensureSheet(TIMETABLE_ENTRIES_SHEET, HEADERS);
}

async function getStudentClassId(studentId) {
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(studentId)) {
      return String(rows[i][2] || '').trim();
    }
  }
  return '';
}

async function listSubjects() {
  const rows = await getSheetRows(SUBJECTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1] || '').trim();
    if (name) out.push(name);
  }
  if (!out.length) return ['English', 'Math', 'Science', 'Reading', 'Writing', 'Grammar'];
  return out;
}

async function loadAllEntries() {
  await ensureTimetableSheet();
  const rows = await getSheetRows(TIMETABLE_ENTRIES_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const e = rowToEntry(rows[i]);
    if (e) out.push(e);
  }
  return out;
}

async function resolveTimetableEntries(ownerType, ownerId) {
  ownerType = String(ownerType || '').trim();
  ownerId = String(ownerId || '').trim();
  const all = await loadAllEntries();
  let entries = all.filter((e) => e.ownerType === ownerType && e.ownerId === ownerId);

  if (!entries.length && ownerType === 'student') {
    const classId = await getStudentClassId(ownerId);
    if (classId) {
      entries = all.filter((e) => e.ownerType === 'class' && e.ownerId === classId);
    }
  }

  if (!entries.length && ownerType === 'teacher') {
    entries = all.filter((e) => e.ownerType === 'class' && e.teacherId === ownerId);
  }

  return sortEntries(entries);
}

async function getTimetable(ownerType, ownerId) {
  if (!ownerType || !ownerId) throw new Error('Owner is required.');

  const entries = await resolveTimetableEntries(ownerType, ownerId);
  const bell = await getBellSchedule().catch(() => ({ periods: [] }));
  const enriched = enrichWithBellBreaks(entries, bell);

  return {
    ownerType,
    ownerId,
    entries: enriched.entries,
    byDay: enriched.byDay,
    breaks: enriched.breaks,
    bellSchedule: bell.periods || []
  };
}

function validateEntryPayload(entry, ownerType, ownerId) {
  const startTime = normalizeTime(entry.startTime);
  const endTime = normalizeTime(entry.endTime);
  if (endTime <= startTime) throw new Error('End time must be after start time.');
  return {
    entryId: String(entry.entryId || '').trim() || newId('tte'),
    ownerType,
    ownerId,
    classId: String(entry.classId || '').trim(),
    dayOfWeek: normalizeDay(entry.dayOfWeek),
    startTime,
    endTime,
    subject: String(entry.subject || '').trim(),
    teacherId: String(entry.teacherId || '').trim(),
    room: String(entry.room || '').trim(),
    notes: String(entry.notes || '').trim(),
    sortOrder: Number(entry.sortOrder) || 0,
    updatedAt: entry.updatedAt || isoNow()
  };
}

function entryToRow(entry) {
  return [
    entry.entryId, entry.ownerType, entry.ownerId, entry.classId,
    String(entry.dayOfWeek), entry.startTime, entry.endTime,
    entry.subject, entry.teacherId, entry.room, entry.notes,
    String(entry.sortOrder), entry.updatedAt
  ];
}

async function saveTimetable(ownerType, ownerId, entries) {
  ownerType = String(ownerType || '').trim();
  ownerId = String(ownerId || '').trim();
  if (!ownerType || !ownerId) throw new Error('Owner is required.');
  if (!Array.isArray(entries)) throw new Error('Entries array is required.');

  const normalized = entries.map((e, idx) => {
    const row = validateEntryPayload(Object.assign({}, e, { sortOrder: e.sortOrder ?? idx }), ownerType, ownerId);
    if (!row.subject) throw new Error('Subject is required for each slot.');
    return row;
  });

  await ensureTimetableSheet();
  const allRows = await getSheetRows(TIMETABLE_ENTRIES_SHEET, { skipCache: true });
  const kept = [];
  for (let i = 1; i < allRows.length; i++) {
    const type = String(allRows[i][COL.ownerType] || '');
    const id = String(allRows[i][COL.ownerId] || '');
    if (type === ownerType && id === ownerId) continue;
    kept.push(allRows[i]);
  }

  const combined = kept.concat(normalized.map(entryToRow));
  const oldCount = Math.max(0, allRows.length - 1);
  const rowWidth = HEADERS.length;

  if (!combined.length && !oldCount) {
    return getTimetable(ownerType, ownerId);
  }

  if (!oldCount && combined.length) {
    await appendRows(TIMETABLE_ENTRIES_SHEET, combined);
  } else {
    const maxRows = Math.max(oldCount, combined.length);
    const toWrite = [];
    for (let i = 0; i < maxRows; i++) {
      toWrite.push(i < combined.length ? combined[i] : new Array(rowWidth).fill(''));
    }
    await updateRange(TIMETABLE_ENTRIES_SHEET, `A2:M${maxRows + 1}`, toWrite);
  }
  invalidateSheetRowsCache(TIMETABLE_ENTRIES_SHEET);
  return getTimetable(ownerType, ownerId);
}

async function getStudentTimetableForTeacher(teacherId, studentId) {
  const ids = await getTeacherStudentIds(teacherId);
  if (!ids.has(String(studentId))) {
    throw new Error('You do not have access to this student.');
  }
  return getTimetable('student', studentId);
}

module.exports = {
  DAY_LABELS,
  ensureTimetableSheet,
  listSubjects,
  getTimetable,
  saveTimetable,
  getStudentTimetableForTeacher,
  groupByDay,
  sortEntries,
  loadAllEntries,
  newId,
  isoNow
};

```


---

## FILE: `morning-class/public/js/timetable-setup.js`

```javascript
(function (global) {
  const PERIOD_TYPES = [
    { value: 'lesson', label: 'Lesson' },
    { value: 'recess', label: 'Recess' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'break', label: 'Break' }
  ];

  let api = null;
  let escapeHtml = null;
  let classes = [];
  let teachers = [];

  function renderBellEditor(mountEl, schedule) {
    const periods = (schedule && schedule.periods) || [];
    let rows = periods.map((p, i) =>
      '<tr data-idx="' + i + '">' +
      '<td><input class="tt-bell-label" value="' + escapeHtml(p.label) + '"></td>' +
      '<td><select class="tt-bell-type">' +
      PERIOD_TYPES.map((t) =>
        '<option value="' + t.value + '"' + (p.periodType === t.value ? ' selected' : '') + '>' + t.label + '</option>'
      ).join('') +
      '</select></td>' +
      '<td><input type="time" class="tt-bell-start" value="' + escapeHtml(p.startTime) + '"></td>' +
      '<td><input type="time" class="tt-bell-end" value="' + escapeHtml(p.endTime) + '"></td>' +
      '<td><button type="button" class="btn btn-ghost tt-bell-del">✕</button></td>' +
      '</tr>'
    ).join('');

    mountEl.innerHTML =
      '<div class="tt-setup-section">' +
      '<h4>Bell schedule (school day structure)</h4>' +
      '<p class="muted small">Set each period, recess, and lunch. Only <strong>Lesson</strong> rows are used for auto-scheduling.</p>' +
      '<table class="grades-table tt-bell-table"><thead><tr><th>Label</th><th>Type</th><th>Start</th><th>End</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="5" class="muted">No periods</td></tr>') + '</tbody></table>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-ghost tt-bell-add">+ Add row</button>' +
      '<button type="button" class="btn btn-primary tt-bell-save">Save bell schedule</button>' +
      '</div>' +
      '<div class="tt-bell-error error"></div>' +
      '</div>';

    mountEl.querySelector('.tt-bell-add').addEventListener('click', () => {
      const tbody = mountEl.querySelector('tbody');
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input class="tt-bell-label" value="New period"></td>' +
        '<td><select class="tt-bell-type">' +
        PERIOD_TYPES.map((t) => '<option value="' + t.value + '">' + t.label + '</option>').join('') +
        '</select></td>' +
        '<td><input type="time" class="tt-bell-start" value="09:00"></td>' +
        '<td><input type="time" class="tt-bell-end" value="09:50"></td>' +
        '<td><button type="button" class="btn btn-ghost tt-bell-del">✕</button></td>';
      tbody.appendChild(tr);
      bindBellRow(tr, mountEl);
    });

    mountEl.querySelector('.tt-bell-save').addEventListener('click', async () => {
      const errEl = mountEl.querySelector('.tt-bell-error');
      errEl.textContent = '';
      const payload = [];
      mountEl.querySelectorAll('tbody tr').forEach((tr, idx) => {
        payload.push({
          label: tr.querySelector('.tt-bell-label').value.trim(),
          periodType: tr.querySelector('.tt-bell-type').value,
          startTime: tr.querySelector('.tt-bell-start').value,
          endTime: tr.querySelector('.tt-bell-end').value,
          sortOrder: idx
        });
      });
      try {
        await api('/api/admin/timetable/bell-schedule', { method: 'POST', body: { periods: payload } }, 'admin');
        errEl.style.color = '#16a34a';
        errEl.textContent = 'Bell schedule saved.';
      } catch (e) {
        errEl.style.color = '#dc2626';
        errEl.textContent = e.message;
      }
    });

    mountEl.querySelectorAll('tbody tr').forEach((tr) => bindBellRow(tr, mountEl));
  }

  function bindBellRow(tr, mountEl) {
    const del = tr.querySelector('.tt-bell-del');
    if (del) {
      del.addEventListener('click', () => {
        tr.remove();
        if (!mountEl.querySelector('tbody tr')) {
          mountEl.querySelector('tbody').innerHTML = '<tr><td colspan="5" class="muted">No periods</td></tr>';
        }
      });
    }
  }

  function renderRequirements(mountEl, classId, requirements) {
    const teacherOpts = teachers.map((t) =>
      '<option value="' + escapeHtml(t.teacherId) + '">' + escapeHtml(t.name) + '</option>'
    ).join('');

    let rows = (requirements || []).map((r, i) => {
      const tOpts = teachers.map((t) =>
        '<option value="' + escapeHtml(t.teacherId) + '"' +
        (t.teacherId === r.teacherId ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>'
      ).join('');
      return (
      '<tr data-idx="' + i + '">' +
      '<td><input class="tt-req-subject" value="' + escapeHtml(r.subject) + '" list="ttSubjectList"></td>' +
      '<td><select class="tt-req-teacher">' + tOpts + '</select></td>' +
      '<td><input type="number" class="tt-req-ppw" min="1" max="20" value="' + (r.periodsPerWeek || 5) + '" style="width:4rem"></td>' +
      '<td><input class="tt-req-room" value="' + escapeHtml(r.room || '') + '" placeholder="Room"></td>' +
      '<td><button type="button" class="btn btn-ghost tt-req-del">✕</button></td>' +
      '</tr>'
      );
    }).join('');

    mountEl.innerHTML =
      '<div class="tt-setup-section">' +
      '<h4>Subject requirements</h4>' +
      '<p class="muted small">Periods per week per subject. Import from teacher assignments or edit manually.</p>' +
      '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">' +
      '<select class="tt-req-class">' +
      classes.map((c) =>
        '<option value="' + escapeHtml(c.classId) + '"' + (c.classId === classId ? ' selected' : '') + '>' +
        escapeHtml(c.name) + '</option>'
      ).join('') +
      '</select>' +
      '<button type="button" class="btn btn-ghost tt-req-import">Import from assignments</button>' +
      '<button type="button" class="btn btn-ghost tt-req-add">+ Add subject</button>' +
      '</div>' +
      '<table class="grades-table"><thead><tr><th>Subject</th><th>Teacher</th><th>Periods/wk</th><th>Room</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="5" class="muted">No requirements yet</td></tr>') + '</tbody></table>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-primary tt-req-save">Save requirements</button>' +
      '<button type="button" class="btn btn-primary tt-req-generate">Auto-generate timetable</button>' +
      '</div>' +
      '<div class="tt-req-error error"></div>' +
      '<div class="tt-req-result muted small"></div>' +
      '<div class="tt-preview-mount" style="margin-top:1rem"></div>' +
      '</div>';

    const classSelect = mountEl.querySelector('.tt-req-class');
    classSelect.addEventListener('change', () => loadRequirements(mountEl, classSelect.value));

    mountEl.querySelector('.tt-req-import').addEventListener('click', async () => {
      const errEl = mountEl.querySelector('.tt-req-error');
      errEl.textContent = '';
      try {
        const data = await api('/api/admin/timetable/requirements/import', {
          method: 'POST',
          body: { classId: classSelect.value }
        }, 'admin');
        renderRequirements(mountEl, classSelect.value, data.requirements || []);
        errEl.style.color = '#16a34a';
        errEl.textContent = 'Imported from class assignments.';
      } catch (e) {
        errEl.style.color = '#dc2626';
        errEl.textContent = e.message;
      }
    });

    mountEl.querySelector('.tt-req-add').addEventListener('click', () => {
      const tbody = mountEl.querySelector('tbody');
      if (tbody.querySelector('.muted')) tbody.innerHTML = '';
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input class="tt-req-subject" list="ttSubjectList"></td>' +
        '<td><select class="tt-req-teacher">' + teacherOpts + '</select></td>' +
        '<td><input type="number" class="tt-req-ppw" min="1" max="20" value="5" style="width:4rem"></td>' +
        '<td><input class="tt-req-room" placeholder="Room"></td>' +
        '<td><button type="button" class="btn btn-ghost tt-req-del">✕</button></td>';
      tbody.appendChild(tr);
      tr.querySelector('.tt-req-del').addEventListener('click', () => tr.remove());
    });

    mountEl.querySelectorAll('.tt-req-del').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('tr').remove());
    });

    mountEl.querySelector('.tt-req-save').addEventListener('click', () => saveRequirements(mountEl, classSelect.value));
    mountEl.querySelector('.tt-req-generate').addEventListener('click', () => generateTimetable(mountEl, classSelect.value));
  }

  async function saveRequirements(mountEl, classId) {
    const errEl = mountEl.querySelector('.tt-req-error');
    errEl.textContent = '';
    const requirements = [];
    mountEl.querySelectorAll('tbody tr').forEach((tr) => {
      if (!tr.querySelector('.tt-req-subject')) return;
      const subject = tr.querySelector('.tt-req-subject').value.trim();
      if (!subject) return;
      requirements.push({
        subject,
        teacherId: tr.querySelector('.tt-req-teacher').value,
        periodsPerWeek: Number(tr.querySelector('.tt-req-ppw').value) || 5,
        room: tr.querySelector('.tt-req-room').value.trim()
      });
    });
    try {
      await api('/api/admin/timetable/requirements', {
        method: 'POST',
        body: { classId, requirements }
      }, 'admin');
      errEl.style.color = '#16a34a';
      errEl.textContent = 'Requirements saved.';
    } catch (e) {
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  async function generateTimetable(mountEl, classId) {
    const errEl = mountEl.querySelector('.tt-req-error');
    const resEl = mountEl.querySelector('.tt-req-result');
    errEl.textContent = '';
    resEl.textContent = 'Generating… (OR-Tools solver)';
    try {
      const data = await api('/api/admin/timetable/generate', {
        method: 'POST',
        body: { classId }
      }, 'admin');
      resEl.textContent = data.result.message + ' — ' +
        data.result.assignmentCount + ' slots, ' +
        data.result.studentsUpdated + ' students, ' +
        data.result.teachersUpdated + ' teachers updated.';
      const preview = mountEl.querySelector('.tt-preview-mount');
      if (preview && global.SaltTimetable) {
        preview.innerHTML = global.SaltTimetable.renderWeekGrid(data.timetable.byDay);
      }
    } catch (e) {
      resEl.textContent = '';
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  async function loadRequirements(mountEl, classId) {
    const data = await api('/api/admin/timetable/requirements?classId=' + encodeURIComponent(classId), {}, 'admin');
    renderRequirements(mountEl, classId, data.requirements || []);
  }

  async function open(mountEl, opts) {
    api = opts.api;
    escapeHtml = opts.escapeHtml;
    classes = opts.classes || [];
    teachers = opts.teachers || [];

    mountEl.innerHTML = '<p class="muted">Loading timetable setup…</p>';

    let solverOk = false;
    try {
      const h = await api('/api/admin/timetable/solver-health', {}, 'admin');
      solverOk = h.ok;
    } catch (e) { /* ignore */ }

    const bellData = await api('/api/admin/timetable/bell-schedule', {}, 'admin');
    const classId = classes[0] ? classes[0].classId : '';

    mountEl.innerHTML =
      (solverOk
        ? '<p class="tt-solver-ok muted small">✓ OR-Tools solver connected</p>'
        : '<p class="tt-solver-warn error">Solver offline — run: <code>cd morning-class/solver && pip install -r requirements.txt && python main.py</code></p>') +
      '<div id="ttBellMount"></div><div id="ttReqMount"></div>';

    renderBellEditor(mountEl.querySelector('#ttBellMount'), bellData);
    if (classId) {
      await loadRequirements(mountEl.querySelector('#ttReqMount'), classId);
    } else {
      mountEl.querySelector('#ttReqMount').innerHTML = '<p class="muted">Create a class first.</p>';
    }
  }

  global.SaltTimetableSetup = { open };
})(window);

```


---

## FILE: `morning-class/public/js/timetable.js`

```javascript
(function (global) {
  const DAYS = [
    { value: 1, label: 'Mon', full: 'Monday' },
    { value: 2, label: 'Tue', full: 'Tuesday' },
    { value: 3, label: 'Wed', full: 'Wednesday' },
    { value: 4, label: 'Thu', full: 'Thursday' },
    { value: 5, label: 'Fri', full: 'Friday' }
  ];

  let api = null;
  let escapeHtml = null;
  let role = 'admin';
  let subjects = [];

  function apiPath(ownerType, ownerId) {
    if (role === 'admin') {
      return '/api/admin/timetable/' + ownerType + 's/' + encodeURIComponent(ownerId);
    }
    if (ownerType === 'teacher') return '/api/teacher/timetable';
    return '/api/teacher/timetable/students/' + encodeURIComponent(ownerId);
  }

  function slotCard(slot, canEdit) {
    if (slot.isBreak) {
      return (
        '<div class="tt-slot tt-slot-break">' +
        '<div class="tt-slot-time">' + escapeHtml(slot.startTime) + '–' + escapeHtml(slot.endTime) + '</div>' +
        '<div class="tt-slot-subject"><em>' + escapeHtml(slot.subject) + '</em></div>' +
        '</div>'
      );
    }
    const time = escapeHtml(slot.startTime) + '–' + escapeHtml(slot.endTime);
    const subj = escapeHtml(slot.subject || '—');
    const room = slot.room ? ' · ' + escapeHtml(slot.room) : '';
    const notes = slot.notes ? '<div class="tt-slot-notes">' + escapeHtml(slot.notes) + '</div>' : '';
    const actions = canEdit
      ? '<div class="tt-slot-actions">' +
        '<button type="button" class="btn btn-ghost tt-edit-slot" data-id="' + escapeHtml(slot.entryId) + '">Edit</button>' +
        '<button type="button" class="btn btn-ghost tt-del-slot" data-id="' + escapeHtml(slot.entryId) + '">Delete</button>' +
        '</div>'
      : '';
    return (
      '<div class="tt-slot" data-id="' + escapeHtml(slot.entryId) + '">' +
      '<div class="tt-slot-time">' + time + '</div>' +
      '<div class="tt-slot-subject"><strong>' + subj + '</strong>' + room + '</div>' +
      notes + actions +
      '</div>'
    );
  }

  function renderWeekGrid(byDay) {
    let html = '<div class="tt-week-grid">';
    DAYS.forEach((d) => {
      const slots = (byDay && byDay[d.value]) || [];
      html += '<div class="tt-day-col"><div class="tt-day-head">' + d.label + '</div><div class="tt-day-body">';
      if (!slots.length) {
        html += '<div class="tt-day-empty muted small">—</div>';
      } else {
        slots.forEach((s) => { html += slotCard(s, false); });
      }
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function renderEditor(mountEl, options) {
    if (!mountEl) return;
    const opts = options || {};
    const ownerType = opts.ownerType;
    const ownerId = opts.ownerId;
    const ownerName = opts.ownerName || '';
    const readonly = Boolean(opts.readonly || role !== 'admin');
    const classId = opts.classId || '';
    let entries = (opts.timetable && opts.timetable.entries) ? opts.timetable.entries.slice() : [];
    let byDay = opts.timetable && opts.timetable.byDay ? opts.timetable.byDay : {};
    let editingId = null;

    function rebuildByDay() {
      byDay = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      entries.forEach((e) => {
        if (byDay[e.dayOfWeek]) byDay[e.dayOfWeek].push(e);
      });
      Object.keys(byDay).forEach((k) => {
        byDay[k].sort((a, b) => a.startTime.localeCompare(b.startTime));
      });
    }

    function render() {
      const subjectOpts = subjects.map((s) => '<option value="' + escapeHtml(s) + '">').join('');
      let formHtml = '';
      if (!readonly) {
        const editSlot = editingId ? entries.find((e) => e.entryId === editingId) : null;
        formHtml =
          '<form class="tt-slot-form">' +
          '<h4>' + (editSlot ? 'Edit slot' : 'Add slot') + '</h4>' +
          '<div class="tt-form-grid">' +
          '<label>Day <select class="tt-f-day" required>' +
          DAYS.map((d) => '<option value="' + d.value + '"' + ((editSlot && editSlot.dayOfWeek === d.value) ? ' selected' : '') + '>' + d.full + '</option>').join('') +
          '</select></label>' +
          '<label>Start <input type="time" class="tt-f-start" required value="' + escapeHtml((editSlot && editSlot.startTime) || '09:00') + '"></label>' +
          '<label>End <input type="time" class="tt-f-end" required value="' + escapeHtml((editSlot && editSlot.endTime) || '09:50') + '"></label>' +
          '<label>Subject <input class="tt-f-subject" list="ttSubjectList" required value="' + escapeHtml((editSlot && editSlot.subject) || '') + '"></label>' +
          '<label>Class <input class="tt-f-class" placeholder="Optional class ID" value="' + escapeHtml((editSlot && editSlot.classId) || classId) + '"></label>' +
          '<label>Room <input class="tt-f-room" value="' + escapeHtml((editSlot && editSlot.room) || '') + '"></label>' +
          '<label class="tt-span2">Notes <input class="tt-f-notes" value="' + escapeHtml((editSlot && editSlot.notes) || '') + '"></label>' +
          '</div>' +
          '<datalist id="ttSubjectList">' + subjectOpts + '</datalist>' +
          '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">' +
          '<button type="submit" class="btn btn-primary">' + (editSlot ? 'Update slot' : 'Add slot') + '</button>' +
          (editSlot ? '<button type="button" class="btn btn-ghost tt-cancel-edit">Cancel</button>' : '') +
          '<button type="button" class="btn btn-primary tt-save-all">Save timetable</button>' +
          '</div>' +
          '<div class="tt-form-error error"></div>' +
          '</form>';
      }

      let listHtml = '<div class="tt-day-lists">';
      DAYS.forEach((d) => {
        const slots = byDay[d.value] || [];
        listHtml += '<div class="tt-day-section"><h4>' + d.full + '</h4>';
        if (!slots.length) {
          listHtml += '<p class="muted small">No slots</p>';
        } else {
          listHtml += slots.map((s) => slotCard(s, !readonly)).join('');
        }
        listHtml += '</div>';
      });
      listHtml += '</div>';

      mountEl.innerHTML =
        '<div class="tt-editor">' +
        (ownerName ? '<p class="muted small">Timetable for <strong>' + escapeHtml(ownerName) + '</strong></p>' : '') +
        renderWeekGrid(byDay) +
        formHtml +
        listHtml +
        '<div class="tt-save-status error"></div>' +
        '</div>';

      bindEvents();
    }

    async function persist() {
      const status = mountEl.querySelector('.tt-save-status');
      if (status) status.textContent = '';
      const data = await api(apiPath(ownerType, ownerId), {
        method: 'POST',
        body: { entries }
      }, role);
      entries = data.timetable.entries.slice();
      rebuildByDay();
      if (status) {
        status.style.color = '#16a34a';
        status.textContent = 'Timetable saved.';
      }
      render();
    }

    function bindEvents() {
      const form = mountEl.querySelector('.tt-slot-form');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const err = mountEl.querySelector('.tt-form-error');
          err.textContent = '';
          try {
            const slot = {
              entryId: editingId || '',
              dayOfWeek: Number(form.querySelector('.tt-f-day').value),
              startTime: form.querySelector('.tt-f-start').value,
              endTime: form.querySelector('.tt-f-end').value,
              subject: form.querySelector('.tt-f-subject').value.trim(),
              classId: form.querySelector('.tt-f-class').value.trim(),
              room: form.querySelector('.tt-f-room').value.trim(),
              notes: form.querySelector('.tt-f-notes').value.trim()
            };
            if (!slot.subject) throw new Error('Subject is required.');
            if (editingId) {
              entries = entries.map((x) => x.entryId === editingId ? Object.assign({}, x, slot, { entryId: editingId }) : x);
            } else {
              entries.push(Object.assign({}, slot, { entryId: 'tmp_' + Date.now() }));
            }
            editingId = null;
            rebuildByDay();
            render();
          } catch (ex) {
            err.textContent = ex.message;
          }
        });

        const cancel = mountEl.querySelector('.tt-cancel-edit');
        if (cancel) cancel.addEventListener('click', () => { editingId = null; render(); });

        const saveAll = mountEl.querySelector('.tt-save-all');
        if (saveAll) {
          saveAll.addEventListener('click', () => persist().catch((ex) => {
            const status = mountEl.querySelector('.tt-save-status');
            if (status) { status.style.color = '#dc2626'; status.textContent = ex.message; }
          }));
        }
      }

      mountEl.querySelectorAll('.tt-edit-slot').forEach((btn) => {
        btn.addEventListener('click', () => {
          editingId = btn.dataset.id;
          render();
        });
      });

      mountEl.querySelectorAll('.tt-del-slot').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!confirm('Remove this slot?')) return;
          entries = entries.filter((x) => x.entryId !== btn.dataset.id);
          if (editingId === btn.dataset.id) editingId = null;
          rebuildByDay();
          render();
        });
      });
    }

    rebuildByDay();
    render();

    return {
      reload: async () => {
        const data = await api(apiPath(ownerType, ownerId), {}, role);
        entries = data.timetable.entries.slice();
        byDay = data.timetable.byDay;
        render();
      }
    };
  }

  function renderAdminPanel(mountEl, options) {
    const students = (options && options.students) || [];
    const teachers = (options && options.teachers) || [];
    let mode = 'student';
    let selectedId = '';
    let editorHandle = null;

    function personOptions() {
      if (mode === 'student') {
        return students.map((s) =>
          '<option value="' + escapeHtml(s.studentId) + '"' + (s.studentId === selectedId ? ' selected' : '') + '>' +
          escapeHtml(s.name) + ' (' + escapeHtml(s.studentId) + ')' +
          (s.className && s.className !== '—' ? ' · ' + escapeHtml(s.className) : '') +
          '</option>'
        ).join('');
      }
      return teachers.map((t) =>
        '<option value="' + escapeHtml(t.teacherId) + '"' + (t.teacherId === selectedId ? ' selected' : '') + '>' +
        escapeHtml(t.name) + ' (' + escapeHtml(t.teacherId) + ')</option>'
      ).join('');
    }

    async function loadSelected() {
      const editorMount = mountEl.querySelector('.tt-editor-mount');
      if (!editorMount || !selectedId) {
        if (editorMount) editorMount.innerHTML = '<p class="muted">Select a person to edit their timetable.</p>';
        return;
      }
      editorMount.innerHTML = '<p class="muted">Loading…</p>';
      const ownerType = mode === 'student' ? 'student' : 'teacher';
      const data = await api(apiPath(ownerType, selectedId), {}, role);
      let ownerName = '';
      let classId = '';
      if (mode === 'student') {
        const s = students.find((x) => x.studentId === selectedId);
        ownerName = s ? s.name : selectedId;
        classId = s ? s.classId : '';
      } else {
        const t = teachers.find((x) => x.teacherId === selectedId);
        ownerName = t ? t.name : selectedId;
      }
      editorHandle = renderEditor(editorMount, {
        ownerType,
        ownerId: selectedId,
        ownerName,
        classId,
        timetable: data.timetable,
        readonly: false
      });
    }

    function renderShell() {
      mountEl.innerHTML =
        '<div class="tt-admin">' +
        '<div class="tt-admin-toolbar">' +
        '<div class="tt-mode-tabs">' +
        '<button type="button" class="tt-mode-btn' + (mode === 'student' ? ' active' : '') + '" data-mode="student">Student timetables</button>' +
        '<button type="button" class="tt-mode-btn' + (mode === 'teacher' ? ' active' : '') + '" data-mode="teacher">Teacher timetables</button>' +
        '</div>' +
        '<select class="tt-person-select">' + personOptions() + '</select>' +
        '</div>' +
        '<div class="tt-editor-mount"><p class="muted">Select a person to edit their timetable.</p></div>' +
        '</div>';

      mountEl.querySelectorAll('.tt-mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          mode = btn.dataset.mode;
          selectedId = '';
          renderShell();
          const sel = mountEl.querySelector('.tt-person-select');
          if (sel && sel.options.length) {
            selectedId = sel.value;
            loadSelected();
          }
        });
      });

      const sel = mountEl.querySelector('.tt-person-select');
      if (sel) {
        if (!selectedId && sel.options.length) selectedId = sel.value;
        sel.addEventListener('change', () => {
          selectedId = sel.value;
          loadSelected();
        });
      }
      if (selectedId) loadSelected();
    }

    renderShell();
  }

  async function renderReadOnly(mountEl, ownerType, ownerId, ownerName) {
    if (!mountEl || !ownerId) return;
    mountEl.innerHTML = '<p class="muted">Loading timetable…</p>';
    try {
      const data = await api(apiPath(ownerType, ownerId), {}, role);
      mountEl.innerHTML =
        '<div class="tt-readonly">' +
        (ownerName ? '<p class="muted small"><strong>' + escapeHtml(ownerName) + '</strong> — weekly schedule</p>' : '') +
        renderWeekGrid(data.timetable.byDay) +
        '</div>';
    } catch (e) {
      mountEl.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function loadSubjects() {
    try {
      const data = await api('/api/admin/timetable/subjects', {}, role === 'admin' ? 'admin' : role);
      subjects = data.subjects || [];
    } catch (e) {
      subjects = ['English', 'Math', 'Science', 'Reading', 'Writing', 'Grammar'];
    }
  }

  function init(opts) {
    api = opts.api;
    escapeHtml = opts.escapeHtml;
    role = opts.role || 'admin';
  }

  async function openAdmin(mountEl, options) {
    await loadSubjects();
    renderAdminPanel(mountEl, options);
  }

  global.SaltTimetable = {
    init,
    renderEditor,
    renderReadOnly,
    openAdmin,
    renderWeekGrid
  };
})(window);

```


---

## FILE: `morning-class/src/routes.js` (timetable-related excerpt)

```javascript
// --- lines 107-139 ---
} = require('./services/classRegistryService');
const {
  ensureTimetableSheet,
  listSubjects,
  getTimetable,
  saveTimetable,
  getStudentTimetableForTeacher
} = require('./services/timetableService');
const { getBellSchedule, saveBellSchedule } = require('./services/bellScheduleService');
const {
  listRequirementsWithClassNames,
  saveRequirements,
  importRequirementsFromAssignments
} = require('./services/timetableRequirementsService');
const { generateClassTimetable } = require('./services/timetableGenerateService');
const { saveTeacherSubjectStyle } = require('./services/subjectStyleService');
const { getBuddyStatus, askEnglishBuddy, getBuddyChatHistory, listBuddyMonitorForClass, unlockBuddy, refillBuddyUsage, clearBuddyChatHistory } = require('./services/englishBuddyService');
const { getStudentDashboard } = require('./services/studentPortalService');
const {
  getStudentDollars,
  applyDollarAdjustment,
  listClassDollarBalances,
  ensureDollarSheets
} = require('./services/dollarService');
const {
  postHomework,
  getClassHomework,
  getStudentHomeworkStatus,
  setHomeworkCompletion,
  ensureHomeworkSheets
} = require('./services/homeworkService');
const {
  getStudentVocabSummary,

// --- lines 1542-1701 ---
});

router.get('/admin/timetable/subjects', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({ subjects: await listSubjects() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load subjects.' });
  }
});

router.get('/admin/timetable/students/:studentId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({ timetable: await getTimetable('student', req.params.studentId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load timetable.' });
  }
});

router.post('/admin/timetable/students/:studentId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    const timetable = await saveTimetable('student', req.params.studentId, req.body.entries || []);
    res.json({ timetable });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save timetable.' });
  }
});

router.get('/admin/timetable/teachers/:teacherId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({ timetable: await getTimetable('teacher', req.params.teacherId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load timetable.' });
  }
});

router.post('/admin/timetable/teachers/:teacherId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    const timetable = await saveTimetable('teacher', req.params.teacherId, req.body.entries || []);
    res.json({ timetable });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save timetable.' });
  }
});

router.get('/teacher/timetable', requireRole('teacher'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({
      timetable: await getTimetable('teacher', req.session.teacherId)
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load timetable.' });
  }
});

router.get('/teacher/timetable/students/:studentId', requireRole('teacher'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({
      timetable: await getStudentTimetableForTeacher(req.session.teacherId, req.params.studentId)
    });
  } catch (e) {
    const code = e.message.includes('access') ? 403 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.get('/admin/timetable/bell-schedule', requireRole('admin'), async (req, res) => {
  try {
    res.json(await getBellSchedule());
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load bell schedule.' });
  }
});

router.post('/admin/timetable/bell-schedule', requireRole('admin'), async (req, res) => {
  try {
    const schedule = await saveBellSchedule(req.body.periods || []);
    res.json(schedule);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save bell schedule.' });
  }
});

router.get('/admin/timetable/requirements', requireRole('admin'), async (req, res) => {
  try {
    const requirements = await listRequirementsWithClassNames(req.query.classId);
    res.json({ requirements });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load requirements.' });
  }
});

router.post('/admin/timetable/requirements', requireRole('admin'), async (req, res) => {
  try {
    const { classId, requirements } = req.body || {};
    const saved = await saveRequirements(classId, requirements || []);
    res.json({ requirements: saved });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save requirements.' });
  }
});

router.post('/admin/timetable/requirements/import', requireRole('admin'), async (req, res) => {
  try {
    const { classId } = req.body || {};
    const requirements = await importRequirementsFromAssignments(classId);
    res.json({ requirements });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not import requirements.' });
  }
});

router.get('/admin/timetable/classes/:classId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({ timetable: await getTimetable('class', req.params.classId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load class timetable.' });
  }
});

router.post('/admin/timetable/generate', requireRole('admin'), async (req, res) => {
  try {
    const { classId } = req.body || {};
    const result = await generateClassTimetable(classId);
    const timetable = await getTimetable('class', classId);
    res.json({ result, timetable });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not generate timetable.' });
  }
});

router.get('/admin/timetable/solver-health', requireRole('admin'), async (req, res) => {
  try {
    const { TIMETABLE_SOLVER_URL } = require('./config');
    const url = (TIMETABLE_SOLVER_URL || 'http://127.0.0.1:8791').replace(/\/$/, '') + '/health';
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    res.json({ ok: r.ok, solver: data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const {
  generateJeopardyBoard,
  createBlankJeopardyBoard
} = require('./services/jeopardyService');

router.post('/jeopardy/generate', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const board = await generateJeopardyBoard({
      subject: body.subject || body.topic,

```

## Config notes

- `TIMETABLE_SOLVER_URL` default: `http://127.0.0.1:8791`
- Sheets: `Timetable_Entries`, `Bell_Schedule`, `Timetable_Requirements`
- Generate flow: requirements + bell + forbidden teacher slots → CP-SAT → save class/teacher/student entries
- Solver start: `cd morning-class/solver && pip install -r requirements.txt && python main.py`
