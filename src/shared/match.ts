// Pure matching / grouping logic. No `figma` globals so it can be unit-tested.
import type { Candidate, FillTarget, Group, GroupStatus, Occurrence, PropertyKind } from './types';

/** Does a variable's scope list allow binding it to this property? */
export function scopeAllows(scopes: readonly string[], property: PropertyKind, fillTarget: FillTarget): boolean {
  if (scopes.includes('ALL_SCOPES')) return true;
  if (property === 'stroke') return scopes.includes('STROKE_COLOR');
  if (scopes.includes('ALL_FILLS')) return true;
  if (property === 'text' || fillTarget === 'text') return scopes.includes('TEXT_FILL');
  return scopes.includes(fillTarget === 'frame' ? 'FRAME_FILL' : 'SHAPE_FILL');
}

/** Frame-like containers use FRAME_FILL, everything else SHAPE_FILL. */
export function fillTargetForType(type: string): FillTarget {
  if (type === 'TEXT') return 'text';
  if (['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'].includes(type)) return 'frame';
  return 'shape';
}

export function statusFor(candidates: readonly Candidate[]): GroupStatus {
  if (candidates.length === 0) return 'unmatched';
  return candidates.length === 1 ? 'ready' : 'choose';
}

const byName = (a: Candidate, b: Candidate) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

export interface GroupingResult {
  groups: Group[];
  members: Map<string, Occurrence[]>;
}

/**
 * Groups occurrences by property + color + exact candidate set.
 * - `#FFFFFF` text and `#FFFFFF` fills never share a group.
 * - Layers whose color resolves to different tokens (e.g. Light vs Dark
 *   mode frames) split into separate groups; identical candidate sets merge.
 */
export function groupOccurrences(
  occurrences: readonly Occurrence[],
  candidatesFor: (o: Occurrence) => Candidate[],
  modeLabelFor: (contextKey: string) => string | undefined,
  isStack: boolean,
): GroupingResult {
  const map = new Map<string, { group: Group; occ: Occurrence[]; layers: Set<string>; modes: Set<string> }>();
  for (const o of occurrences) {
    const cands = candidatesFor(o).slice().sort(byName);
    const key = `${o.property}␟${o.colorKey}␟${cands.map((c) => c.id).join(',')}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        group: {
          id: '', property: o.property, colorKey: o.colorKey, isStack, candidates: cands,
          status: statusFor(cands), modeLabels: [], layerCount: 0, occurrenceCount: 0, sampleNames: [],
        },
        occ: [], layers: new Set(), modes: new Set(),
      };
      map.set(key, entry);
    }
    entry.occ.push(o);
    if (!entry.layers.has(o.nodeId)) {
      entry.layers.add(o.nodeId);
      if (entry.group.sampleNames.length < 5) entry.group.sampleNames.push(o.nodeName);
    }
    const mode = modeLabelFor(o.contextKey);
    if (mode) entry.modes.add(mode);
  }

  const order: Record<PropertyKind, number> = { fill: 0, text: 1, stroke: 2 };
  const entries = [...map.values()].sort(
    (a, b) => b.layers.size - a.layers.size || order[a.group.property] - order[b.group.property] || a.group.colorKey.localeCompare(b.group.colorKey),
  );
  const groups: Group[] = [];
  const members = new Map<string, Occurrence[]>();
  entries.forEach((e, i) => {
    e.group.id = `g${i}`;
    e.group.layerCount = e.layers.size;
    e.group.occurrenceCount = e.occ.length;
    e.group.modeLabels = [...e.modes].sort();
    groups.push(e.group);
    members.set(e.group.id, e.occ);
  });
  return { groups, members };
}

/** Stable key for a merged explicit-mode map. */
export function contextKeyOf(modes: Record<string, string>): string {
  return Object.keys(modes).sort().map((k) => `${k}=${modes[k]}`).join(';');
}

/** Index variables by resolved color key. */
export function indexByKey<T>(items: Iterable<{ key: string; item: T }>): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const { key, item } of items) {
    const list = m.get(key);
    if (list) list.push(item);
    else m.set(key, [item]);
  }
  return m;
}
