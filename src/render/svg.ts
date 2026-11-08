import { encodePNGSync } from './png.ts';
import { canvasOf } from './agg/canvas.ts';
// Scene -> SVG as an IOList, flattened once at the boundary or streamed. No DOM.
import type { Ink, Node, Paint, Scene, Seg, Stroke } from '../core/types.ts';
import { assertNever } from '../core/types.ts';
import { faceById, ftScale } from '../core/fonts.ts';
import type { Face } from '../core/fonts.ts';
import { pyRound } from '../core/log.ts';
import { lookup } from '../core/std.ts';
import type { IOList } from './iolist.ts';
import { iolistChunks, iolistSize, iolistToStream, iolistToString } from './iolist.ts';
import type { Tracer } from '../trace.ts';

// 4-decimal formatting without toFixed: round to 1e-4, then shortest round-trip.
const f = (v: number): string => String(Math.round(v * 10000) / 10000);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NL = '\n';

function seg(s: Seg): string {
  switch (s[0]) {
    case 'M': case 'L': return `${s[0]}${f(s[1])} ${f(s[2])}`;
    case 'Q': return `Q${f(s[1])} ${f(s[2])} ${f(s[3])} ${f(s[4])}`;
    case 'C': return `C${f(s[1])} ${f(s[2])} ${f(s[3])} ${f(s[4])} ${f(s[5])} ${f(s[6])}`;
    case 'Z': return 'Z';
    default: return assertNever(s);
  }
}
const d = (segs: readonly Seg[]): string => segs.map(seg).join(' ');

/**
 * How path data is written. 'default' is mpl's usual output: 4 decimals and a command letter on every segment.
 * 'compact' (toSVG({ precision })) rounds path coordinates (`d`, marker positions) to `decimals` places and writes
 * a repeated command letter once. Lines become relative (polylineCompact), and a line vertex that rounds onto the
 * one before it is dropped. Other attributes (sizes, widths, opacities, text positions) keep 4 decimals.
 */
export type PathData = { readonly kind: 'default' } | { readonly kind: 'compact'; readonly decimals: number };
export const DEFAULT_PATH_DATA: PathData = { kind: 'default' };
const POW10 = [1, 10, 100, 1000, 10000];

/** f() at dp ∈ 0..4 decimals. (Writing it from integer parts measured slower end to end than V8's own conversion.) */
export const fdp = (v: number, dp: number): string => String(Math.round(v * POW10[dp]) / POW10[dp]);

/** Compact path data: one letter per run of the same command, coordinates at `dp` decimals. */
function dCompact(segs: readonly Seg[], dp: number): string {
  let out = '', prev = '', last = '';
  for (const s of segs) {
    let body: string;
    switch (s[0]) {
      case 'M': case 'L': body = `${fdp(s[1], dp)} ${fdp(s[2], dp)}`; break;
      case 'Q': body = `${fdp(s[1], dp)} ${fdp(s[2], dp)} ${fdp(s[3], dp)} ${fdp(s[4], dp)}`; break;
      case 'C': body = `${fdp(s[1], dp)} ${fdp(s[2], dp)} ${fdp(s[3], dp)} ${fdp(s[4], dp)} ${fdp(s[5], dp)} ${fdp(s[6], dp)}`; break;
      case 'Z': out += 'Z'; prev = 'Z'; continue;
      default: return assertNever(s);
    }
    if (s[0] === 'L' && (prev === 'L' || prev === 'M') && body === last) continue;
    out += s[0] === prev && s[0] !== 'M' ? ' ' + body : s[0] + body;
    prev = s[0]; last = body;
  }
  return out;
}
const pathD = (segs: readonly Seg[], pd: PathData): string => (pd.kind === 'default' ? d(segs) : dCompact(segs, pd.decimals));

