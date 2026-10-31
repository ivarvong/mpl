// Tracer: off by default (no-op spans), OTLP-shaped records when enabled.
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subplots, tracer } from '../src/index.ts';

const draw = () => { const [fig, ax] = subplots(); ax.plot([1, 2, 3], [1, 4, 9], 'o-', { label: 'sq' }); ax.bar([1, 2, 3], [1, 2, 3]); ax.legend(); return fig.toSVG(); };

draw();
assert.equal(tracer.spans().length, 0, 'disabled tracer collects nothing');

tracer.enable();
const svg = draw();
assert.ok(svg.startsWith('<svg'));
const spans = tracer.spans();
const names = new Set(spans.map(s => s.name));
for (const n of ['figure.layout', 'axes.layout', 'limits.x', 'ticks.y', 'legend', 'legend.best', 'render.svg', 'render.node', 'tick']) assert.ok(names.has(n), `span ${n}`);
const root = spans.find(s => s.name === 'figure.layout');
assert.equal(root.parent.kind, 'none');
assert.ok(spans.every(s => s.traceId === root.traceId), 'one trace id per run');
assert.ok(spans.filter(s => s.name !== 'figure.layout' && s.name !== 'render.svg').every(s => s.parent.kind === 'some'), 'children carry parent ids');
assert.match(root.traceId, /^[0-9a-f]{32}$/); assert.match(root.spanId, /^[0-9a-f]{16}$/);
assert.ok(root.durationMs >= 0);
const j = tracer.toOTLP().resourceSpans[0].scopeSpans[0].spans[0]; assert.match(j.startTimeUnixNano, /^\d{19}$/); assert.ok(BigInt(j.endTimeUnixNano) >= BigInt(j.startTimeUnixNano));
const otlp = tracer.toOTLP();
assert.equal(otlp.resourceSpans[0].scopeSpans[0].spans.length, spans.length);

draw();
assert.notEqual(tracer.spans().at(-1).traceId, root.traceId, 'new run, new trace');

// a caller's open span parents the library's trace (OTel active-context semantics)
tracer.clear();
const app = tracer.startTrace('app.request', {}); draw(); app.end();
const all = tracer.spans(), appSpan = all.find(s => s.name === 'app.request'), lay = all.find(s => s.name === 'figure.layout');
assert.equal(lay.parent.kind, 'some'); assert.equal(lay.parent.value, appSpan.spanId, 'figure.layout nests under the caller span');
assert.ok(all.every(s => s.traceId === appSpan.traceId), 'one trace across caller and library');
draw(); assert.notEqual(tracer.spans().at(-1).traceId, appSpan.traceId, 'after the caller span ends, a new trace');

// explicit-time spans: startTraceAt / record / endAt keep the given times and nest under the open span
tracer.clear();
const st = tracer.startTraceAt('startup', {}, 0); tracer.record('fetch', { n: 3 }, 1.5, 4.25); st.endAt(10);
const [f1, s1] = tracer.spans();
assert.equal(f1.name, 'fetch'); assert.equal(f1.startMs, 1.5); assert.equal(f1.endMs, 4.25); assert.equal(f1.parent.value, s1.spanId);
assert.equal(s1.startMs, 0); assert.equal(s1.durationMs, 10);
const { FACE_LOADS } = await import('../src/index.ts');
assert.equal(FACE_LOADS.length, 8); assert.ok(FACE_LOADS.every((l) => l.endMs >= l.startMs && l.glyphs > 0), 'face loads timed');

const out = join(tmpdir(), 'mpljs-trace-test.jsonl');
const n = await tracer.flush(out);
const lines = readFileSync(out, 'utf8').trim().split('\n');
assert.equal(lines.length, n); assert.equal(tracer.spans().length, 0);
assert.ok(lines.every(l => 'traceId' in JSON.parse(l)));
unlinkSync(out);
console.log(`tracer: ${n} spans, OTLP shape ok, no-op when disabled`);
