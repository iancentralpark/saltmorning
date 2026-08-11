"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { FrameworkSummary } from "@/lib/types";
import {
  frameworkDisplayName,
  usesKoreanContent,
} from "@/lib/i18n/content-locale";
import {
  ORG_EVENT,
  frameworksQuery,
  readStoredOrg,
  writeOrg,
  type OrgFilter,
} from "@/lib/org/client";

type Org = {
  code: string | null;
  name: string;
  frameworkCount?: number;
};

export function FrameworkCatalog() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [org, setOrg] = useState<OrgFilter>("all");
  const [frameworks, setFrameworks] = useState<FrameworkSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrg(readStoredOrg());
    fetch("/api/organizations")
      .then((r) => r.json())
      .then((d) => setOrgs(d.organizations || []))
      .catch(() => setOrgs([]));

    const onOrg = (e: Event) => {
      const detail = (e as CustomEvent<{ org: OrgFilter }>).detail;
      if (detail?.org) setOrg(detail.org);
    };
    window.addEventListener(ORG_EVENT, onOrg);
    return () => window.removeEventListener(ORG_EVENT, onOrg);
  }, []);

  useEffect(() => {
    const q = frameworksQuery(org);
    fetch(`/api/frameworks${q}`)
      .then((r) => r.json())
      .then((d) => setFrameworks(d.frameworks || []))
      .catch(() => setError("Failed to load frameworks"));
  }, [org]);

  const chips = useMemo(
    () => [
      { code: "all", name: "All orgs" },
      { code: "public", name: "Public catalog" },
      ...orgs
        .filter((o) => o.code && o.code !== "public")
        .map((o) => ({ code: o.code!, name: o.name })),
    ],
    [orgs]
  );

  function selectOrg(code: OrgFilter) {
    setOrg(code);
    writeOrg(code);
  }

  return (
    <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
      <h2 className="font-display text-2xl font-semibold text-ink-900">
        Loaded frameworks
      </h2>
      <p className="mt-1 text-sm text-ink-700/75">
        Filter by organization — public standards plus school-private packs.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => selectOrg(c.code)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              org === c.code
                ? "bg-moss-700 text-white"
                : "border border-ink-900/15 bg-white/70 text-ink-800 hover:bg-moss-100"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-coral-600">{error}</p>}

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {frameworks.map((fw, i) => (
          <li
            key={fw.code}
            className="animate-rise border-l-4 border-moss-500 bg-white/60 px-5 py-4"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-xl font-semibold text-ink-900">
                  {frameworkDisplayName(fw)}
                </p>
                {usesKoreanContent(fw.subject, fw.code) && (
                  <p className="mt-1 text-sm text-ink-700/80">{fw.name}</p>
                )}
                {!usesKoreanContent(fw.subject, fw.code) && fw.nameKo && (
                  <p className="mt-1 text-sm text-ink-700/60">{fw.nameKo}</p>
                )}
              </div>
              <div className="text-right">
                <span className="block text-xs uppercase tracking-wide text-moss-700">
                  {fw.regionStandard}
                </span>
                {fw.organizationCode && (
                  <span className="mt-1 block text-[10px] font-semibold uppercase text-coral-600">
                    {fw.isPublic === false ? "private · " : ""}
                    {fw.organizationCode}
                  </span>
                )}
              </div>
            </div>
            <p className="mt-3 text-sm text-ink-700/70">
              Grades {fw.gradeLevels.join(", ") || "—"} · {fw.skillCount} skills
            </p>
            <Link
              href={`/map?framework=${fw.code}${
                org && org !== "all" ? `&org=${encodeURIComponent(org)}` : ""
              }`}
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-moss-700 hover:text-moss-600"
            >
              Explore <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </li>
        ))}
      </ul>
      {frameworks.length === 0 && !error && (
        <p className="mt-6 text-sm text-ink-700/60">
          No frameworks for this organization filter.
        </p>
      )}
    </section>
  );
}
