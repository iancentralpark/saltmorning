"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CurriculumNode, FrameworkSummary } from "@/lib/types";
import {
  buildVisibleGraph,
  defaultExpanded,
  type MapNodeData,
} from "@/lib/curriculum/layout-tree";
import { CurriculumNodeView } from "./CurriculumNodeView";
import { SkillDrawer } from "./SkillDrawer";

const nodeTypes = { curriculum: CurriculumNodeView };

type Props = {
  initialFramework?: string;
};

export function CurriculumMindmap({ initialFramework }: Props) {
  const [frameworks, setFrameworks] = useState<FrameworkSummary[]>([]);
  const [code, setCode] = useState(initialFramework || "");
  const [root, setRoot] = useState<CurriculumNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MapNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/frameworks")
      .then((r) => r.json())
      .then((data) => {
        setFrameworks(data.frameworks);
        if (!code && data.frameworks[0]) {
          setCode(data.frameworks[0].code);
        }
      });
  }, [code]);

  useEffect(() => {
    if (!code) return;
    setError(null);
    fetch(`/api/frameworks/${encodeURIComponent(code)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Framework not found");
        return r.json();
      })
      .then((data) => {
        setRoot(data.tree);
        setExpanded(defaultExpanded(data.tree, "4"));
        setFocusId(null);
        setDrawerId(null);
      })
      .catch((e) => setError(e.message));
  }, [code]);

  useEffect(() => {
    if (!root) return;
    const g = buildVisibleGraph(root, expanded, focusId);
    setNodes(g.nodes);
    setEdges(g.edges);
  }, [root, expanded, focusId, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<MapNodeData>) => {
      setFocusId(node.id);
      const raw = node.data.raw;
      if (raw.nodeType === "SKILL") {
        setDrawerId(node.id);
        return;
      }
      if (raw.children.length > 0) {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) {
            // collapse: remove this and descendants
            const remove = (n: CurriculumNode) => {
              next.delete(n.id);
              n.children.forEach(remove);
            };
            raw.children.forEach(remove);
            next.delete(node.id);
          } else {
            next.add(node.id);
          }
          return next;
        });
      }
    },
    []
  );

  const legend = useMemo(
    () => ["GRADE", "DOMAIN", "CONCEPT", "SKILL", "CUSTOM"],
    []
  );

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-900/10 bg-white/50 px-4 py-3 sm:px-6">
        <label className="text-sm font-medium text-ink-800">
          Framework
          <select
            className="ml-2 rounded-md border border-ink-900/15 bg-white px-2 py-1.5 text-sm"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          >
            {frameworks.map((f) => (
              <option key={f.code} value={f.code}>
                {f.nameKo || f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2 text-[11px] text-ink-700/70">
          {legend.map((t) => (
            <span key={t} className="rounded bg-moss-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-moss-700">
              {t}
            </span>
          ))}
        </div>
        {error && <p className="text-sm text-coral-600">{error}</p>}
      </div>

      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={1.6}
        >
          <Background gap={22} color="#c5dccb" />
          <Controls />
          <MiniMap
            nodeColor={(n) =>
              n.data?.nodeType === "SKILL" ? "#d4654a" : "#3a6f4e"
            }
            maskColor="rgba(243,247,244,0.75)"
          />
        </ReactFlow>
      </div>

      <SkillDrawer nodeId={drawerId} onClose={() => setDrawerId(null)} />
    </div>
  );
}
