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

export function OrgSwitcher() {
  const [org, setOrg] = useState<OrgFilter>("all");
  const [orgs, setOrgs] = useState<Org[]>([]);

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

  const options: { code: OrgFilter; name: string }[] = [
    { code: "all", name: "All orgs" },
    { code: "public", name: "Public catalog" },
    ...orgs
      .filter((o) => o.code && o.code !== "public")
      .map((o) => ({ code: o.code!, name: o.name })),
  ];

  return (
    <label className="hidden items-center gap-1.5 text-xs font-medium text-ink-700 sm:flex">
      <span className="sr-only">Organization</span>
      <select
        aria-label="Organization filter"
        className="max-w-[11rem] rounded-md border border-ink-900/15 bg-white/90 px-2 py-1.5 text-xs font-semibold text-ink-800"
        value={org}
        onChange={(e) => {
          const next = e.target.value;
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