function strokeAttrs(s: Stroke): string {
  let a = ` stroke="${s.color.hex}" stroke-width="${f(s.width)}"`;
  if (s.color.alpha !== 1) a += ` stroke-opacity="${f(s.color.alpha)}"`;
  if (s.cap !== 'butt') a += ` stroke-linecap="${s.cap}"`;
  if (s.join !== 'miter') a += ` stroke-linejoin="${s.join}"`;
  switch (s.dash.kind) {
    case 'solid': break;
    case 'dashed': a += ` stroke-dasharray="${s.dash.pattern.map(f).join(' ')}"` + (s.dash.offset !== 0 ? ` stroke-dashoffset="${f(s.dash.offset)}"` : ''); break;
    default: assertNever(s.dash);
  }
  return a;
}
const fillAttr = (c: { readonly hex: string; readonly alpha: number }): string => ` fill="${c.hex}"` + (c.alpha !== 1 ? ` fill-opacity="${f(c.alpha)}"` : '');
function inkAttrs(ink: Ink): string {
  switch (ink.kind) {
    case 'fill': return `${fillAttr(ink.fill)} stroke="none"`;
    case 'stroke': return ` fill="none"${strokeAttrs(ink.stroke)}`;
    case 'fillStroke': return `${fillAttr(ink.fill)}${strokeAttrs(ink.stroke)}`;
    default: return assertNever(ink);
  }
}

/**
 * How text is written. 'text': <text> elements, laid out by the viewer's own font engine. 'glyphs':
 * matplotlib's default svg.fonttype 'path' — each glyph's outline once in <defs> (font units), placed
 * with <use> at the same 26.6 pen positions the rasterizer uses, so geometry is exact everywhere.
 */
export type SvgText = 'text' | 'glyphs';
const tagAttr = (tag: string): string => (tag === '' ? '' : ` data-artist="${esc(tag)}"`);
type Ids = { next: number; readonly glyphs: Map<string, string>; readonly text: SvgText; readonly dpi: number; readonly prefix: string; readonly pd: PathData };

/** Outline in font units (y up) as path data: on-curve, conic (with implied midpoints) and cubic segments. */
function glyphPath(face: Face, gid: number): string {
  const o = lookup(face.outlines, gid);
  if (o.kind === 'none') return '';
  const offs = lookup(face.offsets, gid);
  const out: string[] = [];
  for (const [ci, flat] of o.value.entries()) {
    const n = flat.length / 3;
    if (n === 0) continue;
    // composite glyphs: contours are in component units; add the summed component offsets
    let dx = 0, dy = 0;
    if (offs.kind === 'some') { const od = offs.value[ci]; for (let j = 0; j < od.length; j += 2) { dx += od[j]; dy += od[j + 1]; } }
    const X = (i: number): number => flat[3 * (((i % n) + n) % n)] + dx, Y = (i: number): number => flat[3 * (((i % n) + n) % n) + 1] + dy;
    const T = (i: number): number => flat[3 * (((i % n) + n) % n) + 2];
    // start on an on-curve point, or the midpoint of two conics
    let start = 0;
    while (start < n && T(start) !== 1) start++;
    let sx: number, sy: number;
    if (start === n) { sx = (X(0) + X(1)) / 2; sy = (Y(0) + Y(1)) / 2; start = 0; } else { sx = X(start); sy = Y(start); }
    out.push(`M${sx} ${sy}`);
    for (let k = 1; k <= n;) {
      const i = start + k;
      if (T(i) === 1) { out.push(`L${X(i)} ${Y(i)}`); k++; continue; }
      if (T(i) === 2) { out.push(`C${X(i)} ${Y(i)} ${X(i + 1)} ${Y(i + 1)} ${X(i + 2)} ${Y(i + 2)}`); k += 3; continue; }
      // conic: end at the next on-curve point or the implied midpoint
      if (T(i + 1) === 0) { out.push(`Q${X(i)} ${Y(i)} ${(X(i) + X(i + 1)) / 2} ${(Y(i) + Y(i + 1)) / 2}`); k++; }
      else { out.push(`Q${X(i)} ${Y(i)} ${X(i + 1)} ${Y(i + 1)}`); k += 2; }
    }
    out.push('Z');
  }
  return out.join('');
}

function glyphRef(face: Face, gid: number, ids: Ids, defs: string[]): string {
  const key = `${face.id}/${gid}`;
  const known = lookup(ids.glyphs, key);
  if (known.kind === 'some') return known.value;
  const id = `${ids.prefix}g${ids.glyphs.size}`;
  ids.glyphs.set(key, id);
  defs.push(`<path id="${id}" d="${glyphPath(face, gid)}"/>`);
  return id;
}

