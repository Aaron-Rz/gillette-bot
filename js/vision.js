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
    outputFacialTransformationMatrixes: mode === "IMAGE", // head pose for the photo quality check
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

// ---------- colour & statistics helpers ----------
function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const LIN = Float32Array.from({ length: 256 }, (_, i) => srgbToLin(i));
const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
function lab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  return [116 * labF(Y) - 16, 500 * (labF(X) - labF(Y)), 200 * (labF(Y) - labF(Z))];
}
export const median = (a) => { if (!a.length) return 0; const s = Float32Array.from(a).sort(); return s[Math.floor(s.length / 2)]; };
export const quant = (a, q) => { if (!a.length) return 0; const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const clamp01 = (x) => clamp(x, 0, 1);
const lerp01 = (x, a, b) => clamp01((x - a) / (b - a));

// ---------- pure measurement helpers (exported for tests) ----------
/**
 * White balance from the person's own skin. Typical skin (any tone) keeps G/R ≈ 0.58–0.86 and B/R ≈ 0.42–0.82 in sRGB;
 * a colour cast (tungsten, teal grading, shade) pushes the skin outside that band. Returns per-channel gains that move the
 * median skin colour back to the nearest point inside the band – natural variation between skin tones is left alone.
 */
export function skinWhiteBalance([r, g, b]) {
  if (!(r > 0 && g > 0 && b > 0)) return [1, 1, 1];
  const gr = g / r, br = b / r;
  const tgr = clamp(gr, 0.58, 0.86), tbr = clamp(br, 0.42, Math.min(0.82, tgr * 1.02));
  return [1, tgr / gr, tbr / br];
}
/**
 * Head pose in degrees from face-mesh landmarks (normalised x/y, z in image-width units).
 * yaw: depth difference between the two face edges; pitch: forehead→chin depth difference (offset for the canonical face);
 * roll: eye-line angle. 0/0/0 = looking straight into the camera.
 */
export function headPose(pts, W = 1, H = 1, matrix = null) {
  const s = (i) => [pts[i].x * W, pts[i].y * H, (pts[i].z || 0) * W];
  const L = s(234), R = s(454), T = s(10), B = s(152), eL = s(33), eR = s(263), N = s(1);
  const deg = 180 / Math.PI;
  const yawZ = Math.atan2(L[2] - R[2], Math.hypot(R[0] - L[0], R[1] - L[1])) * deg;
  // 2-D cue as a cross-check: where the nose tip sits between the face edges (0.5 = frontal)
  const t = ((N[0] - L[0]) * (R[0] - L[0]) + (N[1] - L[1]) * (R[1] - L[1])) / Math.max(1e-6, (R[0] - L[0]) ** 2 + (R[1] - L[1]) ** 2);
  const yaw2d = Math.asin(clamp(2 * t - 1, -1, 1)) * deg;
  const pitch = Math.atan2(B[2] - T[2], Math.hypot(B[0] - T[0], B[1] - T[1])) * deg - PITCH0;
  const roll = Math.atan2(eR[1] - eL[1], eR[0] - eL[0]) * deg;
  if (matrix && matrix.length >= 16) {
    // MediaPipe's facial transformation matrix (column-major): third column = where the face points
    const fx = matrix[8], fy = matrix[9], fz = matrix[10];
    return { yaw: Math.atan2(fx, fz) * deg, pitch: Math.atan2(fy, Math.hypot(fx, fz)) * deg - PITCH0, roll, yawZ, yaw2d, src: "matrix" };
  }
  // fallback without the matrix: the 2-D nose position over-reads the angle by ~1.6× (the nose sticks out)
  return { yaw: Math.asin(clamp((2 * t - 1) / 1.6, -1, 1)) * deg, pitch, roll, yawZ, yaw2d, src: "landmarks" };
}
const PITCH0 = -5; // calibrated: median pitch of frontal portraits in the test set
/**
 * Contrast-independent sharpness from edge steepness: the steepest edges (98th percentile of the 1-px gradient) relative
 * to the contrast range in the same area (eyes, brows, mouth always have strong edges). A sharp edge spans ~1–2 px
 * (≈0.25–0.5), a blurred one many pixels (→ 0.1). JPEG noise hardly moves it, unlike a plain Laplacian variance.
 */
export function sharpness(L, W, idx) {
  const g = [], v = [];
  for (const k of idx) {
    const x = k % W;
    if (x === 0 || x === W - 1 || k < W || k >= L.length - W) continue;
    g.push(Math.hypot(L[k + 1] - L[k - 1], L[k + W] - L[k - W]) / 2);
    v.push(L[k]);
  }
  if (g.length < 50) return 0;
  const range = quant(v, 0.97) - quant(v, 0.03);
  return range > 8 ? quant(g, 0.98) / range : 0;
}
/** Pixel indices inside axis-aligned boxes around the given landmark groups (P maps a landmark to analysis pixels). */
function boxPixels(P, groups, W, H, padF = 0.15) {
  const out = [];
  for (const ids of groups) {
    const ps = ids.map(P), xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const px = (x1 - x0) * padF, py = Math.max((y1 - y0) * padF, (x1 - x0) * 0.2);
    x0 = Math.max(1, Math.floor(x0 - px)); x1 = Math.min(W - 2, Math.ceil(x1 + px)); y0 = Math.max(1, Math.floor(y0 - py)); y1 = Math.min(H - 2, Math.ceil(y1 + py));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * W + x);
  }
  return out;
}
/** Photo quality gate. m: { faceW (px in the original photo), sharp, skinL, faceP98, clipped, yaw, pitch }. */
export function assessQuality(m) {
  const issues = [];
  if (m.faceP98 < 70 || m.skinL < 28) issues.push(["dark", "The photo is too dark – face a window or a lamp.", true]);
  if (m.faceW < 80) issues.push(["far away", "Your face is too small in the photo – come closer so it fills most of the frame.", true]);
  else if (m.faceW < 140) issues.push(["far away", "Your face is quite small in the photo – a closer shot gives more precise results.", false]);
  if (Math.abs(m.yaw) > 25) issues.push(["side-on", "Your head is turned to the side – look straight into the camera.", true]);
  else if (Math.abs(m.pitch) > 25) issues.push(["tilted", "Your head is tilted up or down – hold the camera at eye level.", true]);
  if (m.sharp < QT.blurHard) issues.push(["blurry", "The photo is blurry – hold still and tap to focus on your face.", true]);
  else if (m.sharp < QT.blurSoft) issues.push(["blurry", "The photo is a little soft – a sharper shot gives more precise results.", false]);
  if (m.faceP98 >= 70 && m.skinL >= 28 && (m.faceP98 < 110 || m.skinL < 45)) issues.push(["dark", "The light is low – daylight gives more precise results.", false]);
  if (m.clipped > 0.25) issues.push(["bright", "Your face is over-exposed – avoid direct flash or harsh sun.", true]);
  const hard = issues.find((i) => i[2]), soft = issues.find((i) => !i[2]);
  const top = hard || soft;
  // 1 = ideal photo; each soft issue costs a bit of confidence
  const score = hard ? 0.3 : clamp01(1 - 0.18 * issues.length - (m.faceW < 200 ? 0.1 : 0));
  return { code: top ? top[0] : "ok", text: top ? top[1] : "", retake: !!hard, score, issues: issues.map((i) => i[0]) };
}
export const QT = { blurHard: 0.1, blurSoft: 0.16 }; // calibrated: real blur 0.07, synthetic blur ≤0.099, sharp photos 0.11–0.68

