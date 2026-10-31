// WebGL2 mark layer for mpljs scenes: dense line series drawn on the GPU with the exact data → device
// transform layout used. Data uploads once (float32, offset from the first sample so precision
// holds at any zoom); a frame only updates the transform. Strokes are capsules: each segment is a
// quad whose fragment shader antialiases by distance to the segment, so the union is exactly a
// round-joined, round-capped stroke, the join and cap style the modern presets use.

const VS = `#version 300 es
precision highp float;
in vec2 a;            // segment start (data, x offset from origin)
in vec2 b;            // segment end
uniform vec4 u_map;   // px = (x·u_map.x + u_map.y, y·u_map.z + u_map.w), device px, y down
uniform vec2 u_size;  // canvas size, device px
uniform float u_hw;   // half stroke width + 1 px of antialiasing room
out vec2 v_a; out vec2 v_b; out vec2 v_p;
void main() {
  vec2 pa = vec2(a.x * u_map.x + u_map.y, a.y * u_map.z + u_map.w);
  vec2 pb = vec2(b.x * u_map.x + u_map.y, b.y * u_map.z + u_map.w);
  vec2 d = pb - pa; float len = length(d);
  vec2 t = len > 1e-6 ? d / len : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
  int c = gl_VertexID;                       // 0..5: two triangles of the capsule's box
  float s = (c == 0 || c == 1 || c == 3) ? -1.0 : 1.0;        // along: start or end side
  float o = (c == 0 || c == 2 || c == 4) ? -1.0 : 1.0;        // across
  vec2 base = s < 0.0 ? pa : pb;
  vec2 p = base + t * s * u_hw + n * o * u_hw;
  v_a = pa; v_b = pb; v_p = p;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_a; in vec2 v_b; in vec2 v_p;
uniform vec4 u_color; uniform float u_hw;
out vec4 o;
void main() {
  vec2 ab = v_b - v_a, ap = v_p - v_a;
  float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float d = length(ap - ab * h);
  float cov = clamp(u_hw - 0.5 - d, 0.0, 1.0);   // u_hw includes +1 px; edge at half width, 1 px ramp
  if (cov <= 0.0) discard;
  o = vec4(u_color.rgb, 1.0) * (u_color.a * cov);  // premultiplied
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export class GLMarks {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl; this.canvas = canvas; this.series = [];
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.p = p;
    this.u = Object.fromEntries(['u_map', 'u_size', 'u_hw', 'u_color'].map((k) => [k, gl.getUniformLocation(p, k)]));
    this.la = gl.getAttribLocation(p, 'a'); this.lb = gl.getAttribLocation(p, 'b');
  }
  /** Upload series once: X (days), Ys (one Float64Array per series). Returns nothing; draw() reuses buffers. */
  setData(X, Ys) {
    const gl = this.gl;
    for (const s of this.series) { gl.deleteBuffer(s.buf); gl.deleteVertexArray(s.vao); }
    this.x0 = X[0];
    this.series = Ys.map((Y) => {
      const f = new Float32Array(X.length * 2);
      for (let i = 0; i < X.length; i++) { f[2 * i] = X[i] - this.x0; f[2 * i + 1] = Y[i]; }
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, f, gl.STATIC_DRAW);
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(this.la); gl.vertexAttribPointer(this.la, 2, gl.FLOAT, false, 8, 0); gl.vertexAttribDivisor(this.la, 1);
      gl.enableVertexAttribArray(this.lb); gl.vertexAttribPointer(this.lb, 2, gl.FLOAT, false, 8, 8); gl.vertexAttribDivisor(this.lb, 1);
      gl.bindVertexArray(null);
      return { buf, vao, n: X.length };
    });
  }
  /**
   * One frame. meta = the axes FrameMeta (box in figure px, limits); css = figure px → CSS px;
   * styles[k] = { color: '#rrggbb', widthPx } in figure px.
   */
  draw(meta, cssW, cssH, figW, styles) {
    const gl = this.gl, dpr = window.devicePixelRatio || 1;
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const k = W / figW;                                       // figure px → device px
    const { box, xlim, ylim } = meta;
    // float64 here, float32 on the GPU: x is measured from the first sample, so the map stays small
    const ax = (box.x1 - box.x0) / (xlim[1] - xlim[0]) * k, bx = (box.x0 + (this.x0 - xlim[0]) / (xlim[1] - xlim[0]) * (box.x1 - box.x0)) * k;
    const ay = -(box.yBot - box.yTop) / (ylim[1] - ylim[0]) * k, by = (box.yBot + ylim[0] / (ylim[1] - ylim[0]) * (box.yBot - box.yTop)) * k;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(box.x0 * k), Math.floor(H - box.yBot * k), Math.ceil((box.x1 - box.x0) * k), Math.ceil((box.yBot - box.yTop) * k));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.p);
    gl.uniform4f(this.u.u_map, ax, bx, ay, by);
    gl.uniform2f(this.u.u_size, W, H);
    this.series.forEach((s, i) => {
      const st = styles[i], [r, g, b] = hex(st.color);
      gl.uniform1f(this.u.u_hw, st.widthPx * k / 2 + 1);
      gl.uniform4f(this.u.u_color, r, g, b, 1);
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.n - 1);
    });
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
  }
  clear() { const gl = this.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
}
