import type { CurriculumNode, NodeType } from "@/lib/types";
import type { Edge, Node } from "@xyflow/react";

const TYPE_COLOR: Record<NodeType, string> = {
  ROOT: "#152820",
  GRADE: "#2f5840",
  DOMAIN: "#3a6f4e",
  CONCEPT: "#4d8a63",
  SKILL: "#d4654a",
  CUSTOM: "#8a6a3d",
};

export type MapNodeData = {
  label: string;
  sublabel?: string;
  nodeType: NodeType;
  code?: string | null;
  hasChildren: boolean;
  raw: CurriculumNode;
};

const COL_GAP = 260;
const ROW_GAP = 88;

/**
 * Visible subtree layout: show ancestors path + siblings at each level + children of focus.
 * Horizontal: depth left→right. Vertical: siblings stacked.
 */
export function buildVisibleGraph(
  root: CurriculumNode,
  expandedIds: Set<string>,
  focusId: string | null
): { nodes: Node<MapNodeData>[]; edges: Edge[] } {
  const nodes: Node<MapNodeData>[] = [];
  const edges: Edge[] = [];

  type Laid = { node: CurriculumNode; depth: number; index: number; parentId: string | null };
  const laid: Laid[] = [];

  const visit = (
    node: CurriculumNode,
    depth: number,
    parentId: string | null,
    siblingIndex: number
  ) => {
    laid.push({ node, depth, index: siblingIndex, parentId });
    if (!expandedIds.has(node.id) && node.id !== root.id) return;
    // Always expand root if in set
    if (node.id === root.id || expandedIds.has(node.id)) {
      node.children.forEach((child, i) => visit(child, depth + 1, node.id, i));
    }
  };

  // Root always visible; expand according to set
  const expandRoot = new Set(expandedIds);
  expandRoot.add(root.id);
  visit(root, 0, null, 0);

  // Re-layout with column packing
  const columns = new Map<number, Laid[]>();
  for (const item of laid) {
    const col = columns.get(item.depth) || [];
    col.push(item);
    columns.set(item.depth, col);
  }

  for (const [depth, items] of columns) {
    items.forEach((item, row) => {
      const label = item.node.titleKo || item.node.title;
      const sub =
        item.node.code ||
        (item.node.nodeType === "GRADE"
          ? `Grade ${item.node.gradeLevel}`
          : item.node.nodeType);

      nodes.push({
        id: item.node.id,
        type: "curriculum",
        position: { x: depth * COL_GAP, y: row * ROW_GAP },
        data: {
          label: label.length > 42 ? `${label.slice(0, 40)}…` : label,
          sublabel: sub || undefined,
          nodeType: item.node.nodeType,
          code: item.node.code,
          hasChildren: item.node.children.length > 0,
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

export function defaultExpanded(root: CurriculumNode, gradeLevel = "4"): Set<string> {
  const ids = new Set<string>([root.id]);
  const grade = root.children.find(
    (c) => c.nodeType === "GRADE" && c.gradeLevel === gradeLevel
  );
  if (grade) {
    ids.add(grade.id);
    // Expand first domain for a useful first view
    const domain = grade.children[0];
    if (domain) {
      ids.add(domain.id);
      const concept = domain.children[0];
      if (concept) ids.add(concept.id);
    }
  }
  return ids;
}
