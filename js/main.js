import { Bot } from "./dialog.js";
import { UI } from "./ui.js";
import { CRM } from "./crm.js";
import { STYLES, SHADES, drawStyle, startLive, resetStrands } from "./ar.js";
import { initAI } from "./ai.js";
import { BY_ID } from "./catalog.js";

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
    if (a) { a.image = img; a.source = "device"; }
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
const modal = $("#modal"), video = $("#cam"), stage = $("#stage-canvas"), msg = $("#stage-msg"), controls = $("#modal-controls");
let stopLive = null;
const arState = { style: "short", shade: "brown", photo: null };

function stopModal() {
  if (stopLive) { stopLive(); stopLive = null; }
  modal.hidden = true;
}
$("#modal-close").addEventListener("click", stopModal);
modal.addEventListener("click", (e) => { if (e.target === modal) stopModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) stopModal(); });

function renderControls(mode) {
  if (mode === "snap") {
    controls.innerHTML = `<div class="modal-actions"><button class="btn" id="shutter">📸 Take photo</button><label class="btn ghost">⬆ Upload instead<input type="file" accept="image/*" hidden id="snap-file"></label></div>`;
    $("#shutter").addEventListener("click", () => {
      stage.toBlob((b) => { stopModal(); if (b) handlePhoto(new File([b], "selfie.jpg", { type: "image/jpeg" })); }, "image/jpeg", 0.92);
    });
    $("#snap-file").addEventListener("change", (e) => { const f = e.target.files[0]; stopModal(); if (f) handlePhoto(f); });
    return;
  }
  const st = STYLES.find((s) => s.id === arState.style);
  const prods = st.products.map((id) => BY_ID[id]).filter(Boolean);
  controls.innerHTML = `
    <div class="seg-label">Style</div>
    <div class="seg" id="seg-style">${STYLES.map((s) => `<button aria-pressed="${s.id === arState.style}" data-s="${s.id}">${s.name}</button>`).join("")}</div>
    <div class="seg-label">Beard colour</div>
    <div class="seg" id="seg-shade">${Object.entries(SHADES).map(([k, c]) => `<button class="swatch" aria-pressed="${k === arState.shade}" data-c="${k}" title="${k}" style="background:${c}"></button>`).join("")}</div>
    <p class="style-note"><b>${st.name}:</b> ${st.note} You'll need: ${prods.map((p) => p.short).join(", ")}.</p>
    <div class="modal-actions"><button class="btn" id="use-style">Get this look</button><label class="btn ghost">⬆ Use a photo<input type="file" accept="image/*" hidden id="ar-file"></label></div>`;
  controls.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => { arState.style = b.dataset.s; renderControls("ar"); drawStatic(); }));
  controls.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => { arState.shade = b.dataset.c; renderControls("ar"); drawStatic(); }));
  $("#use-style").addEventListener("click", () => { const id = arState.style; stopModal(); bot.act("useStyle", id); });
  $("#ar-file").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) await usePhotoInAR(f); });
}

async function usePhotoInAR(file) {
  if (stopLive) { stopLive(); stopLive = null; }
  const img = await loadImage(file);
  msg.textContent = "Finding your face…";
  try {
    const v = await import("./vision.js");
    const a = await v.analyze(img);
    if (!a) { msg.textContent = "No face found – try a front-facing photo."; return; }
    resetStrands();
    arState.photo = { img, a };
    msg.textContent = "";
    drawStatic();
  } catch {
    msg.textContent = "The try-on can't load in this view. Open aaron-rz.github.io/gillette-bot to use it.";
  }
}
function drawStatic() {
  if (!arState.photo || stopLive) return;
  const { img, a } = arState.photo;
  stage.width = a.width; stage.height = a.height;
  const ctx = stage.getContext("2d");
  ctx.drawImage(img, 0, 0, stage.width, stage.height);
  drawStyle(ctx, arState.style, a.landmarks, arState.shade);
}

async function openModal(mode, style) {
  modal.hidden = false;
  $("#modal-title").textContent = mode === "snap" ? "Take a selfie" : "Try beard styles";
  if (style) arState.style = STYLES.some((s) => s.id === style) ? style : "short";
  arState.photo = null;
  resetStrands();
  const ctx = stage.getContext("2d");
  stage.width = 640; stage.height = 480;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 640, 480);
  renderControls(mode);
  msg.textContent = mode === "snap" ? "Starting camera…" : "Starting camera… allow access to try styles live.";
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API");
    stopLive = await startLive(video, stage, () => (mode === "snap" ? { style: "clean" } : arState));
    msg.textContent = mode === "snap" ? "" : "Move a little – the beard follows your face.";
    setTimeout(() => { if (msg.textContent.startsWith("Move")) msg.textContent = ""; }, 3500);
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
$("#basket-btn").addEventListener("click", () => bot.act("basket"));
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
