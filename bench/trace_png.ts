// Honeycomb-style trace waterfall -> SVG + PNG, both rendered by mpljs itself.
//   node bench/trace_png.ts out.png            # traces a demo render
//   node bench/trace_png.ts out.png spans.jsonl # renders a flushed JSONL trace
// Builds the picture directly on the Scene ADT, with mpljs' own AutoLocator for the time axis.
import { readFileSync, writeFileSync } from 'node:fs';
import { registerFonts, subplots, tracer, Tracer } from '../src/index.ts';
import { allFonts } from '../src/fonts/all.ts';
import type { FinishedSpan, Ink, Node, Rgb, Scene, Seg } from '../src/index.ts';
import { toSVG } from '../src/render/svg.ts';
import { toPNGSync } from '../src/render/agg.ts';
import { measure } from '../src/core/text.ts';
import { resolveFace } from '../src/core/fonts.ts';
import { autoTicks } from '../src/core/ticker.ts';

// Scene node helpers (the typed Node shapes from src/core/types.ts)
type TextNode = Extract<Node, { kind: 'text' }> & { readonly weight?: number };   // weight rides along for scaleScene
const rgb = (hex: string, alpha = 1): Rgb => ({ hex, alpha });
const rect = ({ x, y, w, h, fill, fillAlpha = 1 }: { x: number; y: number; w: number; h: number; fill: string; fillAlpha?: number }): Node => ({ kind: 'rect', x, y, w, h, ink: { kind: 'fill', fill: rgb(fill, fillAlpha) } });
const path = ({ segs, stroke, strokeWidth }: { segs: Seg[]; stroke: string; strokeWidth: number }): Node => ({ kind: 'path', segs, ink: { kind: 'stroke', stroke: { color: rgb(stroke), width: strokeWidth, cap: 'butt', join: 'miter', dash: { kind: 'solid' } } } });
const text = ({ text: t, x, y, size, color, weight = 400 }: { text: string; x: number; y: number; size: number; color: string; weight?: number }): TextNode => ({ kind: 'text', text: t, x, y, sizePx: size, sizePt: size, weight, face: resolveFace([FONT], weight).id, glyphs: [], color: rgb(color), rotation: 'horizontal' });
const group = (nodes: Node[]): Node => ({ kind: 'group', clip: { kind: 'none' }, nodes, tag: '' });

const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#bab0ab', '#1f77b4', '#17becf'];
registerFonts(...allFonts);   // a bench tool: every face
const FONT = 'Inter', DPI = 72;                                 // layout in 1x px (1px = 1pt); scaleScene renders at S×
const M = (s: string | number, size: number) => measure(String(s), size, DPI, resolveFace([FONT], 400));
const W = 1500, LEFT = 330, RIGHT = 24, TOP = 78, ROW = 34, NAME = 12, ATTR = 9.5, GUTTER = 8;

const colorFor = (() => { const m = new Map<string, string>(); return (name: string): string => { const c = m.get(name) ?? PALETTE[m.size % PALETTE.length] as string; m.set(name, c); return c; }; })();
const fmtVal = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(5) : v);
const txt = (s: unknown, x: number, y: number, size: number, color: string): TextNode => text({ text: String(s), x, y, size, color });
const clipText = (s: string, maxPx: number, size: number): string => { let t = String(s); while (t.length > 3 && M(t, size).width > maxPx) t = t.slice(0, -2) + '…'; return t; };

/** spans: in-memory Span objects (startMs/endMs/attrs) or OTLP JSON spans. */
/** Re-render a 1x scene at S× device pixels: geometry scales, text is re-shaped at dpi 72·S. */
export function scaleScene(scene: Scene, S: number): Scene {
  const sc = (n: Node): Node => {
    switch (n.kind) {
      case 'group': return { ...n, clip: n.clip.kind === 'rect' ? { ...n.clip, x: n.clip.x * S, y: n.clip.y * S, w: n.clip.w * S, h: n.clip.h * S } : n.clip, nodes: n.nodes.map(sc) };
      case 'rect': return { ...n, x: n.x * S, y: n.y * S, w: n.w * S, h: n.h * S, ink: inkS(n.ink) };
      case 'path': return { ...n, segs: n.segs.map((g) => g.map((v, i) => (i === 0 ? v : (v as number) * S)) as unknown as Seg), ink: inkS(n.ink) };
      case 'text': {
        const face = n.face, lay = measure(n.text, n.sizePt, DPI * S, resolveFace([FONT], 'weight' in n ? (n.weight as number) : 400));
        return { ...n, x: n.x * S, y: n.y * S, sizePx: n.sizePx * S, face, glyphs: lay.runs[0]?.glyphs ?? [] };
      }
      default: return n;
    }
  };
  const inkS = (ink: Ink): Ink => (ink.kind === 'fill' ? ink : { ...ink, stroke: { ...ink.stroke, width: ink.stroke.width * S } });
  return { ...scene, width: scene.width * S, height: scene.height * S, dpi: DPI * S, nodes: scene.nodes.map(sc) };
}

