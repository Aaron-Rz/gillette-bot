// WebGL2 beard renderer. The beard is painted once in the texture space of MediaPipe's canonical face mesh and
// warped per triangle onto the detected 3D landmarks, so it follows head turns, tilt and distance. Lighting comes
// from the camera frame itself (blurred local brightness + mesh normals), so hair darkens in shadow and brightens
// in light. Mirroring for the selfie view happens in the vertex shader.
import { UV, TRI, N_VERTS } from "./facemesh.js";

// ---------- texture space ----------
// Face UVs are squeezed into the hair texture so there is room below the chin for hair that hangs past the jaw.
export const TEX = 1024;
export const tx = (u) => 0.1 + u * 0.8;
export const ty = (v) => 0.03 + v * 0.78;
export const uvOf = (i) => [UV[2 * i], UV[2 * i + 1]];
export const texOf = (i) => [tx(UV[2 * i]) * TEX, ty(UV[2 * i + 1]) * TEX];

// Jaw contour, ear → chin → ear (image left to right along the bottom of the face).
export const JAW = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454];
export const LIPS_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
export const LIPS_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

// ---------- "beard skirt": extra vertices below the jaw so long beards can hang past the chin ----------
export const SKIRT_RINGS = 3;
export const SKIRT_LEN = 0.28; // in face-UV units at the chin, fading to 0 at the ears
const jawW = (i) => 0.22 + 0.78 * Math.pow(Math.sin((Math.PI * i) / (JAW.length - 1)), 0.7);
/** Static UV offsets for each skirt vertex (ring r = 1..SKIRT_RINGS, jaw point i). */
export const SKIRT_DUV = (() => {
  const out = [];
  const c = [0.5, 0.55];
  for (let r = 1; r <= SKIRT_RINGS; r++) {
    for (let i = 0; i < JAW.length; i++) {
      const [u, v] = uvOf(JAW[i]);
      let dx = u - c[0], dy = v - c[1];
      const l = Math.hypot(dx, dy) || 1;
      dx = dx / l * 0.5; dy = dy / l * 0.5 + 0.5; // halfway between radial and straight down
      const l2 = Math.hypot(dx, dy) || 1;
      const d = SKIRT_LEN * jawW(i) * (r / SKIRT_RINGS);
      out.push([(dx / l2) * d, (dy / l2) * d]);
    }
  }
  return out;
})();
export const N_ALL = N_VERTS + SKIRT_RINGS * JAW.length;

