// Minimal OpenTelemetry-shaped tracer. Off by default: every span is a shared
// no-op until enable(). Spans keep performance.now() doubles; export converts
// to OTLP/JSON (traceId/spanId hex, Unix-nano strings, typed attribute values).
// Cloudflare Workers caveat: clocks advance only at I/O boundaries there, so
// intra-request durations read as 0 by design; structure and attrs still work.
import type { Option } from './core/types.ts';
import { none, some } from './core/types.ts';
import { lookup } from './core/std.ts';

export type AttrValue = string | number | boolean;
export type Attrs = Readonly<Record<string, AttrValue>>;
export type Status = { readonly kind: 'unset' } | { readonly kind: 'error'; readonly message: string };
export type SpanEvent = { readonly name: string; readonly timeMs: number; readonly attrs: Attrs };
export type FinishedSpan = {
  readonly traceId: string; readonly spanId: string; readonly parent: Option<string>; readonly name: string;
  readonly startMs: number; readonly endMs: number; readonly durationMs: number;
  readonly attrs: Attrs; readonly events: readonly SpanEvent[]; readonly status: Status;
};

export interface SpanHandle {
  setAttribute(key: string, value: AttrValue): SpanHandle;
  addEvent(name: string, attrs: Attrs): SpanHandle;
  recordException(e: unknown): SpanHandle;
  end(): void;
  /** End at an explicit performance.now() time (work measured outside the span's own call). */
  endAt(ms: number): void;
}

// IDs: xorshift128 seeded once; two 32-bit words per 64-bit id.
let rs0 = (Math.random() * 0xffffffff) >>> 0 || 1, rs1 = (Math.random() * 0xffffffff) >>> 0 || 2;
const rnd32 = (): number => { let t = rs0; const s = rs1; rs0 = s; t ^= t << 11; t ^= t >>> 8; rs1 = (t ^ s ^ (s >>> 19)) >>> 0; return rs1; };
const hex = (bytes: number): string => { let o = ''; for (let i = 0; i < bytes; i += 4) o += rnd32().toString(16).padStart(8, '0'); return o; };
const now = (): number => performance.now();
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const NOOP: SpanHandle = {
  setAttribute: () => NOOP, addEvent: () => NOOP, recordException: () => NOOP, end: () => {}, endAt: () => {},
};

class LiveSpan implements SpanHandle {
  readonly tracer: Tracer; readonly traceId: string; readonly spanId: string; readonly parent: Option<string>;
  readonly name: string; readonly startMs: number;
  readonly attrs: Record<string, AttrValue>; readonly events: SpanEvent[] = [];
  status: Status = { kind: 'unset' };
  constructor(tracer: Tracer, traceId: string, parent: Option<string>, name: string, attrs: Attrs, startMs: number) {
    this.tracer = tracer; this.traceId = traceId; this.spanId = hex(8); this.parent = parent;
    this.name = name; this.startMs = startMs; this.attrs = { ...attrs };
  }
  setAttribute(key: string, value: AttrValue): SpanHandle { this.attrs[key] = value; return this; }
  addEvent(name: string, attrs: Attrs): SpanHandle { this.events.push({ name, timeMs: now(), attrs }); return this; }
  recordException(e: unknown): SpanHandle {
    this.status = { kind: 'error', message: message(e) };
    return this.addEvent('exception', { 'exception.message': message(e) });
  }
  end(): void { this.tracer.finish(this, now()); }
  endAt(ms: number): void { this.tracer.finish(this, ms); }
}

export class Tracer {
  enabled = false;
  serviceName = 'mpljs';
  private finished: FinishedSpan[] = [];
  private stack: LiveSpan[] = [];
  private traceId = hex(16);

  enable(): this { this.enabled = true; return this; }
  disable(): this { this.enabled = false; return this; }

