// MatchMaker UI — Scan → Review → Apply. Vanilla TS, re-renders on state change.
import { cssRgba, keyLabel, stackLayers } from '../shared/color';
import type { ApplyReport, Group, GroupStatus, PluginToUi, ScanStats, SourceOption, UiToPlugin } from '../shared/types';

const send = (msg: UiToPlugin) => parent.postMessage({ pluginMessage: msg }, '*');

interface State {
  view: 'source' | 'review';
  sources: SourceOption[];
  sourceId: string;
  includeHidden: boolean;
  respectScopes: boolean;
  selectionCount: number;
  groups: Group[];
  stats: ScanStats | null;
  sourceLabel: string;
  choice: Record<string, string | undefined>;
  approved: Record<string, boolean>;
  tab: GroupStatus;
  report: ApplyReport | null;
  showReportDetails: boolean;
  located: Record<string, string>;
  busy: { label: string; done: number; total: number } | null;
  error: string;
}

const state: State = {
  view: 'source', sources: [], sourceId: '', includeHidden: false, respectScopes: true, selectionCount: 0,
  groups: [], stats: null, sourceLabel: '', choice: {}, approved: {}, tab: 'choose', report: null,
  showReportDetails: false, located: {}, busy: null, error: '',
};
const locateIndex: Record<string, number> = {};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const app = document.getElementById('app')!;
const currentSource = () => state.sources.find((s) => s.id === state.sourceId);

function swatch(g: { colorKey: string; isStack: boolean }, small = false): string {
  const layers = g.isStack ? stackLayers(g.colorKey).filter((l) => !l.hidden) : [{ key: g.colorKey, hidden: false }];
  return `<div class="swatch${small ? ' sm' : ''}">${layers.map((l) => `<span style="background:${cssRgba(l.key)}"></span>`).join('')}</div>`;
}

function colorLabel(g: Group): string {
  if (!g.isStack) return keyLabel(g.colorKey);
  const layers = stackLayers(g.colorKey);
  return layers.length === 1 ? keyLabel(layers[0].key) : `${layers.length}-paint stack`;
}

const PROP_LABEL = { fill: 'Fill', text: 'Text', stroke: 'Stroke' } as const;

function renderHeader(): string {
  const step = state.view === 'source' ? 1 : state.report ? 3 : 2;
  const s = (n: number, label: string) => `<span class="step${step === n ? ' on' : ''}">${n} ${label}</span>`;
  return `<div class="header"><span class="title">MatchMaker</span><div class="steps">${s(1, 'Scan')}${s(2, 'Review')}${s(3, 'Apply')}</div></div>`;
}

