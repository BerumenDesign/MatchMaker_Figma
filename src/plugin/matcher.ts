// Resolves tokens in each layer's active mode and finds exact candidates.
import { paintSignature, variableColorKey, type RGBA } from '../shared/color';
import { groupOccurrences, indexByKey, scopeAllows, type GroupingResult } from '../shared/match';
import type { Candidate, Occurrence, ScanOptions } from '../shared/types';
import type { ResolvedSource } from './sources';
import type { ScanOutput } from './scan';

/** Resolved `#RRGGBBAA` of a COLOR variable for a given layer (aliases + inherited modes), or null. */
export function resolveVariableKey(v: Variable, node: SceneNode): string | null {
  try {
    const { value, resolvedType } = v.resolveForConsumer(node);
    if (resolvedType !== 'COLOR' || typeof value !== 'object' || value === null || !('r' in value)) return null;
    return variableColorKey(value as RGBA);
  } catch (e) {
    return null;
  }
}

/**
 * Signature of a paint style as it would render on `node`. Paints inside the style
 * that are bound to variables are resolved in the node's mode. Binding replaces the
 * paint opacity with the variable alpha (verified by probe), so the resolved key
 * is the variable RGBA.
 */
export async function styleSignatureFor(style: { paints: readonly Paint[] }, node: SceneNode): Promise<string | null> {
  const parts: string[] = [];
  for (const p of style.paints) {
    if (p.type !== 'SOLID') return null;
    const bound = p.boundVariables && p.boundVariables.color;
    let key: string | undefined;
    if (bound) {
      const v = await figma.variables.getVariableByIdAsync(bound.id);
      const k = v && resolveVariableKey(v, node);
      if (!k) return null;
      key = k;
    }
    parts.push(paintSignature(p, key));
  }
  return parts.join('|');
}

export function modeLabeler(source: ResolvedSource): (ctx: string) => string | undefined {
  if (!source.modeCollections.length) return () => undefined;
  const cache = new Map<string, string | undefined>();
  return (ctx: string) => {
    if (cache.has(ctx)) return cache.get(ctx);
    const explicit: Record<string, string> = {};
    for (const part of ctx ? ctx.split(';') : []) {
      const i = part.indexOf('=');
      explicit[part.slice(0, i)] = part.slice(i + 1);
    }
    const labels = source.modeCollections.map((col) => {
      const modeId = explicit[col.id] ?? col.defaultModeId;
      const m = col.modes.find((x) => x.modeId === modeId);
      return m ? m.name : '?';
    });
    const label = labels.join(' / ');
    cache.set(ctx, label);
    return label;
  };
}

export async function matchScan(
  scan: ScanOutput,
  source: ResolvedSource,
  options: ScanOptions,
  progress: (done: number, total: number) => void,
): Promise<GroupingResult> {
  const candidatesByOcc = new Map<Occurrence, Candidate[]>();
  const cand = (id: string) => source.candidates.get(id)!;

  if (source.kind === 'local-styles') {
    // Index style signatures once per mode context.
    const indexes = new Map<string, Map<string, PaintStyle[]>>();
    for (const [ctx, rep] of scan.contextReps) {
      const entries: { key: string; item: PaintStyle }[] = [];
      for (const s of source.styles) {
        const sig = await styleSignatureFor(s, rep);
        if (sig) entries.push({ key: sig, item: s });
      }
      indexes.set(ctx, indexByKey(entries));
    }
    let i = 0;
    for (const o of scan.occurrences) {
      const styles = indexes.get(o.contextKey)?.get(o.colorKey) ?? [];
      const verified: Candidate[] = [];
      const node = scan.nodes.get(o.nodeId)!;
      for (const s of styles) {
        // Re-verify on the actual layer when it is not the context representative.
        if (node === scan.contextReps.get(o.contextKey) || (await styleSignatureFor(s, node)) === o.colorKey) verified.push(cand(s.id));
      }
      candidatesByOcc.set(o, verified);
      if (++i % 500 === 0) { progress(i, scan.occurrences.length); await new Promise((r) => setTimeout(r, 0)); }
    }
  } else {
    // Resolve every token once per mode context, then verify per layer.
    const indexes = new Map<string, Map<string, Variable[]>>();
    for (const [ctx, rep] of scan.contextReps) {
      const entries: { key: string; item: Variable }[] = [];
      for (const v of source.variables) {
        const key = resolveVariableKey(v, rep);
        if (key) entries.push({ key, item: v });
      }
      indexes.set(ctx, indexByKey(entries));
    }
    let i = 0;
    for (const o of scan.occurrences) {
      const node = scan.nodes.get(o.nodeId)!;
      const isRep = node === scan.contextReps.get(o.contextKey);
      const vars = indexes.get(o.contextKey)?.get(o.colorKey) ?? [];
      const verified: Candidate[] = [];
      for (const v of vars) {
        if (options.respectScopes && !scopeAllows(v.scopes, o.property, o.fillTarget)) continue;
        if (!isRep && resolveVariableKey(v, node) !== o.colorKey) continue;
        verified.push(cand(v.id));
      }
      candidatesByOcc.set(o, verified);
      if (++i % 500 === 0) { progress(i, scan.occurrences.length); await new Promise((r) => setTimeout(r, 0)); }
    }
  }

  return groupOccurrences(scan.occurrences, (o) => candidatesByOcc.get(o) ?? [], modeLabeler(source), source.kind === 'local-styles');
}
