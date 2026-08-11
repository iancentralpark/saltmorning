import {
  DEMO_CLASS_ID,
  DEMO_TEACHER_ID,
} from "@/lib/schedule/demo-data";

function buildUrl(path: string, q: Record<string, string>) {
  const usp = new URLSearchParams(q);
  return `${path}?${usp.toString()}`;
}

export default function ApiDocsPage() {
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
      <h1 className="font-display text-3xl font-semibold text-ink-900">
        External Teacher Portal API
      </h1>
      <p className="mt-2 text-sm text-ink-700/80">
        REST endpoints for existing portals. Auth: header{" "}
        <code className="text-moss-700">x-api-key</code> when{" "}
        <code className="text-moss-700">PORTAL_API_KEY</code> is set. Optional{" "}
        <code className="text-moss-700">x-organization-code</code> for multi-org
        (required when <code className="text-moss-700">PORTAL_REQUIRE_ORG=1</code>
        ). Demo browser login: <code className="text-moss-700">POST /api/auth/demo-login</code>.
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
          <h2 className="font-display text-xl font-semibold">Calendar sync</h2>
          <pre className="mt-2 overflow-x-auto rounded-md bg-ink-900 p-4 text-xs text-moss-100">
{`POST /api/portal/v1/calendar/sync
Header: x-api-key: $PORTAL_API_KEY
Header: x-organization-code: salt-morning
Body: {
  "holidays": { "2026-03-01": "삼일절" },
  "blackouts": [{ "date": "2026-03-05", "title": "Staff PD" }],
  "resequence": true
}`}
          </pre>
        </div>

        <div>
          <h2 className="font-display text-xl font-semibold">Cron calendar sync</h2>
          <pre className="mt-2 overflow-x-auto rounded-md bg-ink-900 p-4 text-xs text-moss-100">
{`# CurricuMap (local overlay or proxy to Salt Morning)
POST /api/cron/calendar-sync
Header: x-cron-secret: $CRON_SECRET
Body: { "holidays": { "2026-03-01": "삼일절" } }
# or with SALT_MORNING_URL set: { "year": 2026, "months": [3,4,5] }

# Salt Morning host cron (preferred — holidays live there)
POST $SALT_MORNING_URL/api/internal/curriculum-map/sync-calendar-cron
Header: x-cron-secret: $CRON_SECRET
Body: { "year": 2026, "months": [1,2,3,4,5,6,7,8,9,10,11,12] }`}
          </pre>
        </div>

        <div>
          <h2 className="font-display text-xl font-semibold">Demo org session</h2>
          <pre className="mt-2 overflow-x-auto rounded-md bg-ink-900 p-4 text-xs text-moss-100">
{`POST /api/auth/demo-login
Body: { "orgCode": "salt-morning" | "acme-academy", "role": "teacher" }

GET  /api/auth/me
POST /api/auth/logout

# Optional Google OAuth (when GOOGLE_CLIENT_ID/SECRET set)
GET /api/auth/google/start
GET /api/auth/google/callback

# Optional Microsoft Entra OAuth (when MICROSOFT_CLIENT_ID/SECRET set)
GET /api/auth/microsoft/start
GET /api/auth/microsoft/callback

# Optional Sign in with Apple (when APPLE_* credentials set)
GET  /api/auth/apple/start
POST /api/auth/apple/callback   # form_post

# AUTH_REQUIRED=1 → middleware requires session on /map /schedule`}
          </pre>
        </div>

        <div>
          <h2 className="font-display text-xl font-semibold">
            Salt Morning / portal deep-link
          </h2>
          <p className="mt-2 text-ink-800">
            Existing teacher portals can deep-link or iframe CurricuMap:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-ink-900 p-4 text-xs text-moss-100">
{`# Embed schedule for a teacher/class
${scheduleEmbed}

# Embed mindmap
${mapEmbed}

# Fetch + generate plans for portal widgets
GET /api/portal/v1/teachers/{teacherId}/classes/{classId}/lessons?date=YYYY-MM-DD&generate=1
Header: x-api-key: $PORTAL_API_KEY`}
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
