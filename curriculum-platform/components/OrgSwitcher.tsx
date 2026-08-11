"use client";

import { useEffect, useState } from "react";
import {
  ORG_EVENT,
  readStoredOrg,
  writeOrg,
  type OrgFilter,
} from "@/lib/org/client";

type Org = {
  code: string | null;
  name: string;
};

type SessionInfo = {
  orgCode: string;
  role: string;
};

export function OrgSwitcher() {
  const [org, setOrg] = useState<OrgFilter>("all");
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    setOrg(readStoredOrg());
    fetch("/api/organizations")
      .then((r) => r.json())
      .then((d) => setOrgs(d.organizations || []))
      .catch(() => setOrgs([]));

    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.session) {
          setSession(d.session);
          setOrg(d.session.orgCode);
          writeOrg(d.session.orgCode);
        }
      })
      .catch(() => setSession(null));

    const onOrg = (e: Event) => {
      const detail = (e as CustomEvent<{ org: OrgFilter }>).detail;
      if (detail?.org) setOrg(detail.org);
    };
    window.addEventListener(ORG_EVENT, onOrg);
    return () => window.removeEventListener(ORG_EVENT, onOrg);
  }, []);

  const locked = Boolean(session && session.role !== "admin");

  const options: { code: OrgFilter; name: string }[] = locked
    ? [
        {
          code: session!.orgCode,
          name:
            orgs.find((o) => o.code === session!.orgCode)?.name ||
            session!.orgCode,
        },
        { code: "public", name: "Public catalog" },
      ]
    : [
        { code: "all", name: "All orgs" },
        { code: "public", name: "Public catalog" },
        ...orgs
          .filter((o) => o.code && o.code !== "public")
          .map((o) => ({ code: o.code!, name: o.name })),
      ];

  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-ink-700">
      <span className="sr-only">Organization</span>
      <select
        aria-label="Organization filter"
        className="max-w-[9rem] rounded-md border border-ink-900/15 bg-white/90 px-2 py-1.5 text-xs font-semibold text-ink-800 disabled:opacity-70 sm:max-w-[11rem]"
        value={org}
        disabled={locked && options.length <= 1}
        onChange={(e) => {
          const next = e.target.value;
          if (locked && next !== session?.orgCode && next !== "public") return;
          setOrg(next);
          writeOrg(next);
        }}
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
