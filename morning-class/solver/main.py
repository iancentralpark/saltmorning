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