/** An OTLP/JSON span as tracer.flush writes it (the fields this picture uses). */
export type OtlpSpan = { traceId: string; spanId: string; parentSpanId?: string; name: string; startTimeUnixNano: string; endTimeUnixNano: string;
  attributes?: { key: string; value: Record<string, unknown> }[]; status?: { code?: number; message?: string } };
type Row = { name: string; traceId: string; spanId: string; parentSpanId: string; startMs: number; endMs: number; attrs: Record<string, unknown>; status?: { code: number; message: string } };

export function traceScene(spansIn: readonly (FinishedSpan | OtlpSpan)[], title = 'trace'): Scene {
  // accept in-memory FinishedSpans or OTLP JSON spans
  const spans: Row[] = spansIn.map((s): Row => ('startMs' in s
    ? { ...s, parentSpanId: s.parent.kind === 'some' ? s.parent.value : '', status: { code: s.status.kind === 'error' ? 2 : 0, message: s.status.kind === 'error' ? s.status.message : '' } }
    : { ...s, parentSpanId: s.parentSpanId || '', status: { code: s.status?.code ?? 0, message: s.status?.message ?? '' }, startMs: Number(BigInt(s.startTimeUnixNano)) / 1e6, endMs: Number(BigInt(s.endTimeUnixNano)) / 1e6,
        attrs: Object.fromEntries((s.attributes || []).map(a => [a.key, Object.values(a.value)[0]])) }));
  const t0 = Math.min(...spans.map(s => s.startMs)), t1 = Math.max(...spans.map(s => s.endMs));
  const total = Math.max(t1 - t0, 1e-6);
  const byId = new Map(spans.map(s => [s.spanId, s])), kids = new Map<string | null, Row[]>();
  for (const s of spans) { const k = byId.has(s.parentSpanId) ? s.parentSpanId : null; const a = kids.get(k) ?? []; a.push(s); kids.set(k, a); }
  const rows: { s: Row; depth: number }[] = [];
  const walk = (p: string | null, depth: number): void => { for (const s of (kids.get(p) ?? []).toSorted((a, b) => a.startMs - b.startMs)) { rows.push({ s, depth }); walk(s.spanId, depth + 1); } };
  walk(null, 0);

  const H = TOP + rows.length * ROW + 28;
  const plotW = W - LEFT - RIGHT;
  const X = (ms: number): number => LEFT + (ms - t0) / total * plotW;
  const nodes: Node[] = [];

  // header
  nodes.push(text({ text: title, x: 24, y: 30, size: 17, color: '#1f2328', weight: 600 }));
  nodes.push(txt(`${spans.length} spans · ${total.toFixed(3)} ms · trace ${spans[0].traceId}`, 24, 48, 10.5, '#6e7781'));

  // time axis + grid (mpljs AutoLocator on the time range)
  const ticks = autoTicks(0, total, Math.floor(plotW / 80)).filter(t => t >= 0 && t <= total);
  const gridSegs: Seg[] = [];
  for (const t of ticks) {
    const x = Math.round(X(t0 + t)) + 0.5;
    gridSegs.push(['M', x, TOP - 6], ['L', x, H - 28]);
    const label = `${+t.toPrecision(4)} ms`;
    nodes.push(txt(label, x - M(label, 9).width / 2, TOP - 10, 9, '#8b949e'));
  }
  // row backgrounds first, grid above them, content on top
  rows.forEach((_, i) => { if (i % 2) nodes.push(rect({ x: 0, y: TOP + i * ROW, w: W, h: ROW, fill: '#f6f8fa' })); });
  nodes.push(path({ segs: gridSegs, stroke: '#e6e8eb', strokeWidth: 1 }));

  // rows
  rows.forEach(({ s, depth }, i) => {
    const y = TOP + i * ROW;
    const color = colorFor(s.name);
    const indent = 16 * depth;
    // depth guides
    if (depth) nodes.push(path({ segs: [['M', 24 + indent - 8 + 0.5, y + 4] as const, ['L', 24 + indent - 8 + 0.5, y + ROW - 4] as const], stroke: '#d0d7de', strokeWidth: 1 }));
    nodes.push(rect({ x: 24 + indent, y: y + 7, w: 4, h: NAME + 2, fill: color }));
    nodes.push(txt(clipText(s.name, LEFT - 24 - indent - 40, NAME), 24 + indent + 8, y + 7 + NAME, NAME, '#1f2328'));
    // bar
    const x0 = X(s.startMs), x1 = Math.max(X(s.endMs ?? s.startMs), x0 + 1.5);
    const err = s.status?.code === 2;
    nodes.push(rect({ x: x0, y: y + 5, w: x1 - x0, h: 14, fill: err ? '#cf222e' : color, fillAlpha: 0.9 }));
    // duration label: inside the bar if it fits, else just after
    const d = ((s.endMs ?? s.startMs) - s.startMs);
    const dl = d >= 1 ? `${d.toFixed(2)} ms` : `${(d * 1000).toFixed(0)} µs`;
    const dw = M(dl, 9.5).width;
    if (x1 - x0 > dw + 10) nodes.push(txt(dl, x0 + 5, y + 5 + 10.5, 9.5, '#ffffff'));
    else nodes.push(txt(dl, Math.min(x1 + 5, W - RIGHT - dw), y + 5 + 10.5, 9.5, '#57606a'));
    // attrs line, clipped to the plot width, kv pairs with keys dimmed
    const parts = Object.entries(s.attrs).map(([k, v]) => [k, fmtVal(v)]);
    const totalW = parts.reduce((n, [k, v]) => n + M(k + '=', ATTR).width + M(String(v), ATTR).width + GUTTER, 0);
    // start under the bar, but pull left so the line fits; never left of the plot edge
    let ax = Math.max(LEFT + 4, Math.min(x0, W - RIGHT - totalW)), remaining = W - RIGHT - ax;
    for (const [k, v] of parts) {
      const kw = M(k + '=', ATTR).width, vw = M(String(v), ATTR).width;
      if (kw + vw + GUTTER > remaining) { if (remaining > 12) nodes.push(txt('…', ax, y + 29, ATTR, '#8b949e')); break; }
      nodes.push(txt(k + '=', ax, y + 29, ATTR, '#8b949e'));
      nodes.push(txt(v, ax + kw, y + 29, ATTR, '#24292f'));
      ax += kw + vw + GUTTER; remaining -= kw + vw + GUTTER;
    }
    if (err) nodes.push(txt(s.status?.message ?? '', ax, y + 29, ATTR, '#cf222e'));
  });

  nodes.push(path({ segs: [['M', LEFT - 0.5, TOP - 6], ['L', LEFT - 0.5, H - 28]], stroke: '#d0d7de', strokeWidth: 1 }));
  return { width: W, height: H, dpi: DPI, background: { kind: 'solid' as const, color: rgb('#ffffff') }, nodes: [group(nodes)] };
}

