// mpl/interactive: hover readouts, nearest-point tooltips, artist highlighting and legend toggles over SVGs written
// by fig.toSVG({ interactive: true }). Zero dependencies, no framework, nothing re-rendered: it reads each Axes'
// sidecar (<g data-mpl-axes="k"><metadata class="mpl-axes">, schema in src/render/annotate.ts), maps the pointer
// with getScreenCTM (so scaled, responsive and several inlined SVGs all work), and only toggles classes and draws a
// small overlay. Theming is CSS custom properties (--mpl-*) and classes (.mpl-*); see README, "Interactive SVG".
// When the SVG's content is replaced (mpl/zoom re-renders it), an `mpl:render` event on the <svg> re-reads the new
// sidecars; legend toggles carry over.
//
//   import { attach } from 'mpl/interactive';
//   const detach = attach(document);      // every annotated SVG under the root

/** One axis of an Axes as the sidecar describes it. `lim` is the view interval (inverted when lim[0] > lim[1]); `g` the
 *  index of the Axes that leads its share group (sharex/sharey/twinx), -1 when the sidecar predates it; `t` the axis
 *  label; `step` the resolution of the value being formatted (days on a date axis; 0 when unknown: the client fills it in). */
export type AxisInfo = { readonly s: string; readonly lim: readonly [number, number]; readonly b: number; readonly names: readonly string[]; readonly px: number; readonly g: number; readonly t: string; readonly step: number };
/** One artist: its kind, label, colour and points (data `d` and pixel `p`, flat x/y pairs), as the sidecar has them. */
export type ArtistInfo = {
  readonly i: number; readonly k: string; readonly l: string; readonly c: string; readonly s: string; readonly ds: string;
  readonly d: readonly number[]; readonly p: readonly number[]; readonly b: readonly number[];
};
export type AxesInfo = {
  readonly box: readonly [number, number, number, number]; readonly x: AxisInfo; readonly y: AxisInfo; readonly cb: boolean;
  readonly a: readonly ArtistInfo[]; readonly lg: readonly (readonly number[])[];
};
/** Formats a value on an axis for display (`exact`: a data point, not the cursor); the default is formatValue. A custom
 *  formatter's text is used as is: the axis unit is only appended to the default formatter's. */
export type Format = (v: number, axis: AxisInfo, which: 'x' | 'y', exact: boolean, svg: SVGSVGElement) => string;

// ---------------------------------------------------------------- sidecar parsing (no casts: parse, don't assert)
type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && !!v && !Array.isArray(v);
const field = (o: unknown, k: string): unknown => (isObj(o) && Object.hasOwn(o, k) ? o[k] : 0);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

function axisOf(o: unknown, px: number): AxisInfo {
  const lim = nums(field(o, 'lim')), b = field(o, 'b'), names = field(o, 'names'), g = field(o, 'g');
  return { s: str(field(o, 's'), 'linear'), lim: [lim[0] || 0, lim.length > 1 ? lim[1] : 1], b: typeof b === 'number' ? b : 10,
           names: Array.isArray(names) ? names.map((n) => String(n)) : [], px, g: typeof g === 'number' && Object.hasOwn(Object(o), 'g') ? g : -1, t: str(field(o, 't')), step: 0 };
}

/** The sidecar JSON of one Axes, parsed. Throws on text that is not JSON. */
export function parseSidecar(text: string): AxesInfo {
  const j: unknown = JSON.parse(text);
  const bx = nums(field(j, 'box'));
  const box: [number, number, number, number] = [bx[0] || 0, bx[1] || 0, bx[2] || 0, bx[3] || 0];
  const arts = field(j, 'a'), lg = field(j, 'lg');
  return {
    box, x: axisOf(field(j, 'x'), box[2] - box[0]), y: axisOf(field(j, 'y'), box[3] - box[1]), cb: field(j, 'cb') === 1,
    a: (Array.isArray(arts) ? arts : []).map((o: unknown, i): ArtistInfo => ({
      i, k: str(field(o, 'k')), l: str(field(o, 'l')), c: str(field(o, 'c'), 'currentColor'), s: str(field(o, 's'), 'xy'), ds: str(field(o, 'ds')),
      d: nums(field(o, 'd')), p: nums(field(o, 'p')), b: nums(field(o, 'b')),
    })),
    lg: (Array.isArray(lg) ? lg : []).map(nums).filter((e) => e.length === 5),
  };
}

