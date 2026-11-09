// Beard-style try-on: draws beard shapes anchored to MediaPipe face landmarks (photo or live camera).
import { getLandmarker } from "./vision.js";

const LOWER_OVAL = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454];
const CHEEK_LINE = [352, 376, 411, 425, 327, 2, 98, 205, 187, 147, 123]; // right ear → under nose → left ear
const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const UPPER_LIP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const CHIN = [176, 148, 152, 377, 400];

export const STYLES = [
  { id: "clean", name: "Clean shave", products: ["proglideRazor", "fusion5SensitiveGel", "skinAfterShaveBalm"], note: "Daily close shave, no lines to maintain." },
  { id: "stubble", name: "Stubble", products: ["kingCStyleMaster", "kingCMoisturiser"], note: "Trim to 1–3 mm every 2–3 days." },
  { id: "moustache", name: "Moustache", products: ["kingCStyleMaster", "fusion5Razor", "kingCShaveCream"], note: "Trim the top lip, shave the rest." },
  { id: "circle", name: "Circle beard", products: ["kingCStyleMaster", "kingCShaveCream", "kingCBeardOil"], note: "Edge the cheeks clean, keep a round frame." },
  { id: "short", name: "Short boxed", products: ["kingCBeardTrimmer", "kingCBeardFaceWash", "kingCBeardOil"], note: "Clean cheek line and neckline, 5–10 mm." },
  { id: "full", name: "Full beard", products: ["kingCBeardTrimmer", "kingCBeardOil", "kingCBeardSoftener"], note: "Let it grow, shape the neck, oil daily." },
];

// ---------- geometry ----------
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

/** Polygons [outer, holes[]] for a style. */
export function stylePolygons(id, lm, W, H) {
  const P = (i) => pt(lm, i, W, H);
  const oval = LOWER_OVAL.map(P);
  const cheek = CHEEK_LINE.map(P);
  const lips = LIPS.map(P);
  const mouthC = centroid(lips);
  const faceC = centroid([P(234), P(454), P(152), P(10)]);
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
  const moustache = (() => {
    const lip = UPPER_LIP.map(P);
    const top = lip.map((p) => lerp(p, centroid(nose), 0.62)).reverse();
    const ext = [lerp(P(61), P(61).map((v, k) => v + (P(61)[k] - mouthC[k]) * 0.25), 1), lerp(P(291), P(291).map((v, k) => v + (P(291)[k] - mouthC[k]) * 0.25), 1)];
    return { outer: [ext[0], ...lip.slice(1, -1), ext[1], ...top.slice(1, -1)], holes: [] };
  })();
  if (id === "moustache") return [moustache];
  if (id === "circle") {
    const ring = scaleAround(lips, mouthC, 1.55, 1.9).concat(CHIN.map(P).map((p) => lerp(mouthC, p, 0.98)));
    return [{ outer: hull(ring.concat(nose.map((p) => lerp(p, mouthC, 0.2)))), holes: [mouthHole] }];
  }
  return [];
}

// ---------- hair rendering ----------
export const SHADES = { black: "#1b1410", brown: "#4a3020", blond: "#9a7a4e", grey: "#8a8580" };
// [strands per face-width², strand length (face-width/1000), base alpha, base blur]
const CFG = { stubble: [4200, 8, 0.16, 3], short: [11000, 18, 0.42, 4], full: [14000, 30, 0.42, 7], circle: [9000, 20, 0.55, 4], moustache: [9000, 22, 0.55, 3] };
const strandCache = new Map();

