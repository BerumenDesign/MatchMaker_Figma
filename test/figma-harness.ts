// Bundled into a use_figma script to run the real plugin core against a Figma file.
import { applyApprovals } from '../src/plugin/apply';
import { matchScan } from '../src/plugin/matcher';
import { scanRoots } from '../src/plugin/scan';
import { resolveSource } from '../src/plugin/sources';

async function run(sourceId: string, rootIds: string[], options = { includeHidden: false, respectScopes: true }) {
  const source = await resolveSource(sourceId);
  const roots: SceneNode[] = [];
  for (const id of rootIds) roots.push((await figma.getNodeByIdAsync(id)) as SceneNode);
  const scan = await scanRoots(roots, source.kind === 'local-styles' ? 'style' : 'variable', options, () => {});
  const { groups, members } = await matchScan(scan, source, options, () => {});
  return { source, scan, groups, members };
}
(globalThis as any).MM = { run, applyApprovals };
