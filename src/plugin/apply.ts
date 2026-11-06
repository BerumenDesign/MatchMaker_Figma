// Applies approved bindings: recheck → write → readback → (restore on failure).
// The whole batch sits between two commitUndo() calls, so one Undo reverts it.
import { recheckPaint, recheckStack, untouchedPaintsEqual, verifyBoundPaint } from '../shared/recheck';
import type { ApplyLine, ApplyReport, Approval, Candidate, Occurrence } from '../shared/types';
import { resolveVariableKey, styleSignatureFor } from './matcher';

interface Item { occ: Occurrence; groupId: string; candidate: Candidate }

type PaintTarget = SceneNode & MinimalFillsMixin & MinimalStrokesMixin;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

async function loadAllFonts(node: TextNode) {
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
}

function readPaints(node: PaintTarget, occ: Occurrence): { paints: Paint[] | null; styleId: string; reason?: string } {
  if (occ.property === 'stroke') {
    return { paints: node.strokes.slice(), styleId: 'strokeStyleId' in node ? (node.strokeStyleId as string) : '' };
  }
  if (node.type === 'TEXT' && occ.range) {
    const [s, e] = occ.range;
    if (e > node.characters.length) return { paints: null, styleId: '', reason: 'Text changed since scan' };
    const fills = node.getRangeFills(s, e);
    const sid = node.getRangeFillStyleId(s, e);
    if (fills === figma.mixed || sid === figma.mixed) return { paints: null, styleId: '', reason: 'Text colors changed since scan' };
    return { paints: (fills as Paint[]).slice(), styleId: sid as string };
  }
  if (node.fills === figma.mixed) return { paints: null, styleId: '', reason: 'Text colors changed since scan' };
  const sid = 'fillStyleId' in node ? node.fillStyleId : '';
  if (sid === figma.mixed) return { paints: null, styleId: '', reason: 'Text colors changed since scan' };
  return { paints: (node.fills as Paint[]).slice(), styleId: sid as string };
}

async function writePaints(node: PaintTarget, occ: Occurrence, paints: Paint[]) {
  if (occ.property === 'stroke') node.strokes = paints;
  else if (node.type === 'TEXT' && occ.range) node.setRangeFills(occ.range[0], occ.range[1], paints);
  else node.fills = paints;
}

async function writeStyle(node: PaintTarget, occ: Occurrence, styleId: string) {
  if (occ.property === 'stroke') await (node as any).setStrokeStyleIdAsync(styleId);
  else if (node.type === 'TEXT' && occ.range) await node.setRangeFillStyleIdAsync(occ.range[0], occ.range[1], styleId);
  else await (node as any).setFillStyleIdAsync(styleId);
}

