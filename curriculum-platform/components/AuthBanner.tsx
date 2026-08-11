"use client";

import { useEffect, useState } from "react";

const MESSAGES: Record<string, string> = {
  required: "Sign in to open the mindmap or schedule.",
  denied: "Sign-in was cancelled or denied.",
  error: "Sign-in failed. Try again or use Demo login.",
  "invalid-state": "Sign-in session expired. Start again.",
  "oauth-disabled": "That identity provider is not configured.",
};

export function AuthBanner() {
  const [msg, setMsg] = useState<string | null>(null);
  const [next, setNext] = useState("/map");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const auth = sp.get("auth");
    if (auth && MESSAGES[auth]) {
      const detail = sp.get("error");
      setMsg(detail ? `${MESSAGES[auth]} (${detail})` : MESSAGES[auth]);
    }
    const n = sp.get("next");
    if (n && n.startsWith("/") && !n.startsWith("//")) setNext(n);
  }, []);

  if (!msg) return null;

  return (
    <div className="border-b border-coral-500/30 bg-coral-500/10 px-4 py-2 text-center text-sm text-ink-900 sm:px-6">
      <p className="font-medium">{msg}</p>
      <p className="mt-0.5 text-xs text-ink-700/80">
        Use the header login controls
        {next !== "/map" ? ` — you’ll return to ${next}` : ""}.
      </p>
    </div>
  );
}