/** Glyphs placed like the rasterizer: origin at pyRound(64·pos)/64, outline scaled by the 16.16 ft scale. */
function glyphText(n: Extract<Node, { kind: 'text' }>, ids: Ids): string {
  const face = faceById(n.face);
  const s = ftScale(face, n.sizePt, ids.dpi) / 65536 / 64;     // 16.16 font units → 26.6, then px
  const defs: string[] = [], uses: string[] = [];
  for (const { gid, dx } of n.glyphs) {
    const id = glyphRef(face, gid, ids, defs);
    const r = n.rotation;
    let x: number, y: number, rot: string;
    if (r === 'vertical') {
      x = pyRound(64 * n.x) / 64; y = pyRound(64 * (n.y - dx)) / 64; rot = ' rotate(-90)';
    } else if (r !== 'horizontal' && r.kind === 'angled') {
      const rad = (r.deg * Math.PI) / 180, c = Math.cos(rad), sA = Math.sin(rad);
      x = pyRound(64 * (n.x + dx * c)) / 64;
      y = pyRound(64 * (n.y + n.dy - dx * sA)) / 64;  // SVG y-down: mirror the FT +dx*sin used in agg
      rot = ` rotate(${f(-r.deg)})`;
    } else {
      x = pyRound(64 * (n.x + dx)) / 64; y = pyRound(64 * (n.y + n.dy)) / 64; rot = '';
    }
    uses.push(`<use href="#${id}" transform="translate(${f(x)} ${f(y)})${rot} scale(${s} ${-s})"/>`);
  }
  const op = n.color.alpha !== 1 ? ` fill-opacity="${f(n.color.alpha)}"` : '';
  return (defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '') + `<g fill="${n.color.hex}"${op} aria-label="${esc(n.text)}">${uses.join('')}</g>` + NL;
}

function nodeIO(n: Node, ids: Ids): IOList {
  switch (n.kind) {
    case 'rect': return `<rect x="${f(n.x)}" y="${f(n.y)}" width="${f(n.w)}" height="${f(n.h)}"${inkAttrs(n.ink)}/>` + NL;
    case 'path': return `<path d="${pathD(n.segs, ids.pd)}"${inkAttrs(n.ink)}/>` + NL;
    case 'polyline': {
      if (ids.pd.kind === 'compact') return ['<path d="', polylineCompact(n, ids.pd.decimals), `" fill="none"${strokeAttrs(n.stroke)}/>` + NL];
      const chunks: string[] = [];
      let buf = '';
      let mi = 0;
      for (let i = 0; i < n.xs.length; i++) {
        const mv = mi < n.moves.length && n.moves[mi] === i;
        if (mv) mi++;
        buf += `${mv ? 'M' : 'L'}${f(n.xs[i])} ${f(n.ys[i])}`;
        if (buf.length > 16384) { chunks.push(buf); buf = ''; }
      }
      chunks.push(buf);
      return ['<path d="', chunks, `" fill="none"${strokeAttrs(n.stroke)}/>` + NL];
    }
    case 'markers': {
      const id = `${ids.prefix}m${ids.next++}`;
      const chunks: string[] = [`<defs><path id="${id}" d="${pathD(n.shape, ids.pd)}"${inkAttrs(n.ink)}/></defs>` + NL];
      const dp = ids.pd.kind === 'compact' ? ids.pd.decimals : 4;
      let buf = '';
      for (let i = 0; i < n.xs.length; i++) {
        buf += `<use href="#${id}" x="${fdp(n.xs[i], dp)}" y="${fdp(n.ys[i], dp)}"/>`;
        if (buf.length > 8192) { chunks.push(buf + NL); buf = ''; }
      }
      if (buf.length > 0) chunks.push(buf + NL);
      return chunks;
    }
    case 'text': {
      if (ids.text === 'glyphs') return glyphText(n, ids);
      const rot = n.rotation === 'vertical' ? ` transform="rotate(-90 ${f(n.x)} ${f(n.y)})"`
        : (n.rotation !== 'horizontal' && n.rotation.kind === 'angled')
          ? ` transform="rotate(${f(-n.rotation.deg)} ${f(n.x)} ${f(n.y)})"` : '';
      const op = n.color.alpha !== 1 ? ` fill-opacity="${f(n.color.alpha)}"` : '';
      const face = faceById(n.face);
      const wt = face.weight !== 400 ? ` font-weight="${face.weight}"` : '';
      return `<text x="${f(n.x)}" y="${f(n.y + n.dy)}" font-family="${esc(face.family)}"${wt} font-size="${f(n.sizePx)}" fill="${n.color.hex}"${op}${rot}>${esc(n.text)}</text>` + NL;
    }
    case 'image': return imageSvg(n);
    case 'group': {
      switch (n.clip.kind) {
        case 'none': return [`<g${tagAttr(n.tag)}>` + NL, n.nodes.map((c) => nodeIO(c, ids)), '</g>' + NL];
        case 'rect': {
          const id = `${ids.prefix}c${ids.next++}`, c = n.clip;
          return [`<clipPath id="${id}"><rect x="${f(c.x)}" y="${f(c.y)}" width="${f(c.w)}" height="${f(c.h)}"/></clipPath>` + NL + `<g clip-path="url(#${id})"${tagAttr(n.tag)}>` + NL,
                  n.nodes.map((ch) => nodeIO(ch, ids)), '</g>' + NL];
        }
        default: return assertNever(n.clip);
      }
    }
    default: return assertNever(n);
  }
}

