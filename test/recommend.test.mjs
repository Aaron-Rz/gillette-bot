import { test } from "node:test";
import assert from "node:assert/strict";
import { recommend, cheapest, compatibility } from "../js/recommend.js";

const ids = (r) => r.steps.map((s) => s.item.id);
const total = (r) => r.steps.reduce((t, s) => t + s.item.price, 0);

test("face + sensitive + own ProGlide handle → ProGlide blades, sensitive gel, balm", () => {
  const r = recommend({ for: "me", area: "face", skin: "sensitive", handle: "yes", owned: "proglide" });
  assert.ok(ids(r).includes("proglideBlades"), ids(r));
  assert.ok(r.steps.some((s) => s.role === "prep" && s.item.sens >= 2), ids(r));
  assert.ok(r.steps.some((s) => s.role === "care"), ids(r));
});
test("face, no handle, redness → sensitive razor (SkinGuard)", () => {
  const r = recommend({ for: "me", area: "face", skin: "sensitive", concerns: ["redness"], handle: "no" });
  assert.equal(r.steps.find((s) => s.role === "shave").item.id, "skinguardRazor");
});
test("Mach3 owner gets Mach3 blades", () => {
  const r = recommend({ area: "face", handle: "yes", owned: "mach3", skin: "normal" });
  assert.ok(ids(r).includes("mach3Blades"));
});
test("beard short → trimmer + care, no razors for women", () => {
  const r = recommend({ for: "gift", gender: "m", area: "beard", style: "short", skin: "normal" });
  assert.ok(r.steps.some((s) => s.role === "trim"));
  assert.ok(!r.steps.some((s) => s.item.gender === "f"));
});
test("gift for girlfriend, body → Venus", () => {
  const r = recommend({ for: "gift", gender: "f", area: "body", skin: "sensitive" });
  assert.ok(r.steps.every((s) => s.item.gender !== "m"), ids(r));
  assert.ok(ids(r).some((id) => id.startsWith("venus")), ids(r));
});
test("budget €30 is respected for a beard gift", () => {
  const r = recommend({ for: "gift", gender: "m", area: "beard", skin: "sensitive", budget: 30 });
  assert.ok(total(r) <= 30, `${total(r)} ${ids(r)}`);
  assert.ok(r.steps.length >= 1);
});
test("budget €15 face", () => {
  const r = recommend({ area: "face", skin: "normal", budget: 15 });
  assert.ok(total(r) <= 15, `${total(r)} ${ids(r)}`);
});
test("wantType trimmer leads with a trimmer", () => {
  const r = recommend({ area: "beard", wantType: "trimmer", style: "full" });
  assert.equal(r.steps[0].role, "trim");
});
test("premium heated razor only with a big budget", () => {
  assert.ok(!ids(recommend({ area: "face", skin: "sensitive", concerns: ["dryness"] })).includes("labsHeatedRazor"));
});
test("cheapest + compatibility", () => {
  assert.ok(cheapest({ area: "face" }).price < 12);
  assert.equal(compatibility("proglide", "fusion5"), true);
  assert.equal(compatibility("proglide", "mach3"), false);
});
