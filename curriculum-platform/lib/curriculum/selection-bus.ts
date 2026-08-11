type SkillOpenListener = (nodeId: string) => void;

const listeners = new Set<SkillOpenListener>();

/** Decouple React Flow custom-node clicks from parent re-renders. */
export function subscribeSkillOpen(listener: SkillOpenListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openSkillNode(nodeId: string) {
  for (const listener of listeners) listener(nodeId);
}
