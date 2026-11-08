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
 *  index of the Axes that leads its share group (sharex/sharey/twinx), -1 when the sidecar predates it. */
export type AxisInfo = { readonly s: string; readonly lim: readonly [number, number]; readonly b: number; readonly names: readonly string[]; readonly px: number; readonly g: number };
/** One artist: its kind, label, colour and points (data `d` and pixel `p`, flat x/y pairs), as the sidecar has them. */
export type ArtistInfo = {
  readonly i: number; readonly k: string; readonly l: string; readonly c: string; readonly s: string; readonly ds: string;
  readonly d: readonly number[]; readonly p: readonly number[]; readonly b: readonly number[];
};
export type AxesInfo = {
  readonly box: readonly [number, number, number, number]; readonly x: AxisInfo; readonly y: AxisInfo; readonly cb: boolean;
  readonly a: readonly ArtistInfo[]; readonly lg: readonly (readonly number[])[];
};
/** Formats a value on an axis for display (`exact`: a data point, not the cursor); the default is formatValue. */
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
           names: Array.isArray(names) ? names.map((n) => String(n)) : [], px, g: typeof g === 'number' && Object.hasOwn(Object(o), 'g') ? g : -1 };
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
/**
 * Dates as UTC ISO dates (the cursor to the day, minute, second or millisecond one pixel resolves; a point without
 * its zero time parts), categories by name,
 * log values to 4 significant digits, linear values to the axis' per-pixel resolution. `exact` (a data point,
 * not the cursor) prints linear values to 7 significant digits (whole numbers from 1e7).
 */
