// Pure predicates used right before writing (recheck) and right after (readback).
import { isBound, solidPaintKey, stackSignature, type PaintLike } from './color';

/** Returns a skip reason, or null when the paint is still the hardcoded value we scanned. */
export function recheckPaint(paint: PaintLike | undefined, expectedKey: string): string | null {
  if (!paint) return 'Paint no longer exists';
  if (paint.type !== 'SOLID') return 'Paint is no longer a solid color';
  if (paint.visible === false) return 'Paint is now hidden';
  if (isBound(paint)) return 'Paint is already bound to a variable';
  if (solidPaintKey(paint) !== expectedKey) return 'Color changed since scan';
  return null;
}

/** Style mode: the whole stack must still be unbound and identical. */
export function recheckStack(paints: readonly PaintLike[] | null, expectedSig: string): string | null {
  if (!paints || paints.length === 0) return 'Paints no longer exist';
  if (paints.some(isBound)) return 'A paint is now bound to a variable';
  if (stackSignature(paints) !== expectedSig) return 'Paint stack changed since scan';
  return null;
}

/** Readback after binding: binding present and rendered color unchanged. */
export function verifyBoundPaint(paint: PaintLike | undefined, variableId: string, expectedKey: string): string | null {
  if (!paint || paint.type !== 'SOLID') return 'Paint missing after write';
  if (paint.boundVariables?.color?.id !== variableId) return 'Figma did not keep the variable binding';
  if (solidPaintKey(paint) !== expectedKey) return `Appearance changed (${solidPaintKey(paint)} ≠ ${expectedKey})`;
  return null;
}

/** Other paints in the same stack must be byte-for-byte unchanged. */
export function untouchedPaintsEqual(before: readonly PaintLike[], after: readonly PaintLike[], changed: Set<number>): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i++) {
    if (changed.has(i)) continue;
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) return false;
  }
  return true;
}
