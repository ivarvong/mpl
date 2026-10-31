// A waterfall of the last frame's trace, read straight from the mpljs tracer (the same spans the
// OTLP export carries). Runs of 3+ same-named siblings fold into one row (×n, summed time) so a
// frame stays readable; click a row for its attributes. Redraws at most 4×/s while frames stream,
// and once more when the page goes idle, so the panel never costs the chart a frame.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LOAD = /^(startup|document\.|modules\.|fetch\.|font\.|script\.|paint\.)/;
const cat = (name) => (name === 'gl.draw' ? 'gl' : name === 'browser.render' ? 'browser' : name === 'input.wait' ? 'wait' : LOAD.test(name) ? 'load'
  : name.startsWith('render.') ? 'render' : name === 'frame' || name === 'figure.build' || name === 'dom.commit' || name === 'hover.draw' ? 'app' : 'layout');
// Browsers clamp performance.now() (0.1 ms without cross-origin isolation, 5 µs with it), so the
// panel finds the clock's resolution from the timestamps and never prints digits finer than that.
let res = 0.001;
const resolution = (spans) => { for (const r of [0.1, 0.01, 0.001]) if (spans.every((s) => Math.abs(s.startMs / r - Math.round(s.startMs / r)) < 1e-6 && Math.abs(s.endMs / r - Math.round(s.endMs / r)) < 1e-6)) return r; return 0.001; };
const fmt = (ms) => { const d = res >= 0.1 ? 1 : res >= 0.01 ? 2 : 3; return ms > 0 && ms < res ? `<${res}` : ms >= 10 ? ms.toFixed(1) : ms.toFixed(d); };

const KEYS = ['frame', 'figure.build', 'figure.layout', 'render.svg', 'dom.commit', 'gl.draw', 'browser.render', 'input.wait'];
const p50 = (a) => a.toSorted((x, y) => x - y)[a.length >> 1];

