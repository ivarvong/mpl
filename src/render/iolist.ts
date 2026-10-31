// IOList: Elixir-iodata-shaped output. Renderers compose nested fragments
// without copying; flattening happens once at the boundary, or never (streaming).
export type IOList = string | readonly IOList[];

export function* iolistChunks(io: IOList): Generator<string> {
  if (typeof io === 'string') { if (io.length > 0) yield io; return; }
  for (const part of io) yield* iolistChunks(part);
}
export function iolistSize(io: IOList): number {
  if (typeof io === 'string') return io.length;
  let n = 0;
  for (const part of io) n += iolistSize(part);
  return n;
}
export function iolistToString(io: IOList): string {
  let out = '';
  for (const c of iolistChunks(io)) out += c;   // V8 ropes: linear
  return out;
}
/** Web ReadableStream<Uint8Array>; each leaf string becomes one chunk. */
export function iolistToStream(io: IOList): ReadableStream<Uint8Array> {
  const it = iolistChunks(io), enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(c): void { const r = it.next(); if (r.done === true) c.close(); else c.enqueue(enc.encode(r.value)); },
  });
}
