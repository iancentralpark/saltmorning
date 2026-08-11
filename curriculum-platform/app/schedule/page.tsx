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
  const [syncBusy, setSyncBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function loadSchedule(reset = false) {
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const teacherId = params.get("teacherId") || undefined;
      const classId = params.get("classId") || undefined;
      const res = reset
        ? await fetch("/api/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reset: true,
              gradeLevel: "4",
              teacherId,
              classId,
            }),
          })
        : await fetch(
            `/api/schedule?${new URLSearchParams({
              ...(teacherId ? { teacherId } : {}),
              ...(classId ? { classId } : {}),
            }).toString()}`
          );
      const payload = (await res.json()) as SchedulePayload & {
        scheduledLessons: ScheduledLesson[];
        count?: number;
      };
      if (reset) {
        const full = await fetch(
          `/api/schedule?${new URLSearchParams({
            ...(teacherId ? { teacherId } : {}),
            ...(classId ? { classId } : {}),
          }).toString()}`
        ).then((r) => r.json());
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

  async function syncDemoHolidays() {
    setSyncBusy(true);
    setError(null);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/schedule/sync-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
      setSyncMsg(
        `Synced ${json.overlayCount} overlays · ${json.nonInstructional} non-instructional days`
      );
      await loadSchedule(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncBusy(false);
    }
  }

  const dayLessons = selectedDate ? lessonsByDate.get(selectedDate) || [] : [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="animate-rise schedule-hero-chrome flex items-start gap-3">
        <CalendarRange className="mt-1 h-6 w-6 text-coral-500" />
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">
            Teacher schedule
          </h1>
          <p className="mt-1 text-sm text-ink-700/75">
            Demo teacher <code className="text-moss-700">T001</code> · class{" "}
            <code className="text-moss-700">C4A</code> — skills lined up on instructional days.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-moss-500/20 bg-moss-50/70 px-4 py-3 text-sm leading-relaxed text-ink-800">
        <p className="font-semibold text-ink-900">How to use this page</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            Left: pick an <strong>instructional day</strong> (numbers = how many skills are
            queued that day).
          </li>
          <li>
            Right: review the skill cards for that day, then click{" "}
            <strong>Generate AI lesson plans</strong> to draft warm-up → closure for each.
          </li>
          <li>
            From <strong>Salt Morning → Lesson plan</strong>, use{" "}
            <em>Open CurricuMap schedule</em> so your teacher/class IDs are passed in. Class
            Tools is unrelated — curriculum links live on the lesson panel.
          </li>
        </ol>
        <p className="mt-2 text-xs text-ink-700/70">
          This screen is a CurricuMap demo sequencer, not a full copy of every Salt Morning
          timetable yet. Holidays can sync from Salt Morning when the bridge env is set.{" "}
          <a href="/docs/api" className="font-semibold text-moss-700 underline-offset-2 hover:underline">
            How it connects →
          </a>
        </p>
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
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide">
              <span className="rounded bg-moss-100 px-2 py-0.5 text-moss-800">
                Instructional
              </span>
              <span className="rounded bg-coral-500/15 px-2 py-0.5 text-coral-600">
                Holiday
              </span>
              <span className="rounded bg-ink-900/10 px-2 py-0.5 text-ink-800">
                Blackout
              </span>
              <span className="rounded bg-sand-200 px-2 py-0.5 text-ink-700">
                Break
              </span>
            </div>
            <button
              type="button"
              disabled={syncBusy}
              onClick={() => void syncDemoHolidays()}
              className="mt-3 w-full rounded-md border border-ink-900/15 bg-white px-3 py-2 text-left text-xs font-semibold text-ink-800 transition hover:bg-moss-100 disabled:opacity-50"
            >
              {syncBusy
                ? "Syncing holidays…"
                : "Sync demo holidays / blackouts (then resequence)"}
            </button>
            {syncMsg && (
              <p className="mt-2 text-xs text-moss-700">{syncMsg}</p>
            )}
            {(() => {
              const overlays = data.calendar.filter(
                (d) =>
                  !d.isInstructional &&
                  (d.dayType === "HOLIDAY" ||
                    d.dayType === "BLACKOUT" ||
                    d.dayType === "EVENT")
              );
              if (overlays.length === 0) return null;
              return (
                <p className="mt-2 text-xs text-ink-700/70">
                  {overlays.length} calendar overlay
                  {overlays.length === 1 ? "" : "s"} blocking instruction
                  {overlays.slice(0, 3).map((o) => (
                    <span key={o.date} className="block font-medium text-ink-800">
                      {o.date} · {o.dayType}
                      {o.title ? ` · ${o.title}` : ""}
                    </span>
                  ))}
                  {overlays.length > 3 && (
                    <span className="block">+{overlays.length - 3} more</span>
                  )}
                </p>
              );
            })()}
            <ul className="mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1 text-sm">
              {data.calendar.map((d) => {
                const count = lessonsByDate.get(d.date)?.length || 0;
                const active = selectedDate === d.date;
                const overlayTone =
                  d.dayType === "HOLIDAY"
                    ? "border-l-2 border-coral-500"
                    : d.dayType === "BLACKOUT"
                      ? "border-l-2 border-ink-900/50"
                      : d.dayType === "BREAK"
                        ? "border-l-2 border-sand-300"
                        : "border-l-2 border-transparent";
                return (
                  <li key={d.date}>
                    <button
                      type="button"
                      disabled={!d.isInstructional}
                      onClick={() => {
                        setSelectedDate(d.date);
                        setPlans([]);
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition ${overlayTone} ${
                        active
                          ? "bg-moss-700 text-white"
                          : d.isInstructional
                            ? "hover:bg-moss-100"
                            : "cursor-not-allowed opacity-70"
                      }`}
                    >
                      <span>
                        <span className="font-medium">{d.date}</span>
                        {!d.isInstructional && (
                          <span
                            className={
                              active ? "text-moss-100" : "text-coral-600"
                            }
                          >
                            {" "}
                            · {d.dayType}
                            {d.title ? ` · ${d.title}` : ""}
                          </span>
                        )}
                      </span>
                      {count > 0 && (
                        <span
                          className={
                            active ? "text-moss-100" : "text-moss-700"
                          }
                        >
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
