"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowDownUp, ArrowRightLeft } from "lucide-react";
import type { CurriculumNode, FrameworkSummary } from "@/lib/types";
import {
  buildVisibleGraph,
  defaultExpanded,
  type LayoutOrientation,
  type MapNodeData,
} from "@/lib/curriculum/layout-tree";
import { subscribeSkillOpen } from "@/lib/curriculum/selection-bus";
import { CurriculumNodeView } from "./CurriculumNodeView";
import { SkillDrawer } from "./SkillDrawer";

const nodeTypes = { curriculum: CurriculumNodeView };

type Props = {
  initialFramework?: string;
};

function MindmapCanvas({ initialFramework }: Props) {
  const { fitView } = useReactFlow();
  const [frameworks, setFrameworks] = useState<FrameworkSummary[]>([]);
  const [code, setCode] = useState(initialFramework || "");
  const [gradeLevel, setGradeLevel] = useState("4");
  const [orientation, setOrientation] =
    useState<LayoutOrientation>("horizontal");
  const [root, setRoot] = useState<CurriculumNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MapNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [error, setError] = useState<string | null>(null);
  const skipFitRef = useRef(false);
  const [subject, setSubject] = useState<string | null>(null);

  useEffect(() => {
    return subscribeSkillOpen((nodeId) => {
      setFocusId(nodeId);
      setDrawerId(nodeId);
    });
  }, []);

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
        const grades: string[] = data.framework.gradeLevels || [];
        const nextGrade = grades.includes("4")
          ? "4"
          : grades[0] || "4";
        setRoot(data.tree);
        setSubject(data.framework.subject || null);
        setGradeLevel(nextGrade);
        setExpanded(defaultExpanded(data.tree, nextGrade));
        setFocusId(null);
        setDrawerId(null);
      })
      .catch((e) => setError(e.message));
  }, [code]);

  const prevGrade = useRef(gradeLevel);
  useEffect(() => {
    if (!root) return;
    if (prevGrade.current === gradeLevel) return;
    prevGrade.current = gradeLevel;
    setExpanded(defaultExpanded(root, gradeLevel));
    setFocusId(null);
    setDrawerId(null);
  }, [gradeLevel, root]);

  useEffect(() => {
    if (!root) return;
    const g = buildVisibleGraph(root, expanded, focusId, orientation, subject);
    setNodes(g.nodes);
    setEdges(g.edges);
    if (skipFitRef.current) {
      skipFitRef.current = false;
      return;
    }
    requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 220 });
    });
  }, [root, expanded, focusId, orientation, subject, setNodes, setEdges, fitView]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<MapNodeData>) => {
      const raw = node.data.raw;
      if (raw.nodeType === "SKILL") {
        skipFitRef.current = true;
        setFocusId(node.id);
        setDrawerId(node.id);
        return;
      }
      setFocusId(node.id);
      if (raw.children.length > 0) {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) {
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

  const activeFramework = frameworks.find((f) => f.code === code);
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
                {f.subject === "KOREAN_LANGUAGE" || f.subject === "KOREAN_HISTORY"
                  ? f.nameKo || f.name
                  : f.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-ink-800">
          Grade
          <select
            className="ml-2 rounded-md border border-ink-900/15 bg-white px-2 py-1.5 text-sm"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
          >
            {(activeFramework?.gradeLevels || ["4"]).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1 rounded-md border border-ink-900/15 bg-white p-0.5">
          <button
            type="button"
            title="Horizontal layout"
            onClick={() => setOrientation("horizontal")}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition ${
              orientation === "horizontal"
                ? "bg-moss-700 text-white"
                : "text-ink-700 hover:bg-moss-100"
            }`}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" /> Horizontal
          </button>
          <button
            type="button"
            title="Vertical layout"
            onClick={() => setOrientation("vertical")}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition ${
              orientation === "vertical"
                ? "bg-moss-700 text-white"
                : "text-ink-700 hover:bg-moss-100"
            }`}
          >
            <ArrowDownUp className="h-3.5 w-3.5" /> Vertical
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] text-ink-700/70">
          {legend.map((t) => (
            <span
              key={t}
              className="rounded bg-moss-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-moss-700"
            >
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
          nodesDraggable={false}
          elementsSelectable
        >
          <Background gap={22} color="#c5dccb" />
          <Controls />
          <MiniMap
            nodeColor={(n) =>
              (n.data as MapNodeData | undefined)?.nodeType === "SKILL"
                ? "#d4654a"
                : "#3a6f4e"
            }
            maskColor="rgba(243,247,244,0.75)"
          />
        </ReactFlow>
      </div>

      <SkillDrawer nodeId={drawerId} onClose={() => setDrawerId(null)} />
    </div>
  );
}

export function CurriculumMindmap(props: Props) {
  return (
    <ReactFlowProvider>
      <MindmapCanvas {...props} />
    </ReactFlowProvider>
  );
}
