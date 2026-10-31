// Scene construction helpers and Agg's pixel snapping.
import type { Clip, Ink, Node, Option, Paint, Seg, Stroke } from './types.ts';
import { none, some } from './types.ts';

/** Agg PathSnapper: pixel centres for odd rounded stroke widths, pixel edges for even (top-left raster coords). */
export const snapOffset = (strokePx: number): number => (Math.round(strokePx) % 2 === 1 ? 0.5 : 0.0);
export const snap = (v: number, strokePx: number): number => Math.floor(v + 0.5) + snapOffset(strokePx);

/** What a shape draws; none when it would draw nothing (fully transparent counts as nothing). */
export function inkOf(fill: Paint, stroke: Option<Stroke>): Option<Ink> {
  const f = fill.kind === 'solid' && fill.color.alpha > 0 ? some(fill.color) : none;
  const s = stroke.kind === 'some' && stroke.value.color.alpha > 0 && stroke.value.width > 0 ? stroke : none;
  if (f.kind === 'some' && s.kind === 'some') return some({ kind: 'fillStroke', fill: f.value, stroke: s.value });
  if (f.kind === 'some') return some({ kind: 'fill', fill: f.value });
  if (s.kind === 'some') return some({ kind: 'stroke', stroke: s.value });
  return none;
}

export const rectNode = (x: number, y: number, w: number, h: number, ink: Ink): Node => ({ kind: 'rect', x, y, w, h, ink });
export const pathNode = (segs: readonly Seg[], ink: Ink): Node => ({ kind: 'path', segs, ink });
export const group = (nodes: readonly Node[], clip: Clip): Node => ({ kind: 'group', clip, nodes, tag: '' });
export const NO_CLIP: Clip = { kind: 'none' };
