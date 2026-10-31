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
type Ids = { next: number; readonly glyphs: Map<string, string>; readonly text: SvgText; readonly dpi: number; readonly prefix: string };

/** Outline in font units (y up) as path data: on-curve, conic (with implied midpoints) and cubic segments. */
function glyphPath(face: Face, gid: number): string {
  const o = lookup(face.outlines, gid);
  if (o.kind === 'none') return '';
  const out: string[] = [];
  for (const flat of o.value) {
    const n = flat.length / 3;
    if (n === 0) continue;
    const X = (i: number): number => flat[3 * (((i % n) + n) % n)], Y = (i: number): number => flat[3 * (((i % n) + n) % n) + 1];
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
    const x = n.rotation === 'vertical' ? pyRound(64 * n.x) / 64 : pyRound(64 * (n.x + dx)) / 64;
    const y = n.rotation === 'vertical' ? pyRound(64 * (n.y - dx)) / 64 : pyRound(64 * n.y) / 64;
    const rot = n.rotation === 'vertical' ? ' rotate(-90)' : '';
    uses.push(`<use href="#${id}" transform="translate(${f(x)} ${f(y)})${rot} scale(${s} ${-s})"/>`);
  }
  const op = n.color.alpha !== 1 ? ` fill-opacity="${f(n.color.alpha)}"` : '';
  return (defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '') + `<g fill="${n.color.hex}"${op} aria-label="${esc(n.text)}">${uses.join('')}</g>` + NL;
}

function nodeIO(n: Node, ids: Ids): IOList {
  switch (n.kind) {
    case 'rect': return `<rect x="${f(n.x)}" y="${f(n.y)}" width="${f(n.w)}" height="${f(n.h)}"${inkAttrs(n.ink)}/>` + NL;
    case 'path': return `<path d="${d(n.segs)}"${inkAttrs(n.ink)}/>` + NL;
    case 'polyline': {
      const chunks: string[] = [];
      let buf = '';
      for (let i = 0; i < n.xs.length; i++) {
        buf += `${i === 0 ? 'M' : 'L'}${f(n.xs[i])} ${f(n.ys[i])}`;
        if (buf.length > 16384) { chunks.push(buf); buf = ''; }
      }
      chunks.push(buf);
      return ['<path d="', chunks, `" fill="none"${strokeAttrs(n.stroke)}/>` + NL];
    }
    case 'markers': {
      const id = `${ids.prefix}m${ids.next++}`;
      const chunks: string[] = [`<defs><path id="${id}" d="${d(n.shape)}"${inkAttrs(n.ink)}/></defs>` + NL];
      let buf = '';
      for (let i = 0; i < n.xs.length; i++) {
        buf += `<use href="#${id}" x="${f(n.xs[i])}" y="${f(n.ys[i])}"/>`;
        if (buf.length > 8192) { chunks.push(buf + NL); buf = ''; }
      }
      if (buf.length > 0) chunks.push(buf + NL);
      return chunks;
    }
    case 'text': {
      if (ids.text === 'glyphs') return glyphText(n, ids);
      const rot = n.rotation === 'vertical' ? ` transform="rotate(-90 ${f(n.x)} ${f(n.y)})"` : '';
      const op = n.color.alpha !== 1 ? ` fill-opacity="${f(n.color.alpha)}"` : '';
      const face = faceById(n.face);
      const wt = face.weight !== 400 ? ` font-weight="${face.weight}"` : '';
      return `<text x="${f(n.x)}" y="${f(n.y)}" font-family="${esc(face.family)}"${wt} font-size="${f(n.sizePx)}" fill="${n.color.hex}"${op}${rot}>${esc(n.text)}</text>` + NL;
    }
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

export function leafCount(n: Node): number {
  switch (n.kind) {
    case 'rect': case 'path': case 'text': return 1;
    case 'polyline': return n.xs.length;
    case 'markers': return n.xs.length;
    case 'group': return n.nodes.reduce((a, c) => a + leafCount(c), 0);
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
 * Scene -> IOList; one span per top-level node. Element ids are per render, so output is deterministic;
 * `prefix` keeps them unique when several SVGs share one HTML document (ids are document-global).
 */
export function svgIO(scene: Scene, tracer: Tracer, text: SvgText = 'text', prefix = ''): IOList {
  const ids: Ids = { next: 0, glyphs: new Map(), text, dpi: scene.dpi, prefix };
  const body = scene.nodes.map((n, i) => tracer.span('render.node', { i, kind: n.kind, leaves: leafCount(n) }, (sp) => {
    const io = nodeIO(n, ids);
    sp.setAttribute('bytes', iolistSize(io));
    return io;
  }));
  const W = scene.width, H = scene.height;
  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}">` + NL,
          background(scene.background, W, H), body, '</svg>' + NL];
}

export const svgChunks = (scene: Scene, tracer: Tracer, text: SvgText = 'text', prefix = ''): Generator<string> => iolistChunks(svgIO(scene, tracer, text, prefix));
export const toSVG = (scene: Scene, tracer: Tracer, text: SvgText = 'text', prefix = ''): string => iolistToString(svgIO(scene, tracer, text, prefix));
export const svgStream = (scene: Scene, tracer: Tracer, text: SvgText = 'text', prefix = ''): ReadableStream<Uint8Array> => iolistToStream(svgIO(scene, tracer, text, prefix));