/**
 * Facial-hair class from zone features (0 clean, 1 stubble, 2 short beard, 3 full beard) plus a 0..1 confidence from
 * the distance to the nearest decision threshold. Features (all relative to the person's own skin):
 *  jawHair/lipHair/cheekHair/belowHair – share of hair pixels per zone; stip – fine dark stipple on chin+lip minus forehead/nose;
 *  chinDark – how much darker the chin/jaw is than the cheek skin on the same side (dense dark hair ≈ 0.45+).
 * Thresholds were set on the training half of the test set only (see BT).
 */
export function classifyBeard(f) {
  const cover = 0.5 * f.jawHair + 0.35 * f.lipHair + 0.15 * f.cheekHair;
  const stip = f.stip ?? 0, dark = f.chinDark ?? 0;
  const darkBeard = dark >= BT.darkOnly && f.jawHair >= BT.darkOnlyJaw; // dark hair on dark skin: little texture, but clearly darker
  const hairy = cover >= BT.hair || stip >= BT.stip || darkBeard;
  const m = (x, t, w) => Math.abs(x - t) / w; // normalised distance to a threshold
  if (!hairy) return { cls: 0, cover, conf: clamp01(0.4 + Math.min(m(cover, BT.hair, 0.25), m(stip, BT.stip, 0.12), m(dark, BT.darkOnly, 0.5) + 0.3)) };
  const long = cover >= BT.longCover && f.jawHair >= BT.longJaw && f.belowHair >= BT.longBelow;
  if (long) return { cls: 3, cover, conf: clamp01(0.4 + Math.min(m(f.belowHair, BT.longBelow, 0.3), m(f.jawHair, BT.longJaw, 0.3))) };
  const white = dark < 0.1 && cover >= BT.whiteCover; // grey/white hair is not darker than the skin – judge it by area
  const dense = (cover >= BT.denseCover && dark >= BT.dense) || darkBeard || white;
  if (dense) return { cls: 2, cover, conf: clamp01(0.35 + Math.min(darkBeard || white ? 0.3 : m(dark, BT.dense, 0.4), m(f.belowHair, BT.longBelow, 0.3))) };
  return { cls: 1, cover, conf: clamp01(0.35 + Math.min(m(dark, BT.dense, 0.4), m(Math.max(cover, stip), BT.hair, 0.3))) };
}
export const BT = { hair: 0.25, stip: 0.12, darkOnly: 0.55, darkOnlyJaw: 0.2, longCover: 0.6, longJaw: 0.65, longBelow: 0.65, whiteCover: 0.45, denseCover: 0.3, dense: 0.42 };
/** Level word used by card and overlay. */
export const level = (v) => (v < 0.3 ? "low" : v < 0.6 ? "medium" : "high");
const confWord = (c) => (c >= 0.7 ? "high" : c >= 0.45 ? "medium" : "low");

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
  // moustache area: between the nose base (v≈0.60) and the upper-lip line (v≈0.65) – not the lip itself
  upperLip: [[0.37, 0.665], [0.39, 0.625], [0.43, 0.607], [0.47, 0.613], [0.5, 0.614], [0.53, 0.613], [0.57, 0.607], [0.61, 0.625], [0.63, 0.665], [0.6, 0.67], [0.575, 0.652], [0.54, 0.643], [0.5, 0.641], [0.46, 0.643], [0.425, 0.652], [0.4, 0.67]],
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
function neckPolygon(P, from = 0, to = 0.33) {
  // strip below the jaw line, pushed down along the face's vertical axis (from/to in nose→chin lengths)
  const NECK_TOP = [58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288];
  const a = P(2), b = P(152), ax = [b[0] - a[0], b[1] - a[1]];
  const at = (f) => NECK_TOP.map(P).map(([x, y], i) => { const w = Math.sin((Math.PI * i) / (NECK_TOP.length - 1)) * 0.75 + 0.25; return [x + ax[0] * f * w, y + ax[1] * f * w]; });
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

// ---------- robust detection ----------
const dims = (s) => [s.naturalWidth || s.videoWidth || s.width, s.naturalHeight || s.videoHeight || s.height];
/** Draw (part of) the source onto a fresh RGB canvas – also turns 1-channel greyscale JPEGs into RGB for MediaPipe. */
function frame(source, sx, sy, sw, sh, W, H, pad = 0, fill = "#808080") {
  const c = document.createElement("canvas");
  c.width = Math.round(W + 2 * pad); c.height = Math.round(H + 2 * pad);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = "high";
  g.drawImage(source, sx, sy, sw, sh, pad, pad, W, H);
  return c;
}
/**
 * Find the face with retries: (1) the photo as RGB, (2) with a grey border (faces touching the edge),
 * (3) upscaled (small or far-away faces), (4) a centre crop upscaled. Landmarks come back normalised to the original photo.
 */
async function detectRobust(source) {
  const [iw, ih] = dims(source);
  const k = Math.min(1, 1280 / Math.max(iw, ih));
  const tries = [
    { sx: 0, sy: 0, sw: iw, sh: ih, s: k, pad: 0 },
    { sx: 0, sy: 0, sw: iw, sh: ih, s: k * 0.8, pad: Math.round(Math.max(iw, ih) * k * 0.15) },
    { sx: 0, sy: 0, sw: iw, sh: ih, s: Math.min(2, 1600 / Math.max(iw, ih)), pad: 0 },
    { sx: iw * 0.2, sy: ih * 0.1, sw: iw * 0.6, sh: ih * 0.6, s: Math.min(2.5, 1280 / (Math.max(iw, ih) * 0.6)), pad: 0 },
  ];
  let attempt = 0;
  for (const t of tries) {
    attempt++;
    if (attempt === 3 && t.s <= k * 1.05) continue; // nothing to gain from "upscaling" a large photo
    const c = frame(source, t.sx, t.sy, t.sw, t.sh, t.sw * t.s, t.sh * t.s, t.pad);
    const res = await detectFace(c, "IMAGE");
    const pts = res.faceLandmarks && res.faceLandmarks[0];
    if (!pts) continue;
    const cw = c.width, ch = c.height;
    const m = res.facialTransformationMatrixes?.[0]?.data;
    return {
      attempt, matrix: m ? Array.from(m) : null,
      landmarks: pts.map((p) => ({ x: (p.x * cw - t.pad) / t.s / iw + t.sx / iw, y: (p.y * ch - t.pad) / t.s / ih + t.sy / ih, z: (p.z * cw) / t.s / iw })),
    };
  }
  return null;
}

/** Analyse an image/canvas. Returns null when no face is found. */
export async function analyze(source) {
  const det = await detectRobust(source);
  if (!det) return null;
  const pts = det.landmarks;
  const [iw, ih] = dims(source);
  const O = (i) => [pts[i].x * iw, pts[i].y * ih];
  const faceW0 = Math.hypot(O(454)[0] - O(234)[0], O(454)[1] - O(234)[1]); // face width in photo pixels

  // analysis crop around the face, resampled so the face is ~300 px wide (small faces upscaled, huge ones downscaled)
  const xs = pts.map((p) => p.x * iw), ys = pts.map((p) => p.y * ih);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys), bw = bx1 - bx0, bh = by1 - by0;
  const cx0 = Math.max(0, Math.floor(bx0 - 0.3 * bw)), cx1 = Math.min(iw, Math.ceil(bx1 + 0.3 * bw));
  const cy0 = Math.max(0, Math.floor(by0 - 0.15 * bh)), cy1 = Math.min(ih, Math.ceil(by1 + 0.75 * bh));
  const S = clamp(300 / Math.max(1, faceW0), 0.1, 4);
  const W = Math.max(8, Math.round((cx1 - cx0) * S)), H = Math.max(8, Math.round((cy1 - cy0) * S));
  const cv = frame(source, cx0, cy0, cx1 - cx0, cy1 - cy0, W, H);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, W, H).data;
  const P = (i) => [(pts[i].x * iw - cx0) * S, (pts[i].y * ih - cy0) * S];
  const faceW = Math.hypot(P(454)[0] - P(234)[0], P(454)[1] - P(234)[1]);
  const midX = P(168)[0];

  // rasterise zone masks (zone id per pixel; 0 = none)
  const ZONES = ["forehead", "nose", "cheekL", "cheekR", "upperLip", "jaw", "browL", "browR", "neck", "below"];
  const polys = Object.fromEntries(ZONES.map((z) => [z, z === "neck" ? neckPolygon(P) : z === "below" ? neckPolygon(P, 0.4, 0.8) : ZONE_UV[z].map(([u, v]) => uvToImage(u, v, P))]));
  const mc = document.createElement("canvas"); mc.width = W; mc.height = H;
  const mx = mc.getContext("2d", { willReadFrequently: true });
  ZONES.forEach((z, zi) => { mx.fillStyle = `rgb(${zi + 1},0,0)`; mx.beginPath(); smoothPath(mx, polys[z]); mx.fill(); });
  const zd = mx.getImageData(0, 0, W, H).data;
  const N = W * H;
  const zonePx = Object.fromEntries(ZONES.map((z) => [z, []]));
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x, v = zd[k * 4];
    if (v && zd[k * 4 + 3] > 250) zonePx[ZONES[v - 1]].push(k);
  }
  const skinZones = ["forehead", "nose", "cheekL", "cheekR"];
  const refIdx = skinZones.flatMap((z) => zonePx[z]);

  // raw luma + saturation → greyscale check, white balance from the person's own skin
  const raw = (k) => 0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2];
  const sat0 = median(refIdx.map((k) => Math.max(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]) - Math.min(d[k * 4], d[k * 4 + 1], d[k * 4 + 2])));
  const gray = sat0 < 6;
  const rawL = refIdx.map(raw), lo = quant(rawL, 0.2), hi = quant(rawL, 0.9);
  const wbPx = refIdx.filter((k) => { const l = raw(k); return l >= lo && l <= hi; });
  const gains = gray ? [1, 1, 1] : skinWhiteBalance([0, 1, 2].map((c) => median(wbPx.map((k) => d[k * 4 + c]))));
  const px = new Uint8ClampedArray(N * 3);
  for (let k = 0; k < N; k++) { px[k * 3] = d[k * 4]; px[k * 3 + 1] = d[k * 4 + 1] * gains[1]; px[k * 3 + 2] = d[k * 4 + 2] * gains[2]; }

  // per-pixel features
  const Lm = new Float32Array(N), Cs = new Float32Array(N), G = new Float32Array(N), A = new Float32Array(N), Bv = new Float32Array(N), EI = new Float32Array(N);
  for (let k = 0; k < N; k++) { const r = px[k * 3], g = px[k * 3 + 1], b = px[k * 3 + 2]; Lm[k] = 0.299 * r + 0.587 * g + 0.114 * b; Cs[k] = Math.max(r, g, b) - Math.min(r, g, b); }
  for (const z of ZONES) for (const k of zonePx[z]) {
    G[k] = (Math.abs(Lm[k] - Lm[k + 1]) + Math.abs(Lm[k] - Lm[k - 1]) + Math.abs(Lm[k] - Lm[k + W]) + Math.abs(Lm[k] - Lm[k - W])) / 2;
    const r = px[k * 3], g = px[k * 3 + 1], b = px[k * 3 + 2];
    const l = lab(r, g, b); A[k] = l[1]; Bv[k] = l[2];
    EI[k] = Math.log(r + 4) - Math.log(g + 4); // erythema-style index: brightness-independent redness
  }

  // quality measurements
  const faceIdx = ["forehead", "nose", "cheekL", "cheekR", "upperLip", "jaw", "browL", "browR"].flatMap((z) => zonePx[z]);
  // edge sharpness at the photo's own resolution (an upscaled small face is judged by "far away", not as blur)
  const sharp = sharpness(Lm, W, boxPixels(P, [[33, 133, 70, 107, 159, 145], [263, 362, 300, 336, 386, 374], [61, 291, 0, 17]], W, H)) * Math.max(1, S);
  const pose = headPose(pts, iw, ih, det.matrix);
  const skinL = median(refIdx.map((k) => Lm[k]));
  const faceP98 = quant(faceIdx.map((k) => Lm[k]), 0.98);
  const clipped = refIdx.filter((k) => Math.min(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]) >= 248).length / Math.max(1, refIdx.length); // burnt-out white
  const q = assessQuality({ faceW: faceW0, sharp, skinL, faceP98, clipped, yaw: pose.yaw, pitch: pose.pitch });

  // box means of luma (and luma²) via integral images: local contrast for stubble, local background for shine spots
  const II = new Float64Array((W + 1) * (H + 1)), II2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0, row2 = 0;
    for (let x = 0; x < W; x++) { const l = Lm[y * W + x]; row += l; row2 += l * l; const o = (y + 1) * (W + 1) + x + 1; II[o] = II[o - W - 1] + row; II2[o] = II2[o - W - 1] + row2; }
  }
  const boxMean = (T, k, r) => { const x = k % W, y = (k / W) | 0, x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1); return (T[y1 * (W + 1) + x1] - T[y0 * (W + 1) + x1] - T[y1 * (W + 1) + x0] + T[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0)); };
  // stubble shows up as fine dark stipple: share of pixels clearly darker than their small neighbourhood, and local contrast
  const rs = Math.max(1, Math.round(faceW * 0.01));
  const dotOf = (zs) => { let n = 0, m = 0; const cv = []; for (const z of zs) for (const k of zonePx[z]) { const mu = boxMean(II, k, rs); if (Lm[k] < mu * 0.95 - 1) n++; m++; cv.push(Math.sqrt(Math.max(0, boxMean(II2, k, rs) - mu * mu)) / (mu + 10)); } return [m ? n / m : 0, median(cv)]; };
  const [dotRef, cvRef] = dotOf(["forehead", "nose"]), [dotJaw, cvJaw] = dotOf(["jaw"]), [dotLip, cvLip] = dotOf(["upperLip"]), [dotCheek, cvCheek] = dotOf(["cheekL", "cheekR"]);

  // ----- facial hair, measured against the person's own cheek skin (per side, so side light does not read as beard) -----
  const side = (k) => ((k % W) < midX ? 0 : 1);
  const tn = (k) => G[k] / (Lm[k] + 15);
  const cr = (k) => Cs[k] / (Lm[k] + 15);
  const refBy = (fn) => [0, 1].map((s) => median(refIdx.filter((k) => side(k) === s).map(fn)) || median(refIdx.map(fn)));
  const refLs = refBy((k) => Lm[k]);
  const refL = skinL;
  const refGn = median(refIdx.map(tn)), refCr = median(refIdx.map(cr)), refG = median(refIdx.map((k) => G[k]));
  const rawHair = (k) => {
    const L = Lm[k], ref = refLs[side(k)], t = tn(k), c = cr(k);
    if (t > Math.max(refGn * 3, 0.06) && G[k] > 4) return true; // textured (hair strands, stubble dots)
    const dull = gray ? t > refGn * 1.5 : c < refCr * 0.66; // without colour, a shadow is only hair when it is textured
    if (L < ref * 0.5 && dull) return true; // clearly darker and colourless → dark hair
    return !gray && L > ref * 1.05 && c < refCr * 0.45 && t > refGn * 2; // grey/white hair: bright, colourless, textured
  };
  // keep only hair that forms an area (beard/stubble), not thin lines like the jaw edge or lip contour
  const rawM = new Uint8Array(N);
  for (const z of ZONES) for (const k of zonePx[z]) rawM[k] = rawHair(k) ? 1 : 0;
  const I = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += rawM[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  const R = Math.max(2, Math.round(faceW * 0.014));
  const hairMap = new Uint8Array(N);
  for (const z of ZONES) for (const k of zonePx[z]) {
    if (!rawM[k]) continue;
    const x = k % W, y = (k / W) | 0, x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
    const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    if (sum / ((x1 - x0) * (y1 - y0)) > 0.38) hairMap[k] = 1;
  }
  const isHair = (k) => hairMap[k] === 1;
  const frac = (z) => { const p = zonePx[z]; if (!p.length) return 0; let n = 0; for (const k of p) if (isHair(k)) n++; return n / p.length; };
  const lipHair = frac("upperLip"), jawHair = frac("jaw"), neckHair = frac("neck"), belowHair = frac("below");
  const cheekHair = (frac("cheekL") + frac("cheekR")) / 2;
  // stubble shadow: the shaved area looks darker, greyer and finer-textured than the cheek skin above it
  const shadowOf = (z) => {
    const p = zonePx[z]; if (p.length < 20) return 0;
    const dark = 1 - median(p.map((k) => Lm[k] / refLs[side(k)]));
    const dull = gray ? 0 : 1 - median(p.map(cr)) / Math.max(1e-3, refCr);
    const tex = median(p.map(tn)) / Math.max(1e-3, refGn);
    return { dark, dull, tex, v: 1.6 * Math.max(0, dark) + 1.2 * Math.max(0, dull) + 0.25 * Math.max(0, tex - 1) };
  };
  const chinS = shadowOf("jaw"), lipS = shadowOf("upperLip");
  const stip = (dotJaw + dotLip) / 2 - dotRef;
  const bf = { lipHair, jawHair, cheekHair, neckHair, belowHair, stip, chinDark: Math.max(chinS.dark || 0, 0) };
  const bc = classifyBeard(bf);
  const beardClass = bc.cls;
  // gauge value: the class sets the band (clean <0.3, stubble/short 0.3–0.6/0.6–0.85, full 0.85+), coverage moves within it
  const beard = [0.05 + 0.2 * clamp01(bc.cover / BT.hair), 0.3 + 0.25 * clamp01(bc.cover), 0.6 + 0.25 * clamp01(bc.cover), 0.85 + 0.15 * clamp01(belowHair)][beardClass];

  // ----- redness: cheek skin vs the person's own forehead, brightness-independent -----
  const skinOf = (zs) => zs.flatMap((z) => zonePx[z]).filter((k) => !isHair(k) && Lm[k] > refL * 0.55 && Lm[k] < refL * 1.25);
  const cheekSkin = skinOf(["cheekL", "cheekR"]), foreSkin = skinOf(["forehead"]);
  const eiRef = median(foreSkin.map((k) => EI[k]));
  const redRel = quant(cheekSkin.map((k) => EI[k]), 0.75) - eiRef;
  const aRel = quant(cheekSkin.map((k) => A[k]), 0.75) - median(foreSkin.map((k) => A[k]));

  const hue = Math.atan2(median(cheekSkin.map((k) => Bv[k])), median(cheekSkin.map((k) => A[k]))) * 180 / Math.PI;
  const cheekEI = cheekSkin.map((k) => EI[k]), foreEI = foreSkin.map((k) => EI[k]);
  // patchiness: how much more the redness varies on the cheeks than on the forehead (irritation comes in blotches)
  const spreadC = quant(cheekEI, 0.9) - quant(cheekEI, 0.5), spreadF = quant(foreEI, 0.9) - quant(foreEI, 0.5);
  // cheeks are naturally a little redder than the forehead (≈ +0.05…0.2 on every skin tone), so only clearly more counts
  const redness = gray || cheekSkin.length < 30 ? 0 : clamp01(RD.wRel * lerp01(redRel, RD.relLo, RD.relHi) + (1 - RD.wRel) * lerp01(spreadC - spreadF, RD.patchLo, RD.patchHi));

  // ----- shine: specular spots on the T-zone, relative to the person's own skin brightness -----
  const tz = zonePx.forehead.concat(zonePx.nose);
  const RB = Math.max(3, Math.round(faceW * 0.06));
  const localMean = (k) => boxMean(II, k, RB);
  const tzL = median(tz.map((k) => Lm[k]));
  const isSpec = (k) => { const L = Lm[k]; return L > tzL * SH.rel && L - localMean(k) > (255 - tzL) * SH.pop && cr(k) < refCr * SH.dull; };
  const specShare = tz.filter(isSpec).length / Math.max(1, tz.length);
  // whitish highlights: brighter than the person's own T-zone and less colourful than it (skin colour washed out by reflection)
  const crTz = median(tz.map(cr));
  const isGloss = (k) => Lm[k] > tzL * 1.1 && cr(k) < crTz * 0.7;
  const specW = tz.filter(isGloss).length / Math.max(1, tz.length);
  const shine = gray ? 0 : lerp01(specW, SH.lo, SH.hi);

  // ----- texture: fine-edge energy on cheek skin relative to forehead -----
  const tex = median(cheekSkin.map((k) => G[k]));
  const texture = beardClass >= 2 ? 0 : clamp01((tex / Math.max(1, refG) - 1.1) / 1.6);

  // natural hair colour from the brows (darkest 40 %) – used as the default shade in the beard try-on
  const browPx = zonePx.browL.concat(zonePx.browR);
  const brow = browPx.slice().sort((a, b) => Lm[a] - Lm[b]).slice(0, Math.max(1, Math.floor(browPx.length * 0.4)));
  const avg = (c) => Math.round(brow.reduce((s, k) => s + d[k * 4 + c], 0) / Math.max(1, brow.length));
  const hairColor = brow.length > 20 && !gray ? "#" + [avg(0), avg(1), avg(2)].map((v) => Math.round(v * 0.85).toString(16).padStart(2, "0")).join("") : null;

  // per-pixel layers (RGBA canvases covering the analysis crop `crop`)
  const layer = (fn) => {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); const im = g.createImageData(W, H);
    fn(im.data); g.putImageData(im, 0, 0); return c;
  };
  const paint = (o, rgb, a) => { o[0] = rgb[0]; o[1] = rgb[1]; o[2] = rgb[2]; o[3] = a; };
  const beardZones = ["upperLip", "jaw"];
  const layers = {
    beard: layer((o) => { for (const z of [...beardZones, ...(jawHair > 0.4 ? ["neck"] : []), "cheekL", "cheekR"]) for (const k of zonePx[z]) if (isHair(k)) paint(o.subarray(k * 4, k * 4 + 4), [0, 174, 239], 190); }),
    redness: gray ? null : layer((o) => { for (const k of skinOf(["cheekL", "cheekR", "neck", "jaw", "upperLip"])) { const v = EI[k] - eiRef - 0.02; if (v > 0) paint(o.subarray(k * 4, k * 4 + 4), [235, 40, 40], Math.min(220, v * 1400)); } }),
    shine: gray ? null : layer((o) => { for (const z of ["forehead", "nose", "cheekL", "cheekR"]) for (const k of zonePx[z]) if (isGloss(k) || isSpec(k)) paint(o.subarray(k * 4, k * 4 + 4), [255, 214, 64], 230); }),
    texture: beardClass >= 2 ? null : layer((o) => { for (const k of cheekSkin) { const v = G[k] - refG * 1.6; if (v > 0) paint(o.subarray(k * 4, k * 4 + 4), [170, 120, 255], Math.min(220, v * 22)); } }),
  };
  const toImg = ([x, y]) => [(x / S + cx0) / iw, (y / S + cy0) / ih];
  const zones = ["forehead", "nose", "cheekL", "cheekR", "upperLip", "jaw", "neck"].map((z) => ({ key: z, label: ZONE_LABELS[z], poly: polys[z].map(toImg) }));

  // ----- findings with a confidence that reflects photo quality and how clear-cut the measurement is -----
  const qc = q.score;
  const skinN = cheekSkin.length / Math.max(1, zonePx.cheekL.length + zonePx.cheekR.length); // share of cheek that is visible skin
  const conf = {
    beard: clamp01(bc.conf * (0.55 + 0.45 * qc) * (gray ? 0.9 : 1)),
    redness: clamp01((0.35 + 0.65 * qc) * (0.5 + 0.5 * Math.min(1, skinN * 1.6)) * (Math.abs(sat0) < 12 ? 0.7 : 1)),
    shine: clamp01((0.35 + 0.65 * qc) * (clipped > 0.08 ? 0.6 : 1)),
    texture: clamp01((0.3 + 0.7 * qc) * (sharp < QT.blurSoft + 0.05 ? 0.6 : 1)),
  };
  const findings = [];
  const slots = {};
  const cls = BEARD_CLASSES[beardClass];
  // any photo issue (small face, soft focus, low light) caps the confidence at "medium"
  if (q.issues.length) for (const k of Object.keys(conf)) conf[k] = Math.min(conf[k], 0.64);
  const C = (k) => ({ confidence: conf[k], confidenceLabel: confWord(conf[k]) });
  findings.push({ key: "beard", label: "Facial hair", value: beard, text: beardClass === 0 ? "Looks clean-shaven." : `Looks like ${cls}.`, ...C("beard") });
  if (!gray) findings.push({ key: "redness", label: "Redness", value: redness, text: redness >= 0.6 ? "Visible redness on the cheeks compared with your forehead – typical after-shave irritation." : redness >= 0.3 ? "Slight redness on the cheeks compared with your forehead." : "Even tone, little redness.", ...C("redness") });
  if (!gray) findings.push({ key: "shine", label: "Shine (T-zone)", value: shine, text: shine >= 0.6 ? "Shiny T-zone – skin tends to be oily." : shine >= 0.3 ? "Some shine on forehead/nose." : "Matte T-zone.", ...C("shine") });
  if (beardClass < 2) findings.push({ key: "texture", label: "Skin texture", value: texture, text: texture > 0.6 ? "Uneven texture – could be bumps or ingrown hairs." : "Smooth texture.", ...C("texture") });

  slots.area = beardClass >= 2 ? "beard" : "face";
  slots.style = ["clean", "stubble", "short", "full"][beardClass];
  // skin conclusions only from a usable photo with reasonable confidence
  if (!q.retake) {
    const concerns = [];
    if (redness >= 0.3 && conf.redness >= 0.45) concerns.push("redness");
    if (shine >= 0.6 && conf.shine >= 0.45) concerns.push("oily skin");
    if (texture > 0.6 && conf.texture >= 0.45) concerns.push("ingrown hairs");
    if (concerns.includes("redness") || concerns.includes("ingrown hairs")) slots.skin = "sensitive";
    if (concerns.length) slots.concerns = concerns;
  }

  return {
    gray, landmarks: pts, width: iw, height: ih, crop: { x: cx0 / iw, y: cy0 / ih, w: (cx1 - cx0) / iw, h: (cy1 - cy0) / ih },
    beard, beardClass, beardLabel: cls, redness, shine, texture,
    quality: q.code, qualityText: q.text, retake: q.retake, qualityInfo: q,
    findings, slots, hairColor, zones, layers, canvas: cv,
    debug: { attempt: det.attempt, mat: det.matrix && det.matrix.map((v) => +v.toFixed(3)), faceW0: Math.round(faceW0), S: +S.toFixed(2), sharp, skinL, faceP98, clipped, ...pose, gains, sat0,
      ...bf, cover: bc.cover, beardConf: bc.conf, chinDark: chinS.dark, chinDull: chinS.dull, chinTex: chinS.tex, lipDark: lipS.dark, lipDull: lipS.dull, lipTex: lipS.tex,
      specW, spreadC, spreadF, dotRef, cvRef, dotJaw, cvJaw, dotLip, cvLip, dotCheek, cvCheek, redRel, aRel, hue, specShare, tzL, refL, refGn, refCr },
  };
}
// calibrated on the training half of the test set (see report); redness is deliberately conservative
const RD = { wRel: 0.5, relLo: 0.12, relHi: 0.3, patchLo: 0.02, patchHi: 0.1 };
const SH = { rel: 1.12, pop: 0.18, dull: 0.8, lo: 0.06, hi: 0.32 };

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
    // dim the photo slightly so the measured pixels stand out; the layer covers the analysis crop
    ctx.fillStyle = "rgba(8,12,40,.28)"; ctx.fillRect(0, 0, W, H);
    const c = a.crop || { x: 0, y: 0, w: 1, h: 1 };
    ctx.drawImage(layer, X(c.x), Y(c.y), (c.w / v.w) * W, (c.h / v.h) * H);
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
  // labels: one per finding, pinned to its main zone (none when the photo needs a retake)
  const anchor = { beard: 152, redness: 50, shine: 151, texture: 280 };
  const off = { beard: [0, 0.06], redness: [-0.02, 0], shine: [0, -0.02], texture: [0.02, 0] };
  ctx.font = `600 ${Math.round(Math.max(11, faceW * 0.055))}px "Nunito Sans", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  for (const f of a.retake ? [] : a.findings || []) {
    if (opts.layer && opts.layer !== f.key) continue;
    const [x0, y0] = P(anchor[f.key]);
    const x = x0 + off[f.key][0] * faceW * 3, y = y0 + off[f.key][1] * faceW * 3;
    const txt = `${f.label.replace(" (T-zone)", "")} · ${level(f.value)}`;
    const tw = ctx.measureText(txt).width, pad = faceW * 0.025, bh = faceW * 0.085;
    const bx = Math.min(W - tw - pad * 2 - 2, Math.max(2, x - tw / 2 - pad));
    ctx.fillStyle = "rgba(17,24,93,.88)"; ctx.fillRect(bx, y - bh / 2, tw + pad * 2, bh);
    ctx.fillStyle = "#fff"; ctx.fillText(txt, bx + pad, y);
  }
  ctx.restore();
}
