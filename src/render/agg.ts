// Scene → RGBA8 pixels, reproducing matplotlib's RendererAgg: paths through
// conv_curve/conv_dash/conv_stroke into the scanline AA rasterizer, markers
// rasterized once and stamped at integer offsets, text as FreeType glyph bitmaps.
import type { Clip, Ink, Node, Option, Paint, Rgb, Scene, Seg, Stroke } from '../core/types.ts';
import { assertNever, none, some } from '../core/types.ts';
import { faceById, ftScale } from '../core/fonts.ts';
import { pyRound } from '../core/log.ts';
import { lookup } from '../core/std.ts';
import type { Tracer } from '../trace.ts';
import { blendCoverage, clearCanvas, newCanvas, quantize } from './agg/canvas.ts';
import type { Canvas, Rgba8 } from './agg/canvas.ts';
import { EMPTY, Rasterizer } from './agg/raster.ts';
import type { Coverage, IBox } from './agg/raster.ts';
import { dashPath, fillPath, flatten, strokePath, stroker } from './agg/stroke.ts';
import type { Sub } from './agg/stroke.ts';
import { drawGlyph } from './ft.ts';
import { encodePNG, encodePNGSync, pngStream } from './png.ts';

export type { Canvas } from './agg/canvas.ts';

function rgba8(c: Rgb): Rgba8 {
  const h = c.hex.replace('#', '');
  const v = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  const a = h.length >= 8 ? v(6) / 255 * c.alpha : c.alpha;
  return { r: v(0), g: v(2), b: v(4), a: quantize(a) };
}

/** set_clipbox: floor(v + 0.5) on each edge, clamped to the canvas. */
function clipBox(clip: Clip, outer: IBox): IBox {
  switch (clip.kind) {
    case 'none': return outer;
    case 'rect': {
      const x0 = Math.floor(clip.x + 0.5), x1 = Math.floor(clip.x + clip.w + 0.5);
      const y0 = Math.floor(clip.y + 0.5), y1 = Math.floor(clip.y + clip.h + 0.5);
      return { x0: Math.max(outer.x0, Math.min(x0, x1)), y0: Math.max(outer.y0, Math.min(y0, y1)),
               x1: Math.min(outer.x1, Math.max(x0, x1)), y1: Math.min(outer.y1, Math.max(y0, y1)) };
    }
    default: return assertNever(clip);
  }
}

type Ctx = { readonly c: Canvas; readonly ras: Rasterizer; readonly dpi: number; readonly tracer: Tracer };

const rectSegs = (x: number, y: number, w: number, h: number): readonly Seg[] =>
  [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];

function strokeCoverage(ras: Rasterizer, clip: IBox, subs: readonly Sub[], s: Stroke): Coverage {
  ras.reset(clip);
  const st = stroker(s.width, s.cap, s.join, s.width);
  switch (s.dash.kind) {
    case 'solid': strokePath(subs, st, ras); break;
    case 'dashed': strokePath(dashPath(subs, s.dash.pattern, s.dash.offset), st, ras); break;
    default: assertNever(s.dash);
  }
  return ras.sweep('nonzero');
}

function fillCoverage(ras: Rasterizer, clip: IBox, subs: readonly Sub[]): Coverage {
  ras.reset(clip);
  fillPath(subs, ras);
  return ras.sweep('nonzero');
}

/** RendererAgg::_draw_path: face, then stroke (each its own rasterizer pass). */
function drawPath(x: Ctx, subs: readonly Sub[], ink: Ink, clip: IBox): void {
  x.tracer.span('raster.path', { ink: ink.kind, subpaths: subs.length, vertices: subs.reduce((n, s) => n + s.xs.length, 0) }, (sp) => {
    const fill = (): void => { const cov = fillCoverage(x.ras, clip, subs); sp.setAttribute('fill.runs', cov.sx.length); blendCoverage(x.c, cov, rgba8(ink.kind === 'stroke' ? ink.stroke.color : ink.fill), 0, 0, clip); };
    const stroke = (s: Stroke): void => { const cov = strokeCoverage(x.ras, clip, subs, s); sp.setAttribute('stroke.runs', cov.sx.length).setAttribute('stroke.w', +s.width.toFixed(3)); blendCoverage(x.c, cov, rgba8(s.color), 0, 0, clip); };
    switch (ink.kind) {
      case 'fill': fill(); return;
      case 'stroke': stroke(ink.stroke); return;
      case 'fillStroke': fill(); stroke(ink.stroke); return;
      default: assertNever(ink);
    }
  });
}

