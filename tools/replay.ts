// Replay a fixture spec (the same calls matplotlib ran) against mpljs from src/.
import { readFileSync } from 'node:fs';
import { subplots } from '../src/index.ts';
import type { Figure } from '../src/index.ts';
import { buildWith, type Fixture } from './replay-core.ts';
export { decode, type Fixture } from './replay-core.ts';
const REF = new URL('../fixtures/ref/', import.meta.url).pathname;

export const fixtureNames = (): string[] => JSON.parse(readFileSync(REF + '_index.json', 'utf8'));
export const loadFixture = (name: string): Fixture => JSON.parse(readFileSync(REF + name + '.json', 'utf8'));
/** Replay a fixture's [method, args, kwargs] calls: ax[method](...args, kwargs). */
export const build = (fx: Fixture): Figure => buildWith(fx, subplots);
