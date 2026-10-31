// mpljs live: the library itself, running in the browser, drawing exact vector frames.
// Every frame re-runs matplotlib's layout (locators, formatters, legend placement) for the current
// view and writes SVG with glyph outlines; hover lives on an overlay and never re-renders the chart.
// Interaction is a pure view model (view.js): input moves a target interval, frames ease toward it.
import { subplots, modern, modernDark, tracer, FACE_LOADS } from './lib/index.js';
import { TracePanel } from './tracepanel.js';
import { toSVG } from './lib/render/svg.js';
import { GLMarks } from './gl.js';
import { ease, nearest, pan, same, velocity, wheelFactor, zoomAbout } from './view.js';

const T_SCRIPT = performance.now();                 // all imported modules have evaluated by now
const host = document.getElementById('chart');
const under = document.getElementById('under'), above = document.getElementById('above'), glCanvas = document.getElementById('gl');
let glm = null;
const initMarks = [];                               // [name, start, end] of startup work, before tracing exists
const timed = (name, fn) => { const t = performance.now(), r = fn(); initMarks.push([name, t, performance.now()]); return r; };
timed('gl.init', () => { try { glm = new GLMarks(glCanvas); } catch { glm = null; } });
let mode = 'svg';                                 // marks drawn as SVG paths, or by the WebGL layer
const overlay = document.getElementById('overlay');
const tip = document.getElementById('tip');
const statsEl = document.getElementById('stats');
const live = document.getElementById('live');
const pill = document.getElementById('xpill'), toast = document.getElementById('toast');

// ---- data: three regions, three years of daily traffic (seeded, synthetic)
let seed = 11;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const DAY = 864e5, t0 = Date.UTC(2023, 9, 20);
const series = [
  { name: 'Americas', base: 6.2, trend: 2.6, week: 0.55 },
  { name: 'EMEA', base: 4.1, trend: 1.9, week: 0.4 },
  { name: 'APAC', base: 2.2, trend: 2.4, week: 0.3 },
];
let dense = false;
function makeData() {
  seed = 11;
  const n = dense ? 3 * 365 * 24 : 3 * 365, step = dense ? DAY / 24 : DAY;
  const xs = Array.from({ length: n }, (_, i) => new Date(t0 + i * step));
  const X = Float64Array.from(xs, (d) => d.getTime() / DAY);          // matplotlib's date units: days
  const ys = series.map((s) => { let walk = 0; return xs.map((d, i) => {
    walk += (rnd() - 0.5) * 0.06;
    const t = i / n, wd = d.getUTCDay(), hour = dense ? d.getUTCHours() : 12;
    return s.base + s.trend * t + walk - (wd === 0 || wd === 6 ? s.week : 0) + (dense ? 0.35 * Math.sin((hour - 9) / 24 * 2 * Math.PI) : 0);
  }); });
  const proxy = ys.map((y) => { let lo = 0, hi = 0; for (let i = 1; i < n; i++) { if (y[i] < y[lo]) lo = i; if (y[i] > y[hi]) hi = i; } return [...new Set([0, lo, hi, n - 1])].toSorted((a, b) => a - b); });
  const top = Math.ceil(Math.max(...ys.map((y) => Math.max(...y))) * 1.18);
  return { xs, X, ys, proxy, top };
}
const lineWidth = () => (dense ? 1 : 1.6);

// matplotlib's AutoDateLocator picks tick counts by time span, not axis width, so on a phone its
// labels collide (matplotlib would draw the same). Narrow screens get ~4 ticks chosen here.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function narrowTicks(ax, [lo, hi]) {
  const span = hi - lo, out = [], labels = [];
  const months = [1, 2, 3, 6, 12].find((m) => span / (30.44 * m) <= 4);
  if (span > 60 && months) {
    const d0 = new Date(lo * DAY), y = d0.getUTCFullYear();
    let m = d0.getUTCMonth();
    for (let k = 0; k < 40; k++, m++) {
      const t = Date.UTC(y + Math.floor(m / 12), m % 12, 1) / DAY;
      if (t > hi) break;
      if (t >= lo && (m % 12) % months === 0) { const dd = new Date(t * DAY); out.push(dd); labels.push(`${MON[dd.getUTCMonth()]} '${String(dd.getUTCFullYear()).slice(2)}`); }
    }
  } else {
    const step = [1 / 24, 1 / 8, 1 / 4, 1 / 2, 1, 2, 7, 14].find((s) => span / s <= 4) || 14;
    for (let t = Math.ceil(lo / step) * step; t <= hi && out.length < 8; t += step) {
      const dd = new Date(Math.round(t * DAY)); out.push(dd);
      labels.push(step < 1 ? dd.toISOString().slice(11, 16) : `${MON[dd.getUTCMonth()]} ${dd.getUTCDate()}`);
    }
  }
  ax.set_xticks(out);
  ax.set_xticklabels(labels);
}
let data = timed('data.generate', makeData);
const full = () => [data.X[0], data.X[data.X.length - 1]];

