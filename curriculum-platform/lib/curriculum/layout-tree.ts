import type { CurriculumNode, NodeType } from "@/lib/types";
import type { Edge, Node } from "@xyflow/react";
import { nodeDisplayTitle } from "@/lib/i18n/content-locale";

const TYPE_COLOR: Record<NodeType, string> = {
  ROOT: "#152820",
  GRADE: "#2f5840",
  DOMAIN: "#3a6f4e",
  CONCEPT: "#4d8a63",
  SKILL: "#d4654a",
  CUSTOM: "#8a6a3d",
};

export type LayoutOrientation = "horizontal" | "vertical";

export type MapNodeData = {
  label: string;
  sublabel?: string;
  nodeType: NodeType;
  code?: string | null;
  hasChildren: boolean;
  orientation: LayoutOrientation;
  raw: CurriculumNode;
};

const MAJOR_GAP = 260;
const MINOR_GAP = 88;

/**
 * Visible subtree layout for drill-down.
 * horizontal: depth left→right, siblings stacked vertically
 * vertical: depth top→bottom, siblings stacked horizontally
 */
export function buildVisibleGraph(
  root: CurriculumNode,
  expandedIds: Set<string>,
  focusId: string | null,
  orientation: LayoutOrientation = "horizontal",
  subject?: string | null
): { nodes: Node<MapNodeData>[]; edges: Edge[] } {
  const nodes: Node<MapNodeData>[] = [];
  const edges: Edge[] = [];

  type Laid = {
    node: CurriculumNode;
    depth: number;
    parentId: string | null;
  };
  const laid: Laid[] = [];

  const visit = (
    node: CurriculumNode,
    depth: number,
    parentId: string | null
  ) => {
    laid.push({ node, depth, parentId });
    const isExpanded = node.id === root.id || expandedIds.has(node.id);
    if (!isExpanded) return;
    for (const child of node.children) {
      visit(child, depth + 1, node.id);
    }
  };

  visit(root, 0, null);

  const columns = new Map<number, Laid[]>();
  for (const item of laid) {
    const col = columns.get(item.depth) || [];
    col.push(item);
    columns.set(item.depth, col);
  }

  for (const [depth, items] of columns) {
    items.forEach((item, row) => {
      const label = nodeDisplayTitle(item.node, {
        subject,
        frameworkCode: item.node.frameworkCode,
      });
      const sub =
        item.node.code ||
        (item.node.nodeType === "GRADE"
          ? `Grade ${item.node.gradeLevel}`
          : item.node.nodeType);

      const x =
        orientation === "horizontal" ? depth * MAJOR_GAP : row * MAJOR_GAP;
      const y =
        orientation === "horizontal" ? row * MINOR_GAP : depth * MINOR_GAP;

      nodes.push({
        id: item.node.id,
        type: "curriculum",
        position: { x, y },
        data: {
          label: label.length > 42 ? `${label.slice(0, 40)}…` : label,
          sublabel: sub || undefined,
          nodeType: item.node.nodeType,
          code: item.node.code,
          hasChildren: item.node.children.length > 0,
          orientation,
          raw: item.node,
        },
        style: {
          borderColor: TYPE_COLOR[item.node.nodeType],
        },
      });

      if (item.parentId) {
        edges.push({
          id: `${item.parentId}->${item.node.id}`,
          source: item.parentId,
          target: item.node.id,
          type: "smoothstep",
          animated: focusId === item.node.id,
          style: { stroke: "#6fa882", strokeWidth: 1.5 },
        });
      }
    });
  }

  return { nodes, edges };
}

export function defaultExpanded(
  root: CurriculumNode,
  gradeLevel = "4"
): Set<string> {
  const ids = new Set<string>([root.id]);
  const grade = root.children.find(
    (c) => c.nodeType === "GRADE" && c.gradeLevel === gradeLevel
  );
  if (grade) {
    ids.add(grade.id);
    const domain = grade.children[0];
    if (domain) {
      ids.add(domain.id);
      const concept = domain.children[0];
      if (concept) ids.add(concept.id);
    }
  }
  return ids;
}