function renderSource(): string {
  const src = currentSource();
  const groups: [string, SourceOption[]][] = [
    ['Local variable collections', state.sources.filter((s) => s.kind === 'local-collection')],
    ['Library variable collections (enabled in this file)', state.sources.filter((s) => s.kind === 'library-collection')],
    ['Color styles', state.sources.filter((s) => s.kind === 'local-styles')],
  ];
  const options = groups
    .filter(([, list]) => list.length)
    .map(([label, list]) => `<optgroup label="${esc(label)}">${list
      .map((s) => `<option value="${esc(s.id)}"${s.id === state.sourceId ? ' selected' : ''}>${esc(s.label)} — ${esc(s.detail)}${s.kind === 'library-collection' ? (s.loaded ? ' (loaded)' : ' (not loaded)') : ''}</option>`)
      .join('')}</optgroup>`)
    .join('');
  const isLib = src?.kind === 'library-collection';
  const needsLoad = isLib && !src?.loaded;
  const libNote = isLib
    ? `<div class="note"><b>Library colors must be loaded before scanning</b>
        Figma only lists names for library variables. To read their values in each mode, MatchMaker imports this collection’s
        color variables into the file. That adds references to the library’s variables (including ones you may not use) and is
        recorded as its own Undo step. No layers are changed.
        ${src?.loaded ? '<br><br>✓ Loaded for this session.' : ''}</div>
       ${needsLoad ? '<button id="load-lib">Load library colors</button>' : ''}`
    : '';
  const scopesNote = isLib && state.respectScopes
    ? '<div class="small">Library variables may report “All scopes” through the Plugin API, so scope filtering may not narrow library candidates.</div>'
    : '';
  const sel = state.selectionCount;
  return `
    <div class="body">
      ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}
      <div class="field">
        <span class="label">Scope</span>
        <div>${sel ? `<b>${sel}</b> selected layer${sel === 1 ? '' : 's'} and all descendants` : '<span class="muted">Select one or more frames on the canvas.</span>'}</div>
      </div>
      <div class="field">
        <span class="label">Match against</span>
        ${state.sources.length ? `<select id="source">${options}</select>` : '<div class="muted">No color variables, enabled library collections or local color styles found in this file.</div>'}
        ${libNote}
      </div>
      <div class="field">
        <span class="label">Options</span>
        <label class="opt"><input type="checkbox" id="opt-scopes"${state.respectScopes ? ' checked' : ''}${src?.kind === 'local-styles' ? ' disabled' : ''}> Respect variable scopes (text / fill / stroke)</label>
        ${scopesNote}
        <label class="opt"><input type="checkbox" id="opt-hidden"${state.includeHidden ? ' checked' : ''}> Include hidden layers</label>
      </div>
      <div class="small">Finds unbound solid fills, strokes and text colors (including each color range in mixed text). Already-linked
        properties, gradients and images are never changed. Exact matches must reproduce the color <i>and</i> transparency in each layer’s active mode.</div>
    </div>
    <div class="footer">
      <span class="spacer"></span>
      <button class="primary" id="scan"${!sel || !src || needsLoad ? ' disabled' : ''}>Scan</button>
    </div>`;
}

function renderGroup(g: Group): string {
  const chosen = state.choice[g.id];
  const approved = !!state.approved[g.id] && !!chosen;
  const cands = g.candidates.length
    ? `<div class="cands">${g.candidates
        .map((c) => `<label class="cand${chosen === c.id ? ' on' : ''}" data-g="${g.id}" data-c="${esc(c.id)}">
            <input type="radio" name="r-${g.id}"${chosen === c.id ? ' checked' : ''}>
            ${swatch(g, true)}<span class="name">${esc(c.name)}</span><span class="grp">${esc(c.group)}</span></label>`)
        .join('')}</div>`
    : '';
  const loc = state.located[g.id];
  return `<div class="group${approved ? ' approved' : ''}">
    <div class="ghead">
      ${g.candidates.length ? `<input type="checkbox" class="approve" data-g="${g.id}"${approved ? ' checked' : ''}${chosen ? '' : ' disabled'} title="Approve">` : ''}
      ${swatch(g)}
      <div class="meta">
        <div class="hex">${esc(colorLabel(g))}</div>
        <div class="badges">
          <span class="badge ${g.property}">${PROP_LABEL[g.property]}</span>
          ${g.modeLabels.map((m) => `<span class="badge mode">${esc(m)}</span>`).join('')}
          <span class="badge" title="${esc(g.sampleNames.join(', '))}">${g.layerCount} layer${g.layerCount === 1 ? '' : 's'}${g.occurrenceCount > g.layerCount ? ` · ${g.occurrenceCount} ranges` : ''}</span>
        </div>
      </div>
      <button class="locate" data-g="${g.id}" title="Select and zoom to an affected layer; click again for the next one">${loc ? esc(loc) : 'Locate'}</button>
    </div>
    ${g.status === 'choose' && !chosen ? `<div class="small" style="margin-top:6px">${g.candidates.length} tokens share this value — choose one.</div>` : ''}
    ${cands}
  </div>`;
}

