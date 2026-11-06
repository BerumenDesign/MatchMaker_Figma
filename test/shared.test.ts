import { describe, expect, it } from 'vitest';
import { keyLabel, rgbaKey, solidPaintKey, stackSignature, stackLayers, variableColorKey } from '../src/shared/color';
import { contextKeyOf, fillTargetForType, groupOccurrences, scopeAllows, statusFor } from '../src/shared/match';
import { recheckPaint, recheckStack, untouchedPaintsEqual, verifyBoundPaint } from '../src/shared/recheck';
import type { Candidate, Occurrence } from '../src/shared/types';

const solid = (r: number, g: number, b: number, opacity = 1, extra: object = {}) =>
  ({ type: 'SOLID', color: { r, g, b }, opacity, visible: true, blendMode: 'NORMAL', boundVariables: {}, ...extra });

describe('color keys', () => {
  it('quantizes to 8-bit and includes alpha', () => {
    expect(rgbaKey({ r: 1, g: 1, b: 1 })).toBe('#FFFFFFFF');
    expect(solidPaintKey(solid(0, 0, 0, 0.5))).toBe('#00000080');
    // float noise from imports collapses to the same key
    expect(solidPaintKey(solid(0.0588235, 0.0901961, 0.164706, 0.07999999821186066)))
      .toBe(solidPaintKey(solid(15 / 255, 23 / 255, 42 / 255, 0.08)));
  });
  it('variable alpha must equal paint opacity for an exact key match', () => {
    expect(variableColorKey({ r: 0, g: 0, b: 0, a: 0.5 })).toBe(solidPaintKey(solid(0, 0, 0, 0.5)));
    expect(variableColorKey({ r: 0, g: 0, b: 0, a: 1 })).not.toBe(solidPaintKey(solid(0, 0, 0, 0.5)));
  });
  it('labels', () => {
    expect(keyLabel('#FFFFFFFF')).toBe('#FFFFFF');
    expect(keyLabel('#00000080')).toBe('#000000 · 50%');
  });
  it('stack signatures cover every paint, order, blend mode and visibility', () => {
    const a = stackSignature([solid(1, 0, 0), solid(0, 0, 1, 0.5)]);
    expect(a).toBe(stackSignature([solid(1, 0, 0), solid(0, 0, 1, 0.5)]));
    expect(a).not.toBe(stackSignature([solid(0, 0, 1, 0.5), solid(1, 0, 0)]));
    expect(a).not.toBe(stackSignature([solid(1, 0, 0), solid(0, 0, 1, 0.5, { visible: false })]));
    expect(a).not.toBe(stackSignature([solid(1, 0, 0), solid(0, 0, 1, 0.5, { blendMode: 'MULTIPLY' })]));
    expect(stackLayers(a)).toEqual([{ key: '#FF0000FF', hidden: false }, { key: '#0000FF80', hidden: false }]);
  });
});

describe('scopes', () => {
  it('maps properties to Figma variable scopes', () => {
    expect(scopeAllows(['TEXT_FILL'], 'text', 'text')).toBe(true);
    expect(scopeAllows(['TEXT_FILL'], 'fill', 'frame')).toBe(false);
    expect(scopeAllows(['FRAME_FILL'], 'fill', 'frame')).toBe(true);
    expect(scopeAllows(['FRAME_FILL'], 'fill', 'shape')).toBe(false);
    expect(scopeAllows(['ALL_FILLS'], 'text', 'text')).toBe(true);
    expect(scopeAllows(['ALL_FILLS'], 'stroke', 'frame')).toBe(false);
    expect(scopeAllows(['STROKE_COLOR'], 'stroke', 'shape')).toBe(true);
    expect(scopeAllows(['ALL_SCOPES'], 'stroke', 'shape')).toBe(true);
    expect(scopeAllows([], 'fill', 'shape')).toBe(false);
  });
  it('classifies node types', () => {
    expect(fillTargetForType('FRAME')).toBe('frame');
    expect(fillTargetForType('INSTANCE')).toBe('frame');
    expect(fillTargetForType('RECTANGLE')).toBe('shape');
    expect(fillTargetForType('TEXT')).toBe('text');
  });
});

