// A request trace as a Gantt/waterfall chart: barh with left= offsets, a tree of indented labels
// drawn with box-drawing characters (tick labels are right-aligned, as in matplotlib), the root label in bold, a dashed x grid, and tight_layout.
// The same calls are an oracle case (fixtures/ref/example_gantt_trace), pixel-checked against
// matplotlib. Writes examples/out/gantt.{svg,png}; docs/images/gantt.svg is this SVG.
import { registerFonts, subplots } from '../src/index.ts';
// the root label is bold: DejaVu Sans Bold is its own module (in an app, 'mpljs/fonts/dejavu-sans-bold')
import { dejavuSansBold } from '../src/fonts/dejavu-sans-bold.ts';
import { save } from './_save.ts';

registerFonts(dejavuSansBold);

const spans = [
  { label: 'GET /api/checkout', start: 0, end: 120, color: 'C0' },
  { label: '├─ auth.verify', start: 2, end: 14, color: 'C1' },
  { label: '├─ db.query orders', start: 15, end: 55, color: 'C2' },
  { label: '└─ pool.acquire', start: 15, end: 19, color: 'C2' },
  { label: '├─ inventory.reserve', start: 56, end: 92, color: 'C4' },
  { label: '└─ render.json', start: 93, end: 118, color: 'C1' },
];

const [fig, ax] = subplots({ rc: { 'axes.axisbelow': true } });   // grid behind the bars
const rows = spans.map((_, i) => i);
ax.barh(rows, spans.map((s) => s.end - s.start), { left: spans.map((s) => s.start), color: spans.map((s) => s.color), height: 0.6 });
ax.set_yticks(rows);
ax.set_yticklabels(spans.map((s) => s.label));
ax.get_yticklabels()[0].set_fontweight('bold');
ax.set_ylim(spans.length - 0.4, -0.6);                    // first span on top
ax.set_xlabel('ms since request start');
ax.set_title('Checkout request trace', { loc: 'left' });
ax.grid(true, { axis: 'x', color: '0.85', linestyle: '--', linewidth: 0.8 });
ax.spines.top.set_visible(false);
ax.spines.right.set_visible(false);
fig.tight_layout();

save('gantt', fig);
