"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Sparkles, Loader2 } from "lucide-react";
import type { LessonPlan, ScheduledLesson, SchoolCalendarDay, TeacherScheduleSlot } from "@/lib/types";

type SchedulePayload = {
  teacherId: string;
  classId: string;
  calendar: SchoolCalendarDay[];
  timetable: TeacherScheduleSlot[];
  scheduledLessons: ScheduledLesson[];
};

export default function SchedulePage() {
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSchedule(reset = false) {
    setError(null);
    try {
      const res = reset
        ? await fetch("/api/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reset: true, gradeLevel: "4" }),
          })
        : await fetch("/api/schedule");
      const payload = (await res.json()) as SchedulePayload & {
        scheduledLessons: ScheduledLesson[];
        count?: number;
      };
      if (reset) {
        const full = await fetch("/api/schedule").then((r) => r.json());
        setData(full);
        const first = full.scheduledLessons[0]?.scheduledDate;
        if (first) setSelectedDate(first);
      } else {
        setData(payload as SchedulePayload);
        const first = payload.scheduledLessons[0]?.scheduledDate;
        if (first) setSelectedDate(first);
      }
      setPlans([]);
    } catch {
      setError("Failed to load schedule");
    }
  }

  useEffect(() => {
    void loadSchedule(false);
  }, []);

  const lessonsByDate = useMemo(() => {
    const map = new Map<string, ScheduledLesson[]>();
    for (const l of data?.scheduledLessons || []) {
      const arr = map.get(l.scheduledDate) || [];
      arr.push(l);
      map.set(l.scheduledDate, arr);
    }
    return map;
  }, [data]);

  async function generateForDay() {
    if (!selectedDate || !data) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId: data.teacherId,
          classId: data.classId,
          date: selectedDate,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      const nextPlans = (json.lessonPlans || []) as LessonPlan[];
      if (nextPlans.length === 0) {
        throw new Error("No lesson plans returned for this day");
      }
      setPlans(nextPlans);
      requestAnimationFrame(() => {
        document
          .getElementById("generated-plans")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const dayLessons = selectedDate ? lessonsByDate.get(selectedDate) || [] : [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="animate-rise flex items-start gap-3">
        <CalendarRange className="mt-1 h-6 w-6 text-coral-500" />
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">
            Teacher schedule
          </h1>
          <p className="mt-1 text-sm text-ink-700/75">
            Demo teacher <code className="text-moss-700">T001</code> · class{" "}
            <code className="text-moss-700">C4A</code> — skills sequenced onto instructional days.
          </p>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-coral-600">{error}</p>}

      {!data && !error && (
        <p className="mt-8 flex items-center gap-2 text-sm text-ink-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading calendar…
        </p>
      )}

      {data && (
        <div className="mt-8 grid gap-8 lg:grid-cols-[320px_1fr]">
          <div>
            <h2 className="font-display text-lg font-semibold">Weekly timetable</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {data.timetable.map((s) => (
                <li key={s.id} className="border-l-2 border-moss-400 pl-3">
                  <span className="font-semibold">{s.dayOfWeek}</span> · P{s.period}{" "}
                  {s.startTime}-{s.endTime}
                  <br />
                  <span className="text-ink-700/70">
                    {s.subject} · {s.frameworkCode}
                  </span>
                </li>
              ))}
            </ul>

            <h2 className="mt-8 font-display text-lg font-semibold">Calendar</h2>
            <ul className="mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1 text-sm">
              {data.calendar.map((d) => {
                const count = lessonsByDate.get(d.date)?.length || 0;
                const active = selectedDate === d.date;
                return (
                  <li key={d.date}>
                    <button
                      type="button"
                      disabled={!d.isInstructional}
                      onClick={() => {
                        setSelectedDate(d.date);
                        setPlans([]);
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition ${
                        active
                          ? "bg-moss-700 text-white"
                          : d.isInstructional
                            ? "hover:bg-moss-100"
                            : "cursor-not-allowed opacity-45"
                      }`}
                    >
                      <span>
                        {d.date}
                        {!d.isInstructional && d.title ? ` · ${d.title}` : ""}
                      </span>
                      {count > 0 && (
                        <span className={active ? "text-moss-100" : "text-moss-700"}>
                          {count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">
                {selectedDate ? `Lessons · ${selectedDate}` : "Select a day"}
              </h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadSchedule(true)}
                  className="rounded-md border border-ink-900/15 bg-white px-3 py-2 text-sm font-semibold text-ink-800 transition hover:bg-moss-100"
                >
                  Resequence skills
                </button>
                <button
                  type="button"
                  disabled={!selectedDate || busy || dayLessons.length === 0}
                  onClick={generateForDay}
                  className="inline-flex items-center gap-2 rounded-md bg-coral-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-coral-600 disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate AI lesson plans
                </button>
              </div>
            </div>

            <ul className="mt-4 space-y-3">
              {dayLessons.length === 0 && (
                <li className="text-sm text-ink-700/60">
                  No skills scheduled this day (weekend, holiday, or queue exhausted).
                </li>
              )}
              {dayLessons.map((l) => (
                <li
                  key={l.id}
                  className="animate-rise border-l-4 border-coral-500 bg-white/70 px-4 py-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-moss-700">
                    Period {l.period} · {l.frameworkCode} · #{l.sequenceIndex + 1}
                  </p>
                  <p className="font-display text-lg font-semibold text-ink-900">
                    {l.skillTitle}
                  </p>
                  {l.skillCode && (
                    <p className="font-mono text-sm text-coral-600">{l.skillCode}</p>
                  )}
                </li>
              ))}
            </ul>

            {plans.length > 0 && (
              <div id="generated-plans" className="mt-8 space-y-4">
                <h3 className="font-display text-lg font-semibold">
                  Generated plans ({plans.length})
                </h3>
                {plans.map((p) => (
                  <article
                    key={p.id}
                    className="animate-rise space-y-2 bg-ink-900 px-5 py-4 text-sand-50"
                  >
                    <p className="text-xs uppercase tracking-wide text-moss-200">
                      {p.model} · period {p.period}
                    </p>
                    <h4 className="font-display text-xl font-semibold">{p.title}</h4>
                    {(
                      [
                        ["Warm-up", p.warmUp],
                        ["Instruction", p.instruction],
                        ["Guided practice", p.guidedPractice],
                        ["Formative assessment", p.formativeAssessment],
                        ["Closure", p.closure],
                      ] as const
                    ).map(([label, text]) => (
                      <div key={label}>
                        <p className="text-xs font-semibold uppercase text-coral-500">
                          {label}
                        </p>
                        <p className="text-sm leading-relaxed text-sand-100/90">{text}</p>
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
