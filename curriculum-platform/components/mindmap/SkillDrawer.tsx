"use client";

import { useEffect, useState } from "react";
import { X, FileText, Sparkles, Loader2 } from "lucide-react";
import type { AiMaterial, CurriculumNode } from "@/lib/types";

type Props = {
  nodeId: string | null;
  onClose: () => void;
};

export function SkillDrawer({ nodeId, onClose }: Props) {
  const [node, setNode] = useState<Omit<CurriculumNode, "children"> | null>(null);
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
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setNode(data.node);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load skill");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  if (!nodeId) return null;

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
        className="fixed inset-0 z-40 bg-ink-950/25 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="animate-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-ink-900/10 bg-sand-50 shadow-panel">
        <div className="flex items-start justify-between gap-3 border-b border-ink-900/10 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-moss-700">
              Skill node
            </p>
            <h2 className="font-display text-xl font-semibold text-ink-900">
              {node?.titleKo || node?.title || "Loading…"}
            </h2>
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
                  {node.objectives.map((o) => (
                    <li key={o.id} className="border-l-2 border-moss-400 pl-3">
                      {o.code && (
                        <p className="font-mono text-xs text-moss-700">{o.code}</p>
                      )}
                      <p className="text-sm text-ink-900">
                        {o.statementKo || o.statement}
                      </p>
                      {(o.masteryCriteriaKo || o.masteryCriteria) && (
                        <p className="mt-1 text-xs text-ink-700/70">
                          Mastery: {o.masteryCriteriaKo || o.masteryCriteria}
                        </p>
                      )}
                    </li>
                  ))}
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
                        <a href={r.url} className="font-medium text-ink-900 underline-offset-2 hover:underline">
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
                      className="rounded-md border border-ink-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink-800 transition hover:border-moss-500 hover:text-moss-700 disabled:opacity-50"
                    >
                      {generating === t ? "Generating…" : t.replaceAll("_", " ")}
                    </button>
                  ))}
                </div>
                {material && (
                  <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-ink-900 p-3 text-xs text-moss-100">
                    {JSON.stringify(material.contentJson, null, 2)}
                  </pre>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