function renderReview(): string {
  const by = (s: GroupStatus) => state.groups.filter((g) => g.status === s);
  const tabs: [GroupStatus, string][] = [['choose', 'Needs choice'], ['ready', 'Ready'], ['unmatched', 'Unmatched']];
  const list = by(state.tab);
  const approvedGroups = state.groups.filter((g) => state.approved[g.id] && state.choice[g.id]);
  const approvedLayers = approvedGroups.reduce((n, g) => n + g.layerCount, 0);
  const st = state.stats;
  const r = state.report;
  const report = r
    ? `<div class="report">
        <div class="nums"><span class="ok">${r.applied} applied</span><span class="skip">${r.skipped} skipped</span><span class="fail">${r.failed} failed</span>
          ${r.lines.some((l) => l.outcome !== 'applied') ? `<button class="link" id="toggle-details">${state.showReportDetails ? 'Hide' : 'Show'} details</button>` : ''}</div>
        ${r.applied ? '<div class="small">One Undo (⌘Z / Ctrl+Z) in Figma reverts this whole batch. The list below is a fresh rescan.</div>' : ''}
        ${state.showReportDetails ? `<ul>${r.lines.filter((l) => l.outcome !== 'applied').map((l) => `<li class="${l.outcome === 'failed' ? 'fail' : 'skip'}">${esc(l.nodeName)} → ${esc(l.candidateName)}: ${esc(l.reason ?? l.outcome)}</li>`).join('')}</ul>` : ''}
      </div>`
    : '';
  const body = list.length
    ? list.map(renderGroup).join('')
    : `<div class="empty">${state.tab === 'unmatched' ? 'No unmatched colors.' : state.tab === 'ready' ? 'No unique exact matches.' : 'Nothing needs a choice.'}</div>`;
  const bulk = state.tab === 'ready' && list.length
    ? `<div style="display:flex;gap:6px;margin-bottom:8px"><button id="approve-all">Approve all ready</button><button id="clear-all">Clear</button></div>` : '';
  const unmatchedHint = state.tab === 'unmatched' && list.length
    ? '<div class="small" style="margin-bottom:8px">No token in this source reproduces these colors exactly in the layer’s mode. They will not be changed.</div>' : '';
  return `
    <div class="body">
      ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}
      ${report}
      <div class="small" style="margin-bottom:4px">Source: ${esc(state.sourceLabel)}</div>
      ${st ? `<div class="stats"><span>${st.layersScanned} layers scanned</span><span>${st.hardcoded} hardcoded</span><span>${st.alreadyLinked} already linked</span>${st.skippedUnsupported ? `<span>${st.skippedUnsupported} gradient/image skipped</span>` : ''}</div>` : ''}
      <div class="tabs">${tabs.map(([k, label]) => `<button class="tab${state.tab === k ? ' on' : ''}" data-tab="${k}">${label}<span class="count">${by(k).length}</span></button>`).join('')}</div>
      ${bulk}${unmatchedHint}
      ${body}
    </div>
    <div class="footer">
      <button id="back">Back</button>
      <button id="rescan">Rescan</button>
      <span class="spacer"></span>
      <button class="primary" id="apply"${approvedGroups.length ? '' : ' disabled'}>Apply ${approvedGroups.length ? `${approvedGroups.length} group${approvedGroups.length === 1 ? '' : 's'} · ${approvedLayers} layer${approvedLayers === 1 ? '' : 's'}` : ''}</button>
    </div>`;
}

function renderBusy(): string {
  const b = state.busy;
  if (!b) return '';
  const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
  return `<div class="busy"><div>${esc(b.label)}${b.total ? ` ${b.done}/${b.total}` : b.done ? ` · ${b.done}` : ''}…</div>
    <div class="bar${b.total ? '' : ' indet'}"><span style="width:${pct}%"></span></div></div>`;
}

function render() {
  const scrollEl = app.querySelector('.body');
  const scroll = scrollEl ? scrollEl.scrollTop : 0;
  app.innerHTML = renderHeader() + (state.view === 'source' ? renderSource() : renderReview()) + renderBusy();
  const nb = app.querySelector('.body');
  if (nb) nb.scrollTop = scroll;
}

