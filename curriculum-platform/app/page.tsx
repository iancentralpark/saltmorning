import Link from "next/link";
import { FrameworkCatalog } from "@/components/FrameworkCatalog";
import { AuthBanner } from "@/components/AuthBanner";
import { ArrowRight, GitBranch, CalendarRange, Plug } from "lucide-react";

export default function HomePage() {
  return (
    <div>
      <AuthBanner />
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%233a6f4e' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <p className="animate-rise font-display text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl md:text-7xl">
            CurricuMap
          </p>
          <h1
            className="animate-rise mt-4 max-w-2xl text-xl text-ink-800/90 sm:text-2xl"
            style={{ animationDelay: "80ms" }}
          >
            Map standards into living skill trees, then schedule AI lesson plans onto real instructional days.
          </h1>
          <p
            className="animate-rise mt-4 max-w-xl text-base text-ink-700/80"
            style={{ animationDelay: "140ms" }}
          >
            Framework-agnostic by design — CCSS, NGSS, and Korea 2022 Revised Curriculum in one graph.
          </p>
          <div
            className="animate-rise mt-8 flex flex-wrap gap-3"
            style={{ animationDelay: "200ms" }}
          >
            <Link
              href="/map"
              className="inline-flex items-center gap-2 rounded-md bg-moss-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-moss-600"
            >
              Open mindmap <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/schedule"
              className="inline-flex items-center gap-2 rounded-md border border-ink-900/15 bg-white/70 px-5 py-2.5 text-sm font-semibold text-ink-900 transition hover:bg-white"
            >
              Teacher schedule
            </Link>
          </div>
        </div>
      </section>

      <FrameworkCatalog />

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {[
            {
              icon: GitBranch,
              title: "Interactive mindmap",
              body: "Drill Framework → Grade → Domain → Concept → Skill with a slide-over for objectives and AI materials.",
            },
            {
              icon: CalendarRange,
              title: "Calendar-aware plans",
              body: "Sequence skills into instructional slots, skipping holidays and blackout days automatically.",
            },
            {
              icon: Plug,
              title: "Salt Morning bridge",
              body: "Lesson panel deep-links open mindmap and schedule for your class. See How it connects for details.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="h-5 w-5 text-coral-500" />
              <h3 className="mt-3 font-display text-lg font-semibold text-ink-900">
                {title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-700/75">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