// ---- view: home = the autoscaled limits; target = where input wants the view; shown = what was
// drawn (it eases toward target). Layout only ever sees shown, as set_xlim, or nothing at home.
const v = { home: null, target: null, shown: null, tau: 70 };
let narrow = false;
let meta = null;                                  // the last frame's FrameMeta: box, limits, scales
const times = { layout: [], dom: [] };
const push = (a, x) => { a.push(x); if (a.length > 60) a.shift(); };
const p50 = (a) => (a.length ? a.toSorted((x, y) => x - y)[a.length >> 1] : 0);

function dark() { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
const preset = () => (dark() ? modernDark : modern);

// No layout reads inside a frame: reading geometry after the previous frame's DOM writes forces a
// synchronous style + layout pass (the trace showed 3.3 ms of it in figure.build). The host's
// width comes from a ResizeObserver; the readout's own sizes are measured once per content shape.
let hostW = timed('dom.first-layout', () => host.clientWidth);   // the page's first style + layout pass happens here
function build() {
  const w = Math.max(320, hostW), h = Math.round(w * (w < 560 ? 0.78 : 0.5));
  narrow = w < 560;
  const [fig, ax] = subplots({ rc: { ...preset(), 'figure.figsize': [w / 100, h / 100], 'figure.dpi': 100,
    'figure.subplot.left': narrow ? 0.13 : 0.075, 'figure.subplot.right': 0.98, 'figure.subplot.top': 0.9, 'figure.subplot.bottom': narrow ? 0.12 : 0.1,
    'axes.ymargin': 0.04 } });
  // In WebGL mode layout sees a proxy per series: its first, last, lowest and highest samples. Autoscale
  // reads only data extents, so limits, ticks and the legend are exactly those of the full data.
  data.ys.forEach((y, k) => {
    const st = { label: series[k].name, color: `C${k}`, linewidth: lineWidth() };
    if (mode === 'gl') { const ix = data.proxy[k]; ax.plot(ix.map((i) => data.xs[i]), ix.map((i) => y[i]), st); }
    else ax.plot(data.xs, y, st);
  });
  const xl = v.home && !same(v.shown, v.home) ? v.shown : null;
  if (xl) ax.set_xlim(xl[0], xl[1]);
  ax.set_ylim(0, data.top);
  if (narrow) narrowTicks(ax, xl || v.home || full());
  ax.set_ylabel('million requests / s');
  ax.legend({ loc: 'upper left', ncols: 3 });
  return fig;
}

// ---- frames: one requestAnimationFrame loop. Layout runs only when the shown view changed; hover
// alone redraws the overlay. The loop sleeps when nothing moves.
let raf = 0, last = 0, dirty = true, hoverDirty = false, glide = 0;
function frame(now) {
  raf = 0;
  const dt = last ? Math.min(now - last, 64) : 1000 / 60;
  last = now;
  if (v.home) {
    if (glide) {
      const before = v.target;
      v.target = v.shown = pan(v.target, glide * dt, v.home);
      glide *= Math.exp(-dt / 325);                                   // iOS-style deceleration
      if (same(before, v.target) || Math.abs(glide) * pxPerUnit() < 0.01) glide = 0;
      dirty = true; why = why === 'redraw' ? 'glide' : why;
    } else if (!same(v.shown, v.target)) { v.shown = ease(v.shown, v.target, dt, v.tau); dirty = true; why = why === 'redraw' ? 'ease' : why; }
  }
  if (dirty) render(); else if (hoverDirty) drawHover();
  if (glide || (v.home && !same(v.shown, v.target))) kick(); else { last = 0; if (!open) panel.idle(); }
}
const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
let why = 'load';                                                               // what caused the next frame, for its trace
const invalidate = (reason) => { dirty = true; if (typeof reason === 'string') why = reason; kick(); };
const hoverChanged = () => { hoverDirty = true; kick(); };

// Every frame is one trace, from the input event that caused it to the end of the browser's own
// rendering work for it:
//   input.wait      event.timeStamp → this frame's callback (queueing + waiting for vsync)
//   figure.build … gl.draw, hover.draw    the page's and mpljs's JS work
//   browser.render  end of our JS → the first task after the frame: an upper bound on main-thread
//                   style, layout, paint and commit. Checked against Chromium's timeline
//                   (bench/bench_live.ts): it contains 92 % of that work, which is about half its
//                   length. GPU raster and display are not in it; when they back up, it shows as
//                   input.wait on the next input.
// The library's spans nest under 'frame' because startTrace joins an open span.
const panel = new TracePanel(document.getElementById('trace'), tracer);
tracer.enable();
let inputT = -1, inputType = '';
const noteInput = (e) => { if (inputT < 0) { inputT = e.timeStamp; inputType = e.type; } };
let open = null;
const frames = [];                                    // the frame whose browser.render is still pending
const after = new MessageChannel();
after.port1.addEventListener('message', () => finishFrame(true));
after.port1.start();
function finishFrame(measured) {
  if (!open) return;
  const f = open, t = performance.now(); open = null;
  if (measured) tracer.record('browser.render', { note: 'main thread, until the next task' }, f.workEnd, t);
  f.root.endAt(measured ? t : f.workEnd);
  if (f.traced) {                                   // a compact record per frame, for benchmarks (window.__frames)
    const sp = tracer.spans(), r = sp.find((x) => x.name === 'frame' && x.endMs === (measured ? t : f.workEnd)), get = (nm) => sp.reduce((acc, x) => acc + (x.name === nm ? x.durationMs : 0), 0);
    if (r) { frames.push({ reason: r.attrs.reason, input: r.attrs.input || '', marks: r.attrs.marks, points: r.attrs.points, start: r.startMs, workStart: f.workStart, workEnd: f.workEnd, end: r.endMs,
      wait: get('input.wait'), build: get('figure.build'), layout: get('figure.layout'), svg: get('render.svg'), dom: get('dom.commit'), gl: get('gl.draw'), browser: get('browser.render') }); if (frames.length > 2000) frames.shift(); }
  }
  if (startup && f.first) {
    for (const p of performance.getEntriesByType('paint')) tracer.record(`paint.${p.name}`, {}, p.startTime, p.startTime);
    startup.endAt(measured ? t : f.workEnd); startup = null; panel.setStartup(tracer.spans()); }
  if (!f.traced) tracer.enable();
  panel.frame();
  if (!raf) panel.idle();
}
const svg = (layer, sc, prefix) => tracer.span('render.svg', { layer, nodes: sc.nodes.length }, (sp) => { const out = toSVG(sc, tracer, 'glyphs', prefix); sp.setAttribute('bytes', out.length); return out; });
function render() {
  dirty = false;
  finishFrame(false);                               // a frame whose follow-up task never ran
  const first = !!startup, traced = first || !panel.frozen;
  if (traced && !first) tracer.clear();
  if (!traced) tracer.disable();
  const n = data.X.length * series.length, tStart = performance.now();
  const root = tracer.startTraceAt('frame', { reason: why, marks: mode, points: n, 'view.days': v.shown ? +(v.shown[1] - v.shown[0]).toFixed(2) : 0, ...(inputT >= 0 ? { input: inputType } : {}) }, inputT >= 0 ? inputT : tStart);
  if (inputT >= 0) tracer.record('input.wait', { event: inputType }, inputT, tStart);
  inputT = -1;
  const a = performance.now();
  const fig = tracer.span('figure.build', { calls: series.length + 5 }, () => build());
  const scene = fig.toScene();
  meta = fig.meta[0].frame;
  if (!v.home) { v.home = [meta.xlim[0], meta.xlim[1]]; v.target = v.shown = v.home; }
  // WebGL mode: the scene splits at the line marks (found by their provenance tags): SVG under them,
  // the GL canvas, then SVG over them; nothing else sits between the marks in these charts
  const nodes = scene.nodes, firstMark = nodes.findIndex(isMark), lastMark = nodes.findLastIndex(isMark);
  const gl = mode === 'gl' && glm && firstMark >= 0;
  const svgA = svg('under', gl ? { ...scene, nodes: nodes.slice(0, firstMark) } : scene, 'u');
  const svgB = gl ? svg('above', { ...scene, background: { kind: 'none' }, nodes: [...nodes.slice(firstMark, lastMark + 1).filter((nd) => !isMark(nd)), ...nodes.slice(lastMark + 1)] }, 'a') : '';
  const b = performance.now();
  tracer.span('dom.commit', { bytes: svgA.length + svgB.length }, () => {
    under.innerHTML = svgA;
    above.innerHTML = svgB;
    const svgEl = under.firstElementChild;
    svgEl.setAttribute('role', 'img');
    svgEl.setAttribute('aria-label', 'Requests per second by region');
  });
  if (gl) tracer.span('gl.draw', { series: series.length, segments: (data.X.length - 1) * series.length }, () => glm.draw(meta, hostW, hostW * scene.height / scene.width, scene.width, data.ys.map((_, k) => ({ color: preset()['axes.prop_cycle'][k], widthPx: lineWidth() * 100 / 72 }))));
  else if (glm) glm.clear();
  const c = performance.now();
  if (overlay.viewBox.baseVal.width !== scene.width || overlay.viewBox.baseVal.height !== scene.height) {
    overlay.setAttribute('viewBox', `0 0 ${scene.width} ${scene.height}`);
    overlay.setAttribute('width', scene.width); overlay.setAttribute('height', scene.height);
  }
  if (hover) tracer.span('hover.draw', { kind: hover.kind }, () => drawHover()); else drawHover();
  why = 'redraw';
  push(times.layout, b - a); push(times.dom, c - b);
  statsEl.textContent = `${n.toLocaleString('en-US')} points · marks: ${gl ? 'WebGL' : 'SVG'} · layout + SVG ${p50(times.layout).toFixed(1)} ms · DOM${gl ? ' + GL' : ''} ${p50(times.dom).toFixed(1)} ms · median of ${times.layout.length} frames`;
  window.__stats = { mode: gl ? 'gl' : 'svg', layout: p50(times.layout), dom: p50(times.dom), frames: times.layout.length, points: n };
  open = { root, workStart: tStart, workEnd: performance.now(), traced, first };
  after.port2.postMessage(0);
}
const isMark = (nd) => nd.kind === 'group' && nd.tag.startsWith('artist/') && nd.tag.endsWith('/line');

// ---- coordinates. Events arrive in CSS px; layout works in figure px (the overlay's viewBox).
const cssToFig = () => overlay.viewBox.baseVal.width / hostW || 1;
function pt(e) {
  const r = host.getBoundingClientRect(), k = cssToFig();
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
}
const boxW = () => meta.box.x1 - meta.box.x0;
const pxPerUnit = () => boxW() / (v.shown[1] - v.shown[0]);                   // figure px per day
const frac = (px) => Math.min(Math.max((px - meta.box.x0) / boxW(), 0), 1);
const at = (lim, f) => lim[0] + f * (lim[1] - lim[0]);
const inBox = (p) => meta && p.x >= meta.box.x0 && p.x <= meta.box.x1 && p.y >= meta.box.yTop && p.y <= meta.box.yBot;
const toPxX = (x) => meta.box.x0 + ((x - meta.xlim[0]) / (meta.xlim[1] - meta.xlim[0])) * boxW();
const toPxY = (y) => meta.box.yBot - ((y - meta.ylim[0]) / (meta.ylim[1] - meta.ylim[0])) * (meta.box.yBot - meta.box.yTop);
const minW = () => (dense ? 0.25 : 7);                                          // six hours / one week

// ---- wheel. Zoom accumulates on the target, about the data under the cursor's screen fraction, and
// eases in. Horizontal scroll (or shift) pans. A plain vertical wheel zooms only once the chart is
// engaged (focused by a click or Tab) or with ⌘/Ctrl; otherwise the page scrolls and a hint says how.
const lineH = (dm) => (dm === 1 ? 16 : dm === 2 ? host.clientHeight : 1);
host.addEventListener('wheel', (e) => {
  if (!meta || !v.home) return;
  const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY) || (e.shiftKey && !e.ctrlKey);
  if (!horiz && !(e.ctrlKey || e.metaKey || document.activeElement === host)) { nudge(); return; }
  e.preventDefault(); noteInput(e);
  glide = 0;
  const p = pt(e);
  if (horiz) {
    const d = (e.deltaX || e.deltaY) * lineH(e.deltaMode) * cssToFig() / pxPerUnit();
    v.target = pan(v.target, d, v.home); v.shown = pan(v.shown, d, v.home);
    invalidate('wheel.pan');
    return;
  }
  v.target = zoomAbout(v.target, at(v.target, frac(p.x)), wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), v.home, minW());
  v.tau = e.ctrlKey ? 30 : 70;                                                  // pinch tracks tighter than a wheel notch
  why = e.ctrlKey ? 'pinch.wheel' : 'wheel';
  kick();
}, { passive: false });

