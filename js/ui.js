// DOM rendering for the chat. Implements the UI interface the Bot (dialog.js) talks to.
import { BY_ID } from "./catalog.js";
import { STEPS } from "./dialog.js";
import { drawAnalysis } from "./vision.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => "€" + n.toFixed(2).replace(".", ",");
const FAST = new URLSearchParams(location.search).get("fast") === "1";

export class UI {
  constructor(handlers) {
    this.h = handlers; // { choose(opt), persona(id), add(id), restart(), photoFile(file), camera(), openAR(style) }
    this.queue = Promise.resolve();
    $("#steps").innerHTML = STEPS.map((s) => `<li>${s}</li>`).join("");
    this.log = $("#log");
  }
  // sequencing: bot messages appear one after another with a short typing indicator
  enqueue(fn) { this.queue = this.queue.then(fn).catch((e) => console.error(e)); return this.queue; }
  typing() {
    if (FAST) return Promise.resolve();
    const t = this.raw('<span class="dots"><i></i><i></i><i></i></span>', "bot typing");
    return new Promise((r) => setTimeout(() => { t.remove(); r(); }, 420));
  }
  raw(html, cls) {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    d.innerHTML = html;
    this.log.appendChild(d);
    this.scroll();
    return d;
  }
  scroll() { requestAnimationFrame(() => { this.log.scrollTop = this.log.scrollHeight; }); }
  wide(html, cls = "") { return this.enqueue(async () => { const d = this.raw(html, "bot wide " + cls); this.wireImages(d); return d; }); }
  wireImages(root) {
    root.querySelectorAll(".pimg img").forEach((img) => {
      img.addEventListener("error", () => { img.remove(); img.parentElement?.classList.add("fallback"); }, { once: true });
      img.addEventListener("load", () => this.scroll(), { once: true });
    });
  }

  // ---------- interface used by the Bot ----------
  bot(html) { return this.enqueue(async () => { await this.typing(); this.raw(html, "bot"); }); }
  user(text) { this.raw(text, "user"); }
  sys(html) { this.enqueue(async () => this.raw(html, "sys")); }
  hint(text) { this.enqueue(async () => { const h = $("#hint"); h.textContent = text; h.hidden = false; }); }
  options(list) {
    $("#hint").hidden = true;
    const box = $("#options");
    box.innerHTML = "";
    this.enqueue(async () => {
      box.innerHTML = "";
      for (const o of list || []) {
        const b = document.createElement("button");
        b.className = "opt" + (o.primary ? " primary" : "");
        b.textContent = o.label;
        b.addEventListener("click", () => { box.innerHTML = ""; this.h.choose(o); });
        box.appendChild(b);
      }
      this.scroll();
    });
  }
  step(n) {
    document.querySelectorAll("#steps li").forEach((li, i) => { li.classList.toggle("done", i + 1 < n); li.classList.toggle("now", i + 1 === n); });
  }
  signal(field, use) {
    const li = document.createElement("li");
    li.innerHTML = `<code>${esc(field)}</code><span>${esc(use)}</span>`;
    $("#signals").prepend(li);
    $("#signals-empty").hidden = true;
  }
  basket(items) { $("#basket-count").textContent = items.reduce((t, b) => t + b.qty, 0); }
  focusInput(ph) { const t = $("#text"); if (ph) t.placeholder = ph; t.focus({ preventScroll: true }); }