  /** A new trace (one per top-level run). Inside an open span it joins that span's trace as a
   *  child instead, as OTel libraries do with the active context, so a caller's own span (a
   *  request, a frame) parents the library's work. */
  startTrace(name: string, attrs: Attrs): SpanHandle { return this.startTraceAt(name, attrs, now()); }
  /** startTrace with an explicit start (e.g. an input event's timeStamp, or navigation start = 0). */
  startTraceAt(name: string, attrs: Attrs, startMs: number): SpanHandle {
    if (!this.enabled) return NOOP;
    if (this.stack.length === 0) this.traceId = hex(16);
    return this.startSpanAt(name, attrs, startMs);
  }
  startSpan(name: string, attrs: Attrs): SpanHandle { return this.startSpanAt(name, attrs, now()); }
  startSpanAt(name: string, attrs: Attrs, startMs: number): SpanHandle {
    if (!this.enabled) return NOOP;
    const parent = this.stack.length > 0 ? some(this.stack[this.stack.length - 1].spanId) : none;
    const s = new LiveSpan(this, this.traceId, parent, name, attrs, startMs);
    this.stack.push(s);
    return s;
  }
  /** A finished child of the open span, from times measured elsewhere (resource timing, a
   *  timestamp taken before tracing was on). */
  record(name: string, attrs: Attrs, startMs: number, endMs: number): void {
    if (!this.enabled) return;
    this.startSpanAt(name, attrs, startMs).endAt(endMs);
  }
  /** Run fn inside a span; exceptions are recorded and rethrown; the span always ends. */
  span<T>(name: string, attrs: Attrs, fn: (s: SpanHandle) => T): T {
    const s = this.startSpan(name, attrs);
    try { return fn(s); } catch (e) { s.recordException(e); throw e; } finally { s.end(); }
  }
  finish(s: LiveSpan, endMs: number): void {
    const i = this.stack.lastIndexOf(s);
    if (i >= 0) this.stack.splice(i, 1);
    this.finished.push({ traceId: s.traceId, spanId: s.spanId, parent: s.parent, name: s.name, startMs: s.startMs, endMs,
                         durationMs: endMs - s.startMs, attrs: s.attrs, events: s.events, status: s.status });
  }
  spans(): readonly FinishedSpan[] { return this.finished.slice(); }
  clear(): void { this.finished = []; }
  /** OTLP/JSON ExportTraceServiceRequest. */
  toOTLP(): object {
    return { resourceSpans: [{ resource: { attributes: [otlpAttr('service.name', this.serviceName)] },
      scopeSpans: [{ scope: { name: 'mpljs' }, spans: this.finished.map(otlpSpan) }] }] };
  }
  /** Append one OTLP Span JSON per line (Node only); returns the count and clears. */
  async flush(path: string): Promise<number> {
    const spans = this.finished; this.clear();
    if (spans.length === 0) return 0;
    const fs = await import('node:fs/promises');
    await fs.appendFile(path, spans.map((s) => JSON.stringify(otlpSpan(s))).join('\n') + '\n');
    return spans.length;
  }
}

const toUnixNano = (ms: number): string => (BigInt(Math.round((performance.timeOrigin + ms) * 1000)) * 1000n).toString();
function otlpAttr(key: string, v: AttrValue): object {
  switch (typeof v) {
    case 'string': return { key, value: { stringValue: v } };
    case 'boolean': return { key, value: { boolValue: v } };
    case 'number': return { key, value: Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v } };
  }
}
const otlpAttrs = (a: Attrs): object[] => Object.entries(a).map(([k, v]) => otlpAttr(k, v));
function otlpSpan(s: FinishedSpan): object {
  return {
    traceId: s.traceId, spanId: s.spanId, ...(s.parent.kind === 'some' ? { parentSpanId: s.parent.value } : {}),
    name: s.name, kind: 1, startTimeUnixNano: toUnixNano(s.startMs), endTimeUnixNano: toUnixNano(s.endMs),
    attributes: otlpAttrs(s.attrs),
    events: s.events.map((e) => ({ name: e.name, timeUnixNano: toUnixNano(e.timeMs), attributes: otlpAttrs(e.attrs) })),
    status: s.status.kind === 'error' ? { code: 2, message: s.status.message } : { code: 0 },
  };
}

export const tracer: Tracer = new Tracer();

const kv = ([k, v]: readonly [string, AttrValue]): string => `${k}=${String(v)}`;

/** Spans as an indented tree with durations and attributes, for humans. */
export function renderTree(spans: readonly FinishedSpan[], width: number): string {
  if (spans.length === 0) return '(no spans)';
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string, FinishedSpan[]>();
  const roots: FinishedSpan[] = [];
  const kids = (id: string): readonly FinishedSpan[] => { const v = lookup(children, id); return v.kind === 'some' ? v.value : []; };
  for (const s of spans) {
    if (s.parent.kind === 'some' && ids.has(s.parent.value)) children.set(s.parent.value, [...kids(s.parent.value), s]);
    else roots.push(s);
  }
  const t0 = Math.min(...spans.map((s) => s.startMs));
  const lines = [`trace ${spans[0].traceId}  ${spans.length} spans`];
  const walk = (level: readonly FinishedSpan[], depth: number): void => {
    for (const s of level.toSorted((a, b) => a.startMs - b.startMs)) {
      const left = `${'  '.repeat(depth)}${s.name}`.padEnd(26) + `${(s.startMs - t0).toFixed(3).padStart(8)} +${s.durationMs.toFixed(3).padStart(7)} ms`;
      const flag = s.status.kind === 'error' ? ` ✗ ${s.status.message}` : '';
      lines.push(`${left}  ${Object.entries(s.attrs).map(kv).join(' ')}${flag}`.slice(0, width));
      for (const e of s.events) lines.push(`${'  '.repeat(depth + 1)}· ${e.name} ${Object.entries(e.attrs).map(kv).join(' ')}`.slice(0, width));
      walk(kids(s.spanId), depth + 1);
    }
  };
  walk(roots, 0);
  return lines.join('\n');
}
