/** Client-side org filter preference (localStorage + URL). */

export const ORG_STORAGE_KEY = "curricumap.org";
export const ORG_EVENT = "curricumap:org";

export type OrgFilter = string; // "all" | "public" | org code

export function readOrgFromLocation(): OrgFilter | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("org");
  return q && q.trim() ? q.trim() : null;
}

export function readStoredOrg(): OrgFilter {
  if (typeof window === "undefined") return "all";
  const fromUrl = readOrgFromLocation();
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(ORG_STORAGE_KEY) || "all";
  } catch {
    return "all";
  }
}

export function writeOrg(org: OrgFilter, syncUrl = true) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ORG_STORAGE_KEY, org);
  } catch {
    // ignore
  }
  if (syncUrl) {
    const u = new URL(window.location.href);
    if (!org || org === "all") u.searchParams.delete("org");
    else u.searchParams.set("org", org);
    window.history.replaceState({}, "", u.pathname + u.search + u.hash);
  }
  window.dispatchEvent(
    new CustomEvent(ORG_EVENT, { detail: { org } })
  );
}

export function frameworksQuery(org: OrgFilter) {
  if (!org || org === "all") return "";
  return `?org=${encodeURIComponent(org)}`;
}
