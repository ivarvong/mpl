// Tracer: off by default (no-op spans), OTLP-shaped records when enabled.
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subplots, tracer } from '../src/index.ts';
import type { FinishedSpan } from '../src/index.ts';

// The OTLP/JSON shape, as far as this test looks (toOTLP returns `object`).
type Otlp = { resourceSpans: { scopeSpans: { spans: { startTimeUnixNano: string; endTimeUnixNano: string }[] }[] }[] };
const otlpSpans = (o: object) => (o as Otlp).resourceSpans[0]?.scopeSpans[0]?.spans ?? [];

/** Narrow a lookup that the assertions below require to succeed. */
const must = <T>(v: T | undefined, what: string): T => { assert.ok(v !== undefined, what); return v; };
const draw = () => { const [fig, ax] = subplots(); ax.plot([1, 2, 3], [1, 4, 9], 'o-', { label: 'sq' }); ax.bar([1, 2, 3], [1, 2, 3]); ax.legend(); return fig.toSVG(); };

draw();
assert.equal(tracer.spans().length, 0, 'disabled tracer collects nothing');

tracer.enable();
const svg = draw();
assert.ok(svg.startsWith('<svg'));
const spans = tracer.spans();
const names = new Set(spans.map(s => s.name));
for (const n of ['figure.layout', 'axes.layout', 'limits.x', 'ticks.y', 'legend', 'legend.best', 'render.svg', 'render.node', 'tick']) assert.ok(names.has(n), `span ${n}`);
const root = must(spans.find(s => s.name === 'figure.layout'), 'figure.layout root');
assert.equal(root.parent.kind, 'none');
assert.ok(spans.every(s => s.traceId === root.traceId), 'one trace id per run');
assert.ok(spans.filter(s => s.name !== 'figure.layout' && s.name !== 'render.svg').every(s => s.parent.kind === 'some'), 'children carry parent ids');
assert.match(root.traceId, /^[0-9a-f]{32}$/); assert.match(root.spanId, /^[0-9a-f]{16}$/);
assert.ok(root.durationMs >= 0);
const first = must(otlpSpans(tracer.toOTLP())[0], 'first OTLP span');
const j = first; assert.match(j.startTimeUnixNano, /^\d{19}$/); assert.ok(BigInt(j.endTimeUnixNano) >= BigInt(j.startTimeUnixNano));
const otlp = tracer.toOTLP();
assert.equal(otlpSpans(otlp).length, spans.length);

draw();
assert.notEqual(tracer.spans().at(-1)?.traceId, root.traceId, 'new run, new trace');

// a caller's open span parents the library's trace (OTel active-context semantics)
tracer.clear();
const app = tracer.startTrace('app.request', {}); draw(); app.end();
const all = tracer.spans(), appSpan = must(all.find(s => s.name === 'app.request'), 'app span'), lay = must(all.find(s => s.name === 'figure.layout'), 'layout span');
assert.deepEqual(lay.parent, { kind: 'some', value: appSpan.spanId }, 'figure.layout nests under the caller span');
assert.ok(all.every(s => s.traceId === appSpan.traceId), 'one trace across caller and library');
draw(); assert.notEqual(tracer.spans().at(-1)?.traceId, appSpan.traceId, 'after the caller span ends, a new trace');

// explicit-time spans: startTraceAt / record / endAt keep the given times and nest under the open span
tracer.clear();
const st = tracer.startTraceAt('startup', {}, 0); tracer.record('fetch', { n: 3 }, 1.5, 4.25); st.endAt(10);
const [f1, s1] = tracer.spans() as [FinishedSpan, FinishedSpan];
assert.equal(f1.name, 'fetch'); assert.equal(f1.startMs, 1.5); assert.equal(f1.endMs, 4.25); assert.deepEqual(f1.parent, { kind: 'some', value: s1.spanId });
assert.equal(s1.startMs, 0); assert.equal(s1.durationMs, 10);
// faces decode on first use, each once, under a font.decode span; registering decodes nothing
const { FACE_LOADS, FACE_CATALOG, registerFonts } = await import('../src/index.ts');
const { getFace } = await import('../src/core/fonts.ts');
const { allFonts } = await import('../src/fonts/all.ts');
assert.deepEqual(FACE_LOADS.map((l) => l.id), ['DejaVu Sans:400'], 'only the default face, decoded by the first draw');
registerFonts(...allFonts);
assert.equal(FACE_LOADS.length, 1, 'registering does not decode');
const decodeTrace = tracer.startTrace('decode-all', {});
for (const e of FACE_CATALOG) getFace(e);
for (const e of FACE_CATALOG) getFace(e);
decodeTrace.end();
assert.deepEqual(FACE_LOADS.map((l) => l.id), FACE_CATALOG.map((e) => e.id), 'every face decoded exactly once, in first-use order');
assert.ok(FACE_LOADS.every((l) => l.endMs >= l.startMs && l.glyphs > 0), 'face loads timed');
assert.deepEqual(tracer.spans().filter((s) => s.name === 'font.decode').map((s) => s.attrs['face']), FACE_CATALOG.slice(1).map((e) => e.id), 'one font.decode span per decode');

const out = join(tmpdir(), 'mpljs-trace-test.jsonl');
const n = await tracer.flush(out);
const lines = readFileSync(out, 'utf8').trim().split('\n');
assert.equal(lines.length, n); assert.equal(tracer.spans().length, 0);
assert.ok(lines.every(l => 'traceId' in JSON.parse(l)));
unlinkSync(out);
console.log(`tracer: ${n} spans, OTLP shape ok, no-op when disabled`);