function frameOf(lm, W, H) {
  const a = pt(lm, 234, W, H), b = pt(lm, 454, W, H);
  const s = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ex = [(b[0] - a[0]) / s, (b[1] - a[1]) / s];
  const ey = [-ex[1], ex[0]];
  const o = pt(lm, 1, W, H); // nose tip
  return { o, ex, ey, s };
}
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shadeVar(hex, f) { const [r, g, b] = rgb(hex); const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${c(r)},${c(g)},${c(b)})`; }

function buildPath(polys) {
  const path = new Path2D();
  for (const { outer, holes } of polys) {
    path.moveTo(...outer[0]); outer.slice(1).forEach((p) => path.lineTo(...p)); path.closePath();
    for (const h of holes) { path.moveTo(...h[0]); h.slice(1).forEach((p) => path.lineTo(...p)); path.closePath(); }
  }
  return path;
}

function strandsFor(id, ctx, path, polys, F) {
  if (strandCache.has(id)) return strandCache.get(id);
  const pts = polys.flatMap((p) => p.outer);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const area = ((x1 - x0) * (y1 - y0)) / (F.s * F.s);
  const n = Math.min(6000, Math.round(CFG[id][0] * area));
  const out = [];
  let tries = 0;
  while (out.length < n && tries < n * 6) {
    tries++;
    const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
    if (!ctx.isPointInPath(path, x, y, "evenodd")) continue;
    const dx = x - F.o[0], dy = y - F.o[1];
    const u = (dx * F.ex[0] + dy * F.ex[1]) / F.s, v = (dx * F.ey[0] + dy * F.ey[1]) / F.s;
    const dir = Math.atan2(1, u * (id === "moustache" ? 2.2 : 0.9)) + (Math.random() - 0.5) * 0.7; // down and outward
    out.push({ u, v, dir, len: 0.5 + Math.random(), tone: 0.75 + Math.random() * 0.6, bucket: Math.floor(Math.random() * 3) });
  }
  strandCache.set(id, out);
  return out;
}

/** Draw a style over whatever is already on ctx (photo/video frame). */
export function drawStyle(ctx, id, lm, shade = "brown") {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const polys = stylePolygons(id, lm, W, H);
  if (!polys.length) return;
  const color = SHADES[shade] || shade;
  const [, len, alpha, blur] = CFG[id];
  const F = frameOf(lm, W, H);
  const path = buildPath(polys);
  ctx.save();
  // soft base tone, feathered
  ctx.filter = `blur(${Math.max(2, (blur * F.s) / 300)}px)`;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill(path, "evenodd");
  ctx.filter = "none";
  ctx.clip(path, "evenodd");
  const strands = strandsFor(id, ctx, path, polys, F);
  const L = (len * F.s) / 1000;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(0.7, F.s / 420);
  for (let b = 0; b < 3; b++) {
    ctx.globalAlpha = [0.55, 0.75, 0.95][b] * (id === "stubble" ? 0.6 : 1);
    ctx.strokeStyle = shadeVar(color, [0.7, 1, 1.35][b]);
    ctx.beginPath();
    for (const st of strands) {
      if (st.bucket !== b) continue;
      const x = F.o[0] + (st.u * F.ex[0] + st.v * F.ey[0]) * F.s;
      const y = F.o[1] + (st.u * F.ex[1] + st.v * F.ey[1]) * F.s;
      const dx = Math.cos(st.dir), dy = Math.sin(st.dir); // in face frame (x along ex, y along ey)
      const px = (dx * F.ex[0] + dy * F.ey[0]) * L * st.len, py = (dx * F.ex[1] + dy * F.ey[1]) * L * st.len;
      ctx.moveTo(x, y); ctx.lineTo(x + px, y + py);
    }
    ctx.stroke();
  }
  ctx.restore();
}
export function resetStrands() { strandCache.clear(); }

// ---------- live camera ----------
export async function startLive(video, canvas, getState) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  await video.play();
  const lm = await getLandmarker("VIDEO");
  const ctx = canvas.getContext("2d");
  let running = true, last = -1;
  function frame() {
    if (!running) return;
    if (video.videoWidth && canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    if (video.currentTime !== last && video.videoWidth) {
      last = video.currentTime;
      const res = lm.detectForVideo(video, performance.now());
      ctx.save();
      ctx.translate(canvas.width, 0); ctx.scale(-1, 1); // mirror like a selfie
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const face = res.faceLandmarks && res.faceLandmarks[0];
      const st = getState();
      if (face) drawStyle(ctx, st.style, face, st.shade);
      ctx.restore();
      canvas.dataset.face = face ? "1" : "0";
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return () => { running = false; stream.getTracks().forEach((t) => t.stop()); };
}
