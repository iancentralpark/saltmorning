"use client";

import { useEffect, useState } from "react";
import { X, FileText, Sparkles, Loader2 } from "lucide-react";
import type { AiMaterial, CurriculumNode } from "@/lib/types";
import {
  masteryDisplay,
  nodeDisplayTitle,
  objectiveDisplayStatement,
  usesKoreanContent,
} from "@/lib/i18n/content-locale";

type Props = {
  nodeId: string | null;
  onClose: () => void;
};

type DrawerNode = Omit<CurriculumNode, "children"> & { childCount?: number };

type MaterialContent = {
  locale?: string;
  provider?: string;
  standardCode?: string | null;
  objective?: string;
  masteryCriteria?: string | null;
  items?: unknown;
};

function MaterialPreview({ material }: { material: AiMaterial }) {
  const content = (material.contentJson || {}) as MaterialContent;
  const items = Array.isArray(content.items) ? content.items : [];
  const typeLabel = material.type.replaceAll("_", " ");

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-ink-900/10 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink-900">{material.title}</p>
        <p className="text-[10px] uppercase tracking-wide text-ink-700/55">
          {content.provider || material.model || "ai"}
        </p>
      </div>

      {content.objective && (
        <div className="rounded-md bg-moss-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-moss-700">
            Objective
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-800">{content.objective}</p>
          {content.masteryCriteria && (
            <p className="mt-1 text-[11px] text-ink-700/65">
              Mastery: {content.masteryCriteria}
            </p>
          )}
        </div>
      )}

      <ol className="space-y-2.5">
        {items.length === 0 && (
          <li className="text-sm text-ink-700/60">No items generated.</li>
        )}
        {items.map((raw, i) => {
          const item = (raw && typeof raw === "object" ? raw : { text: String(raw) }) as Record<
            string,
            unknown
          >;
          const q =
            (typeof item.q === "string" && item.q) ||
            (typeof item.question === "string" && item.question) ||
            (typeof item.prompt === "string" && item.prompt) ||
            (typeof item.text === "string" && item.text) ||
            null;
          const a =
            (typeof item.a === "string" && item.a) ||
            (typeof item.answer === "string" && item.answer) ||
            (typeof item.sampleAnswer === "string" && item.sampleAnswer) ||
            null;
          const section = typeof item.section === "string" ? item.section : null;
          const count =
            typeof item.count === "number"
              ? item.count
              : typeof item.items === "number"
                ? item.items
                : null;

          return (
            <li
              key={i}
              className="rounded-md border border-ink-900/8 bg-sand-50/80 px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-moss-700 px-1 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  {section && (
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-coral-600">
                      {section}
                    </p>
                  )}
                  {q && <p className="text-sm leading-snug text-ink-900">{q}</p>}
                  {!q && !section && (
                    <p className="text-sm text-ink-800">{JSON.stringify(item)}</p>
                  )}
                  {count != null && (
                    <p className="text-xs text-ink-700/70">{count} item{count === 1 ? "" : "s"}</p>
                  )}
                  {a && (
                    <p className="rounded bg-white/80 px-2 py-1 text-xs text-ink-700/80">
                      <span className="font-semibold text-moss-700">Answer · </span>
                      {a}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-[10px] text-ink-700/45">
        {typeLabel}
        {content.standardCode ? ` · ${content.standardCode}` : ""}
      </p>
    </div>
  );
}

export function SkillDrawer({ nodeId, onClose }: Props) {
  const [node, setNode] = useState<DrawerNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [material, setMaterial] = useState<AiMaterial | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeId) {
      setNode(null);
      setMaterial(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMaterial(null);
    fetch(`/api/nodes/${encodeURIComponent(nodeId)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load skill");
        return data;
      })
      .then((data) => {
        if (!cancelled) setNode(data.node);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load skill");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodeId, onClose]);

  if (!nodeId) return null;

  const localeOpts = {
    frameworkCode: node?.frameworkCode,
  };
  const title = node
    ? nodeDisplayTitle(node, localeOpts)
    : loading
      ? "Loading…"
      : "Skill";

  async function generate(type: string) {
    setGenerating(type);
    setError(null);
    try {
      const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId!)}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generate failed");
      setMaterial(data.material);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenerating(null);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close drawer overlay"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 80,
          border: "none",
          background: "rgba(15, 28, 23, 0.28)",
          backdropFilter: "blur(1px)",
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Skill details"
        className="animate-drawer"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 90,
          width: "min(100vw, 28rem)",
          display: "flex",
          flexDirection: "column",
          background: "#faf8f4",
          borderLeft: "1px solid rgba(15, 28, 23, 0.12)",
          boxShadow: "0 18px 50px -24px rgba(15, 28, 23, 0.45)",
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-900/10 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-moss-700">
              Skill node
              {node && usesKoreanContent(null, node.frameworkCode) ? " · KO" : " · EN"}
            </p>
            <h2 className="font-display text-xl font-semibold text-ink-900">{title}</h2>
            {node?.code && (
              <p className="mt-1 font-mono text-sm text-coral-600">{node.code}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-700 hover:bg-moss-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-ink-700">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
          {error && <p className="text-sm text-coral-600">{error}</p>}

          {node && (
            <>
              {node.summary && (
                <p className="text-sm leading-relaxed text-ink-800/90">{node.summary}</p>
              )}

              <section>
                <h3 className="font-display text-base font-semibold text-ink-900">
                  Learning objectives
                </h3>
                <ul className="mt-2 space-y-3">
                  {node.objectives.length === 0 && (
                    <li className="text-sm text-ink-700/60">No objectives on this node.</li>
                  )}
                  {node.objectives.map((o) => {
                    const mastery = masteryDisplay(o, localeOpts);
                    return (
                      <li key={o.id} className="border-l-2 border-moss-400 pl-3">
                        {o.code && (
                          <p className="font-mono text-xs text-moss-700">{o.code}</p>
                        )}
                        <p className="text-sm text-ink-900">
                          {objectiveDisplayStatement(o, localeOpts)}
                        </p>
                        {mastery && (
                          <p className="mt-1 text-xs text-ink-700/70">Mastery: {mastery}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section>
                <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
                  <FileText className="h-4 w-4 text-moss-600" /> Resource library
                </h3>
                <ul className="mt-2 space-y-2">
                  {node.resources.length === 0 && (
                    <li className="text-sm text-ink-700/60">No resources yet.</li>
                  )}
                  {node.resources.map((r) => (
                    <li key={r.id} className="text-sm">
                      <span className="mr-2 text-xs uppercase text-moss-700">{r.type}</span>
                      {r.url ? (
                        <a
                          href={r.url}
                          className="font-medium text-ink-900 underline-offset-2 hover:underline"
                        >
                          {r.title}
                        </a>
                      ) : (
                        <span className="font-medium text-ink-900">{r.title}</span>
                      )}
                      {r.description && (
                        <p className="text-xs text-ink-700/65">{r.description}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
                  <Sparkles className="h-4 w-4 text-coral-500" /> AI material generator
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["DAILY_QUIZ", "FORMATIVE_TEST", "WORKSHEET", "EXIT_TICKET"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={!!generating}
                      onClick={() => generate(t)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                        generating === t
                          ? "border-moss-500 bg-moss-700 text-white"
                          : material?.type === t
                            ? "border-moss-500 bg-moss-50 text-moss-800"
                            : "border-ink-900/15 bg-white text-ink-800 hover:border-moss-500 hover:text-moss-700"
                      }`}
                    >
                      {generating === t ? "Generating…" : t.replaceAll("_", " ")}
                    </button>
                  ))}
                </div>
                {material && <MaterialPreview material={material} />}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
