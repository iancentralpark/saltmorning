"use client";

import { useEffect, useState } from "react";
import { writeOrg } from "@/lib/org/client";

type SessionInfo = {
  orgCode: string;
  role: string;
  orgName?: string;
  provider?: string;
  email?: string | null;
  displayName?: string | null;
};

type OrgOption = { code: string; name: string };

type OAuthFlags = { google?: boolean; microsoft?: boolean };

export function DemoAuth() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [oauth, setOauth] = useState<OAuthFlags>({});
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function refresh() {
    const [me, loginMeta] = await Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/auth/demo-login").then((r) => r.json()),
    ]);
    setSession(me.session || null);
    setOrgs(loginMeta.organizations || []);
    setOauth(me.oauth || loginMeta.oauth || {});
    setDemoEnabled(loginMeta.demoLoginEnabled !== false);
    if (me.session?.orgCode) {
      writeOrg(me.session.orgCode, true);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function login(orgCode: string) {
    setBusy(true);
    try {
      await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgCode, role: "teacher" }),
      });
      writeOrg(orgCode);
      await refresh();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      writeOrg("all");
      setSession(null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    const label =
      session.displayName ||
      session.email ||
      session.orgName ||
      session.orgCode;
    return (
      <div className="hidden items-center gap-1.5 sm:flex">
        <span
          className="max-w-[10rem] truncate text-[11px] font-semibold text-moss-700"
          title={session.email || session.orgCode}
        >
          {label}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void logout()}
          className="rounded-md px-2 py-1 text-[11px] font-semibold text-ink-700 hover:bg-moss-100 disabled:opacity-50"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className="relative hidden items-center gap-1.5 sm:flex">
      {oauth.google && (
        <a
          href="/api/auth/google/start"
          className="rounded-md border border-ink-900/15 bg-white/90 px-2 py-1.5 text-[11px] font-semibold text-ink-800 hover:bg-moss-100"
        >
          Google
        </a>
      )}
      {oauth.microsoft && (
        <a
          href="/api/auth/microsoft/start"
          className="rounded-md border border-ink-900/15 bg-white/90 px-2 py-1.5 text-[11px] font-semibold text-ink-800 hover:bg-moss-100"
        >
          Microsoft
        </a>
      )}
      {demoEnabled && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-ink-900/15 bg-white/90 px-2 py-1.5 text-[11px] font-semibold text-ink-800 hover:bg-moss-100"
          >
            Demo login
          </button>
          {open && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] border border-ink-900/10 bg-sand-50 p-2 shadow-sm">
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-700/60">
                Sign in as org
              </p>
              {orgs.map((o) => (
                <button
                  key={o.code}
                  type="button"
                  disabled={busy}
                  onClick={() => void login(o.code)}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs font-medium text-ink-800 hover:bg-moss-100 disabled:opacity-50"
                >
                  {o.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
