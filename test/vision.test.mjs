// Pure-function checks for the on-device skin & beard check (no DOM, no MediaPipe needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { UV, N_VERTS } from "../js/facemesh.js";
import { skinWhiteBalance, headPose, sharpness, assessQuality, classifyBeard, level, median, quant, QT } from "../js/vision.js";

// a frontal face from the canonical texture layout (x right, y down, z = 0)
const frontal = Array.from({ length: 478 }, (_, i) => ({ x: i < N_VERTS ? 0.25 + UV[2 * i] * 0.5 : 0.5, y: i < N_VERTS ? 0.1 + UV[2 * i + 1] * 0.6 : 0.5, z: 0 }));
// column-major 4×4 rotation about the vertical axis (what MediaPipe's facial transformation matrix carries)
const yawMatrix = (deg) => { const a = (deg * Math.PI) / 180; return [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, -40, 1]; };

test("white balance leaves normal skin tones alone", () => {
  for (const rgb of [[224, 172, 150], [198, 134, 98], [100, 65, 50], [60, 40, 32]]) assert.deepEqual(skinWhiteBalance(rgb), [1, 1, 1], `tone ${rgb}`);
});
test("white balance pulls a colour cast back into the skin range", () => {
  const [, gG, gB] = skinWhiteBalance([150, 160, 170]); // teal-graded skin: too green and blue
  assert.ok(gG < 1 && gB < 1);
  assert.ok((160 * gG) / 150 <= 0.861 && (170 * gB) / 150 <= 0.821);
  const warm = skinWhiteBalance([220, 110, 50]); // tungsten: too little green/blue
  assert.ok(warm[1] > 1 && warm[2] > 1);
  assert.deepEqual(skinWhiteBalance([0, 0, 0]), [1, 1, 1]);
});

test("head pose: frontal ≈ 0°, turned face from the transformation matrix", () => {
  const f = headPose(frontal, 640, 480);
  assert.ok(Math.abs(f.yaw) < 3 && Math.abs(f.roll) < 3, JSON.stringify(f));
  assert.ok(Math.abs(headPose(frontal, 640, 480, yawMatrix(0)).yaw) < 0.01);
  assert.ok(Math.abs(Math.abs(headPose(frontal, 640, 480, yawMatrix(35)).yaw) - 35) < 0.01);
});
test("head pose fallback without matrix sees a turned face", () => {
  // squash one half of the face (as if turned): the nose tip moves towards one edge
  const turned = frontal.map((p) => ({ ...p, x: p.x < 0.5 ? 0.5 - (0.5 - p.x) * 0.3 : p.x }));
  assert.ok(Math.abs(headPose(turned, 640, 480).yaw) > 15);
});

test("sharpness: a crisp edge scores high, a blurred one low, independent of contrast", () => {
  const W = 40, H = 40;
  const img = (fn) => Float32Array.from({ length: W * H }, (_, k) => fn(k % W));
  const idx = Array.from({ length: W * H }, (_, k) => k);
  const crisp = sharpness(img((x) => (x < 20 ? 60 : 180)), W, idx);
  const lowContrast = sharpness(img((x) => (x < 20 ? 100 : 130)), W, idx);
  const blurred = sharpness(img((x) => 60 + 120 / (1 + Math.exp(-(x - 20) / 4))), W, idx);
  assert.ok(crisp > 0.4, `crisp ${crisp}`);
  assert.ok(Math.abs(crisp - lowContrast) < 0.05);
  assert.ok(blurred < QT.blurHard, `blurred ${blurred}`);
  assert.equal(sharpness(img(() => 90), W, idx), 0); // flat area: no edges → 0, the gate then needs other cues
});

const good = { faceW: 320, sharp: 0.35, skinL: 160, faceP98: 220, clipped: 0, yaw: 3, pitch: -2 };
test("quality gate passes a good photo", () => {
  const q = assessQuality(good);
  assert.equal(q.code, "ok"); assert.equal(q.retake, false); assert.equal(q.text, ""); assert.ok(q.score > 0.9);
});
test("quality gate asks for a retake with a clear reason", () => {
  const cases = [[{ yaw: 32 }, "side-on"], [{ yaw: -40 }, "side-on"], [{ pitch: 30 }, "tilted"], [{ sharp: 0.06 }, "blurry"], [{ faceW: 60 }, "far away"], [{ faceP98: 50, skinL: 20 }, "dark"], [{ clipped: 0.4 }, "bright"]];
  for (const [patch, code] of cases) {
    const q = assessQuality({ ...good, ...patch });
    assert.equal(q.code, code, JSON.stringify(patch)); assert.equal(q.retake, true); assert.ok(q.text.length > 20);
  }
});
test("quality gate: dark skin in good light is not 'too dark'", () => {
  assert.equal(assessQuality({ ...good, skinL: 70, faceP98: 175 }).code, "ok");
});
test("soft issues warn and lower confidence but keep the result", () => {
  const q = assessQuality({ ...good, faceW: 110, sharp: 0.13 });
  assert.equal(q.retake, false); assert.equal(q.code, "far away"); assert.deepEqual(q.issues, ["far away", "blurry"]); assert.ok(q.score < 0.8);
  // a hard problem wins over a soft one
  assert.equal(assessQuality({ ...good, faceW: 110, yaw: 30 }).code, "side-on");
});

const zero = { lipHair: 0, jawHair: 0, cheekHair: 0, belowHair: 0, stip: 0, chinDark: 0 };
test("beard classes from zone features", () => {
  assert.equal(classifyBeard(zero).cls, 0);
  assert.equal(classifyBeard({ ...zero, lipHair: 0.4, jawHair: 0.35, chinDark: 0.2 }).cls, 1); // patchy, skin shows through
  assert.equal(classifyBeard({ ...zero, stip: 0.2, chinDark: 0.25 }).cls, 1); // fine stipple only
  assert.equal(classifyBeard({ ...zero, lipHair: 0.8, jawHair: 0.7, chinDark: 0.6, belowHair: 0.3 }).cls, 2);
  assert.equal(classifyBeard({ ...zero, lipHair: 0.95, jawHair: 0.95, chinDark: 0.6, belowHair: 0.9 }).cls, 3);
  assert.equal(classifyBeard({ ...zero, jawHair: 0.3, chinDark: 0.65 }).cls, 2); // dark beard on dark skin: darkness, little texture
  assert.equal(classifyBeard({ ...zero, lipHair: 0.7, jawHair: 0.5, chinDark: 0 }).cls, 2); // white beard: not darker than skin
});
test("beard confidence grows with distance from the thresholds", () => {
  const sure = classifyBeard(zero).conf, borderline = classifyBeard({ ...zero, jawHair: 0.45, lipHair: 0.05 }).conf;
  assert.ok(sure > borderline, `${sure} vs ${borderline}`);
  for (const f of [zero, { ...zero, jawHair: 1, lipHair: 1, belowHair: 1, chinDark: 1 }]) { const c = classifyBeard(f).conf; assert.ok(c >= 0 && c <= 1); }
});

test("levels and stats helpers", () => {
  assert.equal(level(0.1), "low"); assert.equal(level(0.3), "medium"); assert.equal(level(0.6), "high");
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([]), 0);
  assert.equal(quant([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 10); assert.equal(quant([], 0.5), 0);
});