  landing() {
    const img = BY_ID.proglideRazor.img;
    const tiles = [
      ["📷", "Skin & beard check", "Analyse a selfie – on your phone", "photo"],
      ["🧔", "Try beard styles", "Live AR try-on", "ar"],
      ["🪒", "Find my razor", "3 quick questions", "guest"],
      ["💬", "Help with an order", "Refunds, delivery, questions", "help"],
    ];
    this.wide(`<section class="hero"><div class="hero-shot"><img src="${img}" alt="Gillette ProGlide" loading="eager" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div><h1>Find your<br>best shave</h1><p>Personal advice for face, beard &amp; body – and pick it up at Delhaize.</p>
      <div class="tiles">${tiles.map(([i, t, s, a]) => `<button class="tile" data-act="${a}"><span class="ico">${i}</span><b>${t}</b><span>${s}</span></button>`).join("")}</div></section>`).then((d) => {
      d.querySelectorAll(".tile").forEach((b) => b.addEventListener("click", () => this.h.tile(b.dataset.act, b.querySelector("b").textContent)));
    });
  }
  personas(list) {
    this.wide(`<div class="personas">${list.map((c) => `<button class="persona" data-id="${c.id}"><span class="av">${c.name[0]}</span><b>${c.name}, ${c.age}</b><span>${c.city}</span><em>${c.segment}</em></button>`).join("")}</div>`).then((d) => {
      d.querySelectorAll(".persona").forEach((b) => b.addEventListener("click", () => this.h.persona(b.dataset.id)));
    });
  }
  pimg(p) { return `<div class="pimg"><img src="${p.img}" alt="${esc(p.short)}" loading="lazy" referrerpolicy="no-referrer"></div>`; }
  priceHtml(p, promo) {
    const badge = p.promo ? (promo ? `<span class="promo">SuperPlus ${p.promo}</span>` : `<span class="promo locked">${p.promo} with SuperPlus</span>`) : "";
    return `<span class="price">${eur(p.price)}</span>${p.verified ? "" : '<span class="ind" title="No Delhaize price found – indicative">indicative</span>'}${badge}`;
  }
  routine(r, { promo }) {
    const chips = (r.summary || []).map((x) => `<span class="chip">${esc(x)}</span>`).join("");
    const steps = r.steps.map((st, i) => {
      const p = st.item;
      return `<div class="step"><div class="num">${i + 1}</div>${this.pimg(p)}<div>
        <div class="role">${st.label} <span class="line-tag ${p.line}">${p.line === "KingC" ? "King C." : p.line}</span></div>
        <h5>${esc(p.short)}</h5>${st.why ? `<p>${esc(st.why)}</p>` : `<p>${esc(p.pitch)}</p>`}
        <div class="price-row">${this.priceHtml(p, promo)}</div>
        ${st.alt ? `<div class="alt">Alternative: ${esc(st.alt.short)} · ${eur(st.alt.price)}</div>` : ""}</div></div>`;
    }).join("");
    this.wide(`<div class="card routine"><div class="card-head"><h4>Your routine</h4><span class="small muted">${r.steps.length} step${r.steps.length > 1 ? "s" : ""}</span></div>
      ${chips ? `<div class="chips">${chips}</div>` : ""}${steps}<div class="routine-foot"><span>Total</span><b>${eur(r.total)}</b></div></div>`);
  }
  products(ids) {
    const cards = ids.map((id) => BY_ID[id]).filter(Boolean).map((p) => `<article class="card pcard">${this.pimg(p)}<div class="body">
      <span class="line-tag ${p.line}">${p.line === "KingC" ? "King C." : p.line}</span><h5>${esc(p.short)}</h5><p>${esc(p.pitch)}</p>
      <div class="price-row">${this.priceHtml(p, false)}</div><button class="mini-add" data-add="${p.id}">Add to basket</button></div></article>`).join("");
    this.wide(`<div class="strip">${cards}</div>`).then((d) => d.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { this.h.add(b.dataset.add); b.textContent = "Added ✓"; b.disabled = true; })));
  }
  compare(ids) {
    const ps = ids.map((id) => BY_ID[id]);
    const row = (label, f) => `<tr><th>${label}</th>${ps.map((p) => `<td>${f(p)}</td>`).join("")}</tr>`;
    this.wide(`<div class="card"><table class="cmp"><thead><tr><th></th>${ps.map((p) => `<th>${this.pimg(p)}<b>${esc(p.short)}</b></th>`).join("")}</tr></thead><tbody>
      ${row("Price", (p) => eur(p.price) + (p.verified ? "" : "*"))}
      ${row("Sensitive skin", (p) => ["–", "✓", "✓✓"][p.sens])}
      ${row("Best for", (p) => esc(p.features[0] || ""))}
      ${row("Range", (p) => `<span class="line-tag ${p.line}">${p.line === "KingC" ? "King C." : p.line}</span>`)}
      </tbody></table></div>`);
  }
  basketCard(items) {
    const rows = items.map((b) => `<li><span>${esc(b.label)}</span><strong>${eur(b.total)}</strong></li>`).join("");
    this.wide(`<div class="card basket"><div class="card-head"><h4>Your basket</h4></div><ul>${rows}</ul><p class="total"><span>Total</span><b>${eur(items.reduce((t, b) => t + b.total, 0))}</b></p></div>`);
  }
  ticket(t) {
    this.wide(`<div class="ticket"><div class="type">${esc(t.type)} · reference</div><div class="ref">${esc(t.id)}</div><p>${t.details}</p><p class="muted">${esc(t.next)}</p></div>`);
  }
  orderTrack(status) {
    const steps = ["Ordered", "Preparing", { out: "On its way", ready: "Ready" }[status] || "On its way", "Done"];
    const idx = { preparing: 1, out: 2, ready: 2, delivered: 3 }[status] ?? 1;
    this.wide(`<div class="card track">${steps.map((s, i) => `<div class="${i <= idx ? "on" : ""}">${s}</div>`).join("")}</div>`);
  }
  photoPrompt() {
    this.wide(`<div class="card photo-prompt"><div class="row"><button class="btn" data-p="camera">📷 Take a selfie</button><label class="btn ghost">⬆ Upload photo<input type="file" accept="image/*" hidden></label></div>
      <ul class="tips"><li>Face the camera, whole face in the frame</li><li>Daylight, no filter, no sunglasses</li><li>Analysed on your device – never uploaded</li></ul></div>`).then((d) => {
      d.querySelector("[data-p=camera]").addEventListener("click", () => this.h.camera());
      d.querySelector("input").addEventListener("change", (e) => e.target.files[0] && this.h.photoFile(e.target.files[0]));
    });
  }
  consultResult(a) {
    const g = a.findings.map((f) => `<div class="gauge ${f.key}"><div class="lbl"><span>${f.label}</span><span>${f.value < 0.3 ? "low" : f.value < 0.6 ? "medium" : "high"}</span></div><div class="bar"><i style="width:${Math.round(8 + f.value * 92)}%"></i></div><p>${esc(f.text)}</p></div>`).join("");
    this.wide(`<div class="card consult"><div class="card-head"><h4>Your skin &amp; beard check</h4><span class="small muted">${a.source === "ai" ? "AI analysis" : "on-device"}</span></div>
      <div class="shot"><canvas></canvas><span class="badge">${esc(a.beardLabel)}</span></div><div class="gauges">${g}</div>
      <div class="privacy">🔒 ${a.source === "ai" ? "Analysed by Claude in your own account – not stored by this page." : "Analysed on your device – the photo was not uploaded."} Not a medical diagnosis.</div></div>`).then((d) => {
      const c = d.querySelector("canvas");
      const img = a.image;
      c.width = a.width || img.naturalWidth; c.height = a.height || img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (a.landmarks) drawAnalysis(ctx, a);
      this.scroll();
    });
  }
  openAR(style) { this.h.openAR(style); }
  restart() { this.h.restart(); }

  // ---------- CRM panel ----------
  profile(s) {
    const box = $("#profile");
    if (!s.mode) { box.innerHTML = `<p class="muted">No session yet.</p>`; return; }
    const slotRows = Object.entries(s.slots).filter(([, v]) => v !== undefined).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? v.join(", ") : v)}</td></tr>`).join("");
    if (s.mode === "guest" || s.profile?.isNew) {
      box.innerHTML = `<p class="tag${s.profile?.isNew ? " member" : ""}">${s.profile?.isNew ? "New SuperPlus member" : "Anonymous guest"}</p>
        <p class="muted small">${s.profile?.isNew ? `Created in chat: ${esc(s.profile.name)} · reminders ${s.profile.consent ? "allowed" : "not allowed"}` : "No CRM record – Sam only knows what the shopper says or shows (zero-party data):"}</p>
        <table>${slotRows || '<tr><td class="muted">nothing yet</td></tr>'}</table>`;
      return;
    }
    const p = s.profile;
    const rows = [["name", `${p.name} ${p.surname}`], ["age", p.age], ["location", p.city], ["home store", p.store], ["segment", p.segment], ["skin", p.skin], ["owns", p.razor],
      ["last purchase", `${BY_ID[p.lastPurchase.product].short} · ${p.lastPurchase.daysAgo} days ago`], ["refill cycle", `~${p.cycle} days`], ...(p.household ? [["household", p.household]] : []),
      ["SuperPlus points", p.points], ["channel", p.channel], ["marketing consent", p.consent ? "yes" : "no"]];
    box.innerHTML = `<p class="tag member">SuperPlus member</p><table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}</table>
      <h4>Purchase history</h4><ul class="hist">${p.history.map((h) => `<li><span>${h.date}</span>${esc(h.item)} <em>${esc(h.channel)}</em></li>`).join("")}</ul>`;
  }
  clear() {
    this.queue = Promise.resolve();
    this.log.innerHTML = "";
    $("#options").innerHTML = "";
    $("#hint").hidden = true;
    $("#signals").innerHTML = "";
    $("#signals-empty").hidden = false;
    $("#basket-count").textContent = "0";
    $("#text").placeholder = "Type a message…";
  }
}
