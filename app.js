/* Gillette × Delhaize shopping assistant – rule-based conversational commerce demo.
   Flow = data (NODES). Each node: step, say(), cards(), opts(), optional input(). */
(() => {
  "use strict";
  const P = window.PRODUCTS;
  const CRM = window.CRM;
  const STEPS = ["Welcome", "Needs", "Recommend", "Objections", "Checkout", "Follow-up"];
  const params = new URLSearchParams(location.search);

  // ---------- state ----------
  let S;
  function reset() {
    S = {
      mode: null, // "member" | "guest"
      profile: null,
      a: {}, // answers (zero-party data)
      rec: null, // { items:[ids], why, alt:[ids] }
      basket: [],
      entry: params.get("src") === "shelf" ? "shelf" : "web",
      node: null,
      step: 1,
    };
  }

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const eur = (n) => "€" + n.toFixed(2).replace(".", ",");
  const first = () => (S.profile && S.profile.name) || "";
  const isMember = () => S.mode === "member";
  const promoOn = () => isMember(); // SuperPlus card needed for 2+2
  const basketTotal = () => S.basket.reduce((t, b) => t + b.total, 0);
  const basketCount = () => S.basket.reduce((t, b) => t + b.qty, 0);
  const gelFor = () => {
    if (isMember() && S.profile.preferredGel && !S.a.newSkin) return S.profile.preferredGel;
    return S.a.skin === "normal" ? "gelLabs" : "gelSensitive";
  };

  // ---------- CRM panel ----------
  function signal(field, use) {
    const li = document.createElement("li");
    li.innerHTML = `<code>${esc(field)}</code><span>${esc(use)}</span>`;
    $("#signals").prepend(li);
    $("#signals-empty").hidden = true;
  }
  function renderProfile() {
    const box = $("#profile");
    if (!S.mode) {
      box.innerHTML = `<p class="muted">No session yet. Choose “Log in” or “Guest”.</p>`;
      return;
    }
    if (S.mode === "guest" && !S.profile) {
      const rows = Object.entries(S.a).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
      box.innerHTML = `<p class="tag">Anonymous guest</p><p class="muted">No CRM record. The bot only knows what the shopper tells it (zero-party data):</p><table>${rows || '<tr><td class="muted">nothing yet</td></tr>'}</table>`;
      return;
    }
    const p = S.profile;
    const fields = p.isNew
      ? [["name", p.name], ["status", "New SuperPlus member (created in chat)"], ["marketingConsent", p.marketingConsent ? "yes" : "no"], ...Object.entries(S.a)]
      : [
          ["name", `${p.name} ${p.surname}`],
          ["age", p.age],
          ["location", p.city],
          ["home store", p.store],
          ["segment", p.segment],
          ["skin", p.skin],
          ["shaves", p.area + ", " + p.shaveFrequency],
          ["owns", p.razor],
          ["last purchase", `${P[p.lastPurchase.product].name} · ${p.lastPurchase.daysAgo} days ago`],
          ["refill cycle", `~${p.replenishCycleDays} days`],
          ...(p.household ? [["household", p.household]] : []),
          ["SuperPlus points", p.points],
          ["preferred channel", p.channel],
          ["marketing consent", p.marketingConsent ? "yes" : "no"],
        ];
    const hist = p.history
      ? `<h4>Purchase history</h4><ul class="hist">${p.history.map((h) => `<li><span>${esc(h.date)}</span>${esc(h.item)} <em>${esc(h.channel)}</em></li>`).join("")}</ul>`
      : "";
    box.innerHTML = `<p class="tag member">SuperPlus member</p><table>${fields.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>${hist}`;
  }

  // ---------- rendering ----------
  const log = () => $("#log");
  function scrollDown() {
    const l = log();
    l.scrollTop = l.scrollHeight;
  }
  function bubble(html, who = "bot") {
    const d = document.createElement("div");
    d.className = "msg " + who;
    d.innerHTML = html;
    log().appendChild(d);
    scrollDown();
    return d;
  }
  function icon(type) {
    const paths = {
      blades: '<rect x="14" y="20" width="36" height="14" rx="3"/><path d="M17 24h30M17 27h30M17 30h30"/><path d="M32 34v18"/>',
      razor: '<rect x="16" y="12" width="32" height="12" rx="3"/><path d="M19 16h26M19 19h26"/><path d="M29 24l-2 28h10l-2-28"/>',
      gel: '<rect x="22" y="18" width="20" height="36" rx="5"/><path d="M26 18v-6h12v6M38 12h6"/>',
      oil: '<path d="M26 26h12v26a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3z"/><path d="M29 26v-8h6v8M32 18v-6"/>',
      disposable: '<rect x="14" y="14" width="26" height="10" rx="3"/><path d="M17 18h20"/><path d="M27 24l18 30"/>',
    };
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${paths[type] || paths.blades}</svg>`;
  }
  function card(id, opts = {}) {
    const p = P[id];
    const promo = p.promo
      ? promoOn()
        ? `<span class="promo">Your SuperPlus deal: ${p.promo} · ${eur((p.price * 2) / 4)} per pack</span>`
        : `<span class="promo muted-promo">${p.promo} with a SuperPlus card</span>`
      : "";
    return `<article class="card" data-id="${id}">
      <div class="pic t-${p.type}">${icon(p.type)}</div>
      <div class="info">
        <h3>${p.name}</h3>
        <p class="pack">${p.pack}${p.fits ? " · " + p.fits : ""}</p>
        <p class="pitch">${p.pitch}</p>
        <p class="meta"><span class="stars" aria-label="${p.rating} out of 5">★ ${p.rating.toFixed(1)}</span>
        <strong>${eur(p.price)}</strong>${p.indicative ? '<span class="ind" title="No online price found – indicative shelf price">indicative</span>' : ""}</p>
        ${promo}
        ${opts.add === false ? "" : `<button class="add" data-add="${id}">Add to basket</button>`}
      </div></article>`;
  }
  function cards(ids, opts) {
    bubble(`<div class="cards">${ids.map((id) => card(id, opts)).join("")}</div>`, "bot wide");
  }
  function setStep(n) {
    S.step = n;
    document.querySelectorAll("#steps li").forEach((li, i) => {
      li.classList.toggle("done", i + 1 < n);
      li.classList.toggle("now", i + 1 === n);
    });
  }
  function renderBasket() {
    $("#basket-count").textContent = basketCount();
    $("#basket-btn").setAttribute("aria-label", `Basket: ${basketCount()} items, ${eur(basketTotal())}`);
  }
  function setOptions(opts) {
    const box = $("#options");
    box.innerHTML = "";
    (opts || []).forEach((o) => {
      const b = document.createElement("button");
      b.className = "opt" + (o.primary ? " primary" : "");
      b.textContent = o.label;
      b.addEventListener("click", () => choose(o));
      box.appendChild(b);
    });
  }

  // typing delay for natural pacing; skipped with ?fast=1 (tests)
  const FAST = params.get("fast") === "1";
  function typing() {
    if (FAST) return Promise.resolve();
    const t = bubble('<span class="dots"><i></i><i></i><i></i></span>', "bot typing");
    return new Promise((r) => setTimeout(() => { t.remove(); r(); }, 550));
  }

  // ---------- basket actions ----------
  function addToBasket(id, deal) {
    const p = P[id];
    const qty = deal ? 4 : 1;
    const total = deal ? p.price * 2 : p.price;
    S.basket.push({ id, qty, total, label: deal ? `${p.name} – 2+2 deal (4 packs)` : p.name });
    renderBasket();
    bubble(`Added: <strong>${esc(S.basket[S.basket.length - 1].label)}</strong> (${eur(total)})`, "sys");
    if (isMember()) signal("basket", `${p.name} added – will earn SuperPlus points`);
  }
  function addRec(withDeal) {
    S.rec.items.forEach((id) => addToBasket(id, withDeal && !!P[id].promo && promoOn()));
  }
  function showBasket() {
    if (!S.basket.length) return bubble("Your basket is empty for now.");
    const rows = S.basket.map((b) => `<li><span>${esc(b.label)}</span><strong>${eur(b.total)}</strong></li>`).join("");
    bubble(`<div class="basket"><h4>Your basket</h4><ul>${rows}</ul><p class="total">Total <strong>${eur(basketTotal())}</strong></p></div>`, "bot wide");
  }

  // ---------- recommendation engine ----------
  function recommend() {
    const a = S.a;
    const gel = gelFor();
    const skinTxt = a.skin === "sensitive" ? "sensitive skin" : a.skin === "unsure" ? "skin you're not sure about" : "normal skin";
    if (a.area === "body") {
      return { items: ["venus", "foamAloe"], cheap: ["venus"], why: `for legs & body with ${skinTxt}: pivoting head + a hydrating foam against redness` };
    }
    if (a.area === "beard") {
      return { items: ["fusion5", "beardOil"], cheap: ["fusion5"], why: "to keep a beard sharp: the precision trimmer on the back of Fusion5 draws clean lines, the oil keeps the beard soft" };
    }
    // face
    if (a.handle === "yes") {
      return { items: ["proglide", gel], cheap: ["proglide"], why: `for a daily-ready face shave with ${skinTxt}: ProGlide refills for your handle + ${P[gel].name.replace("Gillette ", "")}` };
    }
    return { items: ["fusion5", gel], cheap: ["fusion5"], why: `you need a handle first: Fusion5 is the best entry into the system (refills: Fusion5 or ProGlide) + a gel for ${skinTxt}` };
  }

  // ---------- flow ----------
  const NODES = {
    start: {
      step: 1,
      say: () => [
        S.entry === "shelf"
          ? "Hi! 👋 You scanned the QR code at the <strong>shaving shelf</strong>. I'm Sam, the Gillette shave assistant at Delhaize."
          : "Hi! 👋 I'm Sam, the Gillette shave assistant at Delhaize.",
        "In under a minute I'll find the right razor, blades or gel for you – and you can get them without waiting at the locked blade case.",
        "Log in with your <strong>SuperPlus</strong> card for personal offers, or continue as a guest.",
      ],
      opts: () => [
        { label: "🔑 Log in with SuperPlus", go: "login", primary: true },
        { label: "Continue as guest", go: "g_for", set: () => { S.mode = "guest"; signal("session", "Guest – no CRM data, ask questions instead"); } },
      ],
    },
    login: {
      step: 1,
      say: () => ["Demo: pick a SuperPlus customer. Each one is a different CRM profile."],
      after: () => {
        const html = CRM.map((c) => `<button class="persona" data-persona="${c.id}"><strong>${c.name}, ${c.age}</strong><span>${c.city}</span><em>${c.segment}</em></button>`).join("");
        bubble(`<div class="personas">${html}</div>`, "bot wide");
      },
      opts: () => [{ label: "← Back, continue as guest", go: "g_for", set: () => { S.mode = "guest"; signal("session", "Guest – no CRM data, ask questions instead"); } }],
      kw: () => CRM.map((c) => ({ re: new RegExp(c.name, "i"), run: () => loginAs(c.id) })),
    },

    // ----- member welcome (CRM-triggered) -----
    m_welcome: {
      step: 1,
      say: () => {
        const p = S.profile;
        const lp = P[p.lastPurchase.product];
        signal("name", `Greeting: “Welcome back, ${p.name}”`);
        if (p.id === "lucas") {
          signal("lastPurchase.daysAgo = 34 / cycle 35", "Replenishment trigger: blades due");
          signal("promo × razor = Fusion5", "Offer: ProGlide 2+2 fits his handle");
          return [
            `Welcome back, ${p.name}! 👋`,
            `Your last <strong>${lp.name}</strong> were ${p.lastPurchase.daysAgo} days ago – you usually restock every ~5 weeks, so they're probably getting dull.`,
            `Good timing: this week <strong>2+2 free</strong> on ProGlide with your SuperPlus card. That's 16 blades for ${eur(lp.price * 2)} (${eur((lp.price * 2) / 16)} per blade).`,
          ];
        }
        if (p.id === "marc") {
          signal("lastPurchase.daysAgo = 61 / cycle 60", "Replenishment trigger: Mach3 + beard oil due");
          signal("area = beard, razor = Mach3", "Upsell idea: Fusion5 precision trimmer for beard lines");
          return [
            `Hi ${p.name}, good to see you! 👋`,
            `Your Mach3 blades and King C. Gillette beard oil from 9 September are probably running out – that was ${p.lastPurchase.daysAgo} days ago.`,
            "Want the usual again via Collect&Go, or should I show you an upgrade that makes beard lines easier?",
          ];
        }
        signal("lastPurchase.daysAgo = 22 / cycle 45", "No replenishment push – avoid spamming");
        signal("household + occasion", "Gift idea for partner (December)");
        return [
          `Hi ${p.name}! 👋`,
          "Your Venus pack from 18 October should last a few more weeks, so no need to restock yet.",
          "December is coming though – are you looking for a gift idea for Thomas? Gillette sets are a classic.",
        ];
      },
      opts: () => {
        const id = S.profile.id;
        if (id === "lucas")
          return [
            { label: "Restock my usual", primary: true, go: "rec", set: () => { S.a = { area: "face", skin: "sensitive", handle: "yes" }; } },
            { label: "Show me something new", go: "g_area", set: () => { S.a = { skin: S.profile.skin }; S.a.newSkin = false; signal("skin = sensitive", "Skip skin question – already known"); } },
            { label: "Just browsing", go: "later" },
          ];
        if (id === "marc")
          return [
            { label: "Reorder the usual", primary: true, go: "rec", set: () => { S.a = { area: "beard", skin: "normal" }; S.rec = { items: ["mach3", "beardOil"], cheap: ["mach3"], why: "your usual: Mach3 refills + King C. Gillette beard oil" }; } },
            { label: "Show me the upgrade", go: "rec", set: () => { S.a = { area: "beard", skin: "normal" }; } },
            { label: "Just browsing", go: "later" },
          ];
        return [
          { label: "Yes, gift for Thomas 🎁", primary: true, go: "rec", set: () => { S.a = { for: "gift", area: "face", skin: "unsure", handle: "no" }; S.rec = { items: ["fusion5", "gelLabs"], cheap: ["fusion5"], why: "a gift set for Thomas: Fusion5 razor (no refills needed to start) + GilletteLabs gel" }; signal("household.partner", "Gift recommendation for Thomas"); } },
          { label: "Restock my Venus", go: "rec", set: () => { S.a = { area: "body", skin: "normal" }; } },
          { label: "Something else for me", go: "g_area", set: () => { S.a = { skin: S.profile.skin }; } },
        ];
      },
    },

    // ----- guest discovery -----
    g_for: {
      step: 2,
      say: () => ["Let's find your match. Who are we shopping for?"],
      opts: () => [
        { label: "For me", go: "g_area", set: () => { S.a.for = "me"; } },
        { label: "A gift 🎁", go: "g_area", set: () => { S.a.for = "gift"; } },
      ],
    },
    g_area: {
      step: 2,
      say: () => [S.a.for === "gift" ? "Nice! What does the person shave?" : "What do you want to shave?"],
      opts: () => [
        { label: "Face – clean shave", go: () => (S.a.for === "gift" ? "g_skin" : "g_handle"), set: () => { S.a.area = "face"; if (S.a.for === "gift") S.a.handle = "no"; }, kw: /face|clean|chin/i },
        { label: "Beard – lines & care", go: "g_skin", set: () => { S.a.area = "beard"; }, kw: /beard|moustache|stubble/i },
        { label: "Legs & body", go: "g_skin", set: () => { S.a.area = "body"; }, kw: /leg|body|arm|intimate/i },
      ],
    },
    g_handle: {
      step: 2,
      say: () => ["Do you already have a Gillette Fusion5 or ProGlide handle at home?"],
      opts: () => [
        { label: "Yes, I have one", go: "g_skin", set: () => { S.a.handle = "yes"; }, kw: /yes|yeah|have/i },
        { label: "No / not sure", go: "g_skin", set: () => { S.a.handle = "no"; }, kw: /no|not sure|don't/i },
      ],
    },
    g_skin: {
      step: 2,
      skipIf: () => !!S.a.skin,
      next: "g_freq",
      say: () => [S.a.for === "gift" ? "Do you know how their skin reacts to shaving?" : "How does your skin react to shaving?"],
      opts: () => [
        { label: "Sensitive / redness", go: "g_freq", set: () => { S.a.skin = "sensitive"; }, kw: /sensitive|red|irrit|burn|itch/i },
        { label: "No problems", go: "g_freq", set: () => { S.a.skin = "normal"; }, kw: /normal|fine|no problem|ok/i },
        ...(S.a.for === "gift" ? [{ label: "Not sure", go: "g_freq", set: () => { S.a.skin = "unsure"; } }] : []),
      ],
    },
    g_freq: {
      step: 2,
      skipIf: () => S.a.for === "gift" || !!S.a.freq,
      next: "rec",
      say: () => ["Last one: how often do you shave?"],
      opts: () => [
        { label: "Every day", go: "rec", set: () => { S.a.freq = "daily"; }, kw: /day|daily/i },
        { label: "A few times a week", go: "rec", set: () => { S.a.freq = "weekly"; }, kw: /week|few/i },
        { label: "Now and then", go: "rec", set: () => { S.a.freq = "rarely"; }, kw: /rare|sometimes|now and then/i },
      ],
    },

    // ----- recommend + seduce/CTA -----
    rec: {
      step: 3,
      say: () => {
        if (!S.rec) S.rec = recommend();
        const out = [];
        out.push(isMember() ? `Here's what I'd pick for you, ${first()} – ${S.rec.why}.` : `My recommendation – ${S.rec.why}.`);
        if (isMember()) signal("rec", S.rec.items.map((i) => P[i].name).join(" + "));
        return out;
      },
      after: () => {
        cards(S.rec.items);
        const total = S.rec.items.reduce((t, id) => t + P[id].price, 0);
        const hasPromo = S.rec.items.some((id) => P[id].promo);
        let line = `Together <strong>${eur(total)}</strong>.`;
        if (hasPromo && promoOn()) line += ` With your SuperPlus card you can take the <strong>2+2 free</strong> deal on blades.`;
        else if (hasPromo) line += " SuperPlus members get <strong>2+2 free</strong> on these blades this week.";
        if (S.a.freq === "daily") line += " Shaving daily, a blade lasts about a week – a bigger pack saves trips.";
        if (isMember() && !S.profile.isNew) {
          line += ` You'll earn <strong>${Math.round(total)}</strong> SuperPlus points.`;
          signal("points", "Shown as reward in the CTA");
        }
        bubble(line);
      },
      opts: () => {
        const hasPromo = S.rec.items.some((id) => P[id].promo);
        const o = [];
        if (hasPromo && promoOn()) o.push({ label: "Add with 2+2 deal ✨", primary: true, go: "checkout", run: () => addRec(true) });
        o.push({ label: "Add all to basket", primary: !(hasPromo && promoOn()), go: "checkout", run: () => addRec(false), kw: /add|buy|yes|take/i });
        if (hasPromo && !isMember()) o.push({ label: "Join SuperPlus for 2+2", go: "signup", kw: /join|superplus|sign/i });
        o.push({ label: "Too expensive", go: "o_price", kw: /expensive|price|cheap|money|cost/i });
        o.push({ label: "My skin gets irritated", go: "o_skin", kw: /irrit|sensitive|red|burn|itch/i });
        o.push({ label: "Compare options", go: "o_compare", kw: /compare|differen|vs/i });
        o.push({ label: "Not now", go: "later", kw: /later|not now|no thanks/i });
        return o;
      },
    },

    // ----- objections -----
    o_price: {
      step: 4,
      say: () => {
        const c = S.rec.cheap[0];
        const out = [`Fair point. The cheapest way to get started: <strong>${P[c].name}</strong> on its own for ${eur(P[c].price)}.`];
        const promoItem = S.rec.items.find((id) => P[id].promo);
        if (promoItem) {
          const per = (P[promoItem].price * 2) / 16;
          out.push(`Tip: with the SuperPlus 2+2 deal one ProGlide blade costs ${eur(per)} instead of ${eur(P[promoItem].price / 4)} – that's half price.`);
          if (!isMember()) out.push("SuperPlus is free and takes 30 seconds.");
        }
        out.push("And a good blade lasts 5–10 shaves if you rinse it well and let it dry.");
        return out;
      },
      after: () => cards(S.rec.cheap),
      opts: () => [
        { label: `Add ${P[S.rec.cheap[0]].name.replace("Gillette ", "")} only`, primary: true, go: "checkout", run: () => addToBasket(S.rec.cheap[0], false), kw: /add|only|cheap/i },
        ...(S.rec.items.some((id) => P[id].promo) && !isMember() ? [{ label: "Join SuperPlus for 2+2", go: "signup" }] : []),
        { label: "Back to the full set", go: "rec" },
      ],
    },
    o_skin: {
      step: 4,
      say: () => {
        S.a.skin = "sensitive";
        S.a.newSkin = true;
        const area = S.a.area;
        const swap = area === "body" ? "foamAloe" : "gelSensitive";
        S.rec.items = S.rec.items.map((id) => (P[id].type === "gel" ? swap : id));
        if (!S.rec.items.some((id) => P[id].type === "gel") && area !== "beard") S.rec.items.push(swap);
        if (area === "beard" && !S.rec.items.includes("gelSensitive")) S.rec.items.push("gelSensitive");
        if (isMember()) signal("skin → sensitive", "Profile updated from conversation (zero-party data)");
        return [
          "Irritation usually comes from three things: a dull blade, shaving dry and going against the grain.",
          `I swapped in <strong>${P[swap].name}</strong> – dermatologically tested and made against redness and burning.`,
          "3 tips: wet your skin 1 minute first · shave with the grain · change the blade after 5–10 shaves.",
        ];
      },
      after: () => cards(S.rec.items),
      opts: () => [
        { label: "Add this set", primary: true, go: "checkout", run: () => addRec(promoOn()) },
        { label: "Back", go: "rec" },
      ],
    },
    o_compare: {
      step: 4,
      say: () => ["Here's the honest comparison:"],
      after: () => {
        const ids = Array.from(new Set([S.rec.items[0], ...(S.a.area === "face" || S.a.area === "beard" ? ["fusion5", "proglide", "mach3"] : ["venus", "labsBody"])])).slice(0, 3);
        const best = { proglide: "Most comfort, sensitive skin", fusion5: "First razor, beard lines", mach3: "Best value system", venus: "Legs & body, no refills", labsBody: "Owners of a GilletteLabs razor", proglidePower: "Extra-close shave" };
        const rows = ids
          .map((id) => `<tr><th>${P[id].name.replace("Gillette ", "")}</th><td>${eur(P[id].price)}${P[id].indicative ? "*" : ""}</td><td>★ ${P[id].rating}</td><td>${best[id] || P[id].pitch}</td></tr>`)
          .join("");
        bubble(`<table class="cmp"><thead><tr><th></th><th>Price</th><th>Rating</th><th>Best for</th></tr></thead><tbody>${rows}</tbody></table>`, "bot wide");
      },
      opts: () => [
        { label: "Go with your pick", primary: true, go: "checkout", run: () => addRec(promoOn()) },
        { label: "Too expensive", go: "o_price" },
        { label: "Back", go: "rec" },
      ],
    },
    later: {
      step: 4,
      say: () => {
        if (isMember()) {
          signal("shopping list", "Saved for later instead of losing the lead");
          return S.profile.marketingConsent
            ? [`No problem, ${first()}. I saved it to your Delhaize shopping list and will send you a ${S.profile.channel.toLowerCase()} when it's time to restock.`]
            : [`No problem, ${first()}. I saved it to your Delhaize shopping list – it'll be there next time you open the app.`];
        }
        return ["No problem! You'll find everything at the shaving shelf – the blades are in the locked cases, the service desk opens them for you.", "Or come back to this chat any time."];
      },
      opts: () => [
        { label: "Actually, show me options", go: S.rec ? "rec" : isMember() ? "rec" : "g_for", set: () => { if (!S.rec && isMember() && !S.a.area) S.a = { area: S.profile.area, skin: S.profile.skin, handle: "yes" }; } },
        { label: "Start over", go: "restart" },
      ],
    },

    // ----- sign-up (guest → member: lead capture) -----
    signup: {
      step: 4,
      say: () => ["Great choice! SuperPlus is free. What's your first name?"],
      input: (txt) => {
        const name = txt.trim().split(/\s+/)[0].slice(0, 20);
        if (!name) return;
        S.profile = { name: name.charAt(0).toUpperCase() + name.slice(1), isNew: true, marketingConsent: false };
        S.mode = "member";
        signal("new member", `Guest converted to SuperPlus: ${S.profile.name}`);
        Object.entries(S.a).forEach(([k, v]) => signal(k, "Carried over from guest chat into new CRM record"));
        go("signup2");
      },
      placeholder: "Type your first name…",
    },
    signup2: {
      step: 4,
      say: () => [`Welcome to SuperPlus, ${first()}! 🎉 Your 2+2 deal is unlocked.`, "May we remind you when your blades are probably running out? (You can stop it any time.)"],
      opts: () => [
        { label: "Yes, remind me", primary: true, go: () => (S.a.fulfil ? "thanks2" : "rec"), set: () => { S.profile.marketingConsent = true; S.profile.channel = "E-mail"; signal("marketingConsent = yes", "Explicit opt-in (GDPR)"); } },
        { label: "No thanks", go: () => (S.a.fulfil ? "end" : "rec"), set: () => { signal("marketingConsent = no", "Respected – no reminders"); } },
      ],
    },

    // ----- convert -----
    checkout: {
      step: 5,
      say: () => {
        const out = [];
        out.push(`Your basket: <strong>${basketCount()} item${basketCount() === 1 ? "" : "s"}, ${eur(basketTotal())}</strong>. How would you like to get it?`);
        if (isMember() && S.profile.store) signal("home store", `Pre-filled pick-up: ${S.profile.store}`);
        return out;
      },
      after: () => showBasket(),
      opts: () => {
        const store = isMember() && S.profile.store ? S.profile.store.replace("Delhaize ", "") : "your Delhaize";
        const o = [];
        if (S.entry === "shelf") o.push({ label: "Pick up now at the service desk", primary: true, go: "thanks", set: () => { S.a.fulfil = "service desk – now"; } });
        o.push({ label: `Collect&Go at ${store}`, primary: S.entry !== "shelf", go: "thanks", set: () => { S.a.fulfil = "Collect&Go " + store; } });
        o.push({ label: "Home delivery", go: "thanks", set: () => { S.a.fulfil = "home delivery"; } });
        o.push({ label: "Keep shopping", go: () => (S.rec ? "rec" : "g_for") });
        return o;
      },
    },

    // ----- thank & follow up -----
    thanks: {
      step: 6,
      say: () => {
        const out = [];
        const where = S.a.fulfil === "service desk – now" ? "Show this chat at the service desk – they'll hand you your order, no waiting at the locked case." : S.a.fulfil === "home delivery" ? "It's on its way – you'll get a delivery slot by e-mail." : "We'll message you when it's ready for pick-up (usually within 2 hours).";
        out.push(`Thank you${first() ? ", " + first() : ""}! ✅ Order confirmed. ${where}`);
        if (isMember() && !S.profile.isNew) {
          out.push(`+${Math.round(basketTotal())} SuperPlus points – you now have ${S.profile.points + Math.round(basketTotal())}.`);
          signal("points", "Updated after purchase");
        }
        if (isMember() && S.profile.marketingConsent) {
          const days = S.profile.replenishCycleDays || 35;
          out.push(`I'll send you a ${(S.profile.channel || "message").toLowerCase()} in about ${Math.round(days / 7)} weeks when your blades are due. 🔁`);
          signal("follow-up", `Replenishment reminder scheduled in ~${days} days`);
        }
        out.push("One quick question: was this chat helpful?");
        return out;
      },
      opts: () => {
        const o = [];
        if (isMember() && !S.profile.marketingConsent) o.push({ label: "Remind me when blades run out", go: "thanks2", set: () => { S.profile.marketingConsent = true; signal("marketingConsent = yes", "Opt-in given in chat (GDPR)"); } });
        if (!isMember()) o.push({ label: "Join SuperPlus to save next time", go: "signup" });
        o.push({ label: "👍 Helpful", go: "end", set: () => { S.a.rating = "👍"; } });
        o.push({ label: "👎 Not really", go: "end", set: () => { S.a.rating = "👎"; } });
        return o;
      },
    },
    thanks2: {
      step: 6,
      say: () => [`Done – I'll remind you by ${(S.profile.channel || "e-mail").toLowerCase()}. Was this chat helpful?`],
      opts: () => [
        { label: "👍 Helpful", go: "end", set: () => { S.a.rating = "👍"; } },
        { label: "👎 Not really", go: "end", set: () => { S.a.rating = "👎"; } },
      ],
    },
    end: {
      step: 6,
      say: () => [S.a.rating === "👎" ? "Thanks for the honest feedback – a colleague will look at this chat to improve me." : "Thanks! Enjoy your shave. 🪒", "Want to try another path? Start over and pick a different customer."],
      opts: () => [{ label: "↻ Start over", primary: true, go: "restart" }],
    },
  };

  // ---------- engine ----------
  async function go(id) {
    if (id === "restart") return restart();
    let node = NODES[id];
    while (node && node.skipIf && node.skipIf()) {
      id = node.next;
      node = NODES[id];
    }
    S.node = id;
    setStep(node.step);
    setOptions([]);
    setInput(node);
    for (const m of node.say()) {
      await typing();
      bubble(m);
    }
    if (node.after) {
      await typing();
      node.after();
    }
    setOptions(node.opts ? node.opts() : []);
    renderProfile();
    scrollDown();
  }
  function choose(o) {
    bubble(esc(o.label), "user");
    if (o.set) o.set();
    if (o.run) o.run();
    if (S.mode === "guest") renderProfile();
    go(typeof o.go === "function" ? o.go() : o.go);
  }
  function loginAs(pid) {
    const p = CRM.find((c) => c.id === pid);
    S.mode = "member";
    S.profile = JSON.parse(JSON.stringify(p));
    S.a = {};
    S.rec = null;
    bubble(`Logged in as ${esc(p.name)} ${esc(p.surname)}`, "user");
    signal("login", `SuperPlus card → CRM record loaded (${p.name}, ${p.age}, ${p.city})`);
    go("m_welcome");
  }

  // free text: node input > option keywords > option label > global intents
  function setInput(node) {
    $("#text").placeholder = (node && node.placeholder) || "Type a message…";
  }
  function onText(txt) {
    txt = txt.trim();
    if (!txt) return;
    const node = NODES[S.node];
    if (node && node.input) {
      bubble(esc(txt), "user");
      return node.input(txt);
    }
    const opts = node && node.opts ? node.opts() : [];
    const kws = node && node.kw ? node.kw() : [];
    for (const k of kws) if (k.re.test(txt)) { bubble(esc(txt), "user"); return k.run(); }
    let hit = opts.find((o) => o.kw && o.kw.test(txt)) || opts.find((o) => o.label.toLowerCase().includes(txt.toLowerCase()));
    if (hit) {
      bubble(esc(txt), "user");
      if (hit.set) hit.set();
      if (hit.run) hit.run();
      return go(typeof hit.go === "function" ? hit.go() : hit.go);
    }
    bubble(esc(txt), "user");
    if (/restart|start over|reset/i.test(txt)) return restart();
    if (/basket|cart/i.test(txt)) return showBasket();
    if (/human|person|staff|help/i.test(txt))
      return bubble("A Delhaize colleague at the service desk is happy to help in person. In the chat, just tap one of the options below. 🙂");
    if (S.rec && /expensive|price|cheap/i.test(txt)) return go("o_price");
    if (S.rec && /irrit|sensitive|red|burn/i.test(txt)) return go("o_skin");
    bubble("Sorry, I didn't quite get that. Please tap one of the options below. 👇");
  }

  function restart() {
    reset();
    log().innerHTML = "";
    $("#signals").innerHTML = "";
    $("#signals-empty").hidden = false;
    renderBasket();
    renderProfile();
    go("start");
  }

  // ---------- wiring ----------
  document.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      addToBasket(add.dataset.add, false);
      add.textContent = "Added ✓";
      add.disabled = true;
      if (!document.querySelector("#options [data-checkout]") && S.node !== "checkout") {
        const b = document.createElement("button");
        b.className = "opt primary";
        b.dataset.checkout = "1";
        b.textContent = "Go to checkout";
        b.addEventListener("click", () => choose({ label: "Go to checkout", go: "checkout" }));
        $("#options").prepend(b);
      }
      return;
    }
    const per = e.target.closest("[data-persona]");
    if (per && S.node === "login") return loginAs(per.dataset.persona);
  });
  $("#form").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("#text");
    onText(t.value);
    t.value = "";
  });
  $("#basket-btn").addEventListener("click", showBasket);
  $("#restart").addEventListener("click", restart);
  $("#crm-toggle").addEventListener("click", () => {
    const open = document.body.classList.toggle("crm-open");
    $("#crm-toggle").setAttribute("aria-expanded", String(open));
  });
  $("#crm-close").addEventListener("click", () => {
    document.body.classList.remove("crm-open");
    $("#crm-toggle").setAttribute("aria-expanded", "false");
  });
  const entrySel = $("#entry");
  entrySel.value = params.get("src") === "shelf" ? "shelf" : "web";
  entrySel.addEventListener("change", () => {
    const u = new URL(location.href);
    if (entrySel.value === "shelf") u.searchParams.set("src", "shelf");
    else u.searchParams.delete("src");
    history.replaceState(null, "", u);
    params.set("src", entrySel.value);
    restart();
  });

  restart();
})();
