import { writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { subplots, type Axes } from '../src/index.ts';

function buildBefore() {
  const [fig, ax] = subplots({ rc: { 'svg.fonttype': 'path' } });
  const x = Array.from({ length: 100 }, (_, i) => i / 10);
  ax.plot(x, x.map(Math.sin), 'o-', { label: 'sin(x)' });
  ax.set_title('Annotated chart');
  ax.set_xlabel('x'); ax.set_ylabel('y');
  return fig;
}
function buildAfter() {
  const fig = buildBefore();
  const first = (fig as { axes: Axes[] }).axes[0];
  if (!first) throw new Error('no axes');
  const ax: Axes = first;
  ax.annotate('peak', [1.5, Math.sin(1.5)], { xytext: [2.5, 1.2], arrowprops: { color: 'red', linewidth: 2, headlength: 8, headwidth: 6 } });
  return fig;
}
const figBefore = buildBefore();
const figAfter = buildAfter();
const before = figBefore.toSVG();
const after = figAfter.toSVG();
writeFileSync('docs/images/annotated-before.svg', before);
writeFileSync('docs/images/annotated-after.svg', after);
const pngBefore = figBefore.toPNGSync();
const pngAfter = figAfter.toPNGSync();
await writeFile('docs/images/annotated-before.png', pngBefore);
await writeFile('docs/images/annotated-after.png', pngAfter);
console.log('wrote docs/images/annotated-before/after.{svg,png}');

