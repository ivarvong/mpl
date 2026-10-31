// Types for view.js (plain browser JS, served as-is) so the test can be typechecked.
export type Interval = readonly [number, number];
export function zoomAbout(v: Interval, x: number, f: number, home: Interval, minW: number): [number, number];
export function pan(v: Interval, d: number, home: Interval): [number, number];
export function inside(v: Interval, home: Interval): [number, number];
export function ease(shown: Interval, target: Interval, dt: number, tau: number): [number, number];
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number;
export function nearest(X: Float64Array, x: number): number;
export function velocity(samples: readonly { t: number; x: number }[], now: number, win?: number): number;
export const same: (a: Interval, b: Interval) => boolean;