export async function applyApprovals(
  approvals: Approval[],
  members: Map<string, Occurrence[]>,
  candidates: Map<string, Candidate>,
  progress: (done: number, total: number) => void,
): Promise<ApplyReport> {
  const lines: ApplyLine[] = [];
  const items: Item[] = [];
  for (const a of approvals) {
    const cand = candidates.get(a.candidateId);
    const occs = members.get(a.groupId);
    if (!cand || !occs) continue;
    for (const occ of occs) items.push({ occ, groupId: a.groupId, candidate: cand });
  }

  // One write per node + property + text range.
  const targets = new Map<string, Item[]>();
  for (const it of items) {
    const k = `${it.occ.nodeId}|${it.occ.property}|${it.occ.range ? it.occ.range.join('-') : '*'}`;
    const list = targets.get(k);
    if (list) list.push(it);
    else targets.set(k, [it]);
  }

  const line = (it: Item, outcome: ApplyLine['outcome'], reason?: string) =>
    lines.push({ groupId: it.groupId, nodeName: it.occ.nodeName, candidateName: it.candidate.name, outcome, reason });

  figma.commitUndo();
  let done = 0;
  for (const group of targets.values()) {
    done++;
    if (done % 50 === 0) { progress(done, targets.size); await new Promise((r) => setTimeout(r, 0)); }
    const occ0 = group[0].occ;
    const node = (await figma.getNodeByIdAsync(occ0.nodeId)) as PaintTarget | null;
    if (!node || node.removed) { group.forEach((it) => line(it, 'skipped', 'Layer was deleted')); continue; }
    if (node.type === 'TEXT' && occ0.textLength !== undefined && node.characters.length !== occ0.textLength) {
      group.forEach((it) => line(it, 'skipped', 'Text changed since scan')); continue;
    }
    const { paints, styleId, reason } = readPaints(node, occ0);
    if (!paints) { group.forEach((it) => line(it, 'skipped', reason)); continue; }
    if (styleId) { group.forEach((it) => line(it, 'skipped', 'Layer now uses a style')); continue; }

    try {
      if (node.type === 'TEXT') {
        if (node.hasMissingFont) { group.forEach((it) => line(it, 'failed', 'Missing font — cannot edit this text')); continue; }
        await loadAllFonts(node);
      }

      if (occ0.paintIndex === -1) {
        // ---- Style mode: whole stack → paint style
        const it = group[0];
        const why = recheckStack(paints, occ0.colorKey);
        if (why) { line(it, 'skipped', why); continue; }
        const style = await figma.getStyleByIdAsync(it.candidate.id);
        if (!style || style.type !== 'PAINT') { line(it, 'failed', 'Style no longer exists'); continue; }
        if ((await styleSignatureFor(style as PaintStyle, node)) !== occ0.colorKey) { line(it, 'skipped', 'Style no longer matches this layer'); continue; }
        const original = clone(paints);
        await writeStyle(node, occ0, style.id);
        const after = readPaints(node, occ0);
        const afterSig = after.paints && (await styleSignatureFor({ paints: after.paints }, node));
        if (after.styleId !== style.id || afterSig !== occ0.colorKey) {
          await writeStyle(node, occ0, '');
          await writePaints(node, occ0, original);
          line(it, 'failed', after.styleId !== style.id ? 'Figma did not keep the style link' : 'Appearance changed — reverted');
        } else line(it, 'applied');
        continue;
      }

      // ---- Variable mode: bind individual paints
      const ready: { it: Item; v: Variable }[] = [];
      for (const it of group) {
        const why = recheckPaint(paints[it.occ.paintIndex], it.occ.colorKey);
        if (why) { line(it, 'skipped', why); continue; }
        const v = await figma.variables.getVariableByIdAsync(it.candidate.id);
        if (!v) { line(it, 'failed', 'Variable no longer exists'); continue; }
        if (resolveVariableKey(v, node) !== it.occ.colorKey) { line(it, 'skipped', 'Token value no longer matches in this layer’s mode'); continue; }
        ready.push({ it, v });
      }
      if (!ready.length) continue;

      const original = clone(paints);
      const next = clone(paints);
      for (const { it, v } of ready) {
        next[it.occ.paintIndex] = figma.variables.setBoundVariableForPaint(next[it.occ.paintIndex] as SolidPaint, 'color', v);
      }
      await writePaints(node, occ0, next);

      const after = readPaints(node, occ0).paints ?? [];
      const changed = new Set(ready.map((r) => r.it.occ.paintIndex));
      const problems = ready
        .map(({ it, v }) => ({ it, why: verifyBoundPaint(after[it.occ.paintIndex], v.id, it.occ.colorKey) }))
        .filter((p) => p.why);
      const othersOk = untouchedPaintsEqual(original, after, changed);
      if (problems.length || !othersOk) {
        await writePaints(node, occ0, original);
        for (const { it } of ready) {
          const own = problems.find((p) => p.it === it);
          line(it, 'failed', own ? `${own.why} — reverted` : othersOk ? 'Reverted with another paint on this layer' : 'Other paints changed — reverted');
        }
      } else {
        ready.forEach(({ it }) => line(it, 'applied'));
      }
    } catch (e) {
      group.forEach((it) => line(it, 'failed', e instanceof Error ? e.message : String(e)));
    }
  }
  figma.commitUndo();

  return {
    applied: lines.filter((l) => l.outcome === 'applied').length,
    skipped: lines.filter((l) => l.outcome === 'skipped').length,
    failed: lines.filter((l) => l.outcome === 'failed').length,
    lines,
  };
}
