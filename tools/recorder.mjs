// Records Axes calls as replayable specs (dates and transforms encoded like the fixtures),
// so tools/showcase_mpl.py can run the same calls through matplotlib.
import { subplots } from '../src/index.ts';

const iso = (d) => d.toISOString().slice(0, -1);
const enc = (v) => {
  if (v instanceof Date) return { $date: iso(v) };
  if (Array.isArray(v) && v.length > 0 && v[0] instanceof Date) return { $dates: v.map(iso) };
  if (v && typeof v === 'object' && v.kind === 'transform') return { $transform: v.coords };
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
};
const isKw = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && v.kind !== 'transform';
export function recorder() {
  const rec = { rc: {}, style: '', spec: [] };
  const axes = [];
  let current = 0;
  const wrap = (ax) => {
    const idx = axes.push(ax) - 1;
    return new Proxy(ax, {
      get(t, prop) {
        const v = t[prop];
        if (typeof v !== 'function') return v;
        return (...args) => {
          if (current !== idx) { rec.spec.push(['sca', [idx], {}]); current = idx; }
          const kw = args.length > 0 && isKw(args[args.length - 1]) ? args.pop() : {};
          rec.spec.push([prop, args.map(enc), enc(kw)]);
          const r = v.apply(t, kw && Object.keys(kw).length ? [...args, kw] : args);
          if (prop === 'twinx') { const w = wrap(r); current = axes.length - 1; return w; }
          return r;
        };
      },
    });
  };
  const make = (kwargs = {}) => {
    rec.rc = kwargs.rc || {};
    rec.style = kwargs.style || '';
    const [fig, ax] = subplots(kwargs);
    return [fig, wrap(ax)];
  };
  return { rec, make };
}

