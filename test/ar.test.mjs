// Pure-geometry checks for the face-mesh beard renderer (no DOM / WebGL needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { UV, TRI, N_VERTS } from "../js/facemesh.js";
import { INDICES, TEXCOORDS, N_ALL, JAW, positions, normals, OneEuro, SKIRT_RINGS } from "../js/ar-gl.js";
import { STYLES } from "../js/ar.js";

// a frontal face built from the canonical texture layout (x right, y down, z = 0)
const frontal = Array.from({ length: 478 }, (_, i) => ({ x: i < N_VERTS ? 0.25 + UV[2 * i] * 0.5 : 0.5, y: i < N_VERTS ? 0.1 + UV[2 * i + 1] * 0.6 : 0.5, z: 0 }));

test("canonical mesh is complete", () => {
  assert.equal(UV.length, N_VERTS * 2);
  assert.equal(TRI.length, 898 * 3);
  assert.ok(Math.max(...TRI) < N_VERTS);
  for (const v of UV) assert.ok(v >= 0 && v <= 1);
});

test("skirt adds rings below the jaw with texture coordinates inside the texture", () => {
  assert.equal(N_ALL, N_VERTS + SKIRT_RINGS * JAW.length);
  assert.equal(INDICES.length, TRI.length + SKIRT_RINGS * (JAW.length - 1) * 6);
  for (let i = N_VERTS; i < N_ALL; i++) { assert.ok(TEXCOORDS[2 * i + 1] <= 1 && TEXCOORDS[2 * i + 1] > 0.3); }
  const pos = positions(frontal);
  const chin = JAW.indexOf(152);
  const ringY = (r) => pos[3 * (N_VERTS + (r - 1) * JAW.length + chin) + 1];
  assert.ok(ringY(1) > frontal[152].y && ringY(2) > ringY(1) && ringY(3) > ringY(2), "skirt hangs down from the chin");
});

test("face and skirt triangles share one winding (so back-face culling works)", () => {
  const pos = positions(frontal);
  const sign = (t) => {
    const P = (i) => [pos[3 * INDICES[t + i]], pos[3 * INDICES[t + i] + 1]];
    const [a, b, c] = [P(0), P(1), P(2)];
    return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  };
  const counts = {};
  for (let t = 0; t < INDICES.length; t += 3) counts[sign(t)] = (counts[sign(t)] || 0) + 1;
  assert.ok((counts[1] || 0) < INDICES.length / 3 * 0.02, JSON.stringify(counts));
});

test("skirt follows head rotation and scale", () => {
  const rot = (a, s) => frontal.map((p) => { const x = p.x - 0.5, y = p.y - 0.5; return { x: 0.5 + s * (x * Math.cos(a) - y * Math.sin(a)), y: 0.5 + s * (x * Math.sin(a) + y * Math.cos(a)), z: 0 }; });
  const base = positions(frontal), turned = positions(rot(0.4, 0.7));
  const k = 3 * (N_VERTS + 2 * JAW.length + JAW.indexOf(152));
  const dx0 = base[k] - 0.5, dy0 = base[k + 1] - 0.5;
  const exp = [0.5 + 0.7 * (dx0 * Math.cos(0.4) - dy0 * Math.sin(0.4)), 0.5 + 0.7 * (dx0 * Math.sin(0.4) + dy0 * Math.cos(0.4))];
  assert.ok(Math.abs(turned[k] - exp[0]) < 1e-4 && Math.abs(turned[k + 1] - exp[1]) < 1e-4);
});

test("normals of a frontal face point at the camera", () => {
  const lm = frontal.map((p, i) => ({ ...p, z: i < N_VERTS ? -0.05 * Math.cos((UV[2 * i] - 0.5) * 3) : 0 }));
  const n = normals(positions(lm), 1);
  let z = 0; for (let i = 0; i < N_VERTS; i++) z += n[3 * i + 2];
  assert.ok(z / N_VERTS < -0.5);
});

test("One-Euro filter smooths jitter but follows real movement", () => {
  const f = new OneEuro();
  let out;
  for (let t = 0; t < 30; t++) out = f.filter([0.5 + (t % 2 ? 0.004 : -0.004)], t * 33);
  assert.ok(Math.abs(out[0] - 0.5) < 0.003, "jitter damped");
  for (let t = 30; t < 60; t++) out = f.filter([0.8], t * 33);
  assert.ok(Math.abs(out[0] - 0.8) < 0.01, "converges to the new position");
});

test("every try-on style lists products", () => {
  for (const s of STYLES) assert.ok(s.products.length >= 2 && s.note);
});

test("3D volume: every beard style has shells, fins follow the jaw/skirt contours", async () => {
  const { SHELLS, FIN_RINGS, FIN_INDICES, finVertices } = await import("../js/ar-gl.js");
  for (const s of ["stubble", "moustache", "circle", "short", "full"]) assert.ok(SHELLS[s].n >= 3 && SHELLS[s].h > 0);
  assert.ok(SHELLS.full.n >= 20 && SHELLS.full.h > SHELLS.short.h && SHELLS.stubble.n <= 3);
  const pts = FIN_RINGS.reduce((s, r) => s + r.length, 0);
  assert.equal(FIN_INDICES.length, FIN_RINGS.reduce((s, r) => s + (r.length - 1) * 6, 0));
  assert.ok(Math.max(...FIN_INDICES) < pts * 2);
  const pos = positions(frontal), nrm = normals(pos, 1);
  const fv = finVertices(pos, nrm);
  assert.equal(fv.length, pts * 2 * 10);
  // root and tip vertex of a fin share position/normal; only the height flag differs
  assert.equal(fv[8], 0); assert.equal(fv[18], 1); assert.equal(fv[0], fv[10]);
});

test("photo framing keeps the whole face plus beard room and matches the stage shape", async () => {
  const { faceCrop } = await import("../js/ar.js");
  // small face in a big landscape photo
  const lm = frontal.map((p) => ({ x: 0.45 + (p.x - 0.5) * 0.2, y: 0.4 + (p.y - 0.5) * 0.25, z: 0 }));
  const c = faceCrop(lm, 2000, 1300, 3 / 4);
  const ys = lm.map((p) => p.y * 1300), xs = lm.map((p) => p.x * 2000);
  assert.ok(c.y <= Math.min(...ys) && c.y + c.h >= Math.max(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.5, "chin + beard room inside");
  assert.ok(c.x <= Math.min(...xs) && c.x + c.w >= Math.max(...xs));
  assert.ok(Math.abs(c.w / c.h - 3 / 4) < 0.01, "stage aspect");
  assert.ok(c.w < 2000 * 0.6, "zoomed in");
});
