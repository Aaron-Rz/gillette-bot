// Beard-style try-on. Primary path: WebGL2 face-mesh renderer (ar-gl.js) – the beard is a hair texture mapped onto
// MediaPipe's 3D face mesh, lit by the camera image. Fallback without WebGL2: flat 2D drawing anchored to landmarks.
import { getLandmarker, switchToCPU } from "./vision.js";
import { FaceRenderer, OneEuro, SHADES as GL_SHADES } from "./ar-gl.js";

export const STYLES = [
  { id: "clean", name: "Clean shave", products: ["proglideRazor", "fusion5SensitiveGel", "skinAfterShaveBalm"], note: "Daily close shave, no lines to maintain." },
  { id: "stubble", name: "Stubble", products: ["kingCStyleMaster", "kingCMoisturiser"], note: "Trim to 1–3 mm every 2–3 days." },
  { id: "moustache", name: "Moustache", products: ["kingCStyleMaster", "fusion5Razor", "kingCShaveCream"], note: "Trim the top lip, shave the rest." },
  { id: "circle", name: "Circle beard", products: ["kingCStyleMaster", "kingCShaveCream", "kingCBeardOil"], note: "Edge the cheeks clean, keep a round frame." },
  { id: "short", name: "Short boxed", products: ["kingCBeardTrimmer", "kingCBeardFaceWash", "kingCBeardOil"], note: "Clean cheek line and neckline, 5–10 mm." },
  { id: "full", name: "Full beard", products: ["kingCBeardTrimmer", "kingCBeardOil", "kingCBeardSoftener"], note: "Let it grow, shape the neck, oil daily." },
];
export const SHADES = GL_SHADES;

// ---------- 2D fallback (no WebGL2) ----------
const LOWER_OVAL = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454];
const CHEEK_LINE = [352, 376, 411, 425, 327, 2, 98, 205, 187, 147, 123];
const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const UPPER_LIP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const CHIN = [176, 148, 152, 377, 400];
const pt = (lm, i, W, H) => [lm[i].x * W, lm[i].y * H];
function centroid(ps) { const n = ps.length; return [ps.reduce((s, p) => s + p[0], 0) / n, ps.reduce((s, p) => s + p[1], 0) / n]; }
function scaleAround(ps, c, sx, sy) { return ps.map(([x, y]) => [c[0] + (x - c[0]) * sx, c[1] + (y - c[1]) * sy]); }
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Polygons [{outer, holes}] for a style in image pixels (used by the 2D fallback). */
export function stylePolygons(id, lm, W, H) {
  const P = (i) => pt(lm, i, W, H);
  const oval = LOWER_OVAL.map(P), cheek = CHEEK_LINE.map(P), lips = LIPS.map(P);
  const mouthC = centroid(lips), faceC = centroid([P(234), P(454), P(152), P(10)]);
  const mouthHole = scaleAround(lips, mouthC, 1.04, 1.12);
  if (id === "clean") return [];
  if (id === "stubble" || id === "full") {
    let outer = oval.concat(cheek);
    if (id === "full") outer = outer.map((p, i) => (i < oval.length ? lerp(faceC, p, 1.1 + 0.06 * Math.sin((i / (oval.length - 1)) * Math.PI)) : p));
    return [{ outer, holes: [mouthHole] }];
  }
  if (id === "short") {
    const upper = cheek.map((p, i) => (i === 0 || i === cheek.length - 1 ? p : lerp(p, mouthC, i >= 3 && i <= 7 ? 0.05 : 0.25)));
    return [{ outer: oval.slice(1, -1).concat(upper.slice(1, -1)), holes: [mouthHole] }];
  }
  const nose = [P(98), P(2), P(327)];
  if (id === "moustache") {
    const lip = UPPER_LIP.map(P);
    const top = lip.map((p) => lerp(p, centroid(nose), 0.62)).reverse();
    return [{ outer: [...lip, ...top], holes: [] }];
  }
  if (id === "circle") {
    const ring = scaleAround(lips, mouthC, 1.55, 1.9).concat(CHIN.map(P).map((p) => lerp(mouthC, p, 0.98)));
    return [{ outer: hull(ring.concat(nose.map((p) => lerp(p, mouthC, 0.2)))), holes: [mouthHole] }];
  }
  return [];
}

/** 2D fallback: soft tinted shape with a light strand texture. */
export function drawStyle(ctx, id, lm, shade = "brown") {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const polys = stylePolygons(id, lm, W, H);
  if (!polys.length) return;
  const color = SHADES[shade] || shade;
  const faceW = Math.hypot((lm[454].x - lm[234].x) * W, (lm[454].y - lm[234].y) * H);
  const path = new Path2D();
  for (const { outer, holes } of polys) {
    path.moveTo(...outer[0]); outer.slice(1).forEach((p) => path.lineTo(...p)); path.closePath();
    for (const h of holes) { path.moveTo(...h[0]); h.slice(1).forEach((p) => path.lineTo(...p)); path.closePath(); }
  }
  ctx.save();
  ctx.filter = `blur(${Math.max(2, faceW / 70)}px)`;
  ctx.globalAlpha = id === "stubble" ? 0.25 : 0.6;
  ctx.fillStyle = color;
  ctx.fill(path, "evenodd");
  ctx.restore();
}
export function resetStrands() { /* kept for API compatibility */ }

class Canvas2DRenderer {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext("2d"); this.kind = "2d"; }
  render(src, lm, { style = "short", shade = "brown", mirror = false, width, height } = {}) {
    const c = this.canvas, W = width || src.videoWidth || src.naturalWidth || src.width, H = height || src.videoHeight || src.naturalHeight || src.height;
    if (!W || !H) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = this.ctx;
    ctx.save();
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, 0, 0, W, H);
    if (lm) drawStyle(ctx, style, lm, shade);
    ctx.restore();
  }
}

