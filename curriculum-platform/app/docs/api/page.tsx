import {
  DEMO_CLASS_ID,
  DEMO_TEACHER_ID,
} from "@/lib/schedule/demo-data";

export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-semibold text-ink-900">
        External Teacher Portal API
      </h1>
      <p className="mt-2 text-sm text-ink-700/80">
        REST endpoints for existing portals. Auth: header{" "}
        <code className="text-moss-700">x-api-key</code> when{" "}
        <code className="text-moss-700">PORTAL_API_KEY</code> is set.
      </p>

      <section className="mt-8 space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="font-display text-xl font-semibold">Daily lesson plans</h2>
          <pre className="mt-2 overflow-x-auto rounded-md bg-ink-900 p-4 text-xs text-moss-100">
{`GET /api/portal/v1/teachers/${DEMO_TEACHER_ID}/classes/${DEMO_CLASS_ID}/lessons?date=2026-03-02&generate=1

Response: { teacherId, classId, date, count, lessons: [{ ..., lessonPlan }] }`}
          </pre>
        </div>

        <div>
          <h2 className="font-display text-xl font-semibold">AI materials</h2>
          <pre className="mt-2 overflow-x-auto rounded-md bg-ink-900 p-4 text-xs text-moss-100">
{`GET /api/portal/v1/teachers/${DEMO_TEACHER_ID}/classes/${DEMO_CLASS_ID}/materials`}
          </pre>
        </div>

        <div>
          <h2 className="font-display text-xl font-semibold">Internal helpers</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-800">
            <li>
              <code>GET /api/frameworks</code> — list frameworks
            </li>
            <li>
              <code>GET /api/frameworks/:code</code> — full tree
            </li>
            <li>
              <code>GET /api/schedule</code> — calendar + sequenced skills
            </li>
            <li>
              <code>POST /api/lesson-plans</code> — generate by date or scheduledLessonId
            </li>
            <li>
              <code>POST /api/nodes/:id/materials</code> — AI quiz / worksheet stub
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
