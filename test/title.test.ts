// set_title / get_title API shape (issue #67); the drawn titles are pinned pixel-exact by fixtures/ref/title_*.
import { subplots } from '../src/index.ts';

let fails = 0, checks = 0;
const check = (ok: boolean, msg: string): void => { checks++; if (!ok) { fails++; console.log(`FAIL ${msg}`); } };
const throws = (f: () => unknown, kind: ErrorConstructor, has: string, what: string): void => {
  try { f(); check(false, `${what}: did not throw`); } catch (e) {
    check(e instanceof kind && (e as Error).message.includes(has), `${what}: threw ${(e as Error).name}: ${(e as Error).message}`);
  }
};

// each loc is its own title; get_title reads them back ('' when unset), as matplotlib's get_title(loc)
const [, ax] = subplots();
ax.set_title('L', { loc: 'left' }).set_title('C').set_title('R', { loc: 'right' });
check(ax.get_title() === 'C' && ax.get_title('left') === 'L' && ax.get_title('right') === 'R', 'three titles read back');
ax.set_title('C2', { fontdict: { fontsize: 'large' } });
check(ax.get_title('center') === 'C2' && ax.get_title('left') === 'L', 'a later call replaces only its own loc');
const [, ax2] = subplots();
check(ax2.get_title('right') === '', 'unset title is empty');

// unsupported keywords and values are typed errors naming the problem
throws(() => ax.set_title('x', { rotation: 45 }), TypeError, "unexpected keyword argument 'rotation'", 'unknown keyword');
throws(() => ax.set_title('x', { fontdict: { fontstyle: 'italic' } }), TypeError, "unexpected keyword argument 'fontstyle'", 'unknown fontdict key');
throws(() => ax.set_title('x', { fontsize: 9, size: 10 }), TypeError, 'got both', 'fontsize and size');
throws(() => ax.set_title('x', { loc: 'top' }), Error, "'left', 'center' or 'right'", 'bad loc');
throws(() => ax.set_title('x', { fontdict: 'big' }), Error, 'fontdict must be an object', 'fontdict not an object');
throws(() => ax.set_title('x', { pad: 'wide' }), Error, 'pad must be a number', 'bad pad');
throws(() => ax.get_title('middle'), Error, "'left', 'center' or 'right'", 'get_title bad loc');

if (fails > 0) { console.log(`title: ${fails} of ${checks} checks failed`); process.exit(1); }
console.log(`title: set_title/get_title shape and typed errors; ${checks} checks ok`);
