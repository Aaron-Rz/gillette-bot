import { Bot } from "./dialog.js";
import { UI } from "./ui.js";
import { CRM } from "./crm.js";
import { STYLES, SHADES, startLive, renderPhoto } from "./ar.js";
import { initAI } from "./ai.js";
import { BY_ID } from "./catalog.js";
import { icon } from "./icons.js";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
let entry = params.get("src") === "shelf" ? "shelf" : "web";
let ai = null;

const ui = new UI({
  choose: (o) => bot.choose(o),
  persona: (id) => bot.act("persona", id),
  add: (id) => bot.act("add", id),
  tile: async (act, label) => {
    ui.user(label);
    if (act === "help") {
      await ui.bot("Sure – just type what you need, for example <i>“where is my order?”</i>, <i>“I want a refund”</i> or <i>“my trimmer stopped working”</i>.");
      bot.lastOpts = [];
      ui.options([]);
      ui.focusInput("Describe your question…");
      return;
    }
    bot.act(act);
  },
  photoFile: (f) => handlePhoto(f),
  camera: () => openModal("snap"),
  openAR: (style) => openModal("ar", style),
  restart: () => restart(),
  qty: (i, packs) => bot.act("qty", { i, packs }),
});
ui.thinking = (on) => {
  const id = "thinking";
  document.getElementById(id)?.remove();
  if (on) { const d = ui.raw('<span class="dots"><i></i><i></i><i></i></span>', "bot typing"); d.id = id; }
};
let bot = new Bot(ui, CRM, { entry });

function restart() {
  stopModal();
  ui.clear();
  bot = new Bot(ui, CRM, { entry, ai });
  ui.profile(bot.s);
  bot.start();
}

// ---------- photo consultation ----------
function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
async function handlePhoto(file) {
  const img = await loadImage(file).catch(() => null);
  if (!img) return ui.bot("I couldn't open that file – please send a JPG or PNG photo.");
  ui.user(`<img class="thumb" src="${img.src}" alt="Your photo">`);
  if (!bot.s.mode) { bot.s.mode = "guest"; }
  ui.thinking(true);
  let a = null, err = null;
  try {
    const v = await import("./vision.js");
    a = await v.analyze(img);
    if (a) { a.image = img; a.source = "device"; if (a.hairColor) arState.natural = a.hairColor; }
  } catch (e) {
    console.warn("on-device analysis unavailable", e);
    err = "load";
    if (ai?.images()) {
      const r = await ai.analyzePhoto(file);
      if (r && !r.noFace) { a = { ...r, image: img }; err = null; }
      else if (r?.noFace) err = null;
    }
  }
  ui.thinking(false);
  await bot.onPhoto(a, err);
}
$("#photo-input").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) handlePhoto(f); });

// ---------- modal: AR try-on + selfie camera ----------
// The stage canvas is drawn by the WebGL face-mesh renderer (ar-gl.js) for the live camera and for photos alike.
const modal = $("#modal"), video = $("#cam"), stage = $("#stage-canvas"), msg = $("#stage-msg"), controls = $("#modal-controls");
let stopLive = null;
const arState = { style: "short", shade: "natural", natural: null, photo: null, mode: "ar" };
const shadeValue = () => (arState.shade === "natural" ? arState.natural || SHADES.brown : arState.shade);

function stopModal() {
  if (stopLive) { stopLive(); stopLive = null; }
  modal.hidden = true;
}
$("#modal-close").addEventListener("click", stopModal);
modal.addEventListener("click", (e) => { if (e.target === modal) stopModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) stopModal(); });

function renderControls(mode) {
  if (mode === "snap") {
    controls.innerHTML = `<div class="modal-actions"><button class="btn" id="shutter">${icon("camera")}Take photo</button><label class="btn ghost">${icon("upload")}Upload instead<input type="file" accept="image/*" hidden id="snap-file"></label></div>`;
    $("#shutter").addEventListener("click", () => {
      stage.toBlob((b) => { stopModal(); if (b) handlePhoto(new File([b], "selfie.jpg", { type: "image/jpeg" })); }, "image/jpeg", 0.92);
    });
    $("#snap-file").addEventListener("change", (e) => { const f = e.target.files[0]; stopModal(); if (f) handlePhoto(f); });
    return;
  }
  const st = STYLES.find((s) => s.id === arState.style);
  const prods = st.products.map((id) => BY_ID[id]).filter(Boolean);
  const natural = arState.natural ? `<button class="natural" aria-pressed="${arState.shade === "natural"}" data-c="natural" title="Matches your brows"><i style="background:${arState.natural}"></i>Natural</button>` : "";
  controls.innerHTML = `
    <div class="seg-label">Style</div>
    <div class="seg" id="seg-style">${STYLES.map((s) => `<button aria-pressed="${s.id === arState.style}" data-s="${s.id}">${s.name}</button>`).join("")}</div>
    <div class="seg-label">Beard colour</div>
    <div class="shade-row" id="seg-shade">${natural}${Object.entries(SHADES).map(([k, c]) => `<button aria-pressed="${k === arState.shade}" data-c="${k}" title="${k}" aria-label="${k}" style="background:${c}"></button>`).join("")}</div>
    <p class="style-note"><b>${st.name}:</b> ${st.note} You'll need: ${prods.map((p) => p.short).join(", ")}.</p>
    <div class="modal-actions"><button class="btn" id="use-style">Get this look</button><label class="btn ghost">${icon("upload")}Use a photo<input type="file" accept="image/*" hidden id="ar-file"></label></div>`;
  controls.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => { arState.style = b.dataset.s; renderControls("ar"); drawStatic(); }));
  controls.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => { arState.shade = b.dataset.c; renderControls("ar"); drawStatic(); }));
  $("#use-style").addEventListener("click", () => { const id = arState.style; stopModal(); bot.act("useStyle", id); });
  $("#ar-file").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) await usePhotoInAR(f); });
}