const renderers = new WeakMap();
/** One renderer per canvas (a canvas can only ever have one context type). */
export function rendererFor(canvas) {
  if (renderers.has(canvas)) return renderers.get(canvas);
  let r;
  try { r = new FaceRenderer(canvas); } catch (e) { console.warn("WebGL2 try-on unavailable, using 2D fallback", e); r = new Canvas2DRenderer(canvas); }
  renderers.set(canvas, r);
  canvas.dataset.renderer = r.kind;
  return r;
}

/**
 * Crop (in normalised photo coordinates) around the face with room for a full beard below the chin,
 * matching the stage's aspect ratio (width / height).
 */
export function faceCrop(landmarks, imgW, imgH, aspect = 3 / 4) {
  const xs = landmarks.map((p) => p.x * imgW), ys = landmarks.map((p) => p.y * imgH);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const fw = x1 - x0, fh = y1 - y0;
  const top = y0 - fh * 0.38, bottom = y1 + fh * 0.62;
  // stage-shaped box that holds the face plus room for a full beard; if the photo is too small in one direction,
  // keep the whole beard area (the stage then shows thin bars) instead of cutting the chin off
  let h = bottom - top, w = Math.max(fw * 1.9, h * aspect);
  h = Math.max(h, w / aspect);
  w = Math.min(imgW, w); h = Math.min(imgH, h);
  const cx = (x0 + x1) / 2, cy = (top + bottom) / 2 + (h - (bottom - top)) * 0.1;
  const x = Math.max(0, Math.min(imgW - w, cx - w / 2)), y = Math.max(0, Math.min(imgH - h, cy - h / 2));
  return { x, y, w, h };
}

/**
 * Render a still photo with a style, framed around the face (so the face is large even on a phone).
 * aspect: stage width/height; defaults to the canvas container's shape.
 */
export function renderPhoto(canvas, img, landmarks, style, shade, aspect) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const box = canvas.parentElement?.getBoundingClientRect?.();
  const ar = aspect || (box && box.width && box.height ? box.width / box.height : 3 / 4);
  const c = landmarks ? faceCrop(landmarks, iw, ih, ar) : { x: 0, y: 0, w: iw, h: ih };
  const s = Math.min(1, 1280 / Math.max(c.w, c.h));
  const W = Math.round(c.w * s), H = Math.round(c.h * s);
  const crop = document.createElement("canvas"); crop.width = W; crop.height = H;
  crop.getContext("2d").drawImage(img, c.x, c.y, c.w, c.h, 0, 0, W, H);
  const lm = landmarks && landmarks.map((p) => ({ x: (p.x * iw - c.x) / c.w, y: (p.y * ih - c.y) / c.h, z: (p.z * iw) / c.w }));
  rendererFor(canvas).render(crop, lm, { style, shade, width: W, height: H });
}

// ---------- live camera ----------
/**
 * Start the selfie camera with live try-on. getState() → { style, shade }.
 * onFace(landmarks, video) is called once for the first detected face (e.g. to estimate the natural hair colour).
 */
export async function startLive(video, canvas, getState, onFace) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  video.setAttribute("playsinline", ""); video.muted = true;
  await video.play();
  const renderer = rendererFor(canvas);
  let lm = null;
  try { lm = await getLandmarker("VIDEO"); } catch (e) { console.warn("face tracking unavailable", e); }
  canvas.dataset.tracking = lm ? "1" : "0";
  const filter = new OneEuro();
  const fullQuality = typeof location !== "undefined" && new URLSearchParams(location.search).has("arfull"); // testing: no adaptive shell count
  let running = true, last = -1, frames = 0, t0 = performance.now(), seen = false, lostFor = 0;
  function frame() {
    if (!running) return;
    if (video.videoWidth && video.currentTime !== last) {
      last = video.currentTime;
      const now = performance.now();
      let face = null;
      if (lm) {
        let res = null;
        try { res = lm.detectForVideo(video, now); }
        catch (e) {
          // GPU graph failed on a real frame (e.g. Firefox) → rebuild once on the CPU, keep showing the camera meanwhile
          const cur = lm; lm = null;
          if (switchToCPU()) getLandmarker("VIDEO").then((l) => { lm = l; }).catch((err) => console.warn("face tracking unavailable", err));
          else { lm = cur; console.warn("face tracking error", e); }
        }
        const raw = res?.faceLandmarks && res.faceLandmarks[0];
        if (raw) {
          const flat = new Float32Array(raw.length * 3);
          raw.forEach((p, i) => { flat[3 * i] = p.x; flat[3 * i + 1] = p.y; flat[3 * i + 2] = p.z; });
          const sm = filter.filter(flat, now);
          face = raw.map((_, i) => ({ x: sm[3 * i], y: sm[3 * i + 1], z: sm[3 * i + 2] }));
          lostFor = 0;
          if (!seen) { seen = true; onFace?.(raw, video); }
        } else if (++lostFor > 5) filter.reset();
      }
      const st = getState();
      renderer.render(video, face, { style: st.style, shade: st.shade, mirror: true, live: !fullQuality });
      if (renderer.shells !== undefined) canvas.dataset.shells = String(renderer.shells);
      canvas.dataset.face = face ? "1" : "0";
      frames++;
      if (now - t0 > 1000) { canvas.dataset.fps = String(Math.round((frames * 1000) / (now - t0))); frames = 0; t0 = now; }
    }
    raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);
  return () => { running = false; cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}
