import {
  DEMO_CLASS_ID,
  DEMO_TEACHER_ID,
} from "@/lib/schedule/demo-data";

function buildUrl(path: string, q: Record<string, string>) {
  const usp = new URLSearchParams(q);
  return `${path}?${usp.toString()}`;
}

export default function ConnectPage() {
  const scheduleEmbed = buildUrl("/schedule", {
    embed: "1",
    teacherId: DEMO_TEACHER_ID,
    classId: DEMO_CLASS_ID,
  });
  const mapEmbed = buildUrl("/map", {
    embed: "1",
    framework: "ccss-math",
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-moss-700">
        For Salt Morning teachers
      </p>
      <h1 className="mt-1 font-display text-3xl font-semibold text-ink-900">
        How CurricuMap connects
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-700/85">
        CurricuMap is the curriculum + AI lesson layer.{" "}
        <strong className="font-semibold text-ink-900">Salt Morning</strong> stays your
        attendance / class / lesson home. Teachers do not need to paste API code — open the
        links from the Salt Morning lesson panel.
      </p>

      <section className="mt-8 space-y-4 rounded-xl border border-ink-900/10 bg-white/70 p-5">
        <h2 className="font-display text-xl font-semibold text-ink-900">
          What you use day-to-day
        </h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink-800">
          <li>
            In <strong>Salt Morning → Teacher → Lesson plan</strong>, use{" "}
            <em>Open CurricuMap schedule</em> or <em>Open curriculum mindmap</em>.
            Those buttons already pass your teacher/class context when the bridge env is set.
          </li>
          <li>
            <strong>Mindmap</strong> — browse standards, open a skill, generate a printable
            worksheet / quiz for that skill.
          </li>
          <li>
            <strong>Schedule</strong> — demo sequence of skills onto instructional days, then
            generate AI lesson plans for a selected day. Today this demo uses teacher{" "}
            <code className="text-moss-700">{DEMO_TEACHER_ID}</code> / class{" "}
            <code className="text-moss-700">{DEMO_CLASS_ID}</code> unless the deep-link
            sends other IDs.
          </li>
        </ol>
        <p className="text-sm text-ink-700/80">
          Class Tools (timer / dice) is separate — it is not CurricuMap. Curriculum links live
          on the <strong>lesson plan</strong> panel, not Class Tools.
        </p>
      </section>

      <section className="mt-6 space-y-3 rounded-xl border border-ink-900/10 bg-moss-50/60 p-5">
        <h2 className="font-display text-xl font-semibold text-ink-900">
          Change which teacher/class is linked
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-800">
          <li>
            Open Salt Morning as that teacher — the lesson panel deep-link includes their{" "}
            <code className="text-moss-700">teacherId</code> / active{" "}
            <code className="text-moss-700">classId</code>.
          </li>
          <li>
            Or open CurricuMap schedule manually with query params, e.g.{" "}
            <code className="break-all text-moss-700">
              /schedule?teacherId=YOUR_ID&amp;classId=YOUR_CLASS
            </code>
            .
          </li>
          <li>
            Ops (Railway / morning-class env):{" "}
            <code className="text-moss-700">CURRICULUM_MAP_URL</code>,{" "}
            <code className="text-moss-700">CURRICULUM_MAP_API_KEY</code>,{" "}
            <code className="text-moss-700">CURRICULUM_MAP_ORG_CODE=salt-morning</code>. See{" "}
            <code className="text-moss-700">OPS.md</code>.
          </li>
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href={scheduleEmbed}
            className="rounded-md bg-moss-700 px-3 py-2 text-xs font-semibold text-white hover:bg-moss-800"
          >
            Open demo schedule embed
          </a>
          <a
            href={mapEmbed}
            className="rounded-md border border-ink-900/15 bg-white px-3 py-2 text-xs font-semibold text-ink-800 hover:bg-moss-100"
          >
            Open demo mindmap embed
          </a>
        </div>
      </section>

      <details className="mt-8 rounded-xl border border-ink-900/10 bg-ink-900/95 p-5 text-sand-50">
        <summary className="cursor-pointer font-display text-lg font-semibold text-white">
          Developer API reference (optional)
        </summary>
        <p className="mt-3 text-sm text-sand-100/80">
          For engineers wiring portals. Teachers can ignore this section. Auth header{" "}
          <code className="text-moss-200">x-api-key</code> (={" "}
          <code className="text-moss-200">PORTAL_API_KEY</code>), optional{" "}
          <code className="text-moss-200">x-organization-code</code>.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-black/40 p-4 text-xs text-moss-100">
{`GET /api/portal/v1/teachers/${DEMO_TEACHER_ID}/classes/${DEMO_CLASS_ID}/lessons?date=2026-03-02&generate=1
GET /api/portal/v1/teachers/${DEMO_TEACHER_ID}/classes/${DEMO_CLASS_ID}/materials
POST /api/portal/v1/calendar/sync
Header: x-api-key: $PORTAL_API_KEY
Header: x-organization-code: salt-morning

# Salt Morning proxies these for the logged-in teacher:
GET  /api/teacher/curriculum-map/config
GET  /api/teacher/curriculum-map/lessons
POST /api/teacher/curriculum-map/sync-calendar`}
        </pre>
      </details>
    </div>
  );
}
