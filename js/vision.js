// In-browser face analysis with MediaPipe Face Landmarker. The photo never leaves the device.
// Measurements use whole face zones (forehead, nose, cheeks, upper lip, chin/jaw, neck) built from the face mesh,
// and every finding comes with a per-pixel map so the overlay shows *where* something was measured.
import { UV, TRI } from "./facemesh.js";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let lib = null;
let fileset = null;
let cpuOnly = false; // set once the GPU path failed (e.g. Firefox: GPU service missing at graph start)
const landmarkers = {};
const run = (lm, mode, source, ts) => (mode === "VIDEO" ? lm.detectForVideo(source, ts ?? performance.now()) : lm.detect(source));
function warmUp(lm, mode) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"); g.fillStyle = "#888"; g.fillRect(0, 0, 64, 64);
  run(lm, mode, c, performance.now());
}
/** MediaPipe Tasks needs WebGL even on the CPU delegate (image upload). Without it, fail fast so callers can fall back. */
export function canTrackFaces() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}
export async function getLandmarker(mode = "IMAGE") {
  if (landmarkers[mode]) return landmarkers[mode];
  if (!canTrackFaces()) throw new Error("WebGL unavailable – face tracking cannot run in this browser");
  lib = lib || (await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`));
  fileset = fileset || (await lib.FilesetResolver.forVisionTasks(`${MP}/wasm`));
  const make = (delegate) => lib.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: mode,
    numFaces: 1,
  });
  let lm = null;
  if (!cpuOnly) {
    try { lm = await make("GPU"); warmUp(lm, mode); } // some browsers create the GPU graph but fail on the first frame
    catch (e) { console.warn("GPU face tracking unavailable, using CPU", e); try { lm?.close(); } catch { /* ignore */ } lm = null; cpuOnly = true; }
  }
  if (!lm) lm = await make("CPU");
  landmarkers[mode] = lm;
  return lm;
}
/** Drop the GPU landmarkers and use the CPU from now on (called after a runtime GPU error). */
export function switchToCPU() {
  if (cpuOnly) return false;
  cpuOnly = true;
  for (const k of Object.keys(landmarkers)) { try { landmarkers[k].close(); } catch { /* ignore */ } delete landmarkers[k]; }
  return true;
}
/** Detect with automatic one-time fallback from GPU to CPU. */
export async function detectFace(source, mode = "IMAGE", ts) {
  try { return run(await getLandmarker(mode), mode, source, ts); }
  catch (e) {
    if (!switchToCPU()) throw e;
    console.warn("GPU face tracking failed at runtime, switching to CPU", e);
    return run(await getLandmarker(mode), mode, source, ts);
  }
}

// ---------- colour helpers ----------
function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lab(r, g, b) {
  const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const median = (a) => { if (!a.length) return 0; const s = Float32Array.from(a).sort(); return s[Math.floor(s.length / 2)]; };
const quant = (a, q) => { if (!a.length) return 0; const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ---------- zones on the canonical face mesh (texture coordinates: x right, y down) ----------
// Each zone is a smooth outline in the canonical face's texture space, mapped onto the photo through the mesh
// triangles (barycentric), so it bends with the face instead of being a fixed circle.
const ellipse = (cx, cy, rx, ry, n = 28) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const mirror = (pts) => pts.map(([u, v]) => [1 - u, v]).reverse();
const JAW_UV = [[0.09, 0.64], [0.11, 0.71], [0.155, 0.775], [0.215, 0.835], [0.29, 0.88], [0.37, 0.91], [0.44, 0.922], [0.5, 0.925]];
export const ZONE_UV = {
  forehead: ellipse(0.5, 0.185, 0.2, 0.045),
  nose: [[0.465, 0.33], [0.535, 0.33], [0.55, 0.47], [0.565, 0.53], [0.5, 0.555], [0.435, 0.53], [0.45, 0.47]],
  cheekL: ellipse(0.245, 0.515, 0.095, 0.065),
  cheekR: ellipse(0.755, 0.515, 0.095, 0.065),
  upperLip: [[0.4, 0.668], [0.425, 0.636], [0.46, 0.62], [0.5, 0.617], [0.54, 0.62], [0.575, 0.636], [0.6, 0.668], [0.55, 0.648], [0.5, 0.645], [0.45, 0.648]],
  // chin & jaw: U-shape along the jaw, under the lower lip
  jaw: [...JAW_UV, ...mirror(JAW_UV), [0.86, 0.66], [0.75, 0.69], [0.66, 0.73], [0.6, 0.765], [0.5, 0.775], [0.4, 0.765], [0.34, 0.73], [0.25, 0.69], [0.14, 0.66]],
  browL: ellipse(0.325, 0.262, 0.075, 0.014, 16),
  browR: ellipse(0.675, 0.262, 0.075, 0.014, 16),
};
export const ZONE_LABELS = { forehead: "Forehead", nose: "Nose", cheekL: "Cheek", cheekR: "Cheek", upperLip: "Upper lip", jaw: "Chin & jaw", neck: "Neck" };
/** Which zones belong to which finding (for highlighting). */
export const FINDING_ZONES = { beard: ["upperLip", "jaw"], redness: ["cheekL", "cheekR"], shine: ["forehead", "nose"], texture: ["cheekL", "cheekR"] };

/** Map a canonical texture coordinate onto the photo through the containing mesh triangle. */
function uvToImage(u, v, P) {
  let best = null, bestD = Infinity;
  for (let t = 0; t < TRI.length / 3; t++) {
    const i = TRI[3 * t], j = TRI[3 * t + 1], k = TRI[3 * t + 2];
    const ax = UV[2 * i], ay = UV[2 * i + 1], bx = UV[2 * j], by = UV[2 * j + 1], cx = UV[2 * k], cy = UV[2 * k + 1];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (!den) continue;
    const l1 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / den, l2 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / den, l3 = 1 - l1 - l2;
    const out = Math.max(0, -l1) + Math.max(0, -l2) + Math.max(0, -l3);
    if (out < bestD) { bestD = out; best = [i, j, k, l1, l2, l3]; if (out === 0) break; }
  }
  const [i, j, k, l1, l2, l3] = best;
  const A = P(i), B = P(j), C = P(k);
  return [A[0] * l1 + B[0] * l2 + C[0] * l3, A[1] * l1 + B[1] * l2 + C[1] * l3];
}
function neckPolygon(P, pts, from = 0, to = 0.33) {
  // strip below the jaw line, pushed down along the face's vertical axis (from/to in nose→chin lengths)
  const NECK_TOP = [58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288];
  const ax = [pts[152].x - pts[2].x, pts[152].y - pts[2].y];
  const at = (f) => NECK_TOP.map(P).map(([x, y], i) => { const w = Math.sin((Math.PI * i) / (NECK_TOP.length - 1)) * 0.75 + 0.25; return [x + ax[0] * P.sx * f * w, y + ax[1] * P.sy * f * w]; });
  const top = at(from), down = at(to);
  if (from > 0) { const c = (p) => [(p[0] - top[7][0]) * 0.7 + top[7][0], p[1]]; return [...top.map(c), ...down.map(c).reverse()]; }
  return [...top, ...down.reverse()];
}
/** Smooth closed path through points (quadratic curves through midpoints). */
function smoothPath(ctx, p) {
  const n = p.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(p[n - 1], p[0]);
  ctx.moveTo(...m0);
  for (let i = 0; i < n; i++) { const m = mid(p[i], p[(i + 1) % n]); ctx.quadraticCurveTo(p[i][0], p[i][1], m[0], m[1]); }
  ctx.closePath();
}

export const BEARD_CLASSES = ["clean-shaven", "stubble", "short beard", "full beard"];

/** Analyse an image/canvas. Returns null when no face is found. */
export async function analyze(source) {
  const res = await detectFace(source, "IMAGE");
  const pts = res.faceLandmarks && res.faceLandmarks[0];
  if (!pts) return null;
  const w = source.naturalWidth || source.videoWidth || source.width;
  const h = source.naturalHeight || source.videoHeight || source.height;
  const cv = document.createElement("canvas");
  const scale = Math.min(1, 900 / Math.max(w, h));
  const W = (cv.width = Math.round(w * scale)), H = (cv.height = Math.round(h * scale));
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const P = (i) => [pts[i].x * W, pts[i].y * H];
  P.sx = W; P.sy = H;
  const faceW = Math.hypot(P(454)[0] - P(234)[0], P(454)[1] - P(234)[1]);

  // rasterise zone masks (zone id per pixel; 0 = none)
  const ZONES = ["forehead", "nose", "cheekL", "cheekR", "upperLip", "jaw", "browL", "browR", "neck", "below"];
  const polys = Object.fromEntries(ZONES.map((z) => [z, z === "neck" ? neckPolygon(P, pts) : z === "below" ? neckPolygon(P, pts, 0.4, 0.8) : ZONE_UV[z].map(([u, v]) => uvToImage(u, v, P))]));
  const mc = document.createElement("canvas"); mc.width = W; mc.height = H;
  const mx = mc.getContext("2d", { willReadFrequently: true });
  ZONES.forEach((z, zi) => { mx.fillStyle = `rgb(${zi + 1},0,0)`; mx.beginPath(); smoothPath(mx, polys[z]); mx.fill(); });
  const zd = mx.getImageData(0, 0, W, H).data;
  const zoneAt = (k) => { const v = zd[k * 4]; return v && zd[k * 4 + 3] > 250 ? ZONES[v - 1] : null; };

  // per-pixel features
  const N = W * H;
  const Lm = new Float32Array(N), A = new Float32Array(N), Bv = new Float32Array(N), G = new Float32Array(N), S = new Float32Array(N);
  for (let k = 0; k < N; k++) { const o = k * 4; const r = d[o], g = d[o + 1], b = d[o + 2]; Lm[k] = 0.299 * r + 0.587 * g + 0.114 * b; S[k] = Math.max(r, g, b) - Math.min(r, g, b); }
  const zonePx = Object.fromEntries(ZONES.map((z) => [z, []]));
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x;
    G[k] = (Math.abs(Lm[k] - Lm[k + 1]) + Math.abs(Lm[k] - Lm[k - 1]) + Math.abs(Lm[k] - Lm[k + W]) + Math.abs(Lm[k] - Lm[k - W])) / 2;
    const z = zoneAt(k);
    if (z) { zonePx[z].push(k); const o = k * 4; const l = lab(d[o], d[o + 1], d[o + 2]); A[k] = l[1]; Bv[k] = l[2]; }
  }
  const gray = median(zonePx.forehead.concat(zonePx.nose).map((k) => S[k])) < 6;

  // skin reference: forehead + nose. Hair detection is lighting-robust: hair = fine texture relative to brightness,
  // or clearly darker than the cheek skin *and* less colourful (shadowed skin keeps its colour, hair does not).
  const refPx = zonePx.forehead.concat(zonePx.nose);
  const C = (k) => Math.hypot(A[k], Bv[k]);
  const refL = median(refPx.map((k) => Lm[k]));
  const refA = median(refPx.map((k) => A[k]));
  const refG = median(refPx.map((k) => G[k]));
  const refGn = median(refPx.map((k) => G[k] / (Lm[k] + 15)));
  const refCr = median(refPx.map((k) => C(k) / (Lm[k] + 15)));
  const cheekL = median(zonePx.cheekL.concat(zonePx.cheekR).map((k) => Lm[k])) || refL;
  const rawHair = (k) => {
    const gn = G[k] / (Lm[k] + 15);
    if (gn > Math.max(refGn * 3, 0.06) && G[k] > 7) return true;
    const dark = Lm[k] < cheekL * 0.5;
    const dull = gray || C(k) / (Lm[k] + 15) < refCr * 0.66;
    return dark && dull;
  };
  // keep only hair that forms an area (beard/stubble), not thin lines like the jaw edge or lip contour
  const raw = new Uint8Array(N);
  for (const z of ZONES) for (const k of zonePx[z]) raw[k] = rawHair(k) ? 1 : 0;
  const I = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += raw[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  const R = Math.max(2, Math.round(faceW * 0.014));
  const hairMap = new Uint8Array(N);
  for (const z of ZONES) for (const k of zonePx[z]) {
    if (!raw[k]) continue;
    const x = k % W, y = (k / W) | 0, x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
    const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    if (sum / ((x1 - x0) * (y1 - y0)) > 0.38) hairMap[k] = 1;
  }
  const isHair = (k) => hairMap[k] === 1;

  // facial hair: share of hair pixels in upper lip + chin/jaw (+ neck lightly)
  const beardZones = ["upperLip", "jaw"];
  const frac = (z) => { const px = zonePx[z]; if (!px.length) return 0; let n = 0; for (const k of px) if (isHair(k)) n++; return n / px.length; };
  const lipHair = frac("upperLip"), jawHair = frac("jaw"), neckHair = frac("neck"), cheekHair = (frac("cheekL") + frac("cheekR")) / 2;
  const belowHair = frac("below"); // hair well below the chin → long (full) beard
  // the neck often sits in shadow under the jaw, so it only counts once the jaw itself is clearly hairy
  const coverage = 0.45 * jawHair + 0.35 * lipHair + 0.1 * (jawHair > 0.4 ? neckHair : 0) + 0.1 * cheekHair;
  // calibrated on test portraits: clean-shaven ≈ 0.18, short boxed beard ≈ 0.66, long full beard ≈ 0.7 + hair below chin
  const beardClass = coverage < 0.25 ? 0 : coverage < 0.45 ? 1 : belowHair > 0.45 && jawHair > 0.6 ? 3 : 2;
  const beard = clamp01(beardClass === 3 ? 0.85 + 0.15 * belowHair : (coverage - 0.1) / 0.7);

  // redness: cheeks + neck skin (non-hair) a* above the forehead reference
  const skinOf = (zs) => zs.flatMap((z) => zonePx[z]).filter((k) => !isHair(k) && Lm[k] > refL * 0.55);
  const cheekSkin = skinOf(["cheekL", "cheekR"]);
  const da = quant(cheekSkin.map((k) => A[k] - refA), 0.75);
  const redness = gray ? 0 : clamp01((da - 1.5) / 9);
  // shine: specular (very bright, low-saturation) share on forehead + nose
  const tz = zonePx.forehead.concat(zonePx.nose);
  const specThr = Math.min(242, Math.max(refL * 1.22, quant(tz.map((k) => Lm[k]), 0.9)));
  const isSpec = (k) => Lm[k] >= specThr && Lm[k] > refL * 1.15 && S[k] < 55;
  const shine = gray ? 0 : clamp01((tz.filter(isSpec).length / Math.max(1, tz.length)) * 9);
  // texture: fine-edge energy on cheek skin relative to forehead
  const tex = median(cheekSkin.map((k) => G[k]));
  const texture = beardClass >= 2 ? 0 : clamp01((tex / Math.max(1, refG) - 1.1) / 1.6);

  // natural hair colour from the brows (darkest 40 %) – used as the default shade in the beard try-on
  const browPx = zonePx.browL.concat(zonePx.browR);
  const brow = browPx.slice().sort((a, b) => Lm[a] - Lm[b]).slice(0, Math.max(1, Math.floor(browPx.length * 0.4)));
  const avg = (c) => Math.round(brow.reduce((s, k) => s + d[k * 4 + c], 0) / Math.max(1, brow.length));
  const hairColor = brow.length > 20 && !gray ? "#" + [avg(0), avg(1), avg(2)].map((v) => Math.round(v * 0.85).toString(16).padStart(2, "0")).join("") : null;

  // per-pixel layers (RGBA canvases at analysis size)
  const layer = (fn) => {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); const im = g.createImageData(W, H);
    fn(im.data); g.putImageData(im, 0, 0); return c;
  };
  const paint = (o, rgb, a) => { o[0] = rgb[0]; o[1] = rgb[1]; o[2] = rgb[2]; o[3] = a; };
  const layers = {
    beard: layer((o) => { for (const z of [...beardZones, ...(jawHair > 0.4 ? ["neck"] : []), "cheekL", "cheekR"]) for (const k of zonePx[z]) if (isHair(k)) paint(o.subarray(k * 4, k * 4 + 4), [0, 174, 239], 190); }),
    redness: gray ? null : layer((o) => { for (const k of skinOf(["cheekL", "cheekR", "neck", "jaw", "upperLip"])) { const v = A[k] - refA - 2; if (v > 0) paint(o.subarray(k * 4, k * 4 + 4), [235, 40, 40], Math.min(220, v * 26)); } }),
    shine: gray ? null : layer((o) => { for (const z of ["forehead", "nose", "cheekL", "cheekR"]) for (const k of zonePx[z]) if (isSpec(k)) paint(o.subarray(k * 4, k * 4 + 4), [255, 214, 64], 230); }),
    texture: beardClass >= 2 ? null : layer((o) => { for (const k of cheekSkin) { const v = G[k] - refG * 1.6; if (v > 0) paint(o.subarray(k * 4, k * 4 + 4), [170, 120, 255], Math.min(220, v * 22)); } }),
  };
  const zones = ["forehead", "nose", "cheekL", "cheekR", "upperLip", "jaw", "neck"].map((z) => ({ key: z, label: ZONE_LABELS[z], poly: polys[z].map(([x, y]) => [x / W, y / H]) }));

  const findings = [];
  const slots = {};
  const cls = BEARD_CLASSES[beardClass];
  findings.push({ key: "beard", label: "Facial hair", value: beard, text: beardClass === 0 ? "Looks clean-shaven." : `Looks like ${cls}.` });
  if (!gray) findings.push({ key: "redness", label: "Redness", value: redness, text: redness > 0.55 ? "Visible redness on cheeks/jaw – typical after-shave irritation." : redness > 0.3 ? "Slight redness on the cheeks." : "Even tone, little redness." });
  if (!gray) findings.push({ key: "shine", label: "Shine (T-zone)", value: shine, text: shine > 0.5 ? "Shiny T-zone – skin tends to be oily." : shine > 0.25 ? "Some shine on forehead/nose." : "Matte T-zone." });
  if (beardClass < 2) findings.push({ key: "texture", label: "Skin texture", value: texture, text: texture > 0.6 ? "Uneven texture – could be bumps or ingrown hairs." : "Smooth texture." });

  slots.area = beardClass >= 2 ? "beard" : "face";
  slots.style = ["clean", "stubble", "short", "full"][beardClass];
  const concerns = [];
  if (redness > 0.3) concerns.push("redness");
  if (shine > 0.5) concerns.push("oily skin");
  if (texture > 0.6) concerns.push("ingrown hairs");
  if (redness > 0.3 || texture > 0.6) slots.skin = "sensitive";
  if (concerns.length) slots.concerns = concerns;
  const quality = refL < 70 ? "dark" : refL > 225 ? "bright" : "ok";

  return {
    gray, debug: { lipHair, jawHair, neckHair, belowHair, cheekHair, coverage, refL, refG, refGn, cheekL, da, tex }, landmarks: pts, width: W, height: H,
    beard, beardClass, beardLabel: cls, redness, shine, texture, quality, findings, slots, hairColor, zones, layers, canvas: cv,
  };
}

/** Face-centred crop (normalised) for showing a photo zoomed in on the face. */
export function faceView(a, aspect = 4 / 3) {
  if (!a.landmarks) return { x: 0, y: 0, w: 1, h: 1 };
  const xs = a.landmarks.map((p) => p.x), ys = a.landmarks.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ar = a.width / a.height; // photo aspect
  let h = Math.min(1, (y1 - y0) * 1.75), w = (h * aspect) / ar;
  if (w > 1) { w = 1; h = Math.min(1, (w * ar) / aspect); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + (y1 - y0) * 0.12;
  return { x: Math.max(0, Math.min(1 - w, cx - w / 2)), y: Math.max(0, Math.min(1 - h, cy - h / 2)), w, h };
}

/**
 * Draw the analysis overlay onto a canvas that already holds the photo.
 * opts.layer: "beard" | "redness" | "shine" | "texture" | null; opts.highlight: finding key whose zones are emphasised.
 */
export function drawAnalysis(ctx, a, opts = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (!a.landmarks) return;
  // opts.view: visible part of the photo in normalised coordinates (the card zooms in on the face)
  const v = opts.view || { x: 0, y: 0, w: 1, h: 1 };
  const X = (x) => ((x - v.x) / v.w) * W, Y = (y) => ((y - v.y) / v.h) * H;
  const P = (i) => [X(a.landmarks[i].x), Y(a.landmarks[i].y)];
  const faceW = Math.hypot(P(454)[0] - P(234)[0], P(454)[1] - P(234)[1]);
  ctx.save();
  const layer = opts.layer && a.layers?.[opts.layer];
  if (layer) {
    // dim the photo slightly so the measured pixels stand out
    ctx.fillStyle = "rgba(8,12,40,.28)"; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(layer, v.x * layer.width, v.y * layer.height, v.w * layer.width, v.h * layer.height, 0, 0, W, H);
  }
  const hi = new Set(FINDING_ZONES[opts.highlight] || FINDING_ZONES[opts.layer] || []);
  const lw = Math.max(1.5, W / 360);
  for (const z of a.zones || []) {
    const on = hi.has(z.key);
    ctx.strokeStyle = on ? "#00AEEF" : "rgba(255,255,255,.7)";
    ctx.lineWidth = on ? lw * 1.8 : lw;
    ctx.setLineDash(on ? [] : [lw * 3, lw * 2.5]);
    ctx.beginPath();
    smoothPath(ctx, z.poly.map(([x, y]) => [X(x), Y(y)]));
    if (on && !layer) { ctx.fillStyle = "rgba(0,174,239,.18)"; ctx.fill(); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // labels: one per finding, pinned to its main zone
  const anchor = { beard: 152, redness: 50, shine: 151, texture: 280 };
  const off = { beard: [0, 0.06], redness: [-0.02, 0], shine: [0, -0.02], texture: [0.02, 0] };
  ctx.font = `600 ${Math.round(Math.max(11, faceW * 0.055))}px "Nunito Sans", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  for (const f of a.findings || []) {
    if (opts.layer && opts.layer !== f.key) continue;
    const [x0, y0] = P(anchor[f.key]);
    const x = x0 + off[f.key][0] * faceW * 3, y = y0 + off[f.key][1] * faceW * 3;
    const txt = `${f.label.replace(" (T-zone)", "")} · ${f.value < 0.3 ? "low" : f.value < 0.6 ? "medium" : "high"}`;
    const tw = ctx.measureText(txt).width, pad = faceW * 0.025, bh = faceW * 0.085;
    const bx = Math.min(W - tw - pad * 2 - 2, Math.max(2, x - tw / 2 - pad));
    ctx.fillStyle = "rgba(17,24,93,.88)"; ctx.fillRect(bx, y - bh / 2, tw + pad * 2, bh);
    ctx.fillStyle = "#fff"; ctx.fillText(txt, bx + pad, y);
  }
  ctx.restore();
}
