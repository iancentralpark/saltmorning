"use client";

import { useEffect } from "react";

/** Hide chrome when opened from Salt Morning iframe / deep-link. */
export function EmbedMode() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") === "1") {
      document.documentElement.dataset.embed = "1";
    }
  }, []);
  return null;
}
