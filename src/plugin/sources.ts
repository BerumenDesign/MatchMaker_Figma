// Token sources: local variable collections, enabled library collections, local color styles.
import type { Candidate, SourceKind, SourceOption } from '../shared/types';

export const STYLES_SOURCE_ID = 'local-styles';

/** Library variables imported this session, keyed by library collection key. */
const libraryCache = new Map<string, { name: string; libraryName: string; variables: Variable[] }>();

export interface ResolvedSource {
  id: string;
  kind: SourceKind;
  label: string;
  variables: Variable[];
  styles: PaintStyle[];
  candidates: Map<string, Candidate>;
  /** Collections whose modes we label (the source collection, if multi-mode). */
  modeCollections: VariableCollection[];
}

export async function listSources(): Promise<SourceOption[]> {
  const out: SourceOption[] = [];
  const [collections, colorVars] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync('COLOR'),
  ]);
  for (const col of collections) {
    const n = colorVars.filter((v) => v.variableCollectionId === col.id).length;
    if (n === 0) continue;
    out.push({
      id: col.id, kind: 'local-collection', label: col.name,
      detail: `${n} color${n === 1 ? '' : 's'} · ${col.modes.length} mode${col.modes.length === 1 ? '' : 's'}`,
    });
  }
  try {
    const libs = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    for (const lib of libs) {
      const cached = libraryCache.get(lib.key);
      out.push({
        id: lib.key, kind: 'library-collection', label: lib.name, detail: lib.libraryName,
        loaded: !!cached,
      });
    }
  } catch (e) {
    // No enabled libraries, offline, or permission missing: library sources are simply unavailable.
  }
  const styles = await figma.getLocalPaintStylesAsync();
  if (styles.length) {
    out.push({ id: STYLES_SOURCE_ID, kind: 'local-styles', label: 'Local color styles', detail: `${styles.length} style${styles.length === 1 ? '' : 's'}` });
  }
  return out;
}

/**
 * Imports the COLOR variables of a library collection so their values can be read.
 * This writes remote-variable references into the document, so it is a separate,
 * explicit action and is committed as its own undo step (Undo of an Apply batch
 * never unloads the library).
 */
export async function loadLibrary(
  key: string,
  progress: (done: number, total: number) => void,
): Promise<number> {
  const libs = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  const lib = libs.find((l) => l.key === key);
  if (!lib) throw new Error('That library collection is no longer enabled in this file.');
  const descriptors = (await figma.teamLibrary.getVariablesInLibraryCollectionAsync(key)).filter(
    (d) => d.resolvedType === 'COLOR',
  );
  figma.commitUndo();
  const variables: Variable[] = [];
  const CHUNK = 20;
  for (let i = 0; i < descriptors.length; i += CHUNK) {
    const chunk = descriptors.slice(i, i + CHUNK);
    const res = await Promise.allSettled(chunk.map((d) => figma.variables.importVariableByKeyAsync(d.key)));
    for (const r of res) if (r.status === 'fulfilled') variables.push(r.value);
    progress(Math.min(i + CHUNK, descriptors.length), descriptors.length);
  }
  figma.commitUndo();
  libraryCache.set(key, { name: lib.name, libraryName: lib.libraryName, variables });
  return variables.length;
}

export async function resolveSource(id: string): Promise<ResolvedSource> {
  const candidates = new Map<string, Candidate>();
  if (id === STYLES_SOURCE_ID) {
    const styles = (await figma.getLocalPaintStylesAsync()).filter((s) => s.paints.length > 0);
    for (const s of styles) candidates.set(s.id, { id: s.id, name: s.name, group: 'Local styles', kind: 'style' });
    return { id, kind: 'local-styles', label: 'Local color styles', variables: [], styles, candidates, modeCollections: [] };
  }

  const cached = libraryCache.get(id);
  if (cached) {
    for (const v of cached.variables) candidates.set(v.id, { id: v.id, name: v.name, group: cached.libraryName, kind: 'variable' });
    const modeCollections: VariableCollection[] = [];
    const colIds = [...new Set(cached.variables.map((v) => v.variableCollectionId))];
    for (const cid of colIds) {
      try {
        const col = await figma.variables.getVariableCollectionByIdAsync(cid);
        if (col && col.modes.length > 1) modeCollections.push(col);
      } catch (e) { /* mode labels are cosmetic */ }
    }
    return {
      id, kind: 'library-collection', label: `${cached.name} — ${cached.libraryName}`,
      variables: cached.variables, styles: [], candidates, modeCollections,
    };
  }

  const col = await figma.variables.getVariableCollectionByIdAsync(id);
  if (!col) {
    throw new Error('Library colors are not loaded yet. Click “Load library colors” first.');
  }
  const variables = (await figma.variables.getLocalVariablesAsync('COLOR')).filter((v) => v.variableCollectionId === col.id);
  for (const v of variables) candidates.set(v.id, { id: v.id, name: v.name, group: col.name, kind: 'variable' });
  return {
    id, kind: 'local-collection', label: col.name, variables, styles: [], candidates,
    modeCollections: col.modes.length > 1 ? [col] : [],
  };
}
