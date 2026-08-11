"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { MapNodeData } from "@/lib/curriculum/layout-tree";
import { cn } from "@/lib/utils";

type CurriculumFlowNode = Node<MapNodeData, "curriculum">;

const accent: Record<string, string> = {
  ROOT: "bg-ink-900 text-white",
  GRADE: "bg-moss-700 text-white",
  DOMAIN: "bg-moss-100 text-moss-700",
  CONCEPT: "bg-sand-100 text-ink-800",
  SKILL: "bg-white text-ink-900 ring-1 ring-coral-500/40",
  CUSTOM: "bg-sand-200 text-ink-800",
};

export function CurriculumNodeView({
  data,
  selected,
}: NodeProps<CurriculumFlowNode>) {
  const vertical = data.orientation === "vertical";

  return (
    <div
      className={cn(
        "min-w-[180px] max-w-[220px] rounded-md px-3 py-2 shadow-sm transition",
        accent[data.nodeType] || "bg-white",
        selected && "animate-pulse-soft ring-2 ring-coral-500",
        data.nodeType === "SKILL" && "cursor-pointer"
      )}
    >
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        className="!h-2 !w-2 !bg-moss-400"
      />
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
        {data.nodeType}
        {data.code ? ` · ${data.code}` : ""}
      </p>
      <p className="mt-0.5 text-sm font-semibold leading-snug">{data.label}</p>
      {data.hasChildren && (
        <p className="mt-1 text-[10px] opacity-60">click to expand</p>
      )}
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        className="!h-2 !w-2 !bg-moss-400"
      />
    </div>
  );
}
