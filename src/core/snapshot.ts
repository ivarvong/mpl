// Layout-cache keys without serializing the data. A figure's spec holds every series (often the caller's own
// Float64Array, zero-copy), so JSON.stringify(spec) cost ~6.5 ms on a 35k-point chart, on every first render.
// A snapshot copies typed arrays with a native slice and keeps the rest of the tree. `sameSpec` then walks the live
// spec against it. Equality is at least as strict as comparing the JSON: a snapshot match implies equal JSON.
// Functions are ignored and objects that aren't plain compare by their JSON, as JSON.stringify treats them.
import { isNullish, isPlainObject } from './std.ts';

class JsonLeaf { readonly json: string; constructor(json: string) { this.json = json; } }
class BytesLeaf {
  readonly proto: unknown; readonly bytes: Uint8Array;
  constructor(proto: unknown, bytes: Uint8Array) { this.proto = proto; this.bytes = bytes; }
}
const FN = Symbol('function');

const bytesOf = (v: ArrayBufferView): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/** A copy of `v` that later mutation of `v` (or of the arrays it holds) cannot change. */
export function snapshot(v: unknown): unknown {
  if (typeof v === 'function') return FN;
  if (isNullish(v) || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return v instanceof DataView ? new JsonLeaf(JSON.stringify(v)) : new BytesLeaf(Object.getPrototypeOf(v), bytesOf(v).slice());
  if (Array.isArray(v)) return v.map(snapshot);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = snapshot(v[k]);
    return out;
  }
  return new JsonLeaf(JSON.stringify(v));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  const n = a.length;
  if (b.length !== n) return false;
  // a is the snapshot's own aligned copy; compare b in 4-byte words when its offset allows
  if ((n & 3) === 0 && (b.byteOffset & 3) === 0) {
    const wa = new Int32Array(a.buffer, a.byteOffset, n >> 2), wb = new Int32Array(b.buffer, b.byteOffset, n >> 2);
    for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return false;
    return true;
  }
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Whether `live` still equals the state `snap` was taken from. */
export function sameSpec(snap: unknown, live: unknown): boolean {
  if (snap === FN) return typeof live === 'function';
  if (isNullish(snap) || typeof snap !== 'object') return typeof live === typeof snap && (snap === live || (typeof snap === 'number' && Number.isNaN(snap) && Number.isNaN(live)));
  if (snap instanceof BytesLeaf) return ArrayBuffer.isView(live) && !(live instanceof DataView) && Object.getPrototypeOf(live) === snap.proto && sameBytes(snap.bytes, bytesOf(live));
  if (snap instanceof JsonLeaf) return typeof live === 'object' && !isNullish(live) && !isPlainObject(live) && !Array.isArray(live) && JSON.stringify(live) === snap.json;
  if (Array.isArray(snap)) return Array.isArray(live) && live.length === snap.length && snap.every((s, i) => sameSpec(s, live[i]));
  if (!isPlainObject(snap) || !isPlainObject(live)) return false;
  const ks = Object.keys(snap), kl = Object.keys(live);
  if (ks.length !== kl.length) return false;
  for (let i = 0; i < ks.length; i++) if (ks[i] !== kl[i] || !sameSpec(snap[ks[i]], live[ks[i]])) return false;
  return true;
}