async function usePhotoInAR(file) {
  if (stopLive) { stopLive(); stopLive = null; }
  const img = await loadImage(file).catch(() => null);
  if (!img) { msg.textContent = "Couldn't open that file – try a JPG or PNG."; return; }
  msg.textContent = "Finding your face…";
  try {
    const v = await import("./vision.js");
    const a = await v.analyze(img);
    if (!a) { msg.textContent = "No face found – try a front-facing photo."; return; }
    arState.photo = { img, a };
    if (a.hairColor) { const first = !arState.natural; arState.natural = a.hairColor; if (first) renderControls("ar"); }
    msg.textContent = "";
    stage.dataset.face = "1";
    drawStatic();
  } catch (e) {
    console.warn("photo try-on unavailable", e);
    msg.textContent = "The try-on can't load in this view. Open aaron-rz.github.io/gillette-bot to use it.";
  }
}
function drawStatic() {
  if (!arState.photo || stopLive) return;
  const { img, a } = arState.photo;
  renderPhoto(stage, img, a.landmarks, arState.style, shadeValue());
}

/** Estimate the natural hair colour from the brows on the first live frame (used for the "Natural" swatch). */
function naturalFromFrame(lm, vid) {
  try {
    const c = document.createElement("canvas"); c.width = 160; c.height = Math.round((160 * vid.videoHeight) / vid.videoWidth);
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(vid, 0, 0, c.width, c.height);
    const px = [];
    for (const i of [70, 63, 105, 66, 107, 336, 296, 334, 293, 300]) {
      const x = Math.round(lm[i].x * c.width), y = Math.round(lm[i].y * c.height);
      const d = g.getImageData(Math.max(0, x - 1), Math.max(0, y - 1), 3, 3).data;
      for (let k = 0; k < d.length; k += 4) px.push([d[k], d[k + 1], d[k + 2]]);
    }
    px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
    const dark = px.slice(0, Math.max(1, Math.floor(px.length * 0.4)));
    const avg = [0, 1, 2].map((ch) => Math.round((dark.reduce((s, p) => s + p[ch], 0) / dark.length) * 0.85));
    if (Math.max(...avg) - Math.min(...avg) < 4) return; // grey/IR camera: keep the default
    arState.natural = "#" + avg.map((v) => v.toString(16).padStart(2, "0")).join("");
    if (arState.mode === "ar") renderControls("ar");
  } catch { /* keep default shade */ }
}

async function openModal(mode, style) {
  modal.hidden = false;
  arState.mode = mode;
  $("#modal-title").textContent = mode === "snap" ? "Take a selfie" : "Try beard styles";
  if (style) arState.style = STYLES.some((s) => s.id === style) ? style : "short";
  arState.photo = null;
  renderControls(mode);
  msg.textContent = mode === "snap" ? "Starting camera…" : "Starting camera… allow access to try styles live.";
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API");
    stopLive = await startLive(video, stage, () => (mode === "snap" ? { style: "clean" } : { style: arState.style, shade: shadeValue() }), (lm, vid) => { if (!arState.natural) naturalFromFrame(lm, vid); });
    msg.textContent = stage.dataset.tracking === "0" && mode !== "snap" ? "Face tracking isn't available in this browser – please try Chrome or Safari." : mode === "snap" ? "" : "Turn your head a little – the beard follows your face and the light.";
    setTimeout(() => { if (msg.textContent.startsWith("Turn")) msg.textContent = ""; }, 4000);
  } catch (e) {
    console.warn("camera unavailable", e);
    msg.textContent = mode === "snap" ? "Camera not available – upload a photo instead." : window.claude ? "AR needs the camera, which this view blocks. Open aaron-rz.github.io/gillette-bot on your phone." : "Camera not available – use a photo to try the styles.";
  }
}

// ---------- composer & chrome ----------
$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("#text");
  const v = t.value.trim();
  if (!v) return;
  t.value = "";
  t.placeholder = "Type a message…";
  $("#options").innerHTML = "";
  bot.onText(v);
});
$("#basket-btn").addEventListener("click", () => ui.openBasket());
$("#drawer-close").addEventListener("click", () => ui.closeBasket());
$("#drawer-continue").addEventListener("click", () => ui.closeBasket());
$("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") ui.closeBasket(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) ui.closeBasket(); });
$("#drawer-checkout").addEventListener("click", () => { ui.closeBasket(); ui.user("Checkout"); bot.act("checkout"); });
$("#restart").addEventListener("click", restart);
$("#crm-toggle").addEventListener("click", () => { const o = document.body.classList.toggle("crm-open"); $("#crm-toggle").setAttribute("aria-expanded", String(o)); });
$("#crm-close").addEventListener("click", () => { document.body.classList.remove("crm-open"); $("#crm-toggle").setAttribute("aria-expanded", "false"); });
const sel = $("#entry");
sel.value = entry;
sel.addEventListener("change", () => {
  entry = sel.value;
  const u = new URL(location.href);
  if (entry === "shelf") u.searchParams.set("src", "shelf"); else u.searchParams.delete("src");
  history.replaceState(null, "", u);
  restart();
});

ui.profile(bot.s);
bot.start();

// AI mode only inside a Claude viewer; resolves later (or never) without blocking the page.
initAI((t) => { const s = $("#ai-status"); s.textContent = t; s.hidden = false; }).then((a) => {
  if (!a) return;
  ai = a;
  bot.opts.ai = a;
}).catch(() => {});
