import { create } from "zustand";

// ── Types ──────────────────────────────────────────────

export type ViewKind = "graph" | "timeline" | "chat" | "raw";

export type PanelNode = {
  type: "panel";
  id: string;
  view: ViewKind;
};

export type SplitNode = {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  children: LayoutNode[];
  ratios: number[];
};

export type LayoutNode = PanelNode | SplitNode;

// ── Helpers ────────────────────────────────────────────

let _nextId = 1;
function newId(): string {
  return `p${_nextId++}`;
}

function cloneTree(node: LayoutNode): LayoutNode {
  if (node.type === "panel") return { ...node };
  const s = node;
  return { ...s, children: s.children.map(cloneTree), ratios: [...s.ratios] };
}

function countPanels(node: LayoutNode): number {
  if (node.type === "panel") return 1;
  return node.children.reduce((sum, c) => sum + countPanels(c), 0);
}

function mapNode(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (node.type === "panel") return fn(node);
  const s = node;
  return fn({ ...s, children: s.children.map((c) => mapNode(c, fn)) });
}

function findPanel(node: LayoutNode, id: string): PanelNode | null {
  if (node.type === "panel") return node.id === id ? node : null;
  for (const c of node.children) {
    const found = findPanel(c, id);
    if (found) return found;
  }
  return null;
}

function findSplitContaining(node: LayoutNode, target: LayoutNode): SplitNode | null {
  if (node.type === "panel") return null;
  const s = node;
  if (s.children.includes(target)) return s;
  for (const c of s.children) {
    const found = findSplitContaining(c, target);
    if (found) return found;
  }
  return null;
}

function findSplitById(node: LayoutNode, id: string): SplitNode | null {
  if (node.type === "panel") return null;
  const s = node;
  if (s.id === id) return s;
  for (const c of s.children) {
    const found = findSplitById(c, id);
    if (found) return found;
  }
  return null;
}

// ── Store ──────────────────────────────────────────────

const MAX_PANELS = 4;

interface PanelState {
  root: LayoutNode;
  panelCount: number;

  splitPanel: (panelId: string, direction: "horizontal" | "vertical") => void;
  closePanel: (panelId: string) => void;
  changeView: (panelId: string, view: ViewKind) => void;
  setSplitRatio: (parentSplitId: string, firstChildIdx: number, ratio: number) => void;
  resetLayout: () => void;
}

function initialRoot(): LayoutNode {
  return { type: "panel", id: newId(), view: "graph" };
}

export const usePanelStore = create<PanelState>((set, get) => ({
  root: initialRoot(),
  panelCount: 1,

  splitPanel: (panelId, direction) => {
    const { root } = get();
    if (countPanels(root) >= MAX_PANELS) return;

    const newRoot = cloneTree(root);
    const target = findPanel(newRoot, panelId);
    if (!target) return;

    const newPanel: PanelNode = { type: "panel", id: newId(), view: target.view };
    const parent = findSplitContaining(newRoot, target);

    if (parent && parent.direction === direction) {
      // Same-direction flattening: insert as sibling, recompute equal ratios
      const idx = parent.children.indexOf(target);
      parent.children.splice(idx + 1, 0, newPanel);
      const n = parent.children.length;
      parent.ratios = parent.children.map(() => 1 / n);
    } else {
      // Wrap target + newPanel in a new split node
      const newSplit: SplitNode = {
        type: "split",
        id: newId(),
        direction,
        children: [target, newPanel],
        ratios: [0.5, 0.5],
      };

      if (target === newRoot) {
        set({ root: newSplit, panelCount: countPanels(newSplit) });
        return;
      }

      const grandparent = findSplitContaining(newRoot, target);
      if (grandparent) {
        const idx = grandparent.children.indexOf(target);
        grandparent.children[idx] = newSplit;
      }
    }

    set({ root: newRoot, panelCount: countPanels(newRoot) });
  },

  closePanel: (panelId) => {
    const { root } = get();
    if (countPanels(root) <= 1) return;

    const newRoot = cloneTree(root);
    const target = findPanel(newRoot, panelId);
    if (!target) return;

    const parent = findSplitContaining(newRoot, target);
    if (!parent) return;

    if (parent.children.length > 2) {
      // Remove the child and re-normalize ratios
      const idx = parent.children.indexOf(target);
      parent.children.splice(idx, 1);
      parent.ratios.splice(idx, 1);
      const sum = parent.ratios.reduce((a, b) => a + b, 0);
      parent.ratios = parent.ratios.map((r) => r / sum);
    } else {
      // Two children: collapse -- the surviving sibling takes the parent's slot
      const sibling =
        parent.children[0] === target ? parent.children[1] : parent.children[0];

      if (parent === newRoot) {
        set({ root: sibling, panelCount: countPanels(sibling) });
        return;
      }

      const grandparent = findSplitContaining(newRoot, parent);
      if (grandparent) {
        const idx = grandparent.children.indexOf(parent);
        grandparent.children[idx] = sibling;
      }
    }

    set({ root: newRoot, panelCount: countPanels(newRoot) });
  },

  changeView: (panelId, view) => {
    const { root } = get();
    const newRoot = mapNode(root, (n) => {
      if (n.type === "panel" && n.id === panelId) {
        return { ...n, view };
      }
      return n;
    });
    set({ root: newRoot });
  },

  setSplitRatio: (parentSplitId, firstChildIdx, ratio) => {
    const { root } = get();
    const newRoot = cloneTree(root);
    const split = findSplitById(newRoot, parentSplitId);
    if (!split) return;

    const { ratios } = split;
    if (firstChildIdx < 0 || firstChildIdx >= ratios.length - 1) return;

    // Redistribute: adjacent siblings i and i+1 keep the sum of their old ratios
    const adjacentSum = ratios[firstChildIdx] + ratios[firstChildIdx + 1];
    const clampedRatio = Math.max(0, Math.min(adjacentSum, ratio));
    ratios[firstChildIdx] = clampedRatio;
    ratios[firstChildIdx + 1] = adjacentSum - clampedRatio;

    set({ root: newRoot });
  },

  resetLayout: () => {
    _nextId = 1;
    set({ root: initialRoot(), panelCount: 1 });
  },
}));