let nudgeTimer = 0;
function nudge() {
  toast.textContent = `Click the chart, or hold ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}, to zoom with the wheel`;
  toast.classList.add('on');
  clearTimeout(nudgeTimer); nudgeTimer = setTimeout(() => toast.classList.remove('on'), 1400);
}

// ---- pointers: press → (pan | band) with a 4 px slop, so a click never flashes a drag; two touches
// pinch. Pans are direct manipulation (no easing) and glide on release. Shift-drag (mouse) selects
// an x range to zoom to, matplotlib's zoom-to-rect along x.
const pointers = new Map();
let g = null;                                                                    // the gesture in progress
host.addEventListener('pointerdown', (e) => {
  if (!meta || !v.home || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const p = pt(e);
  pointers.set(e.pointerId, p);
  try { host.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
  glide = 0; v.target = v.shown;                                                // grabbing stops any motion
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), f0: frac((a.x + b.x) / 2), lim: v.shown };
    hover = null; hoverChanged();
  } else if (pointers.size === 1) {
    g = { kind: 'press', x0: p.x, y0: p.y, lim: v.shown, band: e.shiftKey && e.pointerType === 'mouse', touch: e.pointerType !== 'mouse', samples: [] };
  }
  cursor(p);
});
host.addEventListener('pointermove', (e) => {
  if (!meta || !v.home) return;
  const p = pt(e), k = cssToFig();
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (g && g.kind === 'press' && Math.hypot(p.x - g.x0, p.y - g.y0) > 4 * k) {
    g.kind = g.band ? 'band' : 'pan';
    if (g.kind === 'pan' && !g.touch) { hover = null; hoverChanged(); }
  }
  if (g && g.kind === 'pan') {
    noteInput(e);
    const d = (p.x - g.x0) / boxW() * (g.lim[1] - g.lim[0]);
    v.target = v.shown = pan(g.lim, -d, v.home);
    g.samples.push({ t: e.timeStamp, x: v.shown[0] }); if (g.samples.length > 12) g.samples.shift();
    if (g.touch) hover = { kind: 'px', x: p.x, y: p.y };
    invalidate('drag');
  } else if (g && g.kind === 'band') {
    g.x1 = p.x; hoverChanged();
  } else if (g && g.kind === 'pinch' && pointers.size === 2) {
    noteInput(e);
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    const z = zoomAbout(g.lim, at(g.lim, g.f0), g.d0 / Math.max(d, 1), v.home, minW());
    const shift = (g.f0 - frac((a.x + b.x) / 2)) * (z[1] - z[0]);               // the midpoint drags too
    v.target = v.shown = pan(z, shift, v.home);
    invalidate('pinch');
  } else if (!g && e.pointerType !== 'touch') {
    hover = inBox(p) ? { kind: 'px', x: p.x, y: p.y } : null; hoverChanged();
  }
  cursor(p, e.shiftKey);
});
function release(e, cancelled) {
  if (!pointers.delete(e.pointerId) || !g) return;
  if (g.kind === 'band') noteInput(e);
  const p = pt(e);
  if (!cancelled) {
    if (g.kind === 'pan') {
      g.samples.push({ t: e.timeStamp, x: v.shown[0] });                      // holding still before release kills the glide
      const vel = velocity(g.samples, e.timeStamp);
      if (Math.abs(vel) * pxPerUnit() > 0.15) glide = vel;                     // > 0.15 figure px / ms
    } else if (g.kind === 'band' && Math.abs(g.x1 - g.x0) > 6 * cssToFig()) {
      const a = at(v.shown, frac(Math.min(g.x0, g.x1))), b = at(v.shown, frac(Math.max(g.x0, g.x1)));
      const m = (a + b) / 2, w = Math.max(b - a, minW());
      v.target = zoomAbout(v.shown, m, w / (v.shown[1] - v.shown[0]), v.home, minW());
      v.target = pan(v.target, m - (v.target[0] + v.target[1]) / 2, v.home);
      v.tau = 110; why = 'range';
    } else if (g.kind === 'press' && g.touch) {
      hover = inBox(p) ? { kind: 'i', i: nearest(data.X, at(v.shown, frac(p.x))) } : null;  // tap reads out
    }
  }
  if (g.kind === 'pinch' || pointers.size === 0) g = null;
  hoverChanged(); kick();
  cursor(p, e.shiftKey);
}
host.addEventListener('pointerup', (e) => release(e, false));
host.addEventListener('pointercancel', (e) => release(e, true));
host.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !g) { hover = null; hoverChanged(); } });
host.addEventListener('dblclick', (e) => { noteInput(e); resetView(); });
function resetView() { why = 'reset'; glide = 0; if (v.home) { v.target = v.home; v.tau = 120; kick(); } }