/**
 * RendererAgg::draw_markers: the marker is rasterized once (no clipping) relative to
 * its origin and each instance is stamped at the integer floor of its position; the
 * renderer clip box is inclusive of its right/bottom edge, hence the +1.
 */
function drawMarkers(x: Ctx, outline: readonly Seg[], xs: Float64Array, ys: Float64Array, ink: Ink, clip: IBox): void {
  x.tracer.span('raster.markers', { count: xs.length, ink: ink.kind }, (sp) => { sp.setAttribute('masks', stampMarkers(x, outline, xs, ys, ink, clip)); });
}
/** Returns how many distinct sub-pixel phases were rasterized (one per cache entry). */
function stampMarkers(x: Ctx, outline: readonly Seg[], xs: Float64Array, ys: Float64Array, ink: Ink, clip: IBox): number {
  const cache = new Map<string, readonly [Coverage, Coverage]>();
  const free: IBox = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const mclip: IBox = { x0: clip.x0, y0: clip.y0, x1: clip.x1 + 1, y1: clip.y1 + 1 };
  const masks = (fx: number, fy: number): readonly [Coverage, Coverage] => {
    const key = `${fx},${fy}`;
    const hit = lookup(cache, key);
    if (hit.kind === 'some') return hit.value;
    const subs = flatten(outline, fx, fy);
    const r: readonly [Coverage, Coverage] = (() => {
      switch (ink.kind) {
        case 'fill': return [fillCoverage(x.ras, free, subs), EMPTY] as const;
        case 'stroke': return [EMPTY, strokeCoverage(x.ras, free, subs, ink.stroke)] as const;
        case 'fillStroke': return [fillCoverage(x.ras, free, subs), strokeCoverage(x.ras, free, subs, ink.stroke)] as const;
        default: return assertNever(ink);
      }
    })();
    cache.set(key, r);
    return r;
  };
  const face: Rgba8 = ink.kind === 'stroke' ? { r: 0, g: 0, b: 0, a: 0 } : rgba8(ink.fill);
  const edge: Rgba8 = ink.kind === 'fill' ? { r: 0, g: 0, b: 0, a: 0 } : rgba8(ink.stroke.color);
  for (let i = 0; i < xs.length; i++) {
    const px = Math.floor(xs[i]), py = Math.floor(ys[i]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const [f, s] = masks(xs[i] - px, ys[i] - py);
    if (f.w > 0) blendCoverage(x.c, f, face, px, py, mclip);
    if (s.w > 0) blendCoverage(x.c, s, edge, px, py, mclip);
  }
  return cache.size;
}

/** Per-glyph placement from _draw_text_glyphs_and_boxes; y is FreeType-up from the canvas bottom. */
function drawText(x: Ctx, n: Extract<Node, { kind: 'text' }>): void {
  x.tracer.span('raster.text', { text: n.text, glyphs: n.glyphs.length, pt: n.sizePt, rot: n.rotation }, () => drawGlyphs(x, n));
}
function drawGlyphs(x: Ctx, n: Extract<Node, { kind: 'text' }>): void {
  const face = faceById(n.face);
  const scale = ftScale(face, n.sizePt, x.dpi);
  const color = rgba8(n.color);
  const H = x.c.h;
  for (const { gid, dx } of n.glyphs) {
    switch (n.rotation) {
      case 'horizontal': drawGlyph(x.c, face, gid, scale, false, pyRound(64 * (n.x + dx)), pyRound(64 * (H - n.y)), color); break;
      case 'vertical': drawGlyph(x.c, face, gid, scale, true, pyRound(64 * n.x), pyRound(64 * (H - n.y + dx)), color); break;
      default: assertNever(n.rotation);
    }
  }
}

function drawNode(x: Ctx, n: Node, clip: IBox): void {
  switch (n.kind) {
    case 'rect': drawPath(x, flatten(rectSegs(n.x, n.y, n.w, n.h), 0, 0), n.ink, clip); return;
    case 'path': drawPath(x, flatten(n.segs, 0, 0), n.ink, clip); return;
    case 'polyline': {
      const sub: Sub = { xs: Array.from(n.xs), ys: Array.from(n.ys), closed: false };
      if (sub.xs.length > 0) x.tracer.span('raster.polyline', { vertices: sub.xs.length, w: +n.stroke.width.toFixed(3), dash: n.stroke.dash.kind }, (sp) => {
        const cov = strokeCoverage(x.ras, clip, [sub], n.stroke);
        sp.setAttribute('runs', cov.sx.length);
        blendCoverage(x.c, cov, rgba8(n.stroke.color), 0, 0, clip);
      });
      return;
    }
    case 'markers': drawMarkers(x, n.shape, n.xs, n.ys, n.ink, clip); return;
    case 'text': drawText(x, n); return;
    case 'group': { const inner = clipBox(n.clip, clip); for (const ch of n.nodes) drawNode(x, ch, inner); return; }
    default: assertNever(n);
  }
}

function background(x: Ctx, p: Paint, full: IBox): void {
  switch (p.kind) {
    case 'none': return;
    case 'solid': drawPath(x, flatten(rectSegs(0, 0, x.c.w, x.c.h), 0, 0), { kind: 'fill', fill: p.color }, full); return;
    default: assertNever(p);
  }
}

/** Rasterize a Scene. Canvas size truncates like RendererAgg(int(w), int(h)). */
export function renderRGBA(scene: Scene, tracer: Tracer): Canvas {
  return renderInto(newCanvas(Math.trunc(scene.width), Math.trunc(scene.height), scene.dpi), scene, tracer);
}

// toPNGSync throws its canvas away once encoded, so it renders into one kept scratch canvas
// (synchronous: nothing else can hold it meanwhile). A fresh 11 MB buffer costs ~8 ms in first-touch
// page faults plus GC pressure; clearing a reused one costs ~1.5 ms. Only the latest size is kept.
let scratch: Option<Canvas> = none;
function scratchCanvas(w: number, h: number, dpi: number): Canvas {
  if (scratch.kind === 'some' && scratch.value.w === w && scratch.value.h === h) {
    const c = { ...scratch.value, dpi };
    clearCanvas(c);
    return c;
  }
  const c = newCanvas(w, h, dpi);
  scratch = some(c);
  return c;
}
/**
 * Rasterize into the kept scratch canvas. The result is only valid until the next call: encode it
 * and drop it (toPNGSync). Callers that keep pixels use renderRGBA.
 */
export function renderScratch(scene: Scene, tracer: Tracer): Canvas {
  return renderInto(scratchCanvas(Math.trunc(scene.width), Math.trunc(scene.height), scene.dpi), scene, tracer);
}
/** Drop the scratch canvas kept by toPNGSync (memory back to the GC). */
export function releaseScratch(): void { scratch = none; }

function renderInto(c: Canvas, scene: Scene, tracer: Tracer): Canvas {
  const full: IBox = { x0: 0, y0: 0, x1: c.w, y1: c.h };
  const x: Ctx = { c, ras: new Rasterizer(full), dpi: scene.dpi, tracer };
  tracer.span('raster.background', {}, () => background(x, scene.background, full));
  scene.nodes.forEach((n, i) => tracer.span('raster.node', { i, kind: n.kind }, () => drawNode(x, n, full)));
  return c;
}

export const toPNG = (scene: Scene, tracer: Tracer): Promise<Uint8Array> =>
  encodePNG(tracer.span('png.rasterize', { w: scene.width, h: scene.height }, () => renderRGBA(scene, tracer)));
export const toPNGSync = (scene: Scene, tracer: Tracer): Uint8Array => {
  const c = tracer.span('png.rasterize', { w: scene.width, h: scene.height },
    () => renderScratch(scene, tracer));
  return tracer.span('png.encode', { sync: true }, (sp) => { const b = encodePNGSync(c); sp.setAttribute('bytes', b.length); return b; });
};
export const toPNGStream = (scene: Scene, tracer: Tracer): ReadableStream<Uint8Array> =>
  pngStream(tracer.span('png.rasterize', { w: scene.width, h: scene.height }, () => renderRGBA(scene, tracer)));