// ---- CLI
const [outPng, jsonl] = process.argv.slice(2);
if (outPng && import.meta.url === `file://${process.argv[1]}`) {
  let spans: readonly (FinishedSpan | OtlpSpan)[], title: string;
  if (jsonl) {
    spans = readFileSync(jsonl, 'utf8').trim().split('\n').map((l): OtlpSpan => JSON.parse(l));
    title = `trace from ${jsonl}`;
  } else {
    const x = Array.from({ length: 200 }, (_, i) => i / 20);
    const build = () => { const [fig, ax] = subplots({ style: 'seaborn-v0_8-darkgrid' }); for (let i = 0; i < 6; i++) ax.plot(x, x.map(v => Math.sin(v + i / 2) + i * 0.4), i % 2 ? 'o-' : '--', { label: `series ${i}` }); ax.bar([0, 2, 4, 6, 8], [1, 2, 1.5, 2.5, 1], { label: 'bars' }); ax.legend(); ax.set_title('traced render'); ax.set_xlabel('x'); ax.set_ylabel('y'); return fig; };
    for (let i = 0; i < 10; i++) build().toPNGSync();
    tracer.enable(); build().toPNGSync(); spans = tracer.spans(); tracer.disable();
    title = 'mpljs → PNG — layout, Agg-port raster, encode: 6 lines × 200 pts, markers, bars, legend (warm)';
  }
  const scene = traceScene(spans, title);
  writeFileSync(outPng.replace(/\.png$/, '.svg'), toSVG(scene, new Tracer()));
  writeFileSync(outPng, toPNGSync(scene, new Tracer()));
  console.log(`wrote ${outPng} (${spans.length} spans)`);
}
