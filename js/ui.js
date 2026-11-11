// DOM rendering for the chat. Implements the UI interface the Bot (dialog.js) talks to.
import { BY_ID } from "./catalog.js";
import { STEPS } from "./dialog.js";
import { drawAnalysis, faceView } from "./vision.js";
import { icon } from "./icons.js";
import { searchStores, nearestStores, storeById } from "./stores.js";

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
        b.innerHTML = (o.icon ? icon(o.icon) : "") + `<span>${esc(o.label)}</span>`;
        b.addEventListener("click", () => { box.innerHTML = ""; this.h.choose(o); });
        box.appendChild(b);
      }
      this.scroll();
    });
  }
  step(n) {
    $("#steps").dataset.label = `Step ${n} of ${STEPS.length} · ${STEPS[n - 1]}`;
    document.querySelectorAll("#steps li").forEach((li, i) => { li.classList.toggle("done", i + 1 < n); li.classList.toggle("now", i + 1 === n); });
  }
  signal(field, use) {
    const li = document.createElement("li");
    li.innerHTML = `<code>${esc(field)}</code><span>${esc(use)}</span>`;
    $("#signals").prepend(li);
    $("#signals-empty").hidden = true;
  }
  basket(items) {
    this.items = items;
    $("#basket-count").textContent = items.reduce((t, b) => t + b.qty, 0);
    if (!$("#drawer").hidden) this.renderBasket();
  }
  focusInput(ph) { const t = $("#text"); if (ph) t.placeholder = ph; t.focus({ preventScroll: true }); }

  welcome() {
    this.wide(`<section class="hero welcome"><div class="hero-shot"><img src="${BY_ID.proglideRazor.img}" alt="Gillette ProGlide" loading="eager" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>
      <h1>Find your<br>best shave</h1><p>Personal advice for face, beard &amp; body – pick it up at Delhaize.</p>
      <div class="choice">
        <button class="choice-btn primary" data-act="login">${icon("key")}<b>Log in with SuperPlus</b><span>Personal offers, your orders and refill reminders</span></button>
        <button class="choice-btn" data-act="guestHome">${icon("user")}<b>Continue as guest</b><span>No account needed – nothing is stored</span></button>
      </div></section>`).then((d) => {
      d.querySelectorAll(".choice-btn").forEach((b) => b.addEventListener("click", () => {
        if (d.classList.contains("done")) return;
        d.classList.add("done");
        this.h.choose({ label: b.querySelector("b").textContent, act: b.dataset.act });
      }));
    });
  }
  landing() {
    const tiles = [
      ["camera", "Skin & beard check", "Analyse a selfie – on your phone", "photo"],
      ["beard", "Try beard styles", "Live AR try-on", "ar"],
      ["razor", "Find my razor", "3 quick questions", "guest"],
      ["chat", "Help with an order", "Refunds, delivery, questions", "help"],
    ];
    this.wide(`<section class="hero compact"><div class="tiles">${tiles.map(([i, t, s, a]) => `<button class="tile" data-act="${a}">${icon(i)}<b>${t}</b><span>${s}</span></button>`).join("")}</div></section>`).then((d) => {
      d.querySelectorAll(".tile").forEach((b) => b.addEventListener("click", () => this.h.tile(b.dataset.act, b.querySelector("b").textContent)));
    });
  }
  guide(groups) {
    this.wide(`<div class="card guide">${groups.map((g) => `<div class="g"><h6>${esc(g.title)}</h6><div class="g-row">${g.items.map((it) => `<button class="opt" data-id="${it.id}"><span>${esc(it.label)}</span></button>`).join("")}</div></div>`).join("")}</div>`).then((d) => {
      d.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => this.h.choose({ label: b.textContent, act: "cat", arg: { id: b.dataset.id } })));
    });
  }
  advice(a) {
    this.wide(`<div class="card advice"><div class="card-head"><h4>${esc(a.title)}</h4></div><ol>${a.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
      <p class="small muted">Source: <a href="${a.source}" target="_blank" rel="noopener">${esc(a.sourceName)}</a></p></div>`);
  }
  storePicker({ stores, preferred }) {
    const item = (st, km) => `<li><button class="store${st.id === preferred ? " pref" : ""}" data-id="${st.id}">${icon("pin")}<span><b>${esc(st.name)}</b>${st.id === preferred ? '<em>Your store</em>' : ""}<small>${esc(st.street)}, ${esc(st.postcode)} ${esc(st.city)}</small></span>${km != null ? `<i>${km < 10 ? km.toFixed(1) : Math.round(km)} km</i>` : ""}</button></li>`;
    const order = (list) => preferred ? [...list.filter((x) => x.id === preferred), ...list.filter((x) => x.id !== preferred)] : list;
    this.wide(`<div class="card stores"><div class="store-tools"><input type="search" placeholder="City or postcode" aria-label="Search stores"><button class="btn ghost small" data-loc>${icon("locate")}<span>Near me</span></button></div>
      <p class="small muted loc-msg" hidden></p><ul>${order(stores).slice(0, 6).map((x) => item(x)).join("")}</ul></div>`).then((d) => {
      const ul = d.querySelector("ul"), msg = d.querySelector(".loc-msg");
      const render = (list) => { ul.innerHTML = list.length ? list.slice(0, 6).map((x) => item(x, x.km)).join("") : '<li class="muted small">No collect point found – try a city like Gent or 1050.</li>'; wire(); };
      const wire = () => ul.querySelectorAll(".store").forEach((b) => b.addEventListener("click", () => {
        if (d.classList.contains("done")) return;
        d.classList.add("done");
        this.h.choose({ label: storeById(b.dataset.id).name, act: "store", arg: b.dataset.id });
      }));
      wire();
      d.querySelector("input").addEventListener("input", (e) => render(order(searchStores(e.target.value))));
      d.querySelector("[data-loc]").addEventListener("click", () => {
        msg.hidden = false; msg.textContent = "Finding your location…";
        if (!navigator.geolocation) { msg.textContent = "Location isn't available here – search by city instead."; return; }
        navigator.geolocation.getCurrentPosition((pos) => { msg.textContent = "Nearest collect points:"; render(nearestStores({ lat: pos.coords.latitude, lng: pos.coords.longitude })); },
          () => { msg.textContent = "Location not allowed – search by city or postcode instead."; }, { timeout: 8000, maximumAge: 600000 });
      });
      this.scroll();
    });
  }
  // ---------- basket drawer ----------
  openBasket() {
    const dr = $("#drawer");
    dr.hidden = false;
    document.body.classList.add("drawer-open");
    this.renderBasket();
    dr.querySelector(".drawer-card").focus();
  }
  closeBasket() { $("#drawer").hidden = true; document.body.classList.remove("drawer-open"); }
  renderBasket() {
    const items = this.items || [];
    const box = $("#drawer-body");
    const total = items.reduce((t, b) => t + b.total, 0), saved = items.reduce((t, b) => t + (b.saved || 0), 0);
    $("#drawer-foot").hidden = !items.length;
    if (!items.length) { box.innerHTML = `<div class="empty">${icon("basket")}<p>Your basket is empty.</p></div>`; return; }
    box.innerHTML = `<ul class="lines">${items.map((b, i) => { const p = BY_ID[b.id]; return `<li>${this.pimg(p)}<div class="l-main"><b>${esc(p.short)}</b>${b.deal ? `<span class="promo">2+2 free</span>` : ""}<span class="small muted">${eur(p.price)} per pack</span>
      <div class="qty"><button data-q="${i}" data-d="-1" aria-label="One less">${icon(b.packs === 1 ? "trash" : "minus")}</button><span>${b.packs}</span><button data-q="${i}" data-d="1" aria-label="One more">${icon("plus")}</button></div></div><strong>${eur(b.total)}</strong></li>`; }).join("")}</ul>`;
    $("#drawer-total").innerHTML = `${saved ? `<span class="save">You save ${eur(saved)}</span>` : ""}<span>Total</span><b>${eur(total)}</b>`;
    this.wireImages(box);
    box.querySelectorAll("[data-q]").forEach((btn) => btn.addEventListener("click", () => {
      const i = +btn.dataset.q, it = items[i];
      this.h.qty(i, it.packs + Number(btn.dataset.d) * (it.deal ? 4 : 1));
    }));
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
    this.wide(`<div class="strip">${cards}</div>`).then((d) => d.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { this.h.add(b.dataset.add); b.textContent = "Added"; b.disabled = true; })));
  }
  compare(ids) {
    const ps = ids.map((id) => BY_ID[id]);
    const row = (label, f) => `<tr><th>${label}</th>${ps.map((p) => `<td>${f(p)}</td>`).join("")}</tr>`;
    this.wide(`<div class="card"><table class="cmp"><thead><tr><th></th>${ps.map((p) => `<th>${this.pimg(p)}<b>${esc(p.short)}</b></th>`).join("")}</tr></thead><tbody>
      ${row("Price", (p) => eur(p.price) + (p.verified ? "" : "*"))}
      ${row("Sensitive skin", (p) => ["–", "Good", "Best"][p.sens])}
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
    this.wide(`<div class="card photo-prompt"><div class="row"><button class="btn" data-p="camera">${icon("camera")}<span>Take a selfie</span></button><label class="btn ghost">${icon("upload")}<span>Upload photo</span><input type="file" accept="image/*" hidden></label></div>
      <ul class="tips"><li>Face the camera, whole face in the frame</li><li>Daylight, no filter, no sunglasses</li><li>Analysed on your device – never uploaded</li></ul></div>`).then((d) => {
      d.querySelector("[data-p=camera]").addEventListener("click", () => this.h.camera());
      d.querySelector("input").addEventListener("change", (e) => e.target.files[0] && this.h.photoFile(e.target.files[0]));
    });
  }
  consultResult(a) {
    const lvl = (v) => (v < 0.3 ? "low" : v < 0.6 ? "medium" : "high");
    // a photo that fails the quality gate gets a retake request instead of numbers that would only be guesses
    const retake = !!a.retake;
    const conf = (f) => (f.confidenceLabel ? `<span class="conf" data-c="${f.confidenceLabel}" title="How sure the check is, given the photo">${f.confidenceLabel} confidence</span>` : "");
    const g = retake ? "" : a.findings.map((f) => `<button type="button" class="gauge ${f.key}" data-k="${f.key}" aria-pressed="false"><span class="lbl"><span>${f.label}</span><span>${lvl(f.value)}</span></span><span class="bar"><i style="width:${Math.round(8 + f.value * 92)}%"></i></span>${conf(f)}<span class="txt">${esc(f.text)}</span></button>`).join("");
    const layers = a.layers && !retake ? Object.entries({ beard: "Beard", redness: "Redness", shine: "Shine", texture: "Texture" }).filter(([k]) => a.layers[k]) : [];
    const chips = layers.length ? `<div class="layer-chips" role="group" aria-label="Show on photo"><button type="button" data-l="" aria-pressed="true">Zones</button>${layers.map(([k, l]) => `<button type="button" data-l="${k}" aria-pressed="false">${l}</button>`).join("")}</div>` : "";
    const note = retake
      ? `<div class="retake" role="status"><p><b>Let's take that again.</b> ${esc(a.qualityText || "The photo isn't clear enough for a reliable skin check.")}</p>
        <div class="row"><button type="button" class="btn" data-p="camera">${icon("camera")}<span>Take a new selfie</span></button><label class="btn ghost">${icon("upload")}<span>Upload another</span><input type="file" accept="image/*" hidden></label></div></div>`
      : a.qualityText ? `<p class="quality-note small">${esc(a.qualityText)}</p>` : "";
    const badge = retake ? `${a.beardLabel}?` : a.beardLabel;
    this.wide(`<div class="card consult${retake ? " is-retake" : ""}"><div class="card-head"><h4>Your skin &amp; beard check</h4><span class="small muted">${a.source === "ai" ? "AI analysis" : "on-device"}</span></div>
      <div class="shot"><canvas></canvas><span class="badge">${esc(badge)}</span></div>${chips}${note}
      <p class="consult-hint small muted">${layers.length ? "Tap a result or a layer to see where it was measured." : ""}</p>
      <div class="gauges">${g}</div>
      <div class="privacy">${icon("lock")} ${a.source === "ai" ? "Analysed by Claude in your own account – not stored by this page." : "Analysed on your device – the photo was not uploaded."} Not a medical diagnosis.</div></div>`).then((d) => {
      d.querySelector(".retake [data-p=camera]")?.addEventListener("click", () => this.h.camera());
      d.querySelector(".retake input")?.addEventListener("change", (e) => e.target.files[0] && this.h.photoFile(e.target.files[0]));
      const c = d.querySelector("canvas");
      const img = a.image;
      const iw = img.naturalWidth || a.width, ih = img.naturalHeight || a.height;
      const view = a.landmarks ? faceView({ ...a, width: iw, height: ih }) : { x: 0, y: 0, w: 1, h: 1 };
      const sw = view.w * iw, sh = view.h * ih, k = Math.min(1, 960 / Math.max(sw, sh));
      c.width = Math.round(sw * k); c.height = Math.round(sh * k);
      const ctx = c.getContext("2d");
      const state = { layer: null, highlight: null, view };
      const draw = () => {
        ctx.drawImage(img, view.x * iw, view.y * ih, sw, sh, 0, 0, c.width, c.height);
        if (a.landmarks) drawAnalysis(ctx, a, state);
        d.querySelectorAll(".layer-chips button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.l || null) === state.layer)));
        d.querySelectorAll(".gauge").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === state.highlight)));
      };
      d.querySelectorAll(".layer-chips button").forEach((b) => b.addEventListener("click", () => { state.layer = b.dataset.l || null; state.highlight = state.layer; draw(); }));
      d.querySelectorAll(".gauge").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.k, same = state.highlight === k;
        state.highlight = same ? null : k;
        state.layer = same ? null : a.layers?.[k] ? k : null;
        draw();
      }));
      draw();
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
    this.items = [];
    this.closeBasket();
    $("#text").placeholder = "Type a message…";
  }
}
