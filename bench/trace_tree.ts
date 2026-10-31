// Trace one warm render and print the span tree with attributes.
import { subplots, tracer, renderTree } from '../src/index.ts';
const x = Array.from({ length: 200 }, (_, i) => i / 20);
const build = () => {
  const [fig, ax] = subplots({ style: 'seaborn-v0_8-darkgrid' });
  for (let i = 0; i < 6; i++) ax.plot(x, x.map(v => Math.sin(v + i / 2) + i * 0.4), i % 2 ? 'o-' : '--', { label: `series ${i}` });
  ax.bar([0, 2, 4, 6, 8], [1, 2, 1.5, 2.5, 1], { label: 'bars' });
  ax.legend(); ax.set_title('traced render'); ax.set_xlabel('x'); ax.set_ylabel('y');
  return fig;
};
for (let i = 0; i < 10; i++) build().toSVG();
tracer.enable(); build().toSVG();
console.log(renderTree(tracer.spans(), Number(process.env['W'] || 150)));