/** Index list: face triangles + skirt quads, all counter-clockwise in a y-up frame (same as TRI). */
export const INDICES = (() => {
  const idx = Array.from(TRI);
  const n = JAW.length;
  const ring = (r, i) => (r === 0 ? JAW[i] : N_VERTS + (r - 1) * n + i);
  for (let r = 0; r < SKIRT_RINGS; r++) {
    for (let i = 0; i < n - 1; i++) {
      const a0 = ring(r, i), b0 = ring(r, i + 1), a1 = ring(r + 1, i), b1 = ring(r + 1, i + 1);
      // image space is y-down: a1/b1 lie below a0/b0. CCW in y-up = CW in y-down.
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  return new Uint16Array(idx);
})();

/** Static texture coordinates (0..1) for all vertices incl. skirt. */
export const TEXCOORDS = (() => {
  const t = new Float32Array(N_ALL * 2);
  for (let i = 0; i < N_VERTS; i++) { t[2 * i] = tx(UV[2 * i]); t[2 * i + 1] = ty(UV[2 * i + 1]); }
  const n = JAW.length;
  for (let k = 0; k < SKIRT_DUV.length; k++) {
    const [u, v] = uvOf(JAW[k % n]);
    t[2 * (N_VERTS + k)] = tx(u + SKIRT_DUV[k][0]);
    t[2 * (N_VERTS + k) + 1] = ty(v + SKIRT_DUV[k][1]);
  }
  return t;
})();

/**
 * Positions (x, y in 0..1 image space, z) for all vertices incl. skirt from 468+ landmarks.
 * The skirt offset is mapped from UV to screen with the face's local frame, so it rotates and scales with the head.
 */
export function positions(lm, out = new Float32Array(N_ALL * 3)) {
  for (let i = 0; i < N_VERTS; i++) { out[3 * i] = lm[i].x; out[3 * i + 1] = lm[i].y; out[3 * i + 2] = lm[i].z; }
  const d = (a, b) => [lm[b].x - lm[a].x, lm[b].y - lm[a].y, lm[b].z - lm[a].z];
  const ex = d(234, 454).map((c) => c / (UV[2 * 454] - UV[2 * 234]));
  const ey = d(2, 152).map((c) => c / (UV[2 * 152 + 1] - UV[2 * 2 + 1]));
  const n = JAW.length;
  for (let k = 0; k < SKIRT_DUV.length; k++) {
    const j = lm[JAW[k % n]], [du, dv] = SKIRT_DUV[k], o = 3 * (N_VERTS + k);
    out[o] = j.x + ex[0] * du + ey[0] * dv;
    out[o + 1] = j.y + ex[1] * du + ey[1] * dv;
    // hair below the jaw falls back towards the neck → tilt the skirt away from the camera (normals face down)
    out[o + 2] = j.z + ex[2] * du + ey[2] * dv + 0.25 * Math.hypot(ex[0] * du + ey[0] * dv, ex[1] * du + ey[1] * dv);
  }
  return out;
}

/** Smooth per-vertex normals in an x-right, y-down, z-away frame (front-facing normals have z < 0). */
export function normals(pos, aspect, out = new Float32Array(N_ALL * 3)) {
  out.fill(0);
  const P = (i) => [pos[3 * i] * aspect, pos[3 * i + 1], pos[3 * i + 2] * aspect];
  for (let t = 0; t < INDICES.length; t += 3) {
    const a = P(INDICES[t]), b = P(INDICES[t + 1]), c = P(INDICES[t + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const i of [INDICES[t], INDICES[t + 1], INDICES[t + 2]]) { out[3 * i] += n[0]; out[3 * i + 1] += n[1]; out[3 * i + 2] += n[2]; }
  }
  // skirt normals: follow the jaw vertex above them (slightly turned down) so the hair shells don't show seams
  // between the skirt rings
  const nj = JAW.length;
  for (let k = 0; k < SKIRT_RINGS * nj; k++) {
    const j = JAW[k % nj], r = Math.floor(k / nj) + 1, o = 3 * (N_VERTS + k);
    const l = Math.hypot(out[3 * j], out[3 * j + 1], out[3 * j + 2]) || 1;
    out[o] = out[3 * j] / l; out[o + 1] = out[3 * j + 1] / l + 0.25 * (r / SKIRT_RINGS); out[o + 2] = out[3 * j + 2] / l;
  }
  for (let i = 0; i < N_ALL; i++) {
    const l = Math.hypot(out[3 * i], out[3 * i + 1], out[3 * i + 2]) || 1;
    // triangles are CCW in y-up → CW in this y-down frame → cross product points toward the camera (−z) already
    out[3 * i] /= l; out[3 * i + 1] /= l; out[3 * i + 2] /= l;
  }
  return out;
}

// ---------- One-Euro filter (smooth when still, responsive when moving) ----------
export class OneEuro {
  constructor(minCutoff = 1.4, beta = 4, dCutoff = 1) { Object.assign(this, { minCutoff, beta, dCutoff }); this.x = null; this.dx = null; this.t = 0; }
  static alpha(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  filter(v, t) {
    if (!this.x || this.x.length !== v.length) { this.x = Float32Array.from(v); this.dx = new Float32Array(v.length); this.t = t; return this.x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    for (let i = 0; i < v.length; i++) {
      const d = (v[i] - this.x[i]) / dt;
      this.dx[i] += ad * (d - this.dx[i]);
      const a = OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx[i]), dt);
      this.x[i] += a * (v[i] - this.x[i]);
    }
    return this.x;
  }
  reset() { this.x = null; }
}

// ---------- shaders ----------
const VS_BG = `#version 300 es
uniform float uMirror;
out vec2 vSrc;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vec2 img = vec2(p.x, 1. - p.y);
  vSrc = vec2(uMirror > .5 ? 1. - img.x : img.x, img.y);
  gl_Position = vec4(p * 2. - 1., .999, 1.);
}`;
const FS_BG = `#version 300 es
precision highp float;
uniform sampler2D uSrc; in vec2 vSrc; out vec4 o;
void main(){ o = vec4(texture(uSrc, vSrc).rgb, 1.); }`;
const VS_FACE = `#version 300 es
in vec3 aPos; in vec2 aTex; in vec3 aN;
uniform float uMirror;
out vec2 vSrc; out vec2 vTex; out vec3 vN;
void main(){
  vSrc = aPos.xy; vTex = aTex; vN = aN;
  float x = aPos.x * 2. - 1.;
  if (uMirror > .5) x = -x;
  gl_Position = vec4(x, 1. - aPos.y * 2., clamp(aPos.z * 3., -.98, .98), 1.);
}`;
const FS_FACE = `#version 300 es
precision highp float;
uniform sampler2D uSrc, uHair, uShadow;
uniform float uLod; uniform vec2 uRefA, uRefB, uRefC;
in vec2 vSrc; in vec2 vTex; in vec3 vN; out vec4 o;
float lum(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
void main(){
  vec3 base = texture(uSrc, vSrc).rgb;
  vec4 h = texture(uHair, vTex, -0.7);      // premultiplied hair colour + coverage (sharper: keeps single strands)
  float sh = texture(uShadow, vTex).r;      // skin shadow under the hair (stubble look)
  float la = lum(textureLod(uSrc, uRefA, uLod).rgb), lb = lum(textureLod(uSrc, uRefB, uLod).rgb), lc = lum(textureLod(uSrc, uRefC, uLod).rgb);
  float ref = max((la + lb + lc) / 3., .04);
  float local = lum(textureLod(uSrc, vSrc, uLod).rgb);
  float light = mix(1., clamp(local / ref, .32, 1.55), .7);
  // key light direction estimated from the brightness difference between the cheeks (x) and forehead/chin (y)
  vec3 L = normalize(vec3((lb - la) / ref * 1.6, -.45, -1.));
  vec3 n = normalize(vN);
  float nd = max(dot(n, L), 0.);
  float shade = .66 + .46 * nd;
  float lv = pow(light, .7) * shade * mix(.8, 1.15, clamp(ref * 1.4, 0., 1.)); // follows the scene exposure
  vec3 hair = h.rgb * lv + vec3(.12, .11, .10) * pow(nd, 10.) * light * h.a;  // soft sheen
  vec3 skin = base * (1. - .42 * sh) * mix(vec3(1.), vec3(.93, .95, 1.), sh); // slight cool shadow like stubble
  o = vec4(skin * (1. - h.a) + hair, 1.);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// ---------- hair texture painting (canvas 2D, texture space) ----------
export const SHADES = { black: "#231a15", brown: "#5a3a26", blond: "#93744f", ginger: "#8a4a26", grey: "#8e8a84" };
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// deterministic random so the beard doesn't change between repaints
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const T = (i) => texOf(i);
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const skirtTex = (i, r) => { const k = (r - 1) * JAW.length + i; return [TEXCOORDS[2 * (N_VERTS + k)] * TEX, TEXCOORDS[2 * (N_VERTS + k) + 1] * TEX]; };
// smooth value noise 0..1 (for irregular edges and patchy density)
function noise2(seed) {
  const r = rng(seed), G = 64, g = Array.from({ length: G * G }, r);
  const at = (x, y) => g[((y % G + G) % G) * G + ((x % G + G) % G)];
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx, b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx; return a + (b - a) * sy; };
}

// Style geometry in texture space. "top": upper edge of the beard on the cheeks; "drop": how far below the jaw the
// hair reaches (0..SKIRT_RINGS). Lengths/widths in texture px (face ≈ 820 px wide) – strands are drawn thicker than
// real hair because the texture is shown 2–3× smaller on a phone camera image.
// natural cheek line: sideburn → diagonally down to the nasolabial fold → under the nose → mirrored
const TOP_LINE = [127, 123, 187, 206, 165, 167, 164, 393, 391, 426, 411, 352, 356];
const STYLE_DEF = {
  stubble: { top: TOP_LINE, drop: 0.35, len: [5, 10], width: [1.6, 2.6], density: 0.028, under: 0.0, shadow: 0.42, clumps: 0, alpha: 0.5, edge: 0.03 },
  short: { top: TOP_LINE, drop: 0.95, len: [16, 34], width: [2.0, 3.4], density: 0.03, under: 0.3, shadow: 0.35, clumps: 0.3, alpha: 0.82, edge: 0.018 },
  full: { top: TOP_LINE, drop: 1.8, len: [34, 86], width: [2.3, 4.0], density: 0.026, under: 0.45, shadow: 0.35, clumps: 0.65, alpha: 0.86, edge: 0.024 },
  circle: { drop: 0.5, len: [14, 28], width: [2.0, 3.2], density: 0.032, under: 0.42, shadow: 0.3, clumps: 0.25, alpha: 0.84, edge: 0.016 },
  moustache: { drop: 0, len: [14, 28], width: [2.0, 3.2], density: 0.04, under: 0.4, shadow: 0.25, clumps: 0.2, alpha: 0.86, edge: 0.012 },
};

/** Closed outline (texture px) of the hair region of a style. Exported for tests/debug. */
export function regionOutline(id) {
  const def = STYLE_DEF[id];
  if (!def) return [];
  const mouthC = lerp2(T(61), T(291), 0.5);
  if (id === "moustache") {
    const lip = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291].map(T).map((p) => [p[0], p[1] - 3]);
    const nose = T(2);
    const under = [410, 322, 391, 393, 164, 167, 165, 92, 186].map(T).map((p) => lerp2(p, [p[0], nose[1]], 0.55));
    const ext = (i, s) => { const p = T(i); return [p[0] + s * 16, p[1] + 16]; };
    return [ext(61, -1), ...lip.slice(1, -1), ext(291, 1), ...under];
  }
  if (id === "circle") {
    const pts = [];
    const c = [mouthC[0], mouthC[1] + 12];
    const lipsTop = T(164), chin = T(152);
    const rx = (T(291)[0] - T(61)[0]) * 0.86, ryTop = c[1] - lipsTop[1] + 4, ryBot = chin[1] - c[1] + 18;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2, s = Math.sin(a);
      pts.push([c[0] + Math.cos(a) * rx * (s > 0 ? 0.95 : 1), c[1] + s * (s > 0 ? ryBot : ryTop)]);
    }
    return pts;
  }
  const bottom = [];
  const r = def.drop, r0 = Math.floor(r), f = r - r0;
  for (let i = 0; i < JAW.length; i++) {
    const a = r0 === 0 ? T(JAW[i]) : skirtTex(i, r0);
    const b = r0 >= SKIRT_RINGS ? a : skirtTex(i, r0 + 1);
    bottom.push(lerp2(a, b, f));
  }
  const top = def.top.map(T).reverse();
  if (id === "short") {
    const low = top.map((p, k) => (k === 0 || k === top.length - 1 ? p : lerp2(p, mouthC, k >= 4 && k <= 8 ? 0.04 : 0.16)));
    return [...bottom, ...low];
  }
  return [...bottom, ...top];
}

function polyPath(ctx, pts) { ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); }
const hexOf = (c) => (typeof c === "string" && c[0] === "#" ? c : SHADES[c] || SHADES.brown);

const hairCache = new Map();
/** Paint hair (RGBA, uploaded premultiplied) + skin-shadow canvases for a style and shade (name or #hex). */
export function paintHair(id, shade = "brown", size = TEX) {
  const key = `${id}|${shade}|${size}`;
  if (hairCache.has(key)) return hairCache.get(key);
  if (hairCache.size > 24) hairCache.clear();
  const def = STYLE_DEF[id];
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = size; return c; };
  const hair = mk(), shadow = mk();
  if (!def) { const r = { hair, shadow, empty: true }; hairCache.set(key, r); return r; }
  const k = size / TEX;
  const faceW = (T(454)[0] - T(234)[0]) * k;
  const cx = T(152)[0] * k;
  // pull the sides of the region a little inside the face silhouette so the edge can thin out instead of being
  // cut by the mesh border (no straight vertical line at the cheeks)
  const outline = regionOutline(id).map(([x, y]) => [x * k, y * k]).map(([x, y]) => {
    const r = (x - cx) / (faceW / 2);
    return Math.abs(r) > 0.7 ? [cx + (x - cx) * (1 - 0.06 * (Math.abs(r) - 0.7) / 0.3), y] : [x, y];
  });
  // mouth: hard hole from the outer-lip landmarks. Lower lip + corners get a margin; the upper-lip edge may be
  // overlapped very slightly by moustache hair.
  const lipsOut = LIPS_OUT.map(T).map(([x, y]) => [x * k, y * k]);
  const lipsC = lipsOut.reduce((s, p) => [s[0] + p[0] / lipsOut.length, s[1] + p[1] / lipsOut.length], [0, 0]);
  const UPPER = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]); // 185 … 409 (between the corners)
  const mouthHole = lipsOut.map((p, i) => {
    if (UPPER.has(i)) return [p[0], p[1] + 2.5 * k];                     // allow ~2 px overlap on the upper lip
    const d = [p[0] - lipsC[0], p[1] - lipsC[1]], l = Math.hypot(...d) || 1;
    const m = (i === 0 || i === 10 ? 7 : 6) * k;                           // corners + lower lip: keep clear
    return [p[0] + (d[0] / l) * m, p[1] + (d[1] / l) * m];
  });
  const nz = noise2(id.length * 31 + 7);

  // feathered region mask with an irregular (noisy) edge
  const mask = mk(), m = mask.getContext("2d");
  m.filter = `blur(${Math.max(1, Math.round(faceW * def.edge))}px)`;
  m.fillStyle = "#fff"; m.beginPath(); polyPath(m, outline); m.fill();
  m.filter = "none";
  const img = m.getImageData(0, 0, size, size), md = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4 + 3; const a = md[o]; if (!a || a === 255) continue;
    const n = nz((x / size) * 22, (y / size) * 22) * 0.6 + nz((x / size) * 70, (y / size) * 70) * 0.4;
    md[o] = Math.max(0, Math.min(255, (a / 255 - (n - 0.5) * 0.9) * 255));
  }
  m.putImageData(img, 0, 0);
  // "core": a much wider blur of the region → density thins out over a broad band towards every edge
  const core = mk(), cg = core.getContext("2d");
  cg.filter = `blur(${Math.round(faceW * (id === "moustache" ? 0.02 : 0.055))}px)`; cg.drawImage(mask, 0, 0); cg.filter = "none";
  const cd = cg.getImageData(0, 0, size, size).data;
  const at = (arr, x, y) => { const xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= size || yi >= size) return 0; return arr[(yi * size + xi) * 4 + 3] / 255; };
  const inHole = (() => { const hc = mk(), hg = hc.getContext("2d"); hg.fillStyle = "#fff"; hg.beginPath(); polyPath(hg, mouthHole); hg.fill(); const hd = hg.getImageData(0, 0, size, size).data; return (x, y) => at(hd, x, y) > 0.5; })();
  const clipMouth = (ctx) => { ctx.beginPath(); ctx.rect(0, 0, size, size); polyPath(ctx, mouthHole); ctx.clip("evenodd"); };

  // skin shadow (dark, slightly cool tone where hair sits in/under the skin) – also kept off the lips
  const s = shadow.getContext("2d");
  s.save(); clipMouth(s);
  s.filter = `blur(${Math.max(1, Math.round(faceW * 0.008))}px)`; s.globalAlpha = def.shadow; s.drawImage(mask, 0, 0);
  s.restore();

  const g = hair.getContext("2d");
  // colour: slightly desaturated so light shades read as hair, not as paint
  const raw = rgbOf(hexOf(shade));
  const lumBase = 0.299 * raw[0] + 0.587 * raw[1] + 0.114 * raw[2];
  const base = raw.map((c) => c * 0.82 + lumBase * 0.18);
  const light = lumBase > 95; // blond / grey: stronger dark roots so strands stay visible
  const col = (f, warm = 0) => `rgb(${Math.min(255, Math.round(base[0] * f + warm))},${Math.min(255, Math.round(base[1] * f + warm * 0.75))},${Math.min(255, Math.round(base[2] * f + warm * 0.4))})`;
  g.save(); clipMouth(g);
  if (def.under) { // thin undercoat, strongest in the middle of the beard, fading out well before the edges
    const u = mk(), ug = u.getContext("2d");
    ug.drawImage(core, 0, 0); ug.globalCompositeOperation = "source-in"; ug.fillStyle = col(light ? 0.5 : 0.6); ug.fillRect(0, 0, size, size);
    g.globalAlpha = def.under; g.drawImage(u, 0, 0); g.globalAlpha = 1;
  }

  const rand = rng(id.length * 7919 + 13);
  const mouthY = T(13)[1] * k, noseY = T(2)[1] * k, chinY = T(152)[1] * k;
  const halfW = faceW / 2;
  const inMoustache = (x, y) => y < mouthY - 2 * k && y > noseY - 6 * k && Math.abs(x - cx) < halfW * 0.4;
  function dirAt(x, y) {
    const rx = (x - cx) / halfW;
    if (id === "moustache" || inMoustache(x, y)) return Math.atan2(1, rx * 2.4);
    if (Math.abs(rx) > 0.72 && y < mouthY) return Math.atan2(1, rx * 0.12);
    return Math.atan2(1, rx * (y > chinY ? 0.22 : 0.5));
  }
  const clumps = [];
  if (def.clumps) for (let i = 0; i < 320; i++) clumps.push([rand() * size, rand() * size, (rand() - 0.5) * 0.8]);
  const clumpAt = (x, y) => { let best = clumps[0], bd = 1e18; for (const c of clumps) { const d = (c[0] - x) ** 2 + (c[1] - y) ** 2; if (d < bd) { bd = d; best = c; } } return best; };

  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const x0 = Math.max(0, Math.min(...xs) - 20 * k), x1 = Math.min(size, Math.max(...xs) + 20 * k), y0 = Math.max(0, Math.min(...ys) - 20 * k), y1 = Math.min(size, Math.max(...ys) + 20 * k);
  const N = Math.round(((x1 - x0) * (y1 - y0)) / (k * k) * def.density * 1.15);
  const BUCKETS = 8;
  // two sets per tone: dense inner strands and sparser, more transparent edge strands
  const paths = Array.from({ length: BUCKETS * 2 }, () => ({ root: new Path2D(), tip: new Path2D() }));
  let made = 0;
  for (let t = 0; t < N * 5 && made < N; t++) {
    const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0);
    const d = at(md, x, y), c = at(cd, x, y);
    if (d <= 0.22 || inHole(x, y)) continue;
    const p = Math.pow(d, 1.5) * (0.25 + 0.75 * Math.pow(c, 1.4)); // sparse towards every edge
    if (rand() > p) continue;
    made++;
    let a = dirAt(x, y) + (rand() - 0.5) * (id === "stubble" ? 1.6 : 0.5);
    const [lmin, lmax] = def.len;
    let len = (lmin + rand() * (lmax - lmin)) * k * (0.5 + 0.5 * d) * (0.75 + 0.5 * nz(x / size * 30, y / size * 30));
    if (y > chinY && id === "full") len *= 1.2;
    if (rand() < (c < 0.5 ? 0.06 : 0.02) && id !== "stubble" && d > 0.4) len *= 1.6; // wispy flyaways, more at the edge
    if (def.clumps && rand() < def.clumps * (0.4 + 0.6 * c)) { const cl = clumpAt(x, y); a = a * 0.55 + (dirAt(cl[0], cl[1]) + cl[2]) * 0.45; }
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    const curl = (rand() - 0.5) * len * (id === "full" ? 0.6 : 0.4);
    const mx = (x + ex) / 2 - Math.sin(a) * curl, my = (y + ey) / 2 + Math.cos(a) * curl;
    const q0 = [(x + mx) / 2, (y + my) / 2], q1 = [(mx + ex) / 2, (my + ey) / 2], mid = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2];
    const b = Math.min(BUCKETS - 1, Math.floor(rand() * BUCKETS)) + (c < 0.55 ? BUCKETS : 0);
    paths[b].root.moveTo(x, y); paths[b].root.quadraticCurveTo(q0[0], q0[1], mid[0], mid[1]);
    paths[b].tip.moveTo(mid[0], mid[1]); paths[b].tip.quadraticCurveTo(q1[0], q1[1], ex, ey);
  }
  g.lineCap = "round";
  const [wmin, wmax] = def.width;
  const grey = shade === "grey";
  for (let bb = 0; bb < BUCKETS * 2; bb++) {
    const b = bb % BUCKETS, edge = bb >= BUCKETS;
    const f = 0.3 + (b / (BUCKETS - 1)) * 1.05; // wide tone spread → strand-level contrast
    const silver = grey && b % 3 === 0;
    g.lineWidth = (wmin + (((b * 5) % BUCKETS) / (BUCKETS - 1)) * (wmax - wmin)) * k * (edge ? 0.85 : 1);
    g.globalAlpha = def.alpha * (0.78 + 0.22 * (b / (BUCKETS - 1))) * (edge ? 0.6 : 1);
    g.strokeStyle = silver ? "rgb(190,188,182)" : col(f * (light ? 0.62 : 0.8), 0);
    g.stroke(paths[bb].root);
    g.lineWidth *= 0.72;
    g.globalAlpha *= 0.82;
    g.strokeStyle = silver ? "rgb(228,226,220)" : col(f * 1.18, 14);
    g.stroke(paths[bb].tip);
  }
  // depth: darker valleys between tufts, ambient occlusion towards the neck and the lips, lighter cheek tops
  if (id !== "stubble") {
    const N2 = 96, nc = document.createElement("canvas"); nc.width = nc.height = N2;
    const nx = nc.getContext("2d"), nd = nx.createImageData(N2, N2);
    for (let y = 0; y < N2; y++) for (let x = 0; x < N2; x++) { const v = nz(x / N2 * 9 + 3, y / N2 * 9 + 5) * 0.65 + nz(x / N2 * 26, y / N2 * 26) * 0.35; const o = (y * N2 + x) * 4; nd.data[o + 3] = Math.max(0, (0.62 - v)) * 255; }
    nx.putImageData(nd, 0, 0);
    g.globalCompositeOperation = "source-atop"; g.globalAlpha = id === "full" ? 0.6 : 0.45; g.imageSmoothingQuality = "high";
    g.drawImage(nc, 0, 0, size, size);
  }
  g.globalCompositeOperation = "source-atop"; g.globalAlpha = 1;
  const jawY = T(172)[1] * k;
  const ao = g.createLinearGradient(0, jawY - faceW * 0.05, 0, jawY + faceW * 0.42);
  ao.addColorStop(0, "rgba(0,0,0,0)"); ao.addColorStop(0.45, "rgba(0,0,0,.28)"); ao.addColorStop(1, "rgba(0,0,0,.5)");
  g.fillStyle = ao; g.fillRect(0, 0, size, size);
  const lip = g.createRadialGradient(lipsC[0], lipsC[1], faceW * 0.07, lipsC[0], lipsC[1], faceW * 0.17);
  lip.addColorStop(0, "rgba(0,0,0,.3)"); lip.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = lip; g.fillRect(0, 0, size, size);
  const topY = T(123)[1] * k;
  const hl = g.createLinearGradient(0, topY - faceW * 0.02, 0, topY + faceW * 0.22);
  hl.addColorStop(0, `rgba(${col(1.5).slice(4, -1)},.28)`); hl.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = hl; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "source-over";
  g.restore();
  // length map for the 3D shells: R = local hair length (0..1, thins out towards every edge), G = 0 on the lips
  const lenData = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    lenData[o + 3] = 255;
    if (inHole(x, y)) continue;
    lenData[o + 1] = 255;
    const d = md[o + 3] / 255;
    if (d < 0.05) continue;
    const c = cd[o + 3] / 255;
    const v = d * (0.15 + 0.85 * Math.pow(c, 1.3)) * (0.72 + 0.56 * nz((x / size) * 30, (y / size) * 30));
    lenData[o] = Math.min(255, Math.round(v * 255));
  }
  const r = { hair, shadow, empty: false, lenData, size };
  hairCache.set(key, r);
  return r;
}

// ---------- 3D volume: shells + fins ----------
// The beard is drawn as N stacked "shells": copies of the face mesh pushed outward along the 3D normals (and, for long
// styles, pulled down by gravity). Each shell keeps only the strands that are long enough to reach its height, and
// strands get thinner towards the tip, so the hair has real thickness and parallax when the head turns. Fins along the
// jaw/cheek contour stand out from the silhouette so the beard has depth from the side instead of a cut edge.
export const SHELLS = {
  stubble: { n: 3, h: 0.007, lean: 0.004, grav: 0, alpha: 0.55, density: 1.25 },
  moustache: { n: 10, h: 0.028, lean: 0.016, grav: 0.25, alpha: 0.78, density: 1 },
  circle: { n: 11, h: 0.032, lean: 0.024, grav: 0.3, alpha: 0.75, density: 1 },
  short: { n: 12, h: 0.04, lean: 0.03, grav: 0.35, alpha: 0.75, density: 1 },
  full: { n: 22, h: 0.09, lean: 0.065, grav: 0.6, alpha: 0.72, density: 0.9 },
};
/** Fin contours: cheek/jaw outline (with sideburns) and the rings of the beard skirt. */
export const FIN_RINGS = (() => {
  const n = JAW.length, rings = [[127, ...JAW, 356]];
  for (let r = 1; r <= SKIRT_RINGS; r++) rings.push(Array.from({ length: n }, (_, i) => N_VERTS + (r - 1) * n + i));
  return rings;
})();
const FIN_POINTS = FIN_RINGS.reduce((s, r) => s + r.length, 0);
export const FIN_INDICES = (() => {
  const idx = []; let base = 0;
  for (const ring of FIN_RINGS) {
    for (let i = 0; i < ring.length - 1; i++) { const a = base + 2 * i, b = a + 2; idx.push(a, a + 1, b + 1, a, b + 1, b); }
    base += ring.length * 2;
  }
  return new Uint16Array(idx);
})();
/** Fin vertex data (10 floats each: pos3, tex2, n3, fin height 0|1, u along the contour). */
export function finVertices(pos, nrm, out = new Float32Array(FIN_POINTS * 2 * 10)) {
  let o = 0;
  for (const ring of FIN_RINGS) {
    let u = 0;
    ring.forEach((v, i) => {
      if (i) { const p = ring[i - 1]; u += Math.hypot(TEXCOORDS[2 * v] - TEXCOORDS[2 * p], TEXCOORDS[2 * v + 1] - TEXCOORDS[2 * p + 1]); }
      for (const f of [0, 1]) {
        out.set([pos[3 * v], pos[3 * v + 1], pos[3 * v + 2], TEXCOORDS[2 * v], TEXCOORDS[2 * v + 1], nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2], f, u], o);
        o += 10;
      }
    });
  }
  return out;
}

/** Strand cross-section map (tileable): R = strand length fraction, G = tone, B = unused, A = profile (1 centre → 0 edge). */
let strandData = null;
export function strandMap(size = 1024, cell = 5) {
  if (strandData) return strandData;
  const d = new Uint8Array(size * size * 4);
  const rand = rng(4242);
  for (let cy = 0; cy < size; cy += cell) for (let cx = 0; cx < size; cx += cell) {
    const px = cx + rand() * cell, py = cy + rand() * cell, r = 1.6 + rand() * 1.2;
    const t = Math.round((0.3 + 0.7 * Math.pow(rand(), 0.7)) * 255), tone = Math.round(rand() * 255);
    for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
      const a = 1 - Math.hypot(x + 0.5 - px, y + 0.5 - py) / r;
      if (a <= 0) continue;
      const xx = (x + size) % size, yy = (y + size) % size, o = (yy * size + xx) * 4;
      const v = Math.round(a * 255);
      if (v > d[o + 3]) { d[o] = t; d[o + 1] = tone; d[o + 3] = v; }
    }
  }
  strandData = { data: d, size };
  return strandData;
}

const VS_SHELL = `#version 300 es
in vec3 aPos; in vec2 aTex; in vec3 aN; in float aFin; in float aU;
uniform float uMirror, uAspect, uHabs, uGrav, uFin, uH;
uniform vec3 uDown;
out vec2 vSrc; out vec2 vTex; out vec3 vN; out float vH; out float vU;
void main(){
  float h = uFin > .5 ? aFin : uH;
  float hh = h * uHabs;
  vec3 iso = vec3(aPos.x * uAspect, aPos.y, aPos.z * uAspect) + aN * hh + uDown * hh * h * uGrav;
  vec3 p = vec3(iso.x / uAspect, iso.y, iso.z / uAspect);
  vSrc = aPos.xy; vTex = aTex; vN = aN; vH = h; vU = aU;
  float x = p.x * 2. - 1.;
  if (uMirror > .5) x = -x;
  gl_Position = vec4(x, 1. - p.y * 2., clamp(p.z * 3., -.98, .98), 1.);
}`;
const FS_SHELL = `#version 300 es
precision highp float;
uniform sampler2D uSrc, uLen, uStrand, uHair;
uniform float uLod, uLean, uMirror, uFin, uAlpha, uMoustache, uDensity;
uniform vec2 uRefA, uRefB, uRefC;
uniform vec4 uGeo;   // texture coords: centre x, half face width, mouth y, chin y
uniform float uNoseY;
uniform vec3 uColor;
in vec2 vSrc; in vec2 vTex; in vec3 vN; in float vH; in float vU; out vec4 o;
float lum(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
vec2 growDir(vec2 t){
  float rx = (t.x - uGeo.x) / uGeo.y;
  bool must = t.y < uGeo.z - .002 && t.y > uNoseY - .006 && abs(t.x - uGeo.x) < uGeo.y * .4;
  vec2 d = (uMoustache > .5 || must) ? vec2(rx * 2.4, 1.) : (abs(rx) > .72 && t.y < uGeo.z) ? vec2(rx * .12, 1.) : vec2(rx * (t.y > uGeo.w ? .22 : .5), 1.);
  return normalize(d);
}
void main(){
  if (texture(uLen, vTex).g < .5) discard;                 // never on the lips
  float h = vH;
  vec2 d = growDir(vTex);
  vec2 uv = vTex - d * h * uLean;                         // strands lean along their growth direction
  float len = texture(uLen, uv).r;
  if (len < .03) discard;
  float hr = h / len;                                      // height relative to the local hair length
  if (hr > 1.) discard;
  float cov, t, tone;
  if (uFin > .5) {
    float k = vU * 260. * uDensity, col = floor(k);
    t = .3 + .7 * hash(col); tone = hash(col + 17.);
    float w = abs(fract(k) - .5) * 2.;
    cov = (1. - smoothstep(.25 + .4 * (1. - hr), .95, w)) * (1. - smoothstep(t - .1, t, hr));
  } else {
    vec4 s = texture(uStrand, uv * uDensity, -1.);
    t = .3 + .7 * s.r; tone = s.g;
    cov = smoothstep(hr * .7, hr * .7 + .22, s.a) * (1. - smoothstep(t - .1, t, hr));
  }
  // shells seen edge-on show their layers – fade them there (the fins take over at the silhouette)
  if (uFin < .5) cov *= smoothstep(.12, .45, abs(normalize(vN).z));
  if (cov < .02) discard;
  // camera-based light at the root (so a strand is lit like the skin it grows from)
  float la = lum(textureLod(uSrc, uRefA, uLod).rgb), lb = lum(textureLod(uSrc, uRefB, uLod).rgb), lc = lum(textureLod(uSrc, uRefC, uLod).rgb);
  float ref = max((la + lb + lc) / 3., .04);
  float light = mix(1., clamp(lum(textureLod(uSrc, vSrc, uLod).rgb) / ref, .32, 1.55), .7);
  vec3 L = normalize(vec3((lb - la) / ref * 1.6, -.45, -1.)), V = vec3(0., 0., -1.), H = normalize(L + V);
  vec3 n = normalize(vN);
  // strand tangent: growth direction mapped from texture space to the screen, laid onto the surface
  vec2 jx = dFdx(vTex), jy = dFdy(vTex);
  mat2 J = mat2(jx, jy);
  float det = determinant(J);
  vec2 sd = abs(det) > 1e-12 ? inverse(J) * d : vec2(0., 1.);
  sd.y = -sd.y; if (uMirror > .5) sd.x = -sd.x;
  vec3 T = normalize(vec3(sd, 0.) + vec3(0., .001, 0.));
  T = normalize(T - n * dot(n, T) * .85);
  // Kajiya-Kay: diffuse ~ sin(T,L), two highlight lobes along the strand
  float tl = dot(T, L), th = dot(T, H);
  float diff = mix(.45, 1., sqrt(max(0., 1. - tl * tl)));
  float spec1 = pow(sqrt(max(0., 1. - th * th)), 90.) * .07;
  vec3 T2 = normalize(T + n * .3); float th2 = dot(T2, H);
  float spec2 = pow(sqrt(max(0., 1. - th2 * th2)), 24.) * .05;
  float self = mix(.55, 1., pow(hr, .7));                   // self-shadowing: inner shells darker
  vec3 c = uColor * (.7 + .85 * tone) * (.9 + .35 * hr);  // lighter tips
  // borrow the tuft / clump shading of the painted base layer so the volume isn't uniformly grainy
  vec4 ph = texture(uHair, uv);
  float pl = ph.a > .02 ? lum(ph.rgb / ph.a) / max(lum(uColor), .04) : 1.;
  c *= clamp(mix(1., pl, .9), .5, 1.5);
  vec3 col = c * diff * self * pow(light, .75) + (vec3(spec1) + uColor * 1.6 * spec2) * light * (.4 + .6 * hr);
  o = vec4(col, cov * uAlpha);
}`;

// ---------- renderer ----------
export class FaceRenderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 not available");
    this.canvas = canvas; this.gl = gl; this.kind = "webgl2";
    this.bg = compile(gl, VS_BG, FS_BG);
    this.face = compile(gl, VS_FACE, FS_FACE);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = (data, loc, size, usage) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); return b; };
    this.pos = new Float32Array(N_ALL * 3); this.nrm = new Float32Array(N_ALL * 3);
    this.posBuf = buf(this.pos, gl.getAttribLocation(this.face, "aPos"), 3, gl.DYNAMIC_DRAW);
    this.texBuf = buf(TEXCOORDS, gl.getAttribLocation(this.face, "aTex"), 2, gl.STATIC_DRAW);
    this.nBuf = buf(this.nrm, gl.getAttribLocation(this.face, "aN"), 3, gl.DYNAMIC_DRAW);
    const ib = (this.ib = gl.createBuffer()); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, INDICES, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray();
    this.srcTex = this.tex(); this.hairTex = this.tex(); this.shadowTex = this.tex();
    this.hairKey = null;
    // 3D volume: shell program shares the face buffers; fins get their own interleaved buffer
    this.shell = compile(gl, VS_SHELL, FS_SHELL);
    const sp = this.shell, loc = (n) => gl.getAttribLocation(sp, n);
    this.shellVao = gl.createVertexArray();
    gl.bindVertexArray(this.shellVao);
    const bind = (b, l, size) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0); };
    bind(this.posBuf, loc("aPos"), 3); bind(this.texBuf, loc("aTex"), 2); bind(this.nBuf, loc("aN"), 3);
    gl.disableVertexAttribArray(loc("aFin")); gl.disableVertexAttribArray(loc("aU"));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib);
    this.finData = new Float32Array(FIN_POINTS * 2 * 10);
    this.finVao = gl.createVertexArray();
    gl.bindVertexArray(this.finVao);
    this.finBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.finBuf); gl.bufferData(gl.ARRAY_BUFFER, this.finData, gl.DYNAMIC_DRAW);
    [["aPos", 3, 0], ["aTex", 2, 3], ["aN", 3, 5], ["aFin", 1, 8], ["aU", 1, 9]].forEach(([n, size, off]) => { const l = loc(n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 40, off * 4); });
    const fib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FIN_INDICES, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.lenTex = this.tex();
    this.strandTex = this.tex();
    const sm = strandMap();
    this.uploadData(this.strandTex, sm.data, sm.size, true);
    this.quality = 1; this.lastT = 0; this.ema = 0; this.shells = 0;
  }
  uploadData(t, data, size, repeat) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (repeat) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); }
  }
  tex() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  upload(t, el, premul) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  setHair(style, shade) {
    const key = `${style}|${shade}`;
    if (key === this.hairKey) return !this.hairEmpty;
    const h = paintHair(style, shade);
    this.upload(this.hairTex, h.hair, true);
    this.upload(this.shadowTex, h.shadow, true);
    if (h.lenData) this.uploadData(this.lenTex, h.lenData, h.size, false);
    const rgb = rgbOf(hexOf(shade)), l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    this.hairColor = rgb.map((c) => (c * 0.82 + l * 0.18) / 255);
    this.hairKey = key; this.hairEmpty = h.empty;
    return !h.empty;
  }
  /** Draw one frame. src: video/image/canvas; lm: landmarks (normalised) or null. */
  render(src, lm, { style = "short", shade = "brown", mirror = false, width, height, live = false, volume = true } = {}) {
    const gl = this.gl, c = this.canvas;
    const W = width || src.videoWidth || src.naturalWidth || src.width, H = height || src.videoHeight || src.naturalHeight || src.height;
    if (!W || !H) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    gl.viewport(0, 0, W, H);
    this.upload(this.srcTex, src, false);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.bg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(gl.getUniformLocation(this.bg, "uSrc"), 0);
    gl.uniform1f(gl.getUniformLocation(this.bg, "uMirror"), mirror ? 1 : 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!lm || lm.length < N_VERTS || !this.setHair(style, shade)) return;

    positions(lm, this.pos);
    normals(this.pos, W / H, this.nrm);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.nrm);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.frontFace(mirror ? gl.CW : gl.CCW);
    const p = this.face, u = (n) => gl.getUniformLocation(p, n);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex); gl.uniform1i(u("uSrc"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.hairTex); gl.uniform1i(u("uHair"), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(u("uShadow"), 2);
    gl.uniform1f(u("uMirror"), mirror ? 1 : 0);
    const faceWpx = Math.hypot((lm[454].x - lm[234].x) * W, (lm[454].y - lm[234].y) * H);
    gl.uniform1f(u("uLod"), Math.max(0, Math.log2(faceWpx / 14)));
    gl.uniform2f(u("uRefA"), lm[50].x, lm[50].y);
    gl.uniform2f(u("uRefB"), lm[280].x, lm[280].y);
    gl.uniform2f(u("uRefC"), lm[151].x, lm[151].y);
    gl.drawElements(gl.TRIANGLES, INDICES.length, gl.UNSIGNED_SHORT, 0);
    if (volume && SHELLS[style]) this.drawVolume(lm, style, mirror, W, H, faceWpx, live);
    gl.bindVertexArray(null);
  }
  /** Shells (inner → outer) and fins, alpha-blended, depth-tested against the face so the far side stays hidden. */
  drawVolume(lm, style, mirror, W, H, faceWpx, live) {
    const gl = this.gl, cfg = SHELLS[style], p = this.shell, u = (n) => gl.getUniformLocation(p, n);
    // adaptive quality: fewer shells when frames get slow (live camera only)
    if (live) {
      const now = performance.now();
      if (this.lastT) { const dt = now - this.lastT; this.ema = this.ema ? this.ema * 0.85 + dt * 0.15 : dt; if (this.ema > 40) this.quality = Math.max(0.3, this.quality * 0.97); else if (this.ema < 28) this.quality = Math.min(1, this.quality * 1.01); }
      this.lastT = now;
    }
    const n = Math.max(2, Math.round(cfg.n * (live ? this.quality : 1)));
    this.shells = n;
    const aspect = W / H, P = (i) => [lm[i].x * aspect, lm[i].y, lm[i].z * aspect];
    const a = P(234), b = P(454), top = P(10), chin = P(152);
    const faceIso = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const down = [chin[0] - top[0], chin[1] - top[1], chin[2] - top[2]], dl = Math.hypot(...down) || 1;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex); gl.uniform1i(u("uSrc"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lenTex); gl.uniform1i(u("uLen"), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.strandTex); gl.uniform1i(u("uStrand"), 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.hairTex); gl.uniform1i(u("uHair"), 3);
    gl.uniform1f(u("uMirror"), mirror ? 1 : 0);
    gl.uniform1f(u("uAspect"), aspect);
    // with fewer shells (slow device) the hair gets a little shorter instead of showing gaps between layers
    gl.uniform1f(u("uHabs"), cfg.h * faceIso * Math.min(1, Math.max(0.5, n / (cfg.n * 0.7))));
    gl.uniform1f(u("uGrav"), cfg.grav);
    gl.uniform3f(u("uDown"), down[0] / dl, down[1] / dl, down[2] / dl);
    gl.uniform1f(u("uLean"), cfg.lean);
    gl.uniform1f(u("uAlpha"), cfg.alpha);
    gl.uniform1f(u("uDensity"), cfg.density);
    gl.uniform1f(u("uMoustache"), style === "moustache" ? 1 : 0);
    gl.uniform1f(u("uLod"), Math.max(0, Math.log2(faceWpx / 14)));
    gl.uniform2f(u("uRefA"), lm[50].x, lm[50].y); gl.uniform2f(u("uRefB"), lm[280].x, lm[280].y); gl.uniform2f(u("uRefC"), lm[151].x, lm[151].y);
    gl.uniform4f(u("uGeo"), TEXCOORDS[2 * 152], (TEXCOORDS[2 * 454] - TEXCOORDS[2 * 234]) / 2, TEXCOORDS[2 * 13 + 1], TEXCOORDS[2 * 152 + 1]);
    gl.uniform1f(u("uNoseY"), TEXCOORDS[2 * 2 + 1]);
    gl.uniform3f(u("uColor"), ...this.hairColor);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
    // shells
    gl.bindVertexArray(this.shellVao);
    gl.vertexAttrib1f(gl.getAttribLocation(p, "aFin"), 0); gl.vertexAttrib1f(gl.getAttribLocation(p, "aU"), 0);
    gl.uniform1f(u("uFin"), 0);
    for (let i = 1; i <= n; i++) { gl.uniform1f(u("uH"), i / n); gl.drawElements(gl.TRIANGLES, INDICES.length, gl.UNSIGNED_SHORT, 0); }
    // fins (both sides visible)
    if (style !== "stubble") {
      finVertices(this.pos, this.nrm, this.finData);
      gl.bindVertexArray(this.finVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.finBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.finData);
      gl.disable(gl.CULL_FACE);
      gl.uniform1f(u("uFin"), 1);
      gl.drawElements(gl.TRIANGLES, FIN_INDICES.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
}