// ---------------------------------------------------------------- data <-> pixel (the inverse of core/frame.ts)
const fwd = (a: AxisInfo, v: number): number => (a.s === 'log' ? Math.log(v) / Math.log(a.b) : v);
const inv = (a: AxisInfo, v: number): number => (a.s === 'log' ? a.b ** v : v);

/** A pixel (SVG user units, y down) to data on one axis of an Axes. */
export function pixelToData(ax: AxesInfo, which: 'x' | 'y', p: number): number {
  const a = which === 'x' ? ax.x : ax.y;
  const t = which === 'x' ? (p - ax.box[0]) / (ax.box[2] - ax.box[0]) : (ax.box[3] - p) / (ax.box[3] - ax.box[1]);
  const v0 = fwd(a, a.lim[0]), v1 = fwd(a, a.lim[1]);
  return inv(a, v0 + t * (v1 - v0));
}
/** Data to a pixel (SVG user units, y down) on one axis of an Axes. */
export function dataToPixel(ax: AxesInfo, which: 'x' | 'y', v: number): number {
  const a = which === 'x' ? ax.x : ax.y;
  const v0 = fwd(a, a.lim[0]), v1 = fwd(a, a.lim[1]), t = (fwd(a, v) - v0) / (v1 - v0);
  return which === 'x' ? ax.box[0] + t * (ax.box[2] - ax.box[0]) : ax.box[3] - t * (ax.box[3] - ax.box[1]);
}

// ---------------------------------------------------------------- formatting
const trim = (s: string): string => (/^-0\.?0*$/.test(s) ? s.slice(1) : s);
const clip0 = (s: string): string => trim(s.includes('.') ? s.replace(/\.?0+$/, '') : s);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number): string => String(n).padStart(2, '0');
const SEC = 1 / 86400, MIN = 1 / 1440;

/** A date at resolution `r` days: "2026", "Nov 2026", "Nov 5", "Nov 5, 08:40", "Nov 5, 08:40:05", "Nov 5, 08:40:05.25".
 *  Rounded to that resolution, in UTC; the year only when the axis crosses one. */
