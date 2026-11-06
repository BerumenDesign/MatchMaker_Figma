// Walks the scope and collects hardcoded (unbound, unstyled) solid paints.
import { isBound, solidPaintKey, stackSignature, type PaintLike } from '../shared/color';
import { contextKeyOf, fillTargetForType } from '../shared/match';
import type { Occurrence, PropertyKind, ScanOptions, ScanStats } from '../shared/types';

export type Mode = 'variable' | 'style';

export interface ScanOutput {
  occurrences: Occurrence[];
  stats: ScanStats;
  nodes: Map<string, SceneNode>;
  /** First layer seen for each mode context; used to resolve tokens once per context. */
  contextReps: Map<string, SceneNode>;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/** Explicit modes inherited from ancestors (page included), nearest wins. */
function inheritedModes(node: BaseNode): Record<string, string> {
  const chain: Record<string, string>[] = [];
  let p: BaseNode | null = node.parent;
  while (p && p.type !== 'DOCUMENT') {
    if ('explicitVariableModes' in p) chain.push((p as SceneNode | PageNode).explicitVariableModes);
    p = p.parent;
  }
  const merged: Record<string, string> = {};
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(merged, chain[i]);
  return merged;
}

export async function scanRoots(
  roots: readonly SceneNode[],
  mode: Mode,
  options: ScanOptions,
  progress: (done: number) => void,
): Promise<ScanOutput> {
  const t0 = Date.now();
  const occurrences: Occurrence[] = [];
  const nodes = new Map<string, SceneNode>();
  const contextReps = new Map<string, SceneNode>();
  const stats: ScanStats = { layersScanned: 0, hardcoded: 0, alreadyLinked: 0, skippedUnsupported: 0, ms: 0 };
  const visited = new Set<string>();
  figma.skipInvisibleInstanceChildren = !options.includeHidden;

  type Item = { node: SceneNode; modes: Record<string, string>; ctx: string };
  const stack: Item[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    const modes = inheritedModes(roots[i]);
    stack.push({ node: roots[i], modes, ctx: contextKeyOf(modes) });
  }

  function emit(node: SceneNode, ctx: string, property: PropertyKind, paints: readonly PaintLike[], range?: [number, number]) {
    if (!paints.length) return;
    const base = {
      nodeId: node.id, nodeName: node.name, property, fillTarget: fillTargetForType(node.type), contextKey: ctx, range,
      textLength: node.type === 'TEXT' ? node.characters.length : undefined,
    };
    const before = occurrences.length;
    if (mode === 'variable') {
      paints.forEach((p, i) => {
        if (p.visible === false) return;
        if (p.type !== 'SOLID') { stats.skippedUnsupported++; return; }
        if (isBound(p)) { stats.alreadyLinked++; return; }
        occurrences.push({ ...base, paintIndex: i, colorKey: solidPaintKey(p) });
      });
    } else {
      if (!paints.some((p) => p.visible !== false)) return;
      if (paints.some((p) => p.type !== 'SOLID')) { stats.skippedUnsupported++; return; }
      if (paints.some(isBound)) { stats.alreadyLinked++; return; }
      occurrences.push({ ...base, paintIndex: -1, colorKey: stackSignature(paints) });
    }
    if (occurrences.length > before) {
      nodes.set(node.id, node);
      if (!contextReps.has(ctx)) contextReps.set(ctx, node);
    }
  }

  function collect(node: SceneNode, ctx: string) {
    if (node.type === 'TEXT') {
      if (node.characters.length > 0) {
        if (node.fills !== figma.mixed && node.fillStyleId !== figma.mixed) {
          if (node.fillStyleId) stats.alreadyLinked++;
          else emit(node, ctx, 'text', node.fills as readonly Paint[]);
        } else {
          for (const seg of node.getStyledTextSegments(['fills', 'fillStyleId'])) {
            if (seg.fillStyleId) stats.alreadyLinked++;
            else emit(node, ctx, 'text', seg.fills, [seg.start, seg.end]);
          }
        }
      }
    } else if ('fills' in node && node.fills !== figma.mixed) {
      const styleId = 'fillStyleId' in node ? node.fillStyleId : '';
      if (styleId) stats.alreadyLinked++;
      else emit(node, ctx, 'fill', node.fills as readonly Paint[]);
    }
    if ('strokes' in node && node.strokes.length) {
      const styleId = 'strokeStyleId' in node ? node.strokeStyleId : '';
      if (styleId) stats.alreadyLinked++;
      else emit(node, ctx, 'stroke', node.strokes);
    }
  }

  while (stack.length) {
    const { node, modes, ctx } = stack.pop()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    if (!options.includeHidden && !node.visible) continue;
    stats.layersScanned++;

    let nextModes = modes;
    let nextCtx = ctx;
    const explicit = node.explicitVariableModes;
    if (explicit && Object.keys(explicit).length) {
      nextModes = { ...modes, ...explicit };
      nextCtx = contextKeyOf(nextModes);
    }
    collect(node, nextCtx);

    if ('children' in node) {
      const kids = node.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], modes: nextModes, ctx: nextCtx });
    }
    if (stats.layersScanned % 250 === 0) {
      progress(stats.layersScanned);
      await yieldToUi();
    }
  }
  stats.hardcoded = occurrences.length;
  stats.ms = Date.now() - t0;
  return { occurrences, stats, nodes, contextReps };
}