export function formatValue(v: number, a: AxisInfo, _which: 'x' | 'y', exact: boolean): string {
  if (!Number.isFinite(v)) return String(v);
  const res = Math.abs(a.lim[1] - a.lim[0]) / Math.max(a.px, 1);
  if (a.s === 'date') {
    const iso = new Date(Math.round(v * 864e5)).toISOString().replace('T', ' ').replace('Z', '');
    // a point: as precise as it is (no zero time parts); the cursor: as precise as one pixel
    if (exact) return iso.replace(/ 00:00:00\.000$/, '').replace(/\.000$/, '');
    return res >= 1 ? iso.slice(0, 10) : res >= 1 / 1440 ? iso.slice(0, 16) : res >= 1 / 86400 ? iso.slice(0, 19) : iso;
  }
  if (a.s === 'cat') { const n = a.names[Math.round(v)]; if (typeof n === 'string' && (exact || Math.abs(v - Math.round(v)) < 0.5)) return n; }
  if (a.s === 'log') return String(Number(v.toPrecision(4)));
  if (exact) return Math.abs(v) >= 1e7 ? String(Math.round(v)) : String(Number(v.toPrecision(7)));
  return trim(v.toFixed(Math.min(12, Math.max(0, Math.ceil(-Math.log10(res))))));
}

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
.mpl-dim{opacity:var(--mpl-dim-opacity,.22)}.mpl-off{display:none}
.mpl-cross line{stroke:var(--mpl-crosshair,currentColor);stroke-opacity:var(--mpl-crosshair-opacity,.45);stroke-dasharray:3 3}
.mpl-cross line,.mpl-dot,.mpl-lg,.mpl-kb{vector-effect:non-scaling-stroke}
.mpl-dot{fill:var(--mpl-dot-fill,Canvas);stroke:var(--mpl-dot,currentColor);stroke-width:2}
.mpl-lg,.mpl-kb{fill:transparent;outline:none}.mpl-lg{cursor:pointer}
.mpl-lg.mpl-lg-off{fill:var(--mpl-legend-off,Canvas);fill-opacity:var(--mpl-legend-off-opacity,.7)}
.mpl-lg:focus-visible,.mpl-kb:focus-visible{stroke:var(--mpl-focus,Highlight);stroke-width:2}
.mpl-tip{position:fixed;z-index:2147483647;pointer-events:none;font:var(--mpl-tip-font,12px/1.4 system-ui,sans-serif);background:var(--mpl-tip-bg,Canvas);color:var(--mpl-tip-fg,CanvasText);border:1px solid var(--mpl-tip-border,GrayText);border-radius:var(--mpl-tip-radius,4px);padding:4px 8px;white-space:nowrap;box-shadow:0 2px 8px rgb(0 0 0/.18)}
.mpl-tip[hidden]{display:none}.mpl-tip b{font-weight:600}.mpl-tip i{display:inline-block;width:.7em;height:.7em;border-radius:2px;margin-right:.4em}.mpl-tip small{display:block;opacity:.7}`;

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

/** Wire one annotated SVG, and again whenever its content is re-rendered (`mpl:render`); returns its detach function. */
function wire(svg: SVGSVGElement, tip: HTMLDivElement, format: Format): () => void {
  const offs = new Map<number, Set<number>>();   // legend toggles by Axes index: they survive a re-render
  const at: number[] = [];                        // the pointer's last client position while it is over the SVG
  let undo = wireContent(svg, tip, format, offs, at, false);
  // the readout stays up when it was (a wheel zoom under a resting pointer); whoever replaced the content keeps focus
  const rerender = (): void => { const shown = !tip.hidden; undo(); undo = wireContent(svg, tip, format, offs, at, shown); };
  svg.addEventListener('mpl:render', rerender);
  return () => { svg.removeEventListener('mpl:render', rerender); undo(); };
}

function wireContent(svg: SVGSVGElement, tip: HTMLDivElement, format: Format, offs: Map<number, Set<number>>, at: number[], shown: boolean): () => void {
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
  if (axes.length === 0) { tip.hidden = true; return () => {}; }
  const layer = el('g', { class: 'mpl-overlay', 'pointer-events': 'none' });
  const cross = el('g', { class: 'mpl-cross' }), vx = el('line', {}), hy = el('line', {}), dot = el('circle', { class: 'mpl-dot', r: 3.5 });
  cross.append(vx, hy, dot);
  cross.style.display = 'none';
  const hits = el('g', { 'pointer-events': 'all' });
  layer.append(cross, hits);
  svg.append(layer);

  const dims: Element[] = [];
  const undim = (): void => { for (const e of dims.splice(0)) e.classList.remove('mpl-dim'); };
  const hide = (): void => { cross.style.display = 'none'; tip.hidden = true; undim(); };

  /** Show the readout at SVG point (x, y): the cursor's data coordinates, and the nearest point of any Axes there. */
  const show = (x: number, y: number, cx: number, cy: number, pick: readonly Hit[]): void => {
    const here = axes.filter((a) => inside(a.info.box, x, y));
    if (here.length === 0) { hide(); return; }
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
      const head = html('div'), sw = html('i');
      sw.style.background = art.c;
      head.append(sw, html('b', art.l !== '' ? art.l : `${art.k} ${art.i}`));
      const vx2 = art.d[2 * j], vy2 = art.d[2 * j + 1], X = owner.info.x, Y = owner.info.y;
      const base = art.b.length > 0 ? art.b[j] : 0, val = art.s === 'y' ? vx2 : vy2, va = art.s === 'y' ? X : Y;
      const delta = art.b.length > 0 ? ` (${val - base >= 0 ? '+' : ''}${format(val - base, { ...va, s: 'linear' }, art.s === 'y' ? 'x' : 'y', true, svg)})` : '';
      rows.push(head, html('div', `x ${format(vx2, X, 'x', true, svg)}${art.s === 'y' ? delta : ''}`), html('div', `y ${format(vy2, Y, 'y', true, svg)}${art.s === 'y' ? '' : delta}`));
      for (const a of axes) for (const [i, es] of a.groups) {
        const kind = a.info.a[i];
        if ((a !== owner || i !== art.i) && !(kind && (kind.k === 'text' || kind.k === 'annotation'))) for (const e of es) { e.classList.add('mpl-dim'); dims.push(e); }
      }
    } else dot.style.display = 'none';
    const cur = [`x ${format(pixelToData(here[0].info, 'x', x), here[0].info.x, 'x', false, svg)}`,
      ...here.map((a, n) => `y${n > 0 ? n + 1 : ''} ${format(pixelToData(a.info, 'y', y), a.info.y, 'y', false, svg)}`)];
    rows.push(html('small', cur.join(' · ')));
    tip.replaceChildren(...rows);
    tip.hidden = false;
    const r = tip.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    tip.style.left = `${cx + 14 + r.width > W ? Math.max(0, cx - 14 - r.width) : cx + 14}px`;
    tip.style.top = `${cy + 14 + r.height > H ? Math.max(0, cy - 14 - r.height) : cy + 14}px`;
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

  let frame = 0;
  const showAt = (): void => { const p = toSvg(at[0], at[1]); if (p.length === 2) show(p[0], p[1], at[0], at[1], []); };
  const move = (e: PointerEvent): void => {
    at.splice(0, 2, e.clientX, e.clientY);
    // under mpl/zoom a pressed pointer pans or zooms: no readout until it lifts
    if (e.buttons !== 0 && svg.hasAttribute('data-mpl-zoom')) { hide(); return; }
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => { frame = 0; showAt(); });
  };
  const leave = (): void => { at.splice(0); hide(); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
  // re-rendered under a resting pointer (a wheel zoom): the readout follows the new view
  if (at.length === 2 && shown) showAt();

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
      const [cx, cy] = toScreen(s.p[2 * pj], s.p[2 * pj + 1]);
      show(s.p[2 * pj], s.p[2 * pj + 1], cx, cy, [{ art: s, j: pj, dist: 0 }]);
    });
    kb.addEventListener('blur', hide);
    hits.append(kb);
  }
  return () => {
    svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerdown', move); svg.removeEventListener('pointerleave', leave);
    if (frame !== 0) cancelAnimationFrame(frame);
    hide(); layer.remove();
    for (const a of axes) for (const es of a.groups.values()) for (const e of es) e.classList.remove('mpl-off');
  };
}

/**
 * Make every annotated SVG under `root` interactive (fig.toSVG({ interactive: true }), inlined in the page).
 * Returns a function that undoes it. `format` overrides how values print (see formatValue).
 */
export function attach(root: ParentNode = document, format: Format = formatValue): () => void {
  if (document.querySelectorAll('style.mpl-css').length === 0) {
    const s = document.createElement('style');
    s.className = 'mpl-css';
    s.textContent = CSS;
    document.head.append(s);
  }
  const tip = html('div', '', 'mpl-tip');
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  document.body.append(tip);
  const svgs = Array.from(root.querySelectorAll('svg')).filter((s) => s.querySelectorAll('g[data-mpl-axes]').length > 0);
  if (root instanceof SVGSVGElement) svgs.push(root);
  const undo = svgs.map((s) => wire(s, tip, format));
  return () => { for (const u of undo) u(); tip.remove(); };
}