function formatDate(v: number, a: AxisInfo, r: number): string {
  const digits = r >= SEC ? 0 : r >= SEC / 10 ? 1 : r >= SEC / 100 ? 2 : 3;
  const unit = r >= 1 ? 1 : r >= MIN ? MIN : r >= SEC ? SEC : SEC / 10 ** digits;
  const d = new Date(Math.round(Math.round(v / unit) * unit * 864e5)), y = d.getUTCFullYear(), mon = MONTHS[d.getUTCMonth()];
  if (r >= 360) return String(y);
  if (r >= 28) return `${mon} ${y}`;
  const crosses = new Date(a.lim[0] * 864e5).getUTCFullYear() !== new Date(a.lim[1] * 864e5).getUTCFullYear();
  const day = `${mon} ${d.getUTCDate()}${crosses ? `, ${y}` : ''}`;
  if (r >= 1) return day;
  const hm = `${day}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
  if (r >= MIN) return hm;
  const sec = `${hm}:${p2(d.getUTCSeconds())}`;
  return digits === 0 ? sec : `${sec}.${String(d.getUTCMilliseconds()).padStart(3, '0').slice(0, digits)}`;
}

/**
 * Dates in UTC at the resolution they have (the series' `step` for a point, one pixel for the cursor), categories by
 * name, log values to 3 significant digits, linear values to the axis' per-pixel resolution with at least 3 significant
 * digits (a data point keeps no trailing zeros).
 */
export function formatValue(v: number, a: AxisInfo, _which: 'x' | 'y', exact: boolean): string {
  if (!Number.isFinite(v)) return String(v);
  const res = Math.abs(a.lim[1] - a.lim[0]) / Math.max(a.px, 1);
  if (a.s === 'date') return formatDate(v, a, exact && a.step > 0 ? a.step : res);
  if (a.s === 'cat') { const n = a.names[Math.round(v)]; if (typeof n === 'string' && (exact || Math.abs(v - Math.round(v)) < 0.5)) return n; }
  if (a.s === 'log') return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Number(v.toPrecision(3)));
  const axis = Math.ceil(-Math.log10(res));
  if (!exact) return trim(v.toFixed(Math.min(12, Math.max(0, axis))));
  return clip0(v.toFixed(Math.min(12, Math.max(0, axis, v === 0 ? 0 : 2 - Math.floor(Math.log10(Math.abs(v)))))));
}

const steps = new WeakMap<ArtistInfo, number>();
/** The resolution a series' dates actually have, in days: the coarsest of day / minute / second that every point sits on
 *  (the sidecar keeps 12 significant digits, so a date number is only good to ~5 ms), month or year when every point is
 *  the first of one; irregular sub-second stamps count at their spacing, or a pixel. */
function dateStep(art: ArtistInfo, o: number, a: AxisInfo): number {
  const memo = steps.get(art);
  if (typeof memo === 'number') return memo;
  const vs = art.d.filter((_, i) => i % 2 === o);
  const on = (u: number): boolean => vs.every((v) => Math.abs(v / u - Math.round(v / u)) * u <= 5 * 10 ** (Math.floor(Math.log10(Math.abs(v) || 1)) - 11));
  const dates = vs.map((v) => new Date(Math.round(v) * 864e5));
  let r = SEC / 100;
  if (on(1)) r = vs.length > 1 && dates.every((d) => d.getUTCDate() === 1) ? (dates.every((d) => d.getUTCMonth() === 0) ? 365 : 30) : 1;
  else if (on(MIN)) r = MIN;
  else if (on(SEC)) r = SEC;
  else {
    const span = Math.max(...vs) - Math.min(...vs), gap = vs.length > 1 ? span / (vs.length - 1) : Infinity;
    r = Math.max(r, Math.min(gap, Math.abs(a.lim[1] - a.lim[0]) / Math.max(a.px, 1)));
  }
  steps.set(art, r);
  return r;
}

const UNIT = /^(%|‰|°[CF]|[nµu]?s|ms|sec|min|hrs?|h|[kKMGTP]?i?[Bb]|bytes?|bps|[kMG]?Hz|[kM]?[WV]|[mck]?m|k?g|rps|qps)$/;
const RATE = /^[^\s/]+ ?\/ ?[^\s/]+$/;
/** An axis label read for units. `plain`: appended to values as is ("ms", from "ms", "latency (ms)" or "Latency [ms]");
 *  `muted`: a rate that reads as a phrase ("requests / s"), shown quietly; `name`: the label without its unit ("latency"). */
export function unitOf(label: string): { readonly plain: string; readonly muted: string; readonly name: string } {
  const t = label.trim(), p = /^(.*?)\s*[([]([^()[\]]{1,12})[)\]]$/.exec(t);
  const bare = p ? p[1] : t, u = p ? p[2].trim() : t;
  if (UNIT.test(u)) return { plain: u, muted: '', name: p ? bare : '' };
  if (RATE.test(u) && u.length <= 16) return { plain: '', muted: u, name: p ? bare : '' };
  return { plain: '', muted: '', name: p && /^(log|linear|symlog|logit)/i.test(u) ? bare : t };
}
const glue = (v: string, u: string): string => (u === '' ? v : `${v}${/^[%‰°]/.test(u) ? '' : ' '}${u}`);

// ---------------------------------------------------------------- nearest point
export type Hit = { readonly art: ArtistInfo; readonly j: number; readonly dist: number };
/** The nearest visible point to (px, py): ordered series (s 'x' | 'y') snap along their axis (steps to the step
 *  that holds the value there), scatter and unordered lines by 2D distance; across artists, the closest point wins. */
export function nearest(arts: readonly ArtistInfo[], px: number, py: number, off: ReadonlySet<number> = new Set()): readonly Hit[] {
  let best: readonly Hit[] = [];
  for (const art of arts) {
    const n = art.p.length / 2;
    if (n === 0 || off.has(art.i)) continue;
    const o = art.s === 'y' ? 1 : 0, q = o === 1 ? py : px;
    let j = 0, dj = Infinity;
    for (let i = 0; i < n; i++) {
      const d = art.s === 'xy' ? Math.hypot(art.p[2 * i] - px, art.p[2 * i + 1] - py) : Math.abs(art.p[2 * i + o] - q);
      if (d < dj) { dj = d; j = i; }
    }
    if (art.ds !== '' && n > 1) {
      const dir = Math.sign(art.p[2 * (n - 1) + o] - art.p[o]), side = (q - art.p[2 * j + o]) * dir;
      if (art.ds === 'post' && side < 0 && j > 0) j--;
      if (art.ds === 'pre' && side > 0 && j < n - 1) j++;
    }
    const dist = Math.hypot(art.p[2 * j] - px, art.p[2 * j + 1] - py);
    if (best.length === 0 || dist <= best[0].dist) best = [{ art, j, dist }];   // a tie goes to the later artist (stacked on top)
  }
  return best;
}

// ---------------------------------------------------------------- DOM
const NS = 'http://www.w3.org/2000/svg';
const CSS = `[data-mpl-axes] [data-artist]{transition:none}
@media (prefers-reduced-motion:no-preference){[data-mpl-axes] [data-artist]{transition:opacity .12s}}
.mpl-dim{opacity:var(--mpl-dim-opacity,.5)}.mpl-off{display:none}
.mpl-cross line{stroke:var(--mpl-crosshair,currentColor);stroke-opacity:var(--mpl-crosshair-opacity,.45);stroke-dasharray:3 3}
.mpl-cross line,.mpl-dot,.mpl-lg,.mpl-kb{vector-effect:non-scaling-stroke}
.mpl-dot{fill:var(--mpl-dot-fill,Canvas);stroke:var(--mpl-dot,currentColor);stroke-width:2}
.mpl-lg,.mpl-kb{fill:transparent;outline:none}.mpl-lg{cursor:pointer}
.mpl-lg.mpl-lg-off{fill:var(--mpl-legend-off,Canvas);fill-opacity:var(--mpl-legend-off-opacity,.7)}
.mpl-lg:focus-visible,.mpl-kb:focus-visible{stroke:var(--mpl-focus,Highlight);stroke-width:2}
.mpl-tip{position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;width:max-content;max-width:min(var(--mpl-tip-max-width,100vw),var(--mpl-tip-room,100vw));overflow-wrap:anywhere;font:var(--mpl-tip-font,12px/1.4 system-ui,sans-serif);font-variant-numeric:tabular-nums;background:var(--mpl-tip-bg,Canvas);color:var(--mpl-tip-fg,CanvasText);border:1px solid var(--mpl-tip-border,GrayText);border-radius:var(--mpl-tip-radius,4px);padding:var(--mpl-tip-padding,4px 8px);box-shadow:var(--mpl-tip-shadow,0 2px 8px rgb(0 0 0/.18))}
.mpl-tip-compact{font-size:var(--mpl-tip-compact-size,11px);line-height:1.3;padding:var(--mpl-tip-compact-padding,3px 6px)}
.mpl-tip[hidden]{display:none}.mpl-tip b{font-weight:600;margin-right:.5em}.mpl-tip i{display:inline-block;width:.7em;height:.7em;border-radius:2px;margin-right:.4em}.mpl-tip small{display:block;font-size:var(--mpl-tip-small-size,smaller);opacity:.7}.mpl-tip u{text-decoration:none;opacity:.7}`;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string | number>>): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const html = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== '') e.textContent = text;
  if (cls !== '') e.className = cls;
  return e;
};

/** Keyboard stepping on a focused plot: the point index step per key (Home/End jump, Up/Down change series). */
const KEYS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 0, ArrowUp: 0, Home: 0, End: 0 };

const inside = (b: AxesInfo['box'], x: number, y: number): boolean => x >= b[0] - 1 && x <= b[2] + 1 && y >= b[1] - 1 && y <= b[3] + 1;

type Live = { readonly k: number; readonly info: AxesInfo; readonly groups: ReadonlyMap<number, readonly Element[]>; readonly off: Set<number> };
/** The SVG currently showing the readout: what another SVG, a tap outside, Escape or a scroll asks of it. */
type Owner = { readonly svg: SVGSVGElement; readonly hide: () => void; readonly place: () => void };
/** The tooltip one attach() shares among its SVGs, its settings, and which SVG holds it (at most one). */
type Tip = { readonly el: HTMLDivElement; readonly format: Format; readonly compact: number; readonly gap: number; readonly touchGap: number; readonly margin: number; readonly above: boolean; readonly cursor: boolean; on: readonly Owner[] };

/** The part of `svg` the reader can see, as client [left, top, right, bottom]: its box cut by the viewport and any
 *  ancestor that clips (a sideways-scrolling figure). Empty (right <= left) when it is out of view. */
function room(svg: SVGSVGElement): readonly number[] {
  const r = svg.getBoundingClientRect();
  let l = Math.max(r.left, 0), t = Math.max(r.top, 0), R = Math.min(r.right, innerWidth), B = Math.min(r.bottom, innerHeight);
  for (let p = svg.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflow === 'visible') continue;
    const q = p.getBoundingClientRect();
    l = Math.max(l, q.left); t = Math.max(t, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom);
  }
  return [l, t, R, B];
}
const clamp = (lo: number, hi: number, v: number): number => Math.max(lo, Math.min(hi, v));
const onLegend = (e: Event): boolean => e.target instanceof Element && e.target.classList.contains('mpl-lg');
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

/** Wire one annotated SVG, and again whenever its content is re-rendered (`mpl:render`); returns its detach function. */
function wire(svg: SVGSVGElement, tip: Tip): () => void {
  const offs = new Map<number, Set<number>>();   // legend toggles by Axes index: they survive a re-render
  const at: number[] = [];                        // [x, y, touch 0|1] of the last pointer readout, in SVG user units
  let undo = wireContent(svg, tip, offs, at, false);
  // the readout stays up when it was (a wheel zoom under a resting pointer, a tapped value); whoever replaced the content keeps focus
  const rerender = (): void => { const shown = tip.on.some((o) => o.svg === svg); undo(); undo = wireContent(svg, tip, offs, at, shown); };
  svg.addEventListener('mpl:render', rerender);
  return () => { svg.removeEventListener('mpl:render', rerender); undo(); };
}

function wireContent(svg: SVGSVGElement, tip: Tip, offs: Map<number, Set<number>>, at: number[], shown: boolean): () => void {
  const { format } = tip;
  const axes: Live[] = [];
  for (const g of Array.from(svg.querySelectorAll('g[data-mpl-axes]'))) {
    const md = Array.from(g.children).filter((c) => c.tagName.toLowerCase() === 'metadata');
    if (md.length === 0) continue;
    const groups = new Map<number, Element[]>();
    for (const e of Array.from(g.querySelectorAll('[data-artist]'))) {
      const i = Number(str(e.getAttribute('data-artist')).split('/')[1]);
      groups.set(i, [...(groups.get(i) || []), e]);
    }
    const k = Number(g.getAttribute('data-mpl-axes')), off = offs.get(k) || new Set<number>();
    offs.set(k, off);
    for (const i of off) for (const e of groups.get(i) || []) e.classList.add('mpl-off');
    axes.push({ k, info: parseSidecar(str(md[0].textContent)), groups, off });
  }
  if (axes.length === 0) return () => {};
  const layer = el('g', { class: 'mpl-overlay', 'pointer-events': 'none' });
  const cross = el('g', { class: 'mpl-cross' }), vx = el('line', {}), hy = el('line', {}), dot = el('circle', { class: 'mpl-dot', r: 3.5 });
  cross.append(vx, hy, dot);
  cross.style.display = 'none';
  const hits = el('g', { 'pointer-events': 'all' });
  layer.append(cross, hits);
  svg.append(layer);

  const dims: Element[] = [];
  const undim = (): void => { for (const e of dims.splice(0)) e.classList.remove('mpl-dim'); };
  let lx = 0, ly = 0, touch = false;   // where the readout is anchored (SVG user units), and whether a finger put it there
  const hide = (): void => {
    cross.style.display = 'none'; undim();
    if (tip.on.some((o) => o === me)) { tip.el.hidden = true; tip.on = []; }
  };
  const dismiss = (): void => { at.splice(0); hide(); };

  /** Put the tooltip by its anchor, inside the visible part of this chart: beside a mouse or focus, above a finger. */
  const place = (): void => {
    const t = tip.el;
    if (t.hidden) return;
    const [L, T, R, B] = room(svg), wide = R - L, m = tip.margin;
    t.style.visibility = wide <= 0 || B <= T ? 'hidden' : '';
    if (wide <= 0 || B <= T) return;
    t.classList.toggle('mpl-tip-compact', wide < tip.compact);
    t.style.setProperty('--mpl-tip-room', `${Math.max(120, wide - 2 * m)}px`);
    const r = t.getBoundingClientRect(), [cx, cy] = toScreen(lx, ly), g = touch ? tip.touchGap : tip.gap;
    const x = touch || tip.above ? cx - r.width / 2 : cx + g + r.width > R - m ? cx - g - r.width : cx + g;
    const y = touch || tip.above ? (cy - g - r.height < T + m ? cy + g : cy - g - r.height) : cy + g + r.height > B - m ? cy - g - r.height : cy + g;
    t.style.left = `${Math.round(clamp(L + m, R - m - r.width, x))}px`;
    t.style.top = `${Math.round(clamp(T + m, B - m - r.height, y))}px`;
  };
  const me: Owner = { svg, hide: dismiss, place };

  /** Show the readout at SVG point (x, y): the nearest point of any Axes there, under the crosshair. */
  const show = (x: number, y: number, pick: readonly Hit[]): void => {
    const here = axes.filter((a) => inside(a.info.box, x, y));
    if (here.length === 0) { dismiss(); return; }
    for (const o of tip.on) if (o !== me) o.hide();
    tip.on = [me];
    lx = x; ly = y;
    const hit = pick.length > 0 ? pick : here.flatMap((a) => nearest(a.info.a, x, y, a.off)).reduce((b: readonly Hit[], h) => (b.length === 0 || h.dist <= b[0].dist ? [h] : b), []);
    const b = here[0].info.box;
    vx.setAttribute('x1', String(x)); vx.setAttribute('x2', String(x)); vx.setAttribute('y1', String(b[1])); vx.setAttribute('y2', String(b[3]));
    hy.setAttribute('y1', String(y)); hy.setAttribute('y2', String(y)); hy.setAttribute('x1', String(b[0])); hy.setAttribute('x2', String(b[2]));
    cross.style.display = '';
    const rows: HTMLElement[] = [];
    undim();
    if (hit.length > 0) {
      const { art, j } = hit[0], owner = here.find((a) => a.info.a[art.i] === art) || axes.find((a) => a.info.a[art.i] === art) || here[0];
      dot.setAttribute('cx', String(art.p[2 * j])); dot.setAttribute('cy', String(art.p[2 * j + 1]));
      dot.style.display = '';
      // barh: the value is along x and the position along y; everything else the other way round
      const horiz = art.s === 'y', V = horiz ? owner.info.x : owner.info.y, P = horiz ? owner.info.y : owner.info.x, vw = horiz ? 'x' : 'y', pw = horiz ? 'y' : 'x';
      const val = art.d[2 * j + (horiz ? 0 : 1)], base = art.b.length > 0 ? art.b[j] : 0;
      const pos = P.s === 'date' ? { ...P, step: dateStep(art, horiz ? 1 : 0, P) } : P;
      const custom = format !== formatValue, vu = unitOf(V.t), pu = unitOf(P.t);
      const head = html('div'), sw = html('i'), name = art.l !== '' ? art.l : custom || V.t.length > 24 ? '' : vu.name;
      sw.style.background = art.c;
      head.append(sw);
      if (name !== '') head.append(html('b', name), ' ');
      const stacked = art.b.length > 0 && base !== 0;
      const shown1 = format(stacked ? val - base : val, stacked ? { ...V, s: 'linear' } : V, vw, true, svg);
      head.append(html('span', custom ? shown1 : glue(shown1, vu.plain)));
      if (!custom && vu.muted !== '') head.append(' ', html('u', vu.muted));
      rows.push(head);
      const px1 = format(art.d[2 * j + (horiz ? 1 : 0)], pos, pw, true, svg);
      const under = [custom || P.s === 'date' || P.s === 'cat' ? px1 : glue(px1, pu.plain)];
      if (stacked) under.push(`${custom ? format(val, V, vw, true, svg) : glue(format(val, V, vw, true, svg), vu.plain)} total`);
      rows.push(html('small', under.join(' · ')));
      // only series in the Axes under the pointer (twins included) give way to the hovered one: other panels stay as they are
      for (const a of here) for (const [i, es] of a.groups) {
        const kind = a.info.a[i];
        if ((a !== owner || i !== art.i) && kind && kind.p.length > 0) for (const e of es) { e.classList.add('mpl-dim'); dims.push(e); }
      }
    } else dot.style.display = 'none';
    if (tip.cursor) rows.push(html('small', [format(pixelToData(here[0].info, 'x', x), here[0].info.x, 'x', false, svg),
      ...here.map((a) => format(pixelToData(a.info, 'y', y), a.info.y, 'y', false, svg))].join(' · ')));
    tip.el.replaceChildren(...rows);
    tip.el.hidden = rows.length === 0;     // nothing near and no cursor readout: the crosshair alone
    place();
  };
  const toSvg = (cx: number, cy: number): readonly number[] => {
    const m = svg.getScreenCTM();
    if (!m) return [];
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const toScreen = (x: number, y: number): readonly number[] => {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(x, y).matrixTransform(m);
    return [p.x, p.y];
  };

  let frame = 0, fingers = 0, cur: readonly number[] = [], press: readonly number[] = [];
  const showAt = (): void => {
    const p = toSvg(cur[0], cur[1]);
    if (p.length !== 2) return;
    at.splice(0, 3, p[0], p[1], touch ? 1 : 0);
    show(p[0], p[1], []);
  };
  const zoomed = (): boolean => svg.hasAttribute('data-mpl-zoom');
  const move = (e: PointerEvent): void => {
    if (onLegend(e)) return;
    cur = [e.clientX, e.clientY];
    touch = e.pointerType === 'touch';
    // under mpl/zoom a pressed pointer pans or zooms: no readout until it lifts
    if (e.buttons !== 0 && zoomed()) { dismiss(); return; }
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => { frame = 0; showAt(); });
  };
  const down = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') { press = fingers === 0 && !onLegend(e) ? [e.clientX, e.clientY] : []; fingers++; }
    move(e);
  };
  // under mpl/zoom a touch pans, so the readout comes on lift, when the finger did not travel (a tap)
  const lift = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    fingers = Math.max(0, fingers - 1);
    if (e.type === 'pointerup' && press.length === 2 && zoomed() && Math.hypot(e.clientX - press[0], e.clientY - press[1]) < 10) {
      cur = [e.clientX, e.clientY];
      touch = true;
      showAt();
    }
    press = [];
  };
  // a finger lifting fires pointerleave too: a tapped value stays (until the next tap, a tap outside, or Escape)
  const leave = (e: PointerEvent): void => { if (e.pointerType !== 'touch') dismiss(); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointerup', lift);
  svg.addEventListener('pointercancel', lift);
  svg.addEventListener('pointerleave', leave);
  // re-rendered under a resting pointer or a tapped value: the readout follows the new view
  if (at.length === 3 && shown) { touch = at[2] === 1; show(at[0], at[1], []); }

  // legend toggles and keyboard stepping through points
  for (const a of axes) {
    for (const [i, x0, y0, x1, y1] of a.info.lg) {
      const art = a.info.a[i], r = el('rect', { class: 'mpl-lg', x: x0, y: y0, width: x1 - x0, height: y1 - y0, tabindex: 0, role: 'button', 'aria-pressed': 'true' });
      r.setAttribute('aria-label', art && art.l !== '' ? art.l : `${art ? art.k : 'artist'} ${i}`);
      const toggle = (): void => {
        const on = a.off.has(i);
        if (on) a.off.delete(i); else a.off.add(i);
        for (const e of a.groups.get(i) || []) e.classList.toggle('mpl-off', !on);
        r.classList.toggle('mpl-lg-off', !on);
        r.setAttribute('aria-pressed', String(on));
        hide();
      };
      r.addEventListener('click', toggle);
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      r.addEventListener('pointermove', (e) => e.stopPropagation());
      r.addEventListener('pointerenter', hide);
      hits.append(r);
    }
    const series = a.info.a.filter((s) => s.p.length > 0);
    if (series.length === 0) continue;
    const b = a.info.box, kb = el('rect', { class: 'mpl-kb', x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1], tabindex: 0, role: 'application', 'data-mpl-k': a.k });
    kb.setAttribute('aria-label', `Plot ${a.k + 1}: arrow keys move between points, up and down between series`);
    kb.setAttribute('pointer-events', 'none');
    let si = 0, pj = -1;
    kb.addEventListener('keydown', (e) => {
      const dir = KEYS[e.key];
      if (e.key === 'Escape') { hide(); pj = -1; return; }
      if (typeof dir !== 'number' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;   // Shift+arrows: mpl/zoom pans
      e.preventDefault();
      const vis = series.filter((s) => !a.off.has(s.i));
      if (vis.length === 0) return;
      if (e.key === 'ArrowDown') si++;
      if (e.key === 'ArrowUp') si--;
      const s = vis[((si % vis.length) + vis.length) % vis.length], n = s.p.length / 2;
      pj = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : Math.min(n - 1, Math.max(0, pj < 0 ? 0 : pj + dir));
      touch = false;
      show(s.p[2 * pj], s.p[2 * pj + 1], [{ art: s, j: pj, dist: 0 }]);
    });
    kb.addEventListener('blur', hide);
    hits.append(kb);
  }
  return () => {
    svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointerup', lift);
    svg.removeEventListener('pointercancel', lift); svg.removeEventListener('pointerleave', leave);
    if (frame !== 0) cancelAnimationFrame(frame);
    hide(); layer.remove();
    for (const a of axes) for (const es of a.groups.values()) for (const e of es) e.classList.remove('mpl-off');
  };
}

/** Options of attach(); every field is optional. */
export type AttachOptions = {
  /** How values print (default formatValue). */
  readonly format: Format;
  /** Below this visible chart width (CSS px) the tooltip is compact: smaller type and padding. Default 480; 0 never, Infinity always. */
  readonly compact: number;
  /** Distance from a mouse or focus position to the tooltip, CSS px. Default 14. */
  readonly gap: number;
  /** Distance from a finger to the tooltip, CSS px. Default 32. */
  readonly touchGap: number;
  /** Space kept between the tooltip and the chart's edges, CSS px. Default 4. */
  readonly margin: number;
  /** 'auto' (default): beside a mouse, above a finger. 'above': above and centred for every pointer. */
  readonly placement: 'auto' | 'above';
  /** Also list the cursor's own data coordinates under the point. Default false. */
  readonly cursor: boolean;
};

/**
 * Make every annotated SVG under `root` interactive (fig.toSVG({ interactive: true }), inlined in the page).
 * Returns a function that undoes it. The second argument is either a value formatter (see formatValue) or AttachOptions.
 */
export function attach(root: ParentNode = document, options: Format | Partial<AttachOptions> = {}): () => void {
  if (document.querySelectorAll('style.mpl-css').length === 0) {
    const s = document.createElement('style');
    s.className = 'mpl-css';
    s.textContent = CSS;
    document.head.append(s);
  }
  const o: Partial<AttachOptions> = typeof options === 'function' ? { format: options } : options;
  const el0 = html('div', '', 'mpl-tip');
  el0.hidden = true;
  el0.setAttribute('role', 'status');
  document.body.append(el0);
  const tip: Tip = {
    el: el0, format: typeof o.format === 'function' ? o.format : formatValue, compact: num(o.compact, 480), gap: num(o.gap, 14), touchGap: num(o.touchGap, 32),
    margin: num(o.margin, 4), above: o.placement === 'above', cursor: o.cursor === true, on: [],
  };
  const svgs = Array.from(root.querySelectorAll('svg')).filter((s) => s.querySelectorAll('g[data-mpl-axes]').length > 0);
  if (root instanceof SVGSVGElement) svgs.push(root);
  const undo = svgs.map((s) => wire(s, tip));
  // a tap outside the chart holding the readout, or Escape, dismisses it; it stays by its point through a scroll or resize
  const outside = (e: PointerEvent): void => { if (e.pointerType === 'touch') for (const h of tip.on) if (!(e.target instanceof Node && h.svg.contains(e.target))) h.hide(); };
  const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') for (const h of tip.on) h.hide(); };
  const replace = (): void => { for (const h of tip.on) h.place(); };
  document.addEventListener('pointerdown', outside, { capture: true, passive: true });
  document.addEventListener('keydown', esc);
  addEventListener('scroll', replace, { capture: true, passive: true });
  addEventListener('resize', replace);
  return () => {
    for (const u of undo) u();
    el0.remove();
    document.removeEventListener('pointerdown', outside, { capture: true });
    document.removeEventListener('keydown', esc);
    removeEventListener('scroll', replace, { capture: true });
    removeEventListener('resize', replace);
  };
}