/**
 * A polyline as compact path data: an absolute M per subpath, then relative l deltas on the rounded grid (with an
 * absolute L every ANCHOR vertices). Deltas
 * are differences of the rounded integers (units of 10^-dp px), so every vertex lands exactly where its absolute
 * rounding would, with no drift. A vertex that rounds onto the previous one is dropped; leading zeros go
 * (".5"), and a minus sign separates numbers.
 */
// Every ANCHOR-th line vertex is absolute (L). Chromium sums relative coordinates in float32; at precision 4, a
// 7,000-vertex run drifted enough to change 1.2% of a 2x screenshot's pixels (all antialiasing, by <= 32). Re-anchoring
// every 32 keeps that to 0.04% for about 1.5% more bytes; precision 1 renders the same at any anchor (2.59% vs default).
const ANCHOR = 32;
/** k units of 1/p as the shortest decimal (k / p is the double nearest it), leading zero dropped: '.5', '-.5'. */
const rel = (k: number, p: number): string => (k === 0 ? '0' : k > -p && k < p ? (k < 0 ? '-' + String(-k / p).slice(1) : String(k / p).slice(1)) : String(k / p));
function polylineCompact(n: Extract<Node, { kind: 'polyline' }>, dp: number): string[] {
  const p = POW10[dp], xs = n.xs, ys = n.ys, moves = n.moves;
  const chunks: string[] = [];
  let buf = '', mode = 0, mi = 0, px = 0, py = 0, run = 0;   // mode: 0 after M, 1 in l, 2 in L
  for (let i = 0; i < xs.length; i++) {
    const kx = Math.round(xs[i] * p), ky = Math.round(ys[i] * p);
    if (mi < moves.length && moves[mi] === i) { mi++; buf += 'M' + String(kx / p) + ' ' + String(ky / p); mode = 0; run = 0; px = kx; py = ky; continue; }
    if (kx === px && ky === py) continue;
    if (++run >= ANCHOR) {
      buf += (mode === 2 ? ' ' : 'L') + String(kx / p) + ' ' + String(ky / p); mode = 2; run = 0;
    } else {
      const dx = kx - px, dy = ky - py;
      buf += (mode === 1 ? (dx < 0 ? '' : ' ') : 'l') + rel(dx, p) + (dy < 0 ? '' : ' ') + rel(dy, p); mode = 1;
    }
    px = kx; py = ky;
    if (buf.length > 16384) { chunks.push(buf); buf = ''; }
  }
  chunks.push(buf);
  return chunks;
}

function imageSvg(n: Extract<Node, { kind: 'image' }>): string {
  const c = canvasOf(n.w, n.h, 100, n.rgba);
  const png = encodePNGSync(c);
  let bin = '';
  for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i]);
  const b64 = btoa(bin);
  return `<image x="${f(n.x)}" y="${f(n.y)}" width="${f(n.w)}" height="${f(n.h)}" `
    + `preserveAspectRatio="none" xlink:href="data:image/png;base64,${b64}"/>` + NL;
}

