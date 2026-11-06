// Data shapes and the UI ⇄ plugin message protocol.

export type PropertyKind = 'fill' | 'text' | 'stroke';
export type SourceKind = 'local-collection' | 'library-collection' | 'local-styles';
/** What a node's fill counts as for variable scopes. */
export type FillTarget = 'frame' | 'shape' | 'text';

export interface SourceOption {
  id: string; // collection id, library collection key, or 'local-styles'
  kind: SourceKind;
  label: string;
  detail: string; // e.g. library name or "12 colors"
  loaded?: boolean; // library collections only
}

export interface ScanOptions {
  includeHidden: boolean;
  respectScopes: boolean;
}

/** One hardcoded paint (variable mode) or one whole paint stack (style mode). */
export interface Occurrence {
  nodeId: string;
  nodeName: string;
  property: PropertyKind;
  fillTarget: FillTarget;
  /** Paint index inside the stack; -1 = the whole stack (style mode). */
  paintIndex: number;
  /** Text range for mixed-color text, else undefined (whole node). */
  range?: [number, number];
  /** `#RRGGBBAA` (variable mode) or stack signature (style mode). */
  colorKey: string;
  /** Stable key of the effective explicit variable modes for this layer. */
  contextKey: string;
  /** Text length at scan time, used to detect edits before Apply. */
  textLength?: number;
}

export interface Candidate {
  id: string; // variable id or style id
  name: string;
  group: string; // collection / library / "Local styles"
  kind: 'variable' | 'style';
}

export type GroupStatus = 'ready' | 'choose' | 'unmatched';

export interface Group {
  id: string;
  property: PropertyKind;
  colorKey: string;
  isStack: boolean;
  candidates: Candidate[];
  status: GroupStatus;
  modeLabels: string[];
  layerCount: number;
  occurrenceCount: number;
  /** Sample layer names for the row tooltip. */
  sampleNames: string[];
}

export interface ScanStats {
  layersScanned: number;
  hardcoded: number;
  alreadyLinked: number;
  skippedUnsupported: number; // gradients, images, mixed stacks…
  ms: number;
}

export interface ApplyLine {
  groupId: string;
  nodeName: string;
  candidateName: string;
  outcome: 'applied' | 'skipped' | 'failed';
  reason?: string;
}

export interface ApplyReport {
  applied: number;
  skipped: number;
  failed: number;
  lines: ApplyLine[];
}

export interface Approval { groupId: string; candidateId: string }

export type UiToPlugin =
  | { type: 'init' }
  | { type: 'load-library'; sourceId: string }
  | { type: 'scan'; sourceId: string; options: ScanOptions }
  | { type: 'locate'; groupId: string; index: number }
  | { type: 'apply'; approvals: Approval[] }
  | { type: 'resize'; height: number };

export type PluginToUi =
  | { type: 'sources'; sources: SourceOption[]; selectionCount: number }
  | { type: 'selection'; count: number }
  | { type: 'progress'; label: string; done: number; total: number }
  | { type: 'library-loaded'; sourceId: string; count: number }
  | { type: 'scan-result'; groups: Group[]; stats: ScanStats; sourceLabel: string; isRescan: boolean }
  | { type: 'located'; groupId: string; index: number; total: number; name: string }
  | { type: 'apply-result'; report: ApplyReport }
  | { type: 'error'; message: string };
