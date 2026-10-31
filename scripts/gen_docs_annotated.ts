import { writeFileSync } from 'node:fs';
import { subplots } from '../src/index.ts';

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
  const ax = (fig as any).axes[0];
  ax.annotate('peak', [1.5, Math.sin(1.5)], { xytext: [2.5, 1.2], arrowprops: { color: 'red', linewidth: 2, headlength: 8, headwidth: 6 } });
  return fig;
}
const before = buildBefore().toSVG();
const after = buildAfter().toSVG();
writeFileSync('docs/images/annotated-before.svg', before);
writeFileSync('docs/images/annotated-after.svg', after);
console.log('wrote docs/images/annotated-before.svg and annotated-after.svg');