// The cursor says what a press will do: crosshair to read values in the plot, grabbing while panning,
// zoom-in with shift (range select), and the plain arrow outside the plot area.
function cursor(p, shift) {
  const c = g && g.kind === 'pan' ? 'grabbing' : g && g.kind === 'band' ? 'zoom-in' : inBox(p) ? (shift ? 'zoom-in' : 'crosshair') : 'default';
  if (host.style.cursor !== c) host.style.cursor = c;
}
addEventListener('keydown', (e) => { if (e.key === 'Shift' && hover && hover.kind === 'px') cursor(hover, true); });
addEventListener('keyup', (e) => { if (e.key === 'Shift' && hover && hover.kind === 'px') cursor(hover, false); });

// ---- keyboard. ←/→ walk the readout sample by sample (Shift: ×10) and the view follows it;
// +/− zoom about the readout; Home/End jump to the ends; 0 resets. The readout is announced.
host.addEventListener('focus', () => { if (meta && v.home && (!hover || hover.kind !== 'i') && host.matches(':focus-visible')) { hover = { kind: 'i', i: nearest(data.X, at(v.shown, 0.5)) }; hoverChanged(); announce(); } });
host.addEventListener('blur', () => { if (hover && hover.kind === 'i') { hover = null; hoverChanged(); } });
host.addEventListener('keydown', (e) => {
  if (!meta || !v.home) return;
  const n = data.X.length;
  const cur = hover && hover.kind === 'i' ? hover.i : nearest(data.X, at(v.target, 0.5));
  const perPx = Math.max(1, Math.round(n / (data.X[n - 1] - data.X[0]) / pxPerUnit() * 6));  // ~6 px per step
  const step = perPx * (e.shiftKey ? 10 : 1);
  const z = (f) => { v.target = zoomAbout(v.target, data.X[cur], f, v.home, minW()); v.tau = 90; };
  const act = {
    ArrowLeft: () => follow(Math.max(0, cur - step)), ArrowRight: () => follow(Math.min(n - 1, cur + step)),
    Home: () => follow(0), End: () => follow(n - 1),
    '+': () => z(0.7), '=': () => z(0.7), '-': () => z(1 / 0.7), '_': () => z(1 / 0.7), '0': resetView,
    Escape: () => { hover = null; },
  }[e.key];
  if (!act) return;
  e.preventDefault(); noteInput(e); glide = 0; why = `key ${e.key}`;
  act();
  hoverChanged(); kick(); if (e.key !== 'Escape') announce();
});
function follow(i) {
  hover = { kind: 'i', i };
  const x = data.X[i], [lo, hi] = v.target, m = (hi - lo) * 0.08;               // keep 8 % clear of the edges
  if (x < lo + m) v.target = pan(v.target, x - (lo + m), v.home);
  else if (x > hi - m) v.target = pan(v.target, x - (hi - m), v.home);
  v.tau = 90;
}
let announceTimer = 0;
function announce() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    if (!hover || hover.kind !== 'i') return;
    const i = hover.i;
    live.textContent = `${fmtDate(data.X[i])}: ` + data.ys.map((y, k) => `${series[k].name} ${y[i].toFixed(2)} million`).join(', ');
  }, 160);
}