export function leafCount(n: Node): number {
  switch (n.kind) {
    case 'rect': case 'path': case 'text': return 1;
    case 'polyline': return n.xs.length;
    case 'markers': return n.xs.length;
    case 'image': return 1;
    case 'group': return n.nodes.reduce((a, c) => a + leafCount(c), 0);
    default: return assertNever(n);
  }
}

function hasImage(n: Node): boolean {
  switch (n.kind) {
    case 'image': return true;
    case 'group': return n.nodes.some(hasImage);
    case 'rect': case 'path': case 'text': case 'polyline': case 'markers': return false;
    default: return assertNever(n);
  }
}

function background(p: Paint, W: number, H: number): string {
  switch (p.kind) {
    case 'none': return '';
    case 'solid': return `<rect width="${f(W)}" height="${f(H)}"${fillAttr(p.color)}/>` + NL;
    default: return assertNever(p);
  }
}

/**
 * An annotated SVG's per-Axes part: how many top-level scene nodes the Axes drew (an Axes' nodes are contiguous,
 * in axes order, from the first node) and its sidecar (src/render/annotate.ts), already escaped for XML text.
 */
export type SvgAxesAnnot = { readonly nodes: number; readonly sidecar: string };

/** Wrap each Axes' nodes in <g data-mpl-axes="k">, its sidecar first as <metadata class="mpl-axes">. */
function annotated(body: readonly IOList[], annot: readonly SvgAxesAnnot[]): IOList {
  const out: IOList[] = [];
  let at = 0;
  annot.forEach((a, k) => {
    out.push(`<g data-mpl-axes="${k}">` + NL + `<metadata class="mpl-axes">${a.sidecar}</metadata>` + NL, body.slice(at, at + a.nodes), '</g>' + NL);
    at += a.nodes;
  });
  out.push(body.slice(at));
  return out;
}

/**
 * Scene -> IOList; one span per top-level node. Element ids are per render, so output is deterministic;
 * `prefix` keeps them unique when several SVGs share one HTML document (ids are document-global).
 * `annot` (empty by default, which leaves the output byte-identical) makes it an annotated SVG for mpl/interactive.
 */
export function svgIO(scene: Scene, tracer: Tracer, text: SvgText = 'text', prefix = '', pd: PathData = DEFAULT_PATH_DATA, annot: readonly SvgAxesAnnot[] = []): IOList {
  const ids: Ids = { next: 0, glyphs: new Map(), text, dpi: scene.dpi, prefix, pd };
  const nodes = scene.nodes.map((n, i) => tracer.span('render.node', { i, kind: n.kind, leaves: leafCount(n) }, (sp) => {
    const io = nodeIO(n, ids);
    sp.setAttribute('bytes', iolistSize(io));
    return io;
  }));
  const body: IOList = annot.length > 0 ? annotated(nodes, annot) : nodes;
  const W = scene.width, H = scene.height;
  // <image> uses xlink:href (matplotlib's form, readable by SVG 1.1 tools), so the prefix must be bound or
  // standalone viewers (browsers' <img>, GitHub) reject the whole file as malformed XML.
  const xlink = scene.nodes.some(hasImage) ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '';
  return [`<svg xmlns="http://www.w3.org/2000/svg"${xlink} width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}">` + NL,
          background(scene.background, W, H), body, '</svg>' + NL];
}

export const svgChunks = (scene: Scene, tracer: Tracer, text: SvgText = 'text', prefix = '', pd: PathData = DEFAULT_PATH_DATA, annot: readonly SvgAxesAnnot[] = []): Generator<string> => iolistChunks(svgIO(scene, tracer, text, prefix, pd, annot));
export const toSVG = (scene: Scene, tracer: Tracer, text: SvgText = 'text', prefix = '', pd: PathData = DEFAULT_PATH_DATA, annot: readonly SvgAxesAnnot[] = []): string => iolistToString(svgIO(scene, tracer, text, prefix, pd, annot));
export const svgStream = (scene: Scene, tracer: Tracer, text: SvgText = 'text', prefix = '', pd: PathData = DEFAULT_PATH_DATA, annot: readonly SvgAxesAnnot[] = []): ReadableStream<Uint8Array> => iolistToStream(svgIO(scene, tracer, text, prefix, pd, annot));