describe('grouping', () => {
  const occ = (nodeId: string, property: Occurrence['property'], colorKey: string, contextKey = ''): Occurrence => ({
    nodeId, nodeName: nodeId, property, fillTarget: property === 'text' ? 'text' : 'frame', paintIndex: 0, colorKey, contextKey,
  });
  const c = (id: string, name = id): Candidate => ({ id, name, group: 'Tokens', kind: 'variable' });

  it('splits the same hex by property and by candidate set (mode)', () => {
    const occurrences = [
      occ('bg1', 'fill', '#FFFFFFFF', 'light'), occ('bg2', 'fill', '#FFFFFFFF', 'light'),
      occ('t1', 'text', '#FFFFFFFF', 'light'), occ('t2', 'text', '#FFFFFFFF', 'dark'),
      occ('x', 'stroke', '#12345678'),
    ];
    const cands = (o: Occurrence) => {
      if (o.property === 'fill') return [c('surface', 'Surface/Default')];
      if (o.property === 'text') return o.contextKey === 'dark' ? [c('primary', 'Text/Primary')] : [c('inverse', 'Text/Inverse'), c('onbrand', 'Text/OnBrand')];
      return [];
    };
    const { groups, members } = groupOccurrences(occurrences, cands, (k) => (k ? k.toUpperCase() : undefined), false);
    expect(groups).toHaveLength(4);
    const bg = groups.find((g) => g.property === 'fill')!;
    expect(bg.status).toBe('ready');
    expect(bg.layerCount).toBe(2);
    expect(members.get(bg.id)).toHaveLength(2);
    const textLight = groups.find((g) => g.property === 'text' && g.modeLabels.includes('LIGHT'))!;
    expect(textLight.status).toBe('choose');
    expect(textLight.candidates.map((x) => x.name)).toEqual(['Text/Inverse', 'Text/OnBrand']);
    const textDark = groups.find((g) => g.property === 'text' && g.modeLabels.includes('DARK'))!;
    expect(textDark.status).toBe('ready');
    expect(groups.find((g) => g.property === 'stroke')!.status).toBe('unmatched');
  });

  it('merges modes when the candidate set is identical', () => {
    const { groups } = groupOccurrences(
      [occ('a', 'fill', '#000000FF', 'light'), occ('b', 'fill', '#000000FF', 'dark')],
      () => [c('black')], (k) => k, false);
    expect(groups).toHaveLength(1);
    expect(groups[0].modeLabels).toEqual(['dark', 'light']);
  });

  it('counts layers, not occurrences, for multi-range text', () => {
    const o1 = { ...occ('t', 'text', '#FF0000FF'), range: [0, 3] as [number, number] };
    const o2 = { ...occ('t', 'text', '#FF0000FF'), range: [7, 9] as [number, number] };
    const { groups } = groupOccurrences([o1, o2], () => [c('red')], () => undefined, false);
    expect(groups[0].layerCount).toBe(1);
    expect(groups[0].occurrenceCount).toBe(2);
  });

  it('status rules', () => {
    expect(statusFor([])).toBe('unmatched');
    expect(statusFor([c('a')])).toBe('ready');
    expect(statusFor([c('a'), c('b')])).toBe('choose');
  });

  it('context keys are order independent', () => {
    expect(contextKeyOf({ b: '2', a: '1' })).toBe(contextKeyOf({ a: '1', b: '2' }));
  });
});

describe('recheck + readback', () => {
  it('skips anything that changed after the scan', () => {
    expect(recheckPaint(solid(1, 1, 1), '#FFFFFFFF')).toBeNull();
    expect(recheckPaint(undefined, '#FFFFFFFF')).toMatch(/no longer exists/);
    expect(recheckPaint(solid(1, 1, 0), '#FFFFFFFF')).toMatch(/changed/);
    expect(recheckPaint(solid(1, 1, 1, 1, { boundVariables: { color: { id: 'v' } } }), '#FFFFFFFF')).toMatch(/already bound/);
    expect(recheckPaint({ type: 'GRADIENT_LINEAR' }, '#FFFFFFFF')).toMatch(/solid/);
    expect(recheckPaint(solid(1, 1, 1, 1, { visible: false }), '#FFFFFFFF')).toMatch(/hidden/);
  });
  it('stack recheck', () => {
    const stack = [solid(1, 0, 0), solid(0, 0, 1, 0.5)];
    expect(recheckStack(stack, stackSignature(stack))).toBeNull();
    expect(recheckStack([solid(1, 0, 0)], stackSignature(stack))).toMatch(/changed/);
  });
  it('readback requires binding and identical appearance', () => {
    const bound = solid(0, 0, 0, 0.5, { boundVariables: { color: { id: 'v1' } } });
    expect(verifyBoundPaint(bound, 'v1', '#00000080')).toBeNull();
    // Figma replaces paint opacity with the variable alpha → appearance change is caught
    expect(verifyBoundPaint(solid(0, 0, 0, 1, { boundVariables: { color: { id: 'v1' } } }), 'v1', '#00000080')).toMatch(/Appearance/);
    expect(verifyBoundPaint(solid(0, 0, 0, 0.5), 'v1', '#00000080')).toMatch(/binding/);
  });
  it('untouched paints must be identical', () => {
    const a = [solid(1, 0, 0), solid(0, 1, 0)];
    const b = [solid(1, 0, 0, 1, { boundVariables: { color: { id: 'x' } } }), solid(0, 1, 0)];
    expect(untouchedPaintsEqual(a, b, new Set([0]))).toBe(true);
    expect(untouchedPaintsEqual(a, b, new Set([1]))).toBe(false);
  });
});