export class TracePanel {
  constructor(el, tracer) {
    this.el = el; this.tracer = tracer; this.frozen = false; this.pending = false; this.lastDraw = 0; this.open = new Set(); this.spans = []; this.hist = []; this.startup = []; this.view = 'frame';
    el.innerHTML = `<div class="tp-head"><div class="tp-sum" aria-live="off"></div><div class="tp-actions">
      <span class="tp-tabs" role="tablist"><button type="button" role="tab" data-v="frame" aria-selected="true">Last frame</button><button type="button" role="tab" data-v="startup" aria-selected="false">Startup</button></span>
      <button type="button" class="tp-freeze" aria-pressed="false">Freeze</button><button type="button" class="tp-otlp">Download OTLP</button></div></div>
      <div class="tp-legend"><span class="k app"></span>page <span class="k layout"></span>mpljs layout <span class="k render"></span>mpljs SVG <span class="k gl"></span>WebGL <span class="k browser"></span>browser render <span class="k wait"></span>input wait <span class="k load"></span>loading</div>
      <div class="tp-rows" role="tree"></div>`;
    this.sum = el.querySelector('.tp-sum'); this.rows = el.querySelector('.tp-rows');
    const fz = el.querySelector('.tp-freeze');
    fz.addEventListener('click', () => { this.frozen = !this.frozen; fz.setAttribute('aria-pressed', this.frozen); fz.textContent = this.frozen ? 'Frozen · resume' : 'Freeze'; if (!this.frozen) this.draw(); });
    el.querySelector('.tp-otlp').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(this.tracer.toOTLP(), null, 2)], { type: 'application/json' }));
      a.download = `mpljs-frame-${this.spans.length ? this.spans[0].traceId.slice(0, 8) : 'trace'}.otlp.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    for (const b of el.querySelectorAll('.tp-tabs button')) b.addEventListener('click', () => {
      this.view = b.dataset.v;
      for (const x of el.querySelectorAll('.tp-tabs button')) x.setAttribute('aria-selected', x === b);
      this.render();
    });
    this.rows.addEventListener('click', (e) => {
      const r = e.target.closest('.tp-row'); if (!r) return;
      const id = r.dataset.id; if (this.open.has(id)) this.open.delete(id); else this.open.add(id);
      this.render();
    });
  }
  setStartup(spans) { this.startup = spans; if (this.view === 'startup') this.render(); }
  frame() {
    // one frame is an anecdote (JIT, GC): keep the top-level split of the last 60 frames too
    if (!this.frozen) {
      const sp = this.tracer.spans(), g = (n) => sp.reduce((a, x) => a + (x.name === n ? x.durationMs : 0), 0);
      if (sp.length) { this.hist.push(KEYS.map(g)); if (this.hist.length > 60) this.hist.shift(); }
    }
    this.pending = true; const t = performance.now(); if (t - this.lastDraw > 250) this.draw(); }
  idle() { if (this.pending) this.draw(); }
  draw() {
    if (this.frozen) return;
    this.pending = false; this.lastDraw = performance.now();
    this.spans = this.tracer.spans();
    this.render();
  }
  render() {
    const spans = this.view === 'startup' ? this.startup : this.spans;
    if (!spans.length) return;
    const kids = new Map(), ids = new Set(spans.map((s) => s.spanId)), roots = [];
    for (const s of spans) {
      if (s.parent.kind === 'some' && ids.has(s.parent.value)) { const k = kids.get(s.parent.value) || []; k.push(s); kids.set(s.parent.value, k); } else roots.push(s);
    }
    const root = roots.find((s) => s.name === 'frame' || s.name === 'startup') || roots[0];
    res = resolution(spans);
    const t0 = Math.min(...spans.map((s) => s.startMs)), t1 = Math.max(...spans.map((s) => s.endMs)), T = Math.max(t1 - t0, 1e-6);
    const out = [];
    const walk = (list, depth, path) => {
      const sorted = list.toSorted((a, b) => a.startMs - b.startMs), groups = new Map();
      for (const s of sorted) { const g = groups.get(s.name) || []; g.push(s); groups.set(s.name, g); }
      const done = new Set();
      for (const s of sorted) {
        if (done.has(s.name)) continue;
        const g = groups.get(s.name);
        if (g.length >= 3) {
          done.add(s.name);
          const id = `${path}/${s.name}×`;
          out.push({ id, name: s.name, n: g.length, depth, start: g[0].startMs, end: Math.max(...g.map((x) => x.endMs)), dur: g.reduce((a, x) => a + x.durationMs, 0), attrs: g[0].attrs, kids: g.reduce((a, x) => a + (kids.get(x.spanId) || []).length, 0) });
        } else {
          const id = `${path}/${s.name}#${g.indexOf(s)}`;
          out.push({ id, name: s.name, n: 1, depth, start: s.startMs, end: s.endMs, dur: s.durationMs, attrs: s.attrs, err: s.status.kind === 'error' });
          walk(kids.get(s.spanId) || [], depth + 1, id);
        }
      }
    };
    walk(roots, 0, '');
    const by = (n) => spans.filter((s) => s.name === n).reduce((a, s) => a + s.durationMs, 0);
    const reason = root.attrs.reason || '';
    const head = root.name === 'startup' ? `startup · navigation → first frame rendered` : `frame · ${esc(reason)}${root.attrs.input ? ` · from ${esc(root.attrs.input)} event` : ''}`;
    this.sum.innerHTML = `<b>${fmt(T)} ms</b> <span>${head} · ${spans.length} spans · trace ${esc(root.traceId.slice(0, 8))}…</span>`
      + `<span class="tp-split">build ${fmt(by('figure.build'))} · layout ${fmt(by('figure.layout'))} · SVG ${fmt(by('render.svg'))} · DOM ${fmt(by('dom.commit'))}${spans.some((s) => s.name === 'gl.draw') ? ` · GL ${fmt(by('gl.draw'))}` : ''} · browser ${fmt(by('browser.render'))}${spans.some((s) => s.name === 'input.wait') ? ` · input wait ${fmt(by('input.wait'))}` : ''} ms</span>`
      + (root.name === 'startup' ? '' : this.hist.length > 1 ? `<span class="tp-med">median of last ${this.hist.length} frames: <b>${fmt(p50(this.hist.map((h) => h[0])))} ms</b> · build ${fmt(p50(this.hist.map((h) => h[1])))} · layout ${fmt(p50(this.hist.map((h) => h[2])))} · SVG ${fmt(p50(this.hist.map((h) => h[3])))} · DOM ${fmt(p50(this.hist.map((h) => h[4])))}${this.hist.some((h) => h[5] > 0) ? ` · GL ${fmt(p50(this.hist.map((h) => h[5])))}` : ''} · browser ${fmt(p50(this.hist.map((h) => h[6])))} ms</span>` : '')
      + `<span class="tp-res">clock resolution ${res} ms${res >= 0.1 ? ' (the browser clamps timers on this page)' : ''}; browser.render runs from the end of our JS to the next task: an upper bound on main-thread style, layout, paint and commit (Chromium's own timeline accounts for about half of it); GPU raster and display are not in it</span>`;
    this.rows.innerHTML = out.map((r) => {
      const left = ((r.start - t0) / T) * 100, w = Math.max(((r.end - r.start) / T) * 100, 0.3);
      const attrs = Object.entries(r.attrs).map(([k, v]) => `<span><i>${esc(k)}</i> ${esc(v)}</span>`).join('');
      const open = this.open.has(r.id);
      return `<div class="tp-row${open ? ' open' : ''}" data-id="${esc(r.id)}" role="treeitem" aria-expanded="${open}" tabindex="-1">
        <div class="tp-name" style="padding-left:${r.depth * 12}px">${esc(r.name)}${r.n > 1 ? ` <em>×${r.n}</em>` : ''}${r.err ? ' <em class="err">error</em>' : ''}</div>
        <div class="tp-track"><div class="tp-bar ${cat(r.name)}" style="left:${left}%;width:${w}%"></div></div>
        <div class="tp-dur">${fmt(r.dur)}${r.n > 1 ? '<small> Σ</small>' : ''}</div>
        ${open ? `<div class="tp-attrs">${attrs || '<span><i>no attributes</i></span>'}${r.n > 1 ? `<span><i>folded</i> ${r.n} spans, ${r.kids} children</span>` : ''}</div>` : ''}
      </div>`;
    }).join('');
  }
}
