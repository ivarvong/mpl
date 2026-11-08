// invert_xaxis / invert_yaxis / set_*inverted / get_*inverted / *axis_inverted against matplotlib 3.11.2. The expected
// booleans and limits are matplotlib's own (python, linux/amd64): an autoscaled axis stays autoscaled and inverted.
import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';

const [fig, ax] = subplots();
const ylim = (): readonly number[] => { fig.toScene(); return fig.meta[0].y.lim; };
const xlim = (): readonly number[] => { fig.toScene(); return fig.meta[0].x.lim; };
const close = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
const step = (inv: boolean, got: boolean, lim: readonly number[], want: readonly number[], what: string): void => {
  assert.equal(got, inv, `${what}: inverted`);
  assert.ok(close(lim, want), `${what}: limits ${JSON.stringify(lim)} want ${JSON.stringify(want)}`);
};
step(false, ax.yaxis_inverted(), ylim(), [0, 1], 'fresh axes');
ax.invert_yaxis(); step(true, ax.yaxis_inverted(), ylim(), [1, 0], 'invert_yaxis on the default view');
ax.plot([0, 2], [1, 5]); step(true, ax.yaxis_inverted(), ylim(), [5.2, 0.8], 'autoscale keeps the inversion');
ax.set_yinverted(true); step(true, ax.get_yinverted(), ylim(), [5.2, 0.8], 'set_yinverted(true) is idempotent');
ax.set_yinverted(false); step(false, ax.get_yinverted(), ylim(), [0.8, 5.2], 'set_yinverted(false)');
ax.plot([0, 2], [0, 9]); step(false, ax.get_yinverted(), ylim(), [-0.45, 9.45], 'still autoscaled');
ax.invert_xaxis(); step(true, ax.xaxis_inverted(), xlim(), [2.1, -0.1], 'invert_xaxis');
ax.set_xlim(0, 1); step(false, ax.xaxis_inverted(), xlim(), [0, 1], 'set_xlim overrides');
assert.throws(() => ax.set_yinverted('yes'), /inverted must be a bool/);
console.log('invert: matches matplotlib 3.11.2 (8 steps)');
