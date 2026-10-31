// The only module that observes JavaScript's `undefined`. Standard-library
// lookups are lifted into Option here, and nowhere else (tools/check_strict.mjs
// enforces this for every other file under src/).
import type { Option } from './types.ts';
import { none, some } from './types.ts';

export function lookup<K, V>(m: ReadonlyMap<K, V>, k: K): Option<V> {
  if (!m.has(k)) return none;
  const v = m.get(k);
  return v === undefined ? none : some(v);
}

/** An own property of a plain object (kwargs, rc layers), as Option<unknown>. */
export function prop(o: Readonly<Record<string, unknown>>, k: string): Option<unknown> {
  return Object.hasOwn(o, k) ? some(o[k]) : none;
}

export const isPlainObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v) && Object.getPrototypeOf(v) === Object.prototype;

export const isNullish = (v: unknown): boolean => v === undefined || v === null;
