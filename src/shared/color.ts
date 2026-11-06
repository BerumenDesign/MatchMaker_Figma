// Pure color helpers shared by the plugin sandbox, the UI and the tests.
// All comparisons happen in 8-bit space so float noise from imports
// (e.g. opacity 0.07999999821186066) never breaks an "exact" match.

export interface RGB { r: number; g: number; b: number }
export interface RGBA extends RGB { a: number }

/** Minimal shape of a Figma paint that we read. */
export interface PaintLike {
  type: string;
  color?: RGB;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
  boundVariables?: { color?: { id: string } };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const to8 = (x: number) => Math.round(clamp01(x) * 255);
const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

/** Canonical key `#RRGGBBAA` for a color + alpha. */
export function rgbaKey(c: RGB, a = 1): string {
  return '#' + hex2(to8(c.r)) + hex2(to8(c.g)) + hex2(to8(c.b)) + hex2(to8(a));
}

/** Key for what a solid paint renders (color + paint opacity). */
export function solidPaintKey(p: PaintLike): string {
  return rgbaKey(p.color ?? { r: 0, g: 0, b: 0 }, p.opacity ?? 1);
}

/** Key for a COLOR variable value (RGBA). */
export function variableColorKey(v: RGBA): string {
  return rgbaKey(v, v.a ?? 1);
}

export function parseKey(key: string): RGBA {
  const n = (i: number) => parseInt(key.slice(i, i + 2), 16) / 255;
  return { r: n(1), g: n(3), b: n(5), a: key.length >= 9 ? n(7) : 1 };
}

/** Human label: `#RRGGBB` or `#RRGGBB · 50%`. */
export function keyLabel(key: string): string {
  const hex = key.slice(0, 7);
  const a = key.length >= 9 ? parseInt(key.slice(7, 9), 16) : 255;
  return a === 255 ? hex : `${hex} · ${Math.round((a / 255) * 100)}%`;
}

export function cssRgba(key: string): string {
  const c = parseKey(key);
  return `rgba(${to8(c.r)}, ${to8(c.g)}, ${to8(c.b)}, ${+c.a.toFixed(3)})`;
}

export function isBound(p: PaintLike): boolean {
  return !!(p.boundVariables && p.boundVariables.color);
}

/**
 * Signature of a single paint for full-stack comparison (style matching).
 * `resolvedKey` lets the caller substitute a variable-resolved color.
 */
export function paintSignature(p: PaintLike, resolvedKey?: string): string {
  if (p.type !== 'SOLID') return `${p.type}:unsupported`;
  const vis = p.visible === false ? 'hidden' : 'shown';
  return `SOLID:${resolvedKey ?? solidPaintKey(p)}:${p.blendMode ?? 'NORMAL'}:${vis}`;
}

export function stackSignature(paints: readonly PaintLike[], resolvedKeys?: (string | undefined)[]): string {
  return paints.map((p, i) => paintSignature(p, resolvedKeys?.[i])).join('|');
}

/** Converts a stack signature back to swatch layers (bottom → top) for the UI. */
export function stackLayers(sig: string): { key: string; hidden: boolean }[] {
  if (!sig) return [];
  return sig.split('|').map((part) => {
    const [, key, , vis] = part.split(':');
    return { key, hidden: vis === 'hidden' };
  });
}
