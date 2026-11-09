// In-browser face analysis with MediaPipe Face Landmarker. The photo never leaves the device.
const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let lib = null;
const landmarkers = {};
export async function getLandmarker(mode = "IMAGE") {
  if (landmarkers[mode]) return landmarkers[mode];
  lib = lib || (await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`));
  const fileset = await lib.FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const make = (delegate) => lib.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: mode,
    numFaces: 1,
  });
  try { landmarkers[mode] = await make("GPU"); } catch { landmarkers[mode] = await make("CPU"); }
  return landmarkers[mode];
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
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Landmark groups (MediaPipe face mesh indices)
const REG = {
  forehead: [151, 9, 108, 337],
  cheekRef: [50, 280, 117, 346],
  nose: [4, 5],
  beard: [207, 427, 212, 432, 214, 434, 210, 430, 204, 424, 202, 422, 200, 199, 201, 421, 208, 428],
  moustache: [164, 167, 393, 165, 391],
  neck: [152],
};

export const BEARD_CLASSES = ["clean-shaven", "stubble", "short beard", "full beard"];

/** Analyse an image/canvas. Returns null when no face is found. */
export async function analyze(source) {
  const lm = await getLandmarker("IMAGE");
  const res = lm.detect(source);
  const pts = res.faceLandmarks && res.faceLandmarks[0];
  if (!pts) return null;
  const w = source.naturalWidth || source.videoWidth || source.width;
  const h = source.naturalHeight || source.videoHeight || source.height;
  const cv = document.createElement("canvas");
  const scale = Math.min(1, 900 / Math.max(w, h));
  cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, cv.width, cv.height);
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const P = (i) => ({ x: pts[i].x * cv.width, y: pts[i].y * cv.height });
  const faceW = Math.hypot(P(234).x - P(454).x, P(234).y - P(454).y);

  function sample(ids, rFactor, offsetY = 0) {
    const out = [];
    const r = Math.max(3, faceW * rFactor);
    for (const id of ids) {
      const c = P(id);
      const cy = c.y + offsetY * faceW;
      for (let y = Math.round(cy - r); y <= cy + r; y += 1) {
        for (let x = Math.round(c.x - r); x <= c.x + r; x += 1) {
          if (x < 1 || y < 1 || x >= cv.width - 1 || y >= cv.height - 1) continue;
          if ((x - c.x) ** 2 + (y - cy) ** 2 > r * r) continue;
          const k = (y * cv.width + x) * 4;
          const d = img.data;
          const L = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
          // gradient magnitude (hair = many fine edges)
          const kr = k + 4, kd = k + cv.width * 4;
          const Lr = 0.299 * d[kr] + 0.587 * d[kr + 1] + 0.114 * d[kr + 2];
          const Ld = 0.299 * d[kd] + 0.587 * d[kd + 1] + 0.114 * d[kd + 2];
          out.push({ r: d[k], g: d[k + 1], b: d[k + 2], L, grad: Math.abs(L - Lr) + Math.abs(L - Ld) });
        }
      }
    }
    return out;
  }

  const ref = [...sample(REG.cheekRef, 0.045), ...sample(REG.forehead, 0.05)];
  const refL = median(ref.map((p) => p.L));
  const refA = median(ref.map((p) => lab(p.r, p.g, p.b)[1]));
  const refGrad = median(ref.map((p) => p.grad));
  const beardPx = [...sample(REG.beard, 0.028), ...sample(REG.moustache, 0.02)];
  const darkFrac = mean(beardPx.map((p) => (p.L < refL * 0.72 ? 1 : 0)));
  const edgeFrac = mean(beardPx.map((p) => (p.grad > Math.max(14, refGrad * 2.2) ? 1 : 0)));
  const beard = clamp01(edgeFrac * 1.3 - 0.12 + darkFrac * 0.05);
  const beardClass = beard < 0.15 ? 0 : beard < 0.38 ? 1 : beard < 0.74 ? 2 : 3;
  const gray = mean(ref.map((p) => Math.abs(p.r - p.g) + Math.abs(p.g - p.b))) < 3;

  // redness: skin pixels (not dark hair) on cheeks + lower face vs forehead
  const skinPx = [...sample(REG.cheekRef, 0.05), ...sample([207, 427, 205, 425], 0.035)].filter((p) => p.L > refL * 0.75);
  const cheekA = median(skinPx.map((p) => lab(p.r, p.g, p.b)[1]));
  const foreA = median(sample(REG.forehead, 0.05).map((p) => lab(p.r, p.g, p.b)[1]));
  const redness = gray ? 0 : clamp01((cheekA - foreA - 2) / 8 + (cheekA - 20) / 25);
  // shine: near-white, low-saturation pixels on forehead + nose
  const tz = [...sample(REG.forehead, 0.06), ...sample(REG.nose, 0.035)];
  const shine = gray ? 0 : clamp01(mean(tz.map((p) => (p.L > Math.min(235, refL * 1.28) && Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) < 45 ? 1 : 0))) * 6);
  // texture: fine-edge density on clean cheek skin
  const texture = beardClass >= 2 ? 0 : clamp01((median(sample(REG.cheekRef, 0.045).map((p) => p.grad)) - 4) / 14);
  const light = refL;

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
  const quality = light < 70 ? "dark" : light > 225 ? "bright" : "ok";

  return { gray, debug: { darkFrac, edgeFrac, refL, refGrad, cheekA, foreA }, landmarks: pts, width: cv.width, height: cv.height, beard, beardClass, beardLabel: cls, redness, shine, texture, quality, findings, slots, canvas: cv };
}

/** Draw the analysis overlay (regions + subtle mesh) onto a canvas that already holds the photo. */
export function drawAnalysis(ctx, a) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const P = (i) => [a.landmarks[i].x * W, a.landmarks[i].y * H];
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.55)";
  for (let i = 0; i < a.landmarks.length; i += 3) { const [x, y] = P(i); ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6); }
  const faceW = Math.hypot(P(234)[0] - P(454)[0], P(234)[1] - P(454)[1]);
  const ring = (ids, color, r) => { ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, W / 260); for (const id of ids) { const [x, y] = P(id); ctx.beginPath(); ctx.arc(x, y, faceW * r, 0, Math.PI * 2); ctx.stroke(); } };
  ring([50, 280], "#4FC3F7", 0.05);
  ring([151], "#FFD54F", 0.06);
  ring([172, 397, 152], "#FF8A65", 0.045);
  ctx.restore();
}
