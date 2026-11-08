// The axes frame in device px and its data -> device transform, through each axis' scale.
import { forward } from './scale.ts';
import type { Position, Scale } from './types.ts';

export type AxesBox = {
  readonly x0: number; readonly x1: number; readonly yTop: number; readonly yBot: number; readonly w: number; readonly h: number;
  /** top and bottom edges flipped with the geometry height Hg (Agg's int canvas height; the float height in SVG): for paths and clips */
  readonly yTopG: number; readonly yBotG: number;
  /** bottom and top edges in display (y-up) coordinates, b·H and t·H exactly as matplotlib holds them; H − yBot can be 1 ulp off */
  readonly b: number; readonly t: number;
};
export type Frame = {
  readonly box: AxesBox; readonly W: number; readonly H: number;
  /** the height paths, markers, images and clip boxes flip with: Agg's RendererAgg uses its int canvas height, while
   *  text flips with the float H (Text._draw: get_canvas_width_height). matplotlib's SVG flips everything with H. */
  readonly Hg: number;
  /** the canvas PathClipper clips line paths to (±1 px): int(W) × int(H) in Agg, W × H in SVG */
  readonly clipW: number; readonly clipH: number;
  /** Agg's pixel snapping (PathSnapper, draw_markers' pixel grid) applies; matplotlib's SVG backend never snaps */
  readonly snap: boolean;
  readonly xlim: readonly [number, number]; readonly ylim: readonly [number, number];
  readonly xscale: Scale; readonly yscale: Scale;
  /** transData's affine part, display (y up) = scaled·a + c, with matplotlib's float operations */
  readonly ax: number; readonly cx: number; readonly ay: number; readonly cy: number;
};

/**
 * The axes bbox as matplotlib holds it: TransformedBbox(position, transFigure), so edges are
 * l·W, r·W, b·H, t·H in display (y-up) coordinates and widths are differences of edges.
 * Top-left y values flip with the canvas height, as Agg does.
 */
export function axesBox(p: Position, W: number, H: number, Hg: number = H): AxesBox {
  const [l, b, r, t] = p;
  const x0 = l * W, x1 = r * W, y0 = b * H, y1 = t * H;
  return { x0, x1, yTop: H - y1, yBot: H - y0, yTopG: Hg - y1, yBotG: Hg - y0, w: x1 - x0, h: y1 - y0, b: y0, t: y1 };
}

/**
 * BboxTransformTo(axes.bbox) ∘ BboxTransformFrom(viewLim), composed by np.dot:
 * From = [1/w, −v0·(1/w)], so a = outw·(1/w), c = outw·(−v0·(1/w)) + outl. Points map as (v·a + 0) + c.
 */
export function frame(box: AxesBox, W: number, H: number, dev: Device, xlim: readonly [number, number], ylim: readonly [number, number], xscale: Scale, yscale: Scale): Frame {
  const vx0 = forward(xscale, xlim[0]), vx1 = forward(xscale, xlim[1]), vy0 = forward(yscale, ylim[0]), vy1 = forward(yscale, ylim[1]);
  const kx = 1.0 / (vx1 - vx0), ky = 1.0 / (vy1 - vy0);
  const outb = box.b;
  return { box, W, H, Hg: geomHeight(H, dev), clipW: dev === 'agg' ? Math.trunc(W) : W, clipH: dev === 'agg' ? Math.trunc(H) : H, snap: dev === 'agg', xlim, ylim, xscale, yscale,
           ax: box.w * kx, cx: box.w * (-vx0 * kx) + box.x0,
           ay: box.h * ky, cy: box.h * (-vy0 * ky) + outb };
}
/**
 * The output a scene is laid out for. 'agg' is the PNG rasterizer (RendererAgg: int canvas, path snapping); 'svg' is
 * matplotlib's SVG backend (float canvas, no snapping).
 */
export type Device = 'agg' | 'svg';
/** The height a device flips path geometry with: RendererAgg's int(height), or the float height in SVG. */
export const geomHeight = (H: number, dev: Device): number => (dev === 'agg' ? Math.trunc(H) : H);

/** Data → top-left device px. */
export const tx = (f: Frame, x: number): number => forward(f.xscale, x) * f.ax + f.cx;
/** Data → top-left device px. Matches Agg's concatenated affine (scale(1,-1)·translate(0,H) after
 *  transData): y_out = −ay·v + (H − cy). Reassociating as H − (ay·v + cy) is 1 ulp off at some *.5 and
 *  disagrees with PathSnapper's floor(v+0.5). */
export const ty = (f: Frame, y: number): number => forward(f.yscale, y) * -f.ay + (f.Hg - f.cy);
/** Data → top-left px for a text anchor, which flips with the float height. */
export const tyText = (f: Frame, y: number): number => forward(f.yscale, y) * -f.ay + (f.H - f.cy);
