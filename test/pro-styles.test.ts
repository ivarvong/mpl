// The bundled pro-* sheets: shipped verbatim from styles/*.mplstyle (which matplotlib renders for the oracle),
// and every key they set is one the theme parser reads, so none is silently ignored.
import { readdirSync, readFileSync } from 'node:fs';
import { PRO_STYLES } from '../src/core/data/prostyles.ts';
import { DEFAULTS } from '../src/core/rc.ts';
import { availableStyles, bundledStyle } from '../src/core/style.ts';
import { parseTheme } from '../src/core/theme.ts';
import { mergeLayers } from '../src/core/rc.ts';

const DIR = new URL('../styles/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.mplstyle')).toSorted();
const fail = (m: string): never => { console.error(`pro-styles: ${m}`); process.exit(1); };
if (files.length !== PRO_STYLES.size) fail(`${files.length} sheets in styles/, ${PRO_STYLES.size} bundled; run node scripts/gen_pro_styles.ts`);
for (const f of files) {
  const name = f.replace(/\.mplstyle$/, '');
  if (PRO_STYLES.get(name) !== readFileSync(new URL(f, DIR), 'utf8')) fail(`${name}: bundled text differs from styles/${f}; run node scripts/gen_pro_styles.ts`);
  if (!availableStyles().includes(name)) fail(`${name} missing from availableStyles()`);
  const layer = bundledStyle(name);
  if (!layer.ok) fail(`${name}: ${layer.error}`);
  else {
    for (const key of layer.value.keys()) if (!DEFAULTS.has(key) && key !== 'axes.prop_cycle') fail(`${name}: ${key} is not a key mpljs reads`);
    const th = parseTheme(mergeLayers([DEFAULTS, layer.value]));
    if (!th.ok) fail(`${name}: ${th.error}`);
  }
}
console.log(`pro-styles: ${files.length} sheets bundled verbatim, every key read by the theme`);
