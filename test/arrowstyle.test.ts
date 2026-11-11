// annotate(arrowprops={'arrowstyle': ...}) (issue #69):
//  1. FancyArrowPatch geometry: ConnectionStyle arc3 (rad, shrinkA / shrinkB) then every ArrowStyle transmute
//     annotate draws, vertex for vertex and bit for bit against matplotlib 3.11.2 (fixtures/arrow_oracle.json,
//     from fixtures/generate_arrow_oracle.py); the rendered figures are pixel oracles (annotate_arrowstyle_*);
//  2. style strings parse as _Style.__new__ does ("Name, key=value" with spaces dropped, the name lower-cased);
//  3. unsupported inputs throw typed errors: UnsupportedArrowStyleError for a style this port does not draw,
//     TypeError for a keyword the style or FancyArrowPatch does not take.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARROW_STYLES, subplots, UnsupportedArrowStyleError } from '../src/index.ts';
import type { ArrowSeg } from '../src/core/arrow.ts';
import { parseArrowStyle, parseConnectionStyle, styledArrowPaths } from '../src/core/arrow.ts';

let checks = 0;
type Piece = { codes: number[]; vertices: [number, number][]; fillable: boolean };
type Case = { style: string; posA: [number, number]; posB: [number, number]; rad: number; shrinkA: number; shrinkB: number; mutation: number; linewidth: number; pieces: Piece[] };
const cases: Case[] = JSON.parse(readFileSync(new URL('../fixtures/arrow_oracle.json', import.meta.url), 'utf8'));
const K = 100 / 72;

/** Path codes and vertices as matplotlib stores them; a CLOSEPOLY's vertex is ignored (matplotlib's is arbitrary). */
const flat = (segs: readonly ArrowSeg[]): { codes: number[]; vertices: (readonly [number, number] | 'close')[] } => {
  const codes: number[] = [], vertices: (readonly [number, number] | 'close')[] = [];
  for (const sg of segs) {
    switch (sg.kind) {
      case 'M': codes.push(1); vertices.push(sg.p); break;
      case 'L': codes.push(2); vertices.push(sg.p); break;
      case 'Q': codes.push(3, 3); vertices.push(sg.c, sg.p); break;
      case 'Z': codes.push(79); vertices.push('close'); break;
    }
  }
  return { codes, vertices };
};

for (const c of cases) {
  const at = { x0: c.posA[0], y0: c.posA[1], x1: c.posA[0], y1: c.posA[1] };
  const got = styledArrowPaths(at, c.posB, false, {
    style: parseArrowStyle(c.style), rad: c.rad, relpos: [0.5, 0.5], shrinkAPt: c.shrinkA, shrinkBPt: c.shrinkB,
    mutationPt: c.mutation, linewidthPt: c.linewidth,
  }, K);
  const tag = `${c.style} ${JSON.stringify(c.posA)}→${JSON.stringify(c.posB)} rad ${c.rad}`;
  assert.equal(got.length, c.pieces.length, `${tag}: piece count`);
  got.forEach((pc, i) => {
    const want = c.pieces[i], f = flat(pc.segs);
    assert.equal(pc.fillable, want.fillable, `${tag} piece ${i}: fillable`);
    assert.deepEqual(f.codes, want.codes, `${tag} piece ${i}: codes`);
    f.vertices.forEach((v, j) => {
      if (v === 'close') return;
      assert.ok(Object.is(v[0], want.vertices[j][0]) && Object.is(v[1], want.vertices[j][1]),
        `${tag} piece ${i} vertex ${j}: ${v.join(',')} vs ${want.vertices[j].join(',')}`);
    });
  });
  checks++;
}

// _Style.__new__ parsing
assert.deepEqual(parseArrowStyle('Simple, tail_width=0.4, head_width = 1.2'), { kind: 'simple', headLength: 0.5, headWidth: 1.2, tailWidth: 0.4 }); checks++;
assert.equal(parseConnectionStyle('arc3'), 0); assert.equal(parseConnectionStyle('arc3, rad=-0.25'), -0.25); checks++;
assert.deepEqual(ARROW_STYLES, ['-', '<-', '->', '<->', '<|-', '-|>', '<|-|>', ']-', '-[', ']-[', '|-|', ']->', '<-[', 'simple', 'fancy', 'wedge']); checks++;

// typed errors
const annotate = (arrowprops: Record<string, unknown>): void => {
  const [, ax] = subplots();
  ax.annotate('x', [0.5, 0.5], { xytext: [0.1, 0.1], arrowprops });
};
const throwsAs = (fn: () => void, type: new (...a: never[]) => Error, re: RegExp): void => { assert.throws(fn, (e: unknown) => e instanceof type && re.test(String(e))); checks++; };
throwsAs(() => annotate({ arrowstyle: 'curveb' }), UnsupportedArrowStyleError, /unknown arrowstyle; supported: - <- ->/);
throwsAs(() => annotate({ arrowstyle: '<|-|>,angleA=30' }), UnsupportedArrowStyleError, /angleA/);
throwsAs(() => annotate({ arrowstyle: ']-[,angleB=-10' }), UnsupportedArrowStyleError, /angleB/);
throwsAs(() => annotate({ arrowstyle: '->', connectionstyle: 'angle3,angleA=90,angleB=0' }), UnsupportedArrowStyleError, /only the arc3/);
throwsAs(() => annotate({ arrowstyle: '-,head_width=1' }), TypeError, /"-": unexpected keyword argument 'head_width'/);
throwsAs(() => annotate({ arrowstyle: ']-,widthB=1' }), TypeError, /unexpected keyword argument 'widthB'/);
throwsAs(() => annotate({ arrowstyle: '->,head_width' }), TypeError, /incorrect style argument/);
throwsAs(() => annotate({ arrowstyle: '->,head_width=wide' }), TypeError, /incorrect style argument/);
throwsAs(() => annotate({ arrowstyle: '->', connectionstyle: 'arc3,radius=1' }), TypeError, /unexpected keyword argument 'radius'/);
throwsAs(() => annotate({ arrowstyle: '->', width: 2 }), TypeError, /arrowstyle does not take 'width' \(supported: arrowstyle, connectionstyle/);
throwsAs(() => annotate({ arrowstyle: '->', shrink: 0.1 }), TypeError, /does not take 'shrink'/);
throwsAs(() => annotate({ arrowstyle: 3 }), TypeError, /arrowstyle must be a style string/);
throwsAs(() => annotate({ arrowstyle: '->', relpos: [0.5] }), TypeError, /relpos must be \[x, y\]/);
throwsAs(() => annotate({ arrowstyle: '->', linestyle: '--' }), TypeError, /does not take 'linestyle'/);

console.log(`arrowstyle: ${checks} checks ok (${cases.length} matplotlib arrow geometries bit-exact)`);
