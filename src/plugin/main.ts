// MatchMaker — plugin sandbox entry point.
import type { Candidate, Group, Occurrence, PluginToUi, ScanOptions, UiToPlugin } from '../shared/types';
import { applyApprovals } from './apply';
import { matchScan } from './matcher';
import { scanRoots } from './scan';
import { listSources, loadLibrary, resolveSource } from './sources';

figma.showUI(__html__, { width: 440, height: 680, themeColors: true, title: 'MatchMaker' });

const post = (msg: PluginToUi) => figma.ui.postMessage(msg);

interface LastScan {
  sourceId: string;
  options: ScanOptions;
  rootIds: string[];
  groups: Group[];
  members: Map<string, Occurrence[]>;
  candidates: Map<string, Candidate>;
}
let last: LastScan | null = null;

function selectionRoots(): SceneNode[] {
  return figma.currentPage.selection.slice();
}

async function runScan(sourceId: string, options: ScanOptions, rootIds: string[] | null, isRescan: boolean) {
  const source = await resolveSource(sourceId);
  let roots: SceneNode[];
  if (rootIds) {
    roots = [];
    for (const id of rootIds) {
      const n = await figma.getNodeByIdAsync(id);
      if (n && !n.removed && n.type !== 'PAGE' && n.type !== 'DOCUMENT') roots.push(n as SceneNode);
    }
  } else roots = selectionRoots();
  if (!roots.length) throw new Error('Select one or more frames to scan.');

  const scan = await scanRoots(roots, source.kind === 'local-styles' ? 'style' : 'variable', options, (done) =>
    post({ type: 'progress', label: 'Scanning layers', done, total: 0 }),
  );
  const { groups, members } = await matchScan(scan, source, options, (done, total) =>
    post({ type: 'progress', label: 'Matching tokens', done, total }),
  );
  last = { sourceId, options, rootIds: roots.map((r) => r.id), groups, members, candidates: source.candidates };
  post({ type: 'scan-result', groups, stats: scan.stats, sourceLabel: source.label, isRescan });
}

async function locate(groupId: string, index: number) {
  const occs = last?.members.get(groupId);
  if (!occs || !occs.length) return;
  const ids = [...new Set(occs.map((o) => o.nodeId))];
  const i = ((index % ids.length) + ids.length) % ids.length;
  const node = await figma.getNodeByIdAsync(ids[i]);
  if (!node || node.removed) throw new Error('That layer no longer exists. Rescan to refresh.');
  let page: BaseNode | null = node;
  while (page && page.type !== 'PAGE') page = page.parent;
  if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page as PageNode);
  figma.currentPage.selection = [node as SceneNode];
  figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
  post({ type: 'located', groupId, index: i, total: ids.length, name: node.name });
}

figma.on('selectionchange', () => post({ type: 'selection', count: figma.currentPage.selection.length }));

figma.ui.onmessage = async (msg: UiToPlugin) => {
  try {
    switch (msg.type) {
      case 'init':
        post({ type: 'sources', sources: await listSources(), selectionCount: figma.currentPage.selection.length });
        break;
      case 'load-library': {
        const count = await loadLibrary(msg.sourceId, (done, total) =>
          post({ type: 'progress', label: 'Loading library colors', done, total }),
        );
        post({ type: 'library-loaded', sourceId: msg.sourceId, count });
        post({ type: 'sources', sources: await listSources(), selectionCount: figma.currentPage.selection.length });
        break;
      }
      case 'scan':
        await runScan(msg.sourceId, msg.options, null, false);
        break;
      case 'locate':
        await locate(msg.groupId, msg.index);
        break;
      case 'apply': {
        if (!last) throw new Error('Scan first.');
        const report = await applyApprovals(msg.approvals, last.members, last.candidates, (done, total) =>
          post({ type: 'progress', label: 'Applying', done, total }),
        );
        post({ type: 'apply-result', report });
        await runScan(last.sourceId, last.options, last.rootIds, true);
        break;
      }
      case 'resize':
        figma.ui.resize(440, Math.max(420, Math.min(1000, Math.round(msg.height))));
        break;
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