function scan() {
  state.error = '';
  state.busy = { label: 'Scanning layers', done: 0, total: 0 };
  render();
  send({ type: 'scan', sourceId: state.sourceId, options: { includeHidden: state.includeHidden, respectScopes: state.respectScopes } });
}

app.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'source') { state.sourceId = t.value; state.error = ''; render(); }
  else if (t.id === 'opt-hidden') state.includeHidden = t.checked;
  else if (t.id === 'opt-scopes') { state.respectScopes = t.checked; render(); }
  else if (t.classList.contains('approve')) { state.approved[t.dataset.g!] = t.checked; render(); }
});

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('button, .cand') as HTMLElement | null;
  if (!el) return;
  if (el.classList.contains('cand')) {
    e.preventDefault();
    const g = el.dataset.g!;
    state.choice[g] = el.dataset.c!;
    state.approved[g] = true;
    render();
    return;
  }
  switch (el.id) {
    case 'scan': case 'rescan': state.report = null; scan(); return;
    case 'load-lib':
      state.busy = { label: 'Loading library colors', done: 0, total: 0 }; render();
      send({ type: 'load-library', sourceId: state.sourceId }); return;
    case 'back': state.view = 'source'; state.report = null; state.error = ''; render(); return;
    case 'approve-all':
      state.groups.filter((g) => g.status === 'ready').forEach((g) => { state.approved[g.id] = true; }); render(); return;
    case 'clear-all':
      state.groups.forEach((g) => { state.approved[g.id] = false; }); render(); return;
    case 'toggle-details': state.showReportDetails = !state.showReportDetails; render(); return;
    case 'apply': {
      const approvals = state.groups
        .filter((g) => state.approved[g.id] && state.choice[g.id])
        .map((g) => ({ groupId: g.id, candidateId: state.choice[g.id]! }));
      if (!approvals.length) return;
      state.error = '';
      state.busy = { label: 'Applying', done: 0, total: 0 }; render();
      send({ type: 'apply', approvals });
      return;
    }
  }
  if (el.dataset.tab) { state.tab = el.dataset.tab as GroupStatus; render(); return; }
  if (el.classList.contains('locate')) {
    const g = el.dataset.g!;
    const i = locateIndex[g] ?? 0;
    locateIndex[g] = i + 1;
    send({ type: 'locate', groupId: g, index: i });
  }
});

window.onmessage = (ev: MessageEvent) => {
  const msg = ev.data && (ev.data.pluginMessage as PluginToUi);
  if (!msg) return;
  switch (msg.type) {
    case 'sources': {
      state.sources = msg.sources;
      state.selectionCount = msg.selectionCount;
      if (!state.sources.some((s) => s.id === state.sourceId)) state.sourceId = state.sources[0]?.id ?? '';
      break;
    }
    case 'selection': state.selectionCount = msg.count; if (state.view !== 'source') return; break;
    case 'progress': state.busy = { label: msg.label, done: msg.done, total: msg.total }; break;
    case 'library-loaded': state.busy = null; break;
    case 'scan-result': {
      state.busy = null;
      state.groups = msg.groups;
      state.stats = msg.stats;
      state.sourceLabel = msg.sourceLabel;
      state.view = 'review';
      state.choice = {};
      state.approved = {};
      state.located = {};
      for (const k of Object.keys(locateIndex)) delete locateIndex[k];
      // Preselect unique exact matches only.
      for (const g of msg.groups) if (g.status === 'ready') { state.choice[g.id] = g.candidates[0].id; state.approved[g.id] = true; }
      if (!msg.isRescan) {
        const groups = msg.groups;
        const has = (s: GroupStatus) => groups.some((g: Group) => g.status === s);
        state.tab = has('choose') ? 'choose' : has('ready') ? 'ready' : 'unmatched';
      }
      break;
    }
    case 'located': state.located[msg.groupId] = `${msg.index + 1}/${msg.total}`; break;
    case 'apply-result': state.report = msg.report; state.showReportDetails = msg.report.failed > 0; break;
    case 'error': state.busy = null; state.error = msg.message; break;
  }
  render();
};

render();
send({ type: 'init' });