// ---- hover readout: crosshair, points, an x pill on the axis and a card that follows the pointer.
// Persistent elements, attributes updated in place.
let hover = null;
const fmtDate = (x) => { const d = new Date(Math.round(x * DAY)); return dense ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : d.toISOString().slice(0, 10); };
const fmtPill = (x) => { const d = new Date(Math.round(x * DAY)); const s = `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; return dense ? `${s} ${d.toISOString().slice(11, 16)}` : s; };
const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, val); overlay.append(el); return el; };
const band = mk('rect', { class: 'band', visibility: 'hidden' });
const hline = mk('line', { 'stroke-width': 1, visibility: 'hidden' });
const dots = series.map(() => mk('circle', { r: 4.5, 'stroke-width': 2, visibility: 'hidden' }));
const show = (el, on) => { const vis = on ? 'visible' : 'hidden'; if (el.getAttribute('visibility') !== vis) el.setAttribute('visibility', vis); };
let tipKey = '', sizes = { shape: '', tw: 0, th: 0, pw: 0 };

function drawHover() {
  hoverDirty = false;
  if (!meta) return;
  // range band (shift-drag)
  const bandOn = g && g.kind === 'band' && g.x1 !== undefined;
  show(band, bandOn);
  if (bandOn) {
    const a = Math.max(Math.min(g.x0, g.x1), meta.box.x0), b = Math.min(Math.max(g.x0, g.x1), meta.box.x1);
    band.setAttribute('x', a); band.setAttribute('width', Math.max(0, b - a)); band.setAttribute('y', meta.box.yTop); band.setAttribute('height', meta.box.yBot - meta.box.yTop);
  }
  const i = !hover ? -1 : hover.kind === 'i' ? hover.i : inBox(hover) ? nearest(data.X, at(meta.xlim, frac(hover.x))) : -1;
  const x = i < 0 ? 0 : toPxX(data.X[i]);
  const on = i >= 0 && x >= meta.box.x0 - 0.5 && x <= meta.box.x1 + 0.5;
  show(hline, on); dots.forEach((d) => show(d, on));
  pill.hidden = tip.hidden = !on;
  if (!on) return;
  const rc = preset(), cyc = rc['axes.prop_cycle'];
  hline.setAttribute('x1', x); hline.setAttribute('x2', x); hline.setAttribute('y1', meta.box.yTop); hline.setAttribute('y2', meta.box.yBot);
  hline.setAttribute('stroke', rc['axes.labelcolor']);
  const ys = data.ys.map((y) => toPxY(y[i]));
  dots.forEach((d, k) => { d.setAttribute('cx', x); d.setAttribute('cy', ys[k]); d.setAttribute('fill', cyc[k]); d.setAttribute('stroke', rc['figure.facecolor']); });
  // card: rows ordered as the lines stack at this x (top line first), keys in series colour
  const key = `${i}|${cyc.join()}`;
  if (key !== tipKey) {
    tipKey = key;
    const order = data.ys.map((_, k) => k).toSorted((a, b) => data.ys[b][i] - data.ys[a][i]);
    tip.innerHTML = `<div class="when">${fmtDate(data.X[i])}</div>` + order.map((k) => `<div class="row"><span class="key" style="background:${cyc[k]}"></span><span>${series[k].name}</span><b>${data.ys[k][i].toFixed(2)}M</b></div>`).join('');
    pill.textContent = fmtPill(data.X[i]);
  }
  const shape = `${dense}|${tip.textContent.length}|${pill.textContent.length}`;
  if (shape !== sizes.shape) sizes = { shape, tw: tip.offsetWidth, th: tip.offsetHeight, pw: pill.offsetWidth };  // rare: new content shape
  const s = 1 / cssToFig(), { tw, th, pw } = sizes;
  const cx = x * s;
  const top = meta.box.yTop * s, bot = meta.box.yBot * s;
  const py = hover.kind === 'px' ? hover.y * s : Math.min(...ys) * s;
  tip.style.transform = `translate(${Math.round(cx + 16 + tw > hostW - 4 ? cx - 16 - tw : cx + 16)}px, ${Math.round(Math.min(Math.max(py - th / 2, top), bot - th))}px)`;
  pill.style.transform = `translate(${Math.round(Math.min(Math.max(cx - pw / 2, meta.box.x0 * s - 8), hostW - pw))}px, ${Math.round(bot + 4)}px)`;
}

// ---- controls
const resetTimes = () => { times.layout.length = 0; times.dom.length = 0; };
const setMode = (m) => { mode = m === 'gl' && glm ? 'gl' : 'svg'; panel.hist.length = 0; for (const el of document.querySelectorAll('[name=marks]')) el.checked = el.value === mode; resetTimes(); invalidate('marks'); };
document.getElementById('dense').addEventListener('change', (e) => {
  dense = e.target.checked;
  document.getElementById('sub').textContent = `${dense ? 'Hourly' : 'Daily'}, three years · synthetic data`;
  data = makeData(); if (glm) glm.setData(data.X, data.ys);
  v.home = v.target = v.shown = null; glide = 0; hover = null; tipKey = '';
  setMode(dense ? 'gl' : 'svg');
});
for (const el of document.querySelectorAll('[name=marks]')) el.addEventListener('change', () => setMode(el.value));
if (!glm) for (const el of document.querySelectorAll('[name=marks][value=gl]')) { el.disabled = true; el.parentElement.title = 'WebGL2 is not available here'; }
if (glm) timed('gl.upload', () => glm.setData(data.X, data.ys));
document.getElementById('reset').addEventListener('click', resetView);
new ResizeObserver((es) => { const w = es[0].contentRect.width; if (w !== hostW) { hostW = w; invalidate('resize'); } }).observe(host);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { tipKey = ''; sizes.shape = ''; invalidate('theme'); });
new MutationObserver(() => { tipKey = ''; invalidate('theme'); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
window.__frames = frames;
window.__live = { get startup() { return panel.startup; }, get view() { return { ...v }; }, get meta() { return meta; }, get hover() { return hover; }, get glide() { return glide; } };
// ---- startup: one trace from navigation start (t = 0) to the first frame's rendering, assembled
// from the browser's navigation and resource timing, the library's face-load timestamps, and the
// first frame itself (which nests under it).
let startup = null;
const win = (rs, name, attrs) => { if (rs.length) tracer.record(name, { files: rs.length, bytes: rs.reduce((x, r) => x + r.encodedBodySize, 0), transfer: rs.reduce((x, r) => x + r.transferSize, 0), ...attrs }, Math.min(...rs.map((r) => r.startTime)), Math.max(...rs.map((r) => r.responseEnd))); };
{
  const nav = performance.getEntriesByType('navigation')[0];
  const js = performance.getEntriesByType('resource').filter((r) => /\.js(\?|$)/.test(r.name) && new URL(r.name).origin === location.origin);
  startup = tracer.startTraceAt('startup', { page: location.pathname, modules: js.length }, 0);
  if (nav) {
    tracer.record('document.fetch', { bytes: nav.encodedBodySize, protocol: nav.nextHopProtocol || '' }, nav.startTime, nav.responseEnd);
    tracer.record('document.parse', {}, nav.responseEnd, nav.domInteractive);
  }
  const fetched = js.length ? Math.max(...js.map((r) => r.responseEnd)) : T_SCRIPT;
  if (js.length) {
    const fe = tracer.startSpanAt('modules.fetch', { files: js.length, bytes: js.reduce((x, r) => x + r.encodedBodySize, 0) }, Math.min(...js.map((r) => r.startTime)));
    win(js.filter((r) => r.name.includes('/data/fonts/')), 'fetch.font-data', {});
    win(js.filter((r) => !r.name.includes('/data/fonts/')), 'fetch.code', {});
    fe.endAt(fetched);
  }
  // V8 compiles while streaming, so 'compile+evaluate' is measured from the last byte to our first line
  const ev = tracer.startSpanAt('modules.compile+evaluate', {}, Math.min(fetched, FACE_LOADS.length ? FACE_LOADS[0].startMs : fetched));
  for (const f of FACE_LOADS) tracer.record('font.build', { face: f.id, glyphs: f.glyphs }, f.startMs, f.endMs);
  ev.endAt(T_SCRIPT);
  const si = tracer.startSpanAt('script.init', { points: data.X.length * series.length, webgl: !!glm }, T_SCRIPT);
  for (const [name, a, b] of initMarks) tracer.record(name, {}, a, b);
  si.endAt(performance.now());
}
invalidate('load');
