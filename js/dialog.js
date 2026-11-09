// Dialog manager: frame-based. Every message fills what it can, then the bot asks only what is still missing
// or jumps to the answer. Service requests (refunds, orders, complaints …) are recognised from typed text.
import { parse, SERVICE_INTENTS } from "./nlu.js";
import { recommend, cheapest, compatibility, summary, styleName } from "./recommend.js";
import { BY_ID, CATALOG } from "./catalog.js";
import { STYLES } from "./ar.js";

const eur = (n) => "€" + n.toFixed(2).replace(".", ",");
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rnd = (n) => Math.floor(Math.random() * 10 ** n).toString().padStart(n, "0");
const PHONE = "0800 95 713";
const HELP_URL = "https://help.delhaize.be/";

// product name aliases for the NLU
const ALIASES = [
  ["proglideBlades", /\bpro ?glide( blades?| refills?)?\b/], ["fusion5Razor", /\bfusion ?5?( razor)?\b/], ["mach3Blades", /\bmach ?3\b/],
  ["skinguardRazor", /\bskin ?guard\b/], ["labsHeatedRazor", /\bheated\b/], ["labsExfoliatingRazor", /\bexfoliat\w*\b/],
  ["kingCBeardTrimmer", /\b(beard )?trimmer\b/], ["kingCStyleMaster", /\bstyle ?master\b/], ["kingCBeardOil", /\bbeard oil\b/],
  ["kingCBeardFaceWash", /\b(beard|face) wash\b/], ["skinAfterShaveBalm", /\b(after ?shave|balm)\b/], ["blue3Disposable", /\bblue ?3|disposables?\b/],
  ["venusSmoothSensitive", /\bvenus\b/], ["fusion5SensitiveGel", /\b(shaving |shave )?gel\b/], ["sensitiveShaveFoam", /\bfoam\b/],
];

export const STEPS = ["Welcome", "Needs", "Routine", "Questions", "Checkout", "Follow-up"];

export class Bot {
  constructor(ui, crm, opts = {}) {
    this.ui = ui;
    this.crm = crm;
    this.opts = opts;
    this.reset();
  }
  reset() {
    this.s = { mode: null, profile: null, slots: {}, rec: null, basket: [], pending: null, entry: this.opts.entry || "web", photo: null, rating: null };
  }
  get member() { return this.s.mode === "member"; }
  get name() { return this.s.profile?.name || ""; }
  sig(field, use) { this.ui.signal(field, use); }

  // ---------- entry points from the UI ----------
  async start() {
    this.ui.step(1);
    const shelf = this.s.entry === "shelf";
    await this.ui.bot(shelf ? "Hi! 👋 You scanned the code at the <b>shaving shelf</b>. I'm Sam, your Gillette shave expert." : "Hi! 👋 I'm Sam, your Gillette shave expert at Delhaize.");
    await this.ui.bot("Tell me in your own words what you need – or pick a start below. Log in with <b>SuperPlus</b> for personal offers.");
    this.ui.landing();
    this.menu(true);
  }
  menu(first) {
    const o = [];
    if (!this.s.mode) o.push({ label: "🔑 Log in with SuperPlus", act: "login", primary: true });
    if (first) return this.ui.options(o);
    o.push({ label: "📷 Skin & beard check", act: "photo" }, { label: "🧔 Try beard styles", act: "ar" }, { label: "Find my razor", act: "guest" });
    if (!first) o.push({ label: "🛒 Basket", act: "basket" });
    this.ui.options(o);
  }

  async choose(opt) {
    if (opt.label) this.ui.user(opt.label);
    await this.act(opt.act, opt.arg);
  }

  async act(act, arg) {
    const s = this.s;
    switch (act) {
      case "login": return this.login();
      case "persona": return this.loginAs(arg);
      case "guest": if (!s.mode) { s.mode = "guest"; this.sig("session", "Guest – no CRM record, learns from the chat"); } return this.consult();
      case "set": Object.assign(s.slots, arg); this.ui.profile(this.s); return this.consult();
      case "photo": return this.photoStart();
      case "ar": return this.arStart(arg);
      case "useStyle": return this.useStyle(arg);
      case "beardIs": return this.photoConfirm(arg);
      case "goal": return this.photoGoal(arg);
      case "addRoutine": return this.addRoutine(arg);
      case "add": this.addItems([arg], false); return this.afterAdd();
      case "cheaper": return this.cheaper();
      case "irritation": return this.irritation();
      case "compare": return this.compare();
      case "later": return this.later();
      case "checkout": return this.checkout();
      case "fulfil": return this.thanks(arg);
      case "consent": return this.consent(arg);
      case "rate": return this.rate(arg);
      case "signup": return this.signup();
      case "basket": return this.showBasket(true);
      case "menu": this.ui.step(1); await this.ui.bot("What else can I do for you? Type anything – or pick:"); return this.menu();
      case "restart": return this.ui.restart();
      case "member": return this.memberAct(arg);
      case "svc": return this.service(arg.flow, arg);
      case "typeHint": this.ui.focusInput(arg); return;
      default: return this.fallback();
    }
  }

  // ---------- free text ----------
  async onText(text) {
    const s = this.s;
    this.ui.user(esc(text));
    // AI mode (claude.ai artifact): Claude handles the turn with page tools; engine is the fallback.
    if (this.opts.ai && this.opts.ai.available()) {
      const ok = await this.opts.ai.turn(text, this).catch(() => false);
      if (ok) return;
    }
    const p = parse(text, { aliases: ALIASES });
    // pending free-text input (name, order number, description)
    if (s.pending?.input && !(p.top && (SERVICE_INTENTS.includes(p.top) || p.top === "restart") && p.intents[0].score >= 2.5 && s.pending.input !== "orderNo")) {
      const pend = s.pending; s.pending = null;
      return this.onInput(pend, text, p);
    }
    const before = { ...s.slots };
    const learned = this.applyEntities(p.entities);
    const top = p.top;
    if (top && SERVICE_INTENTS.includes(top)) return this.service(top, { p });
    switch (top) {
      case "restart": return this.ui.restart();
      case "login": return this.login();
      case "photo": return this.photoStart();
      case "ar": return this.arStart(p.entities.style);
      case "basket": return /\b(remove|delete)\b/.test(p.fixed) ? this.removeFromBasket(p) : this.showBasket(true);
      case "compat": return this.compat(p);
      case "compare": return this.compare(p.entities.products);
      case "cheaper": if (s.rec) return this.cheaper(); s.slots.budget = s.slots.budget || "low"; break;
      case "price": return this.price(p);
      case "promo": return this.promo();
      case "store": return this.store();
      case "thanks": await this.ui.bot(`You're welcome${this.name ? ", " + this.name : ""}! 😊 Anything else?`); return this.menu();
      case "bye": await this.ui.bot("Thanks for chatting – enjoy your shave! 🪒"); return this.ui.options([{ label: "↻ Start over", act: "restart", primary: true }]);
      case "yes": return this.yesNo(true);
      case "no": return this.yesNo(false);
      case "greeting": if (!learned.length) { await this.ui.bot(`Hi${this.name ? " " + this.name : ""}! What can I do for you – a new razor, a beard routine, or help with an order?`); return this.menu(); }
    }
    if (learned.length || top === "recommend" || top === "cheaper") {
      if (!s.mode) { s.mode = "guest"; this.sig("session", "Guest – details taken from the typed message"); }
      if (learned.length) {
        const sum = summary(s.slots);
        await this.ui.bot(`Got it: <b>${esc(sum.join(" · "))}</b>.`);
        for (const k of learned) this.sig(k, `Understood from text: “${k} = ${Array.isArray(s.slots[k]) ? s.slots[k].join(", ") : s.slots[k]}”`);
        this.ui.profile(s);
      }
      // already recommended and the shopper refines → rebuild
      if (s.rec && learned.length) return this.recommendNow(true);
      return this.consult();
    }
    return this.fallback(p);
  }

  applyEntities(e) {
    const s = this.s.slots;
    const keys = [];
    const set = (k, v) => { if (v !== undefined && s[k] !== v) { s[k] = v; keys.push(k); } };
    set("for", e.for); set("recipient", e.recipient); set("gender", e.gender); set("area", e.area); set("skin", e.skin);
    if (e.concerns) { const c = Array.from(new Set([...(s.concerns || []), ...e.concerns])); if (c.length !== (s.concerns || []).length) { s.concerns = c; keys.push("concerns"); } }
    set("owned", e.owned); set("handle", e.handle); set("style", e.style); set("budget", e.budget); set("freq", e.freq); set("wantType", e.wantType);
    if (e.wantType === "oil" || e.wantType === "trimmer") set("area", s.area || "beard");
    if (["blades", "razor", "gel", "care"].includes(e.wantType) && !s.area) set("area", "face");
    if ((e.handle === "yes" || e.owned) && !s.for) set("for", "me");
    if (e.style && !s.area) set("area", e.style === "clean" ? "face" : "beard");
    if (e.recipient && e.gender === "f" && !s.area) { /* ask area */ }
    return keys.filter((k) => !["recipient", "gender"].includes(k) || keys.length === 1 ? true : true);
  }

  async onInput(pend, text, p) {
    const s = this.s;
    if (pend.input === "name") {
      const name = text.trim().split(/\s+/)[0].replace(/[^\p{L}-]/gu, "").slice(0, 20);
      if (!name) { s.pending = pend; return this.ui.bot("Just your first name, please 🙂"); }
      s.profile = { name: name.charAt(0).toUpperCase() + name.slice(1), isNew: true, consent: false, channel: "E-mail" };
      s.mode = "member";
      this.sig("new member", `Guest converted to SuperPlus: ${s.profile.name}`);
      Object.keys(s.slots).forEach((k) => this.sig(k, "Carried over from the guest chat into the new CRM record"));
      this.ui.profile(s);
      await this.ui.bot(`Welcome to SuperPlus, ${esc(s.profile.name)}! 🎉 Your <b>2+2 deal</b> is unlocked.`);
      await this.ui.bot("May we remind you when your blades are probably running out? You can stop it any time.");
      return this.ui.options([{ label: "Yes, remind me", act: "consent", arg: "signup-yes", primary: true }, { label: "No thanks", act: "consent", arg: "signup-no" }]);
    }
    if (pend.input === "orderNo") {
      const no = p.entities.orderNo || (text.match(/[a-z]{0,3}-?\d{4,}/i) || [])[0];
      if (!no) { s.pending = pend; return this.ui.bot("I couldn't find an order number in that. It's on your confirmation e-mail, e.g. <b>DL-731554</b>. Or type “don't know”."); }
      return this.service(pend.flow, { ...pend, orderNo: no.toUpperCase() });
    }
    if (pend.input === "describe") return this.service(pend.flow, { ...pend, description: text });
    if (pend.input === "product") return this.service(pend.flow, { ...pend, product: (p.entities.products || [])[0], productText: text });
    return this.fallback(p);
  }

  async fallback(p) {
    const sugg = [];
    const second = p?.intents?.[0]?.name;
    if (second) sugg.push(second);
    await this.ui.bot("Sorry, I didn't quite get that. You can ask me things like <i>“razor for sensitive skin under €20”</i>, <i>“where is my order?”</i> or <i>“I want a refund”</i>.");
    this.menu();
  }

  async yesNo(yes) {
    const s = this.s;
    if (s.pending?.confirm) { const c = s.pending.confirm; s.pending = null; return this.act(yes ? c.yes : c.no, yes ? c.yesArg : c.noArg); }
    if (s.rec && s.step === 3) return yes ? this.addRoutine(this.promoOn()) : this.later();
    if (!yes) { await this.ui.bot("No problem. Anything else I can help with?"); return this.menu(); }
    return this.consult();
  }

  // ---------- login & members ----------
  async login() {
    this.ui.step(1);
    await this.ui.bot("Demo: pick a SuperPlus customer – each one is a different CRM profile.");
    this.ui.personas(this.crm);
    this.ui.options([{ label: "Continue as guest", act: "guest" }]);
  }
  async loginAs(id) {
    const p = this.crm.find((c) => c.id === id);
    const s = this.s;
    s.mode = "member";
    s.profile = JSON.parse(JSON.stringify(p));
    s.slots = { for: "me", area: p.area, skin: p.skin, owned: p.owned, handle: p.handle, freq: p.freq, style: p.style, gender: p.gender };
    Object.keys(s.slots).forEach((k) => s.slots[k] === undefined && delete s.slots[k]);
    s.rec = null;
    this.ui.user(`Logged in as ${p.name} ${p.surname}`);
    this.sig("login", `SuperPlus card → CRM record loaded (${p.name}, ${p.age}, ${p.city})`);
    this.ui.profile(s);
    const lp = BY_ID[p.lastPurchase.product];
    if (id === "lucas") {
      this.sig("lastPurchase 34 d / cycle 35 d", "Replenishment trigger: blades due");
      this.sig("owned = Fusion5 handle", "ProGlide refills fit → offer 2+2");
      await this.ui.bot(`Welcome back, ${p.name}! 👋`);
      await this.ui.bot(`Your last <b>${lp.short}</b> were ${p.lastPurchase.daysAgo} days ago – you usually restock every ~5 weeks, so they're probably getting dull.`);
      await this.ui.bot(`Good timing: <b>2+2 free</b> on ProGlide this week with your SuperPlus card – 16 blades for ${eur(lp.price * 2)} (${eur((lp.price * 2) / 16)} per blade).`);
      return this.ui.options([{ label: "Restock my usual", act: "member", arg: "restock", primary: true }, { label: "📷 Check my skin first", act: "photo" }, { label: "Show me something new", act: "member", arg: "new" }]);
    }
    if (id === "marc") {
      this.sig("lastPurchase 61 d / cycle 60 d", "Replenishment trigger: Mach3 + beard oil due");
      this.sig("area = beard, razor = Mach3", "Upgrade idea: King C. trimmer for the short beard");
      await this.ui.bot(`Hi ${p.name}, good to see you! 👋`);
      await this.ui.bot(`Your Mach3 blades and King C. Gillette beard oil from 9 September are probably running out – that was ${p.lastPurchase.daysAgo} days ago.`);
      await this.ui.bot("Reorder the usual with home delivery, or shall I show you how to keep that short beard sharper?");
      return this.ui.options([{ label: "Reorder the usual", act: "member", arg: "reorder", primary: true }, { label: "Upgrade my beard routine", act: "member", arg: "upgrade" }, { label: "🧔 Try other styles", act: "ar" }]);
    }
    this.sig("lastPurchase 22 d / cycle 45 d", "No refill push – too early, avoids spam");
    this.sig("household + occasion", "Gift idea for her partner (December)");
    await this.ui.bot(`Hi ${p.name}! 👋`);
    await this.ui.bot("Your Venus razor from 18 October should last a few more weeks – no need to restock yet.");
    await this.ui.bot("December is coming though: looking for a gift for <b>Thomas</b>? He has a beard, and King C. Gillette sets are popular.");
    return this.ui.options([{ label: "Yes, gift for Thomas 🎁", act: "member", arg: "gift", primary: true }, { label: "Something for me", act: "member", arg: "me" }]);
  }
  async memberAct(a) {
    const s = this.s, p = s.profile;
    if (a === "restock") { s.rec = this.fixedRec(["fusion5SensitiveGel", "proglideBlades"], "your usual: ProGlide refills for your Fusion5 handle + your sensitive gel"); return this.recommendNow(false, true); }
    if (a === "reorder") { s.rec = this.fixedRec(["mach3Blades", "kingCBeardOil"], "your usual: Mach3 refills + King C. Gillette beard oil"); return this.recommendNow(false, true); }
    if (a === "upgrade") { s.slots = { ...s.slots, area: "beard", style: "short" }; return this.recommendNow(); }
    if (a === "new") { s.slots.wantType = undefined; s.slots.owned = undefined; s.slots.handle = undefined; return this.consult(); }
    if (a === "gift") { s.slots = { for: "gift", recipient: "partner", gender: "m", area: "beard", style: "short", skin: "normal" }; this.sig("household.partner", "Gift recommendation for Thomas"); return this.recommendNow(); }
    if (a === "me") { s.slots = { for: "me", gender: "f", area: "body", skin: p.skin }; return this.consult(); }
  }
  fixedRec(ids, why) {
    const steps = ids.map((id) => { const it = BY_ID[id]; return { role: it.role, label: { prep: "Prep", blades: "Shave", shave: "Shave", care: "Care", trim: "Trim" }[it.role] || "Item", item: it, alt: null, why: "" }; });
    return { steps, total: steps.reduce((t, x) => t + x.item.price, 0), notes: [], summary: [why], fixed: true, why };
  }

  // ---------- consultation ----------
  async consult() {
    const s = this.s, sl = s.slots;
    this.ui.step(2);
    if (!s.mode) { s.mode = "guest"; this.sig("session", "Guest – no CRM record, learns from the chat"); }
    if (!sl.for) {
      await this.ui.bot("Let's find your match. Who are we shopping for?");
      return this.ui.options([{ label: "For me", act: "set", arg: { for: "me" } }, { label: "A gift 🎁", act: "set", arg: { for: "gift" } }]);
    }
    if (!sl.area) {
      await this.ui.bot(sl.for === "gift" ? "Nice! What does the person shave?" : "What do you want to shave or groom?");
      return this.ui.options([
        { label: "Face – clean shave", act: "set", arg: { area: "face" } },
        { label: "Beard – trim & care", act: "set", arg: { area: "beard" } },
        { label: "Legs & body", act: "set", arg: { area: "body" } },
        { label: "Head", act: "set", arg: { area: "head" } },
      ]);
    }
    if (sl.area === "beard" && !sl.style) {
      await this.ui.bot(sl.for === "gift" ? "What kind of beard does he have?" : "Which beard do you have – or want?");
      return this.ui.options([
        { label: "Stubble", act: "set", arg: { style: "stubble" } }, { label: "Short beard", act: "set", arg: { style: "short" } },
        { label: "Full beard", act: "set", arg: { style: "full" } }, ...(sl.for === "me" ? [{ label: "🧔 Not sure – try styles", act: "ar" }] : []),
      ]);
    }
    if (sl.area === "body" && sl.for === "me" && !sl.gender) {
      await this.ui.bot("Which range should I show you?");
      return this.ui.options([{ label: "GilletteLabs Body (men)", act: "set", arg: { gender: "m" } }, { label: "Venus (women)", act: "set", arg: { gender: "f" } }]);
    }
    if ((sl.area === "face" || sl.area === "head") && sl.for !== "gift" && !sl.handle) {
      await this.ui.bot("Do you already have a Gillette razor handle at home?");
      return this.ui.options([
        { label: "Yes – Fusion5 / ProGlide", act: "set", arg: { handle: "yes", owned: "fusion5" } },
        { label: "Yes – Mach3", act: "set", arg: { handle: "yes", owned: "mach3" } },
        { label: "No / not sure", act: "set", arg: { handle: "no" } },
      ]);
    }
    if (!sl.skin) {
      await this.ui.bot(sl.for === "gift" ? "Do you know how their skin reacts to shaving?" : "How does your skin react to shaving?");
      return this.ui.options([
        { label: "Sensitive / redness", act: "set", arg: { skin: "sensitive" } },
        { label: "No problems", act: "set", arg: { skin: "normal" } },
        sl.for === "gift" ? { label: "Not sure", act: "set", arg: { skin: "sensitive" } } : { label: "📷 Check it with a photo", act: "photo" },
      ]);
    }
    return this.recommendNow();
  }

  promoOn() { return this.member; }

  async recommendNow(refine = false, keep = false) {
    const s = this.s;
    this.ui.step(3);
    s.step = 3;
    if (!keep) s.rec = recommend(s.slots);
    const r = s.rec;
    if (!r.steps.length) { await this.ui.bot("Hmm, I couldn't find a fitting product for that combination. Could you tell me a bit more?"); return this.menu(); }
    const head = r.fixed ? `Here's ${r.why}.` : refine ? "Updated – here's your new routine:" : `${this.member ? `Here's your routine, ${esc(this.name)}` : "Here's your personal routine"}${s.photo ? " – based on your photo and answers" : ""}:`;
    await this.ui.bot(head);
    if (this.member) this.sig("routine", r.steps.map((x) => x.item.short).join(" + "));
    this.ui.routine(r, { promo: this.promoOn(), member: this.member });
    const hasPromo = r.steps.some((x) => x.item.promo);
    let line = `Together <b>${eur(r.total)}</b>.`;
    if (hasPromo && this.promoOn()) line += " Your SuperPlus card gets <b>2+2 free</b> on the blades.";
    else if (hasPromo) line += " SuperPlus members get <b>2+2 free</b> on these blades this week.";
    if (this.member && !s.profile.isNew) { line += ` You'll earn <b>${Math.round(r.total)}</b> SuperPlus points.`; this.sig("points", "Shown as reward next to the CTA"); }
    for (const n of r.notes) line += " " + esc(n);
    await this.ui.bot(line);
    const o = [];
    if (hasPromo && this.promoOn()) o.push({ label: "Add routine with 2+2 ✨", act: "addRoutine", arg: true, primary: true });
    o.push({ label: "Add routine to basket", act: "addRoutine", arg: false, primary: !(hasPromo && this.promoOn()) });
    if (hasPromo && !this.member) o.push({ label: "Join SuperPlus for 2+2", act: "signup" });
    o.push({ label: "Cheaper option", act: "cheaper" }, { label: "Compare", act: "compare" });
    if (s.slots.area === "beard" || s.slots.style) o.push({ label: "🧔 Try styles", act: "ar" });
    if (!s.photo && s.slots.for !== "gift" && s.slots.area !== "body") o.push({ label: "📷 Check with photo", act: "photo" });
    o.push({ label: "Not now", act: "later" });
    this.ui.options(o);
    this.ui.hint("Tip: type to refine, e.g. “cheaper”, “I have a Mach3” or “my skin gets red”.");
  }

  // ---------- basket ----------
  addItems(ids, deal) {
    for (const id of ids) {
      const p = BY_ID[id];
      const useDeal = deal && p.promo && this.promoOn();
      const qty = useDeal ? 4 : 1;
      const total = useDeal ? p.price * 2 : p.price;
      this.s.basket.push({ id, qty, total, label: useDeal ? `${p.short} – 2+2 deal (4 packs)` : p.short });
      this.ui.sys(`Added: <b>${esc(useDeal ? p.short + " – 2+2 deal" : p.short)}</b> (${eur(total)})`);
    }
    this.ui.basket(this.s.basket);
  }
  async addRoutine(deal) { this.addItems(this.s.rec.steps.map((x) => x.item.id), deal); return this.checkout(); }
  async afterAdd() { this.ui.options([{ label: "Go to checkout", act: "checkout", primary: true }, { label: "Keep shopping", act: "menu" }]); }
  async showBasket(withOptions) {
    const b = this.s.basket;
    if (!b.length) { await this.ui.bot("Your basket is empty for now."); return withOptions && this.menu(); }
    this.ui.basketCard(b);
    if (withOptions) this.ui.options([{ label: "Go to checkout", act: "checkout", primary: true }, { label: "Keep shopping", act: "menu" }]);
  }
  async removeFromBasket(p) {
    const b = this.s.basket;
    const target = (p.entities.products || [])[0];
    let i = target ? b.findIndex((x) => x.id === target) : -1;
    if (i < 0 && p.entities.wantType) i = b.findIndex((x) => BY_ID[x.id].type === p.entities.wantType || BY_ID[x.id].role === ({ gel: "prep", care: "care" }[p.entities.wantType]));
    if (i < 0) i = b.length - 1;
    if (i < 0) return this.ui.bot("Your basket is already empty.");
    const [gone] = b.splice(i, 1);
    this.ui.basket(b);
    await this.ui.bot(`Removed <b>${esc(gone.label)}</b>.`);
    return this.showBasket(true);
  }

  // ---------- objections & questions ----------
  async cheaper() {
    const s = this.s; this.ui.step(4);
    const c = cheapest(s.slots);
    await this.ui.bot(`Fair point. The cheapest way to get started: <b>${esc(c.short)}</b> for ${eur(c.price)}.`);
    const blades = (s.rec?.steps || []).find((x) => x.item.promo);
    if (blades) await this.ui.bot(`Tip: with the SuperPlus 2+2 deal one ProGlide blade costs ${eur((blades.item.price * 2) / 16)} instead of ${eur(blades.item.price / 4)} – half price.${this.member ? "" : " SuperPlus is free and takes 30 seconds."}`);
    this.ui.products([c.id]);
    const o = [{ label: `Add ${c.short}`, act: "add", arg: c.id, primary: true }];
    if (blades && !this.member) o.push({ label: "Join SuperPlus for 2+2", act: "signup" });
    if (s.rec) o.push({ label: "Back to my routine", act: "set", arg: {} });
    this.ui.options(o);
  }
  async irritation() {
    const s = this.s;
    s.slots.skin = "sensitive"; s.slots.concerns = Array.from(new Set([...(s.slots.concerns || []), "irritation"]));
    if (this.member) this.sig("skin → sensitive", "Profile updated from the conversation (zero-party data)");
    await this.ui.bot("Irritation usually comes from three things: a dull blade, shaving dry, and going against the grain.");
    await this.ui.bot("3 tips: wet your skin for a minute first · shave with the grain · change the blade after 5–10 shaves. I've switched your routine to sensitive-skin products:");
    return this.recommendNow(true);
  }
  async compare(products) {
    const s = this.s; this.ui.step(4);
    let ids = (products || []).filter((id) => BY_ID[id]);
    if (ids.length < 2) {
      const area = s.slots.area || "face";
      ids = area === "beard" ? ["kingCBeardTrimmer", "kingCStyleMaster", "fusionOneHybrid"] : area === "body" ? ["venusSmoothSensitive", "venusComfortGlide", "labsBodyIntimateRazor"] : ["proglideRazor", "fusion5Razor", "skinguardRazor", "mach3Razor"];
      if (s.rec) { const main = s.rec.steps.find((x) => ["shave", "blades", "trim"].includes(x.role))?.item.id; if (main && !ids.includes(main)) ids = [main, ...ids].slice(0, 4); }
    }
    await this.ui.bot("Here's the honest comparison:");
    this.ui.compare(ids.slice(0, 4));
    const o = [];
    if (s.rec) o.push({ label: "Add my routine", act: "addRoutine", arg: this.promoOn(), primary: true });
    ids.slice(0, 3).forEach((id) => o.push({ label: `Add ${BY_ID[id].short}`, act: "add", arg: id }));
    this.ui.options(o);
  }
  async later() {
    const s = this.s; this.ui.step(4);
    if (this.member) {
      this.sig("shopping list", "Saved for later instead of losing the lead");
      await this.ui.bot(s.profile.consent ? `No problem, ${esc(this.name)}. I saved it to your Delhaize shopping list and will remind you via ${s.profile.channel.toLowerCase()} when it's time.` : `No problem, ${esc(this.name)}. I saved it to your Delhaize shopping list.`);
    } else await this.ui.bot("No problem! You'll find everything in the shaving aisle – the blades are in the locked cases, the service desk opens them for you.");
    this.menu();
  }
  async compat(p) {
    const prods = p.entities.products || [];
    const owned = p.entities.owned;
    const names = { mach3: "Mach3", proglide: "ProGlide", fusion5: "Fusion5", labs: "GilletteLabs", skinguard: "SkinGuard", venus: "Venus" };
    const mentioned = Object.keys(names).filter((k) => new RegExp(`\\b${k === "fusion5" ? "fusion ?5?" : k === "proglide" ? "pro ?glide" : k === "mach3" ? "mach ?3" : k}\\b`).test(p.fixed));
    if (mentioned.length >= 2) {
      const ok = compatibility(mentioned[0], mentioned[1]);
      await this.ui.bot(ok ? `Yes 👍 <b>${names[mentioned[0]]}</b> and <b>${names[mentioned[1]]}</b> share the same click system – the refills fit each other's handles (except the battery-powered ProGlide Power, which takes Power refills).` : `No – <b>${names[mentioned[0]]}</b> and <b>${names[mentioned[1]]}</b> use different systems, so the blades don't fit. Fusion5 and ProGlide refills are interchangeable; Mach3 has its own.`);
    } else await this.ui.bot("Quick guide: <b>Fusion5 and ProGlide</b> refills fit each other's handles · <b>Mach3</b> refills fit only Mach3 handles · <b>GilletteLabs</b> and <b>SkinGuard</b> have their own blades. Which handle do you have?");
    if (owned) { this.s.slots.owned = owned; this.s.slots.handle = "yes"; }
    this.ui.options([{ label: "Show me refills", act: "set", arg: { wantType: "blades", area: this.s.slots.area || "face", handle: "yes", owned: owned || mentioned[0] || "fusion5" } }, { label: "Something else", act: "menu" }]);
  }
  async price(p) {
    const ids = p.entities.products || [];
    if (ids.length) { const it = BY_ID[ids[0]]; await this.ui.bot(`<b>${esc(it.short)}</b> costs ${eur(it.price)}${it.verified ? " at Delhaize" : " (indicative price)"}.${it.promo ? ` With SuperPlus: ${it.promo}.` : ""}`); this.ui.products([it.id]); return this.menu(); }
    if (this.s.rec) { await this.ui.bot(`Your routine comes to <b>${eur(this.s.rec.total)}</b>. Want a cheaper option?`); this.s.pending = { confirm: { yes: "cheaper", no: "menu" } }; return this.ui.options([{ label: "Cheaper option", act: "cheaper" }, { label: "Add routine", act: "addRoutine", arg: this.promoOn(), primary: true }]); }
    await this.ui.bot("Prices start at under €10 for disposables and go up to premium GilletteLabs razors. Tell me what you need and your budget, e.g. “razor under €20”.");
  }
  async promo() {
    await this.ui.bot(`This week (4–18 Nov) SuperPlus members get <b>2+2 free</b> on ProGlide and ProGlide Power refills and GilletteLabs body blades. ${this.member ? "Your card is linked, so it applies automatically." : "SuperPlus is free – want to join?"}`);
    this.ui.products(["proglideBlades"]);
    this.ui.options(this.member ? [{ label: "Add ProGlide 2+2", act: "add", arg: "proglideBlades", primary: true }, { label: "Something else", act: "menu" }] : [{ label: "Join SuperPlus", act: "signup", primary: true }, { label: "Find my razor", act: "guest" }]);
  }
  async store() {
    const st = this.member ? this.s.profile.store : "your Delhaize";
    await this.ui.bot(`In ${esc(st)} you'll find Gillette in the <b>personal care aisle</b>. Razor blades are in locked cases – tap “Pick up at the service desk” at checkout and a colleague hands them over, no waiting.`);
    this.menu();
  }

  // ---------- photo consultation ----------
  async photoStart() {
    this.ui.step(2);
    if (!this.s.mode) { this.s.mode = "guest"; this.sig("session", "Guest – photo consultation"); }
    await this.ui.bot("Let's look at your skin and beard. Take a selfie or upload a photo – face the camera, good light, no sunglasses.");
    this.ui.photoPrompt();
  }
  /** Called by the UI with the analysis (or null when no face was found). */
  async onPhoto(a, err) {
    const s = this.s;
    if (!a) {
      await this.ui.bot(err === "load" ? "The face analysis couldn't load here. Let's do it with two quick questions instead." : "I couldn't find a face in that photo. Try a front-facing shot in daylight, with your whole face in the frame.");
      return this.ui.options(err === "load" ? [{ label: "OK", act: "set", arg: {} }] : [{ label: "📷 Try another photo", act: "photo", primary: true }, { label: "Skip – answer questions", act: "set", arg: {} }]);
    }
    s.photo = a;
    this.ui.profile(s);
    this.sig("photo", a.source === "ai" ? "Analysed by Claude in the viewer's own account" : "Analysed on this device – the image is not uploaded");
    this.ui.consultResult(a);
    if (a.quality !== "ok") await this.ui.bot(`The photo is a bit ${a.quality} – the results may be less precise.`);
    await this.ui.bot(`Did I get your facial hair right? It looks like <b>${a.beardLabel}</b>.`);
    const opts = [["clean", "Clean-shaven"], ["stubble", "Stubble"], ["short", "Short beard"], ["full", "Full beard"]];
    this.ui.options(opts.map(([k, l]) => ({ label: (a.slots.style === k ? "✓ " : "") + l, act: "beardIs", arg: k, primary: a.slots.style === k })));
  }
  async photoConfirm(style) {
    const s = this.s, a = s.photo;
    s.slots.for = s.slots.for || "me";
    if (a?.slots.skin) s.slots.skin = a.slots.skin; else if (!s.slots.skin) s.slots.skin = "normal";
    if (a?.slots.concerns) s.slots.concerns = Array.from(new Set([...(s.slots.concerns || []), ...a.slots.concerns]));
    this.sig("photo findings", `${style}, skin ${s.slots.skin}${s.slots.concerns ? " (" + s.slots.concerns.join(", ") + ")" : ""}`);
    if (style === "clean") { s.slots.area = "face"; s.slots.style = "clean"; this.ui.profile(s); return this.consult(); }
    s.slots.style = style;
    this.ui.profile(s);
    await this.ui.bot(`What's the plan for your ${styleName(style)}?`);
    this.ui.options([{ label: "Keep & shape it", act: "goal", arg: "keep", primary: true }, { label: "Shave it off", act: "goal", arg: "shave" }, { label: "🧔 Try other styles", act: "ar" }]);
  }
  async photoGoal(g) {
    const s = this.s;
    if (g === "shave") { s.slots.area = "face"; s.slots.style = "clean"; s.slots.concerns = Array.from(new Set([...(s.slots.concerns || []), "irritation"])); }
    else s.slots.area = "beard";
    return this.consult();
  }

  // ---------- AR ----------
  async arStart(style) {
    await this.ui.bot("Let's try some beard styles on you. Allow the camera – or use a photo. Nothing is recorded or uploaded.");
    this.ui.openAR(style || this.s.slots.style || "short");
  }
  async useStyle(id) {
    const s = this.s, st = STYLES.find((x) => x.id === id);
    this.ui.user(`I like the ${st.name.toLowerCase()}`);
    s.slots.for = s.slots.for || "me";
    s.slots.style = id;
    s.slots.area = id === "clean" ? "face" : "beard";
    if (!s.mode) { s.mode = "guest"; this.sig("session", "Guest – AR try-on"); }
    this.sig("AR style", `${st.name} → products to get the look`);
    await this.ui.bot(`Great choice! <b>${st.name}</b>: ${st.note}`);
    return this.consult();
  }

  // ---------- checkout & follow-up ----------
  async checkout() {
    const s = this.s; this.ui.step(5);
    if (!s.basket.length) { await this.ui.bot("Your basket is empty – let's find something first."); return this.consult(); }
    await this.ui.bot(`Your basket: <b>${s.basket.reduce((t, b) => t + b.qty, 0)} items, ${eur(s.basket.reduce((t, b) => t + b.total, 0))}</b>. How would you like to get it?`);
    this.showBasket(false);
    const store = this.member && s.profile.store ? s.profile.store.replace("Delhaize ", "") : "your Delhaize";
    if (this.member && s.profile.store) this.sig("home store", `Pick-up pre-filled: ${s.profile.store}`);
    const o = [];
    if (s.entry === "shelf") o.push({ label: "Pick up now at the service desk", act: "fulfil", arg: "desk", primary: true });
    o.push({ label: `Collect&Go – ${store}`, act: "fulfil", arg: "collect", primary: s.entry !== "shelf" }, { label: "Home delivery", act: "fulfil", arg: "delivery" }, { label: "Keep shopping", act: "menu" });
    this.ui.options(o);
  }
  async thanks(how) {
    const s = this.s; this.ui.step(6);
    s.fulfil = how;
    const total = s.basket.reduce((t, b) => t + b.total, 0);
    const where = how === "desk" ? "Show this chat at the service desk – they'll hand you your order, no waiting at the locked case." : how === "delivery" ? "It's on its way – you'll get a delivery slot by e-mail." : "We'll message you when it's ready for pick-up (usually within 2 hours).";
    await this.ui.bot(`Thank you${this.name ? ", " + esc(this.name) : ""}! ✅ Order <b>DL-${rnd(6)}</b> confirmed. ${where}`);
    if (this.member && !s.profile.isNew) { await this.ui.bot(`+${Math.round(total)} SuperPlus points – you now have ${s.profile.points + Math.round(total)}.`); this.sig("points", "Updated after purchase"); }
    if (this.member && s.profile.consent) {
      const days = s.profile.cycle || 35;
      await this.ui.bot(`I'll send you a ${s.profile.channel.toLowerCase()} in about ${Math.round(days / 7)} weeks when your blades are due. 🔁`);
      this.sig("follow-up", `Replenishment reminder in ~${days} days`);
    }
    await this.ui.bot("One quick question: was this chat helpful?");
    const o = [];
    if (this.member && !s.profile.consent) o.push({ label: "Remind me when blades run out", act: "consent", arg: "yes" });
    if (!this.member) o.push({ label: "Join SuperPlus for next time", act: "signup" });
    o.push({ label: "👍 Helpful", act: "rate", arg: "up" }, { label: "👎 Not really", act: "rate", arg: "down" });
    this.ui.options(o);
  }
  async consent(v) {
    const s = this.s;
    const yes = v === "yes" || v === "signup-yes";
    if (s.profile) { s.profile.consent = yes; this.ui.profile(s); }
    this.sig(`marketing consent = ${yes ? "yes" : "no"}`, yes ? "Explicit opt-in (GDPR)" : "Respected – no reminders");
    if (v.startsWith("signup")) return s.fulfil ? this.rate() : s.rec ? this.recommendNow(false, true) : this.consult();
    await this.ui.bot(yes ? `Done – I'll remind you by ${(s.profile?.channel || "e-mail").toLowerCase()}.` : "OK, no reminders.");
    return this.ui.options([{ label: "👍 Helpful", act: "rate", arg: "up" }, { label: "👎 Not really", act: "rate", arg: "down" }]);
  }
  async rate(v) {
    if (v) this.s.rating = v;
    await this.ui.bot(v === "down" ? "Thanks for the honest feedback – a colleague will review this chat to improve me." : "Thanks! Enjoy your shave. 🪒");
    this.ui.options([{ label: "↻ Start over", act: "restart", primary: true }, { label: "Something else", act: "menu" }]);
  }
  async signup() {
    this.ui.step(4);
    this.s.pending = { input: "name" };
    await this.ui.bot("Great choice! SuperPlus is free. What's your first name?");
    this.ui.options([]);
    this.ui.focusInput("Your first name…");
  }

  // ---------- service requests (typed) ----------
  async service(flow, ctx = {}) {
    const s = this.s; this.ui.step(4);
    const p = ctx.p;
    if (p?.entities?.orderNo) ctx.orderNo = p.entities.orderNo;
    if (p?.entities?.products) ctx.product = p.entities.products[0];
    const lastOrder = this.member ? s.profile.lastOrder : null;
    this.sig("service", `Typed request recognised: ${flow.replace("_", " ")}`);
    const ticket = async (type, details, next) => { this.ui.ticket({ id: `${type.slice(0, 2).toUpperCase()}-${rnd(5)}`, type, details, next }); };
    const back = () => this.ui.options([{ label: "Back to shopping", act: "menu" }, { label: "That's all, thanks", act: "rate" }]);

    if (flow === "refund") {
      if (!ctx.channel) {
        if (ctx.orderNo) ctx.channel = "delivery";
        else {
          await this.ui.bot("Sorry it didn't work out. Where did you buy it?");
          const o = [];
          if (lastOrder) { this.sig("lastOrder", `Offered order ${lastOrder.no} from the CRM`); o.push({ label: `My order ${lastOrder.no} (${lastOrder.channel})`, act: "svc", arg: { flow, channel: lastOrder.channel === "Collect&Go" ? "collect" : "delivery", orderNo: lastOrder.no }, primary: true }); }
          o.push({ label: "In a Delhaize store", act: "svc", arg: { flow, channel: "store" } }, { label: "Online – home delivery", act: "svc", arg: { flow, channel: "delivery" } }, { label: "Online – Collect&Go", act: "svc", arg: { flow, channel: "collect" } });
          return this.ui.options(o);
        }
      }
      if (ctx.channel === "store") {
        await this.ui.bot("For products bought in store: bring the product and its packaging to the <b>service desk of the store where you bought it</b>. Delhaize refunds the product when you show your proof of purchase.");
        await this.ui.bot("No paper receipt? Your digital receipt works too (in the Delhaize app for 3 months, on delhaize.be for 1 year), or the desk can look it up with the date, payment method and total.");
        return back();
      }
      if (ctx.channel === "collect") {
        await this.ui.bot("For <b>Collect&Go</b> orders you check your products at pick-up and can refuse items right there. If you notice a quality problem later, the store's service desk refunds it with your receipt.");
        return back();
      }
      if (!ctx.orderNo) { s.pending = { input: "orderNo", flow, channel: "delivery" }; this.ui.options([]); this.ui.focusInput("Order number, e.g. DL-731554"); return this.ui.bot("What's your order number? It's in your confirmation e-mail (e.g. DL-731554)."); }
      if (!ctx.reason) {
        await this.ui.bot(`Order <b>${esc(ctx.orderNo)}</b> – what's the reason?`);
        return this.ui.options([["unopened", "Unopened – changed my mind"], ["opened", "Opened – didn't like it"], ["defect", "Damaged or defective"], ["skin", "Skin reaction"]].map(([k, l]) => ({ label: l, act: "svc", arg: { flow, channel: "delivery", orderNo: ctx.orderNo, reason: k } })));
      }
      if (ctx.reason === "unopened") {
        await this.ui.bot("You can withdraw from a home-delivery purchase <b>within 14 days of receiving it</b>, no reason needed. You'll get the money back on the same payment method within 14 days.");
        await ticket("Return", `Withdrawal for order ${ctx.orderNo} (unopened)`, "Send it back by post at your own cost, or have it picked up for €10 – free with your next delivery.");
        return back();
      }
      if (ctx.reason === "opened") {
        await this.ui.bot("I'm sorry – sealed hygiene products like razor blades can't be returned once the seal is broken, for health reasons. But if something is wrong with the product, it's covered.");
        await this.ui.bot("Want me to find something that suits you better instead?");
        return this.ui.options([{ label: "Yes, find a better match", act: "set", arg: {}, primary: true }, { label: "It's actually defective", act: "svc", arg: { flow: "defect", orderNo: ctx.orderNo } }]);
      }
      if (ctx.reason === "skin") return this.service("injury", { orderNo: ctx.orderNo });
      return this.service("defect", { orderNo: ctx.orderNo });
    }

    if (flow === "order_status") {
      const no = ctx.orderNo || lastOrder?.no;
      if (!no) { s.pending = { input: "orderNo", flow }; this.ui.options([]); this.ui.focusInput("Order number, e.g. DL-731554"); return this.ui.bot("Let me check. What's your order number? (It's in your confirmation e-mail, e.g. DL-731554.)"); }
      if (!ctx.orderNo && lastOrder) this.sig("lastOrder", `Order ${no} picked from CRM – no need to ask`);
      const st = lastOrder && lastOrder.no === no ? lastOrder.status : ["preparing", "out", "ready", "delivered"][parseInt(no.replace(/\D/g, "").slice(-1), 10) % 4];
      const txt = { preparing: "is being prepared – it'll be ready within 2 hours", out: "is <b>out for delivery</b> – expected today between 14:00 and 16:00", ready: `is <b>ready for pick-up</b>${this.member ? " at " + esc(s.profile.store) : ""}`, delivered: "was <b>delivered</b> – if something is missing, tell me" }[st];
      await this.ui.bot(`Order <b>${esc(no)}</b> ${txt}. 📦`);
      this.ui.orderTrack(st);
      return back();
    }

    if (flow === "defect") {
      const prod = ctx.product ? BY_ID[ctx.product] : null;
      if (!prod && !ctx.productText) { s.pending = { input: "product", flow, orderNo: ctx.orderNo }; this.ui.options([]); this.ui.focusInput("Product and what's wrong…"); return this.ui.bot("I'm sorry about that. Which product is it, and what's wrong with it?"); }
      const what = prod ? prod.short : ctx.productText;
      await this.ui.bot(`Products have a <b>2-year legal guarantee</b>. ${ctx.orderNo ? "For your online order I've opened a case:" : "Bring it with your receipt to the service desk – or I can open a case now:"}`);
      await ticket("Defect", `${esc(what)}${ctx.orderNo ? " · order " + esc(ctx.orderNo) : ""}`, ctx.orderNo ? "Customer service contacts you within 1 working day for a replacement or refund." : "Show this reference at the service desk.");
      return back();
    }

    if (flow === "injury") {
      await this.ui.bot("I'm sorry! First aid: rinse with <b>cold water</b>, press a clean tissue on small cuts for a few minutes, then apply an alcohol-free balm. Don't shave the area for a day or two.");
      await this.ui.bot("⚠️ If bleeding doesn't stop after 10 minutes, or you notice swelling, hives or trouble breathing, see a doctor – in an emergency call <b>112</b>.");
      await ticket("Product report", `Skin reaction / injury${ctx.orderNo ? " · order " + esc(ctx.orderNo) : ""}`, `Our quality team may contact you. You can also call customer service free on ${PHONE}.`);
      this.ui.options([{ label: "Show sensitive-skin products", act: "irritation", primary: true }, { label: "Back to shopping", act: "menu" }]);
      return;
    }

    if (flow === "cancel") {
      if (/subscri|unsubscri|reminder/.test(p?.fixed || "")) {
        if (s.profile) { s.profile.consent = false; this.ui.profile(s); }
        this.sig("marketing consent = no", "Unsubscribed in chat");
        await this.ui.bot("Done – you won't get any more reminders from me. (SuperPlus itself has no paid subscription.)");
        return back();
      }
      const no = ctx.orderNo || lastOrder?.no;
      if (!no) { s.pending = { input: "orderNo", flow }; this.ui.options([]); this.ui.focusInput("Order number, e.g. DL-731554"); return this.ui.bot("Which order should I cancel? Please type the order number."); }
      await this.ui.bot(`Order <b>${esc(no)}</b> wasn't prepared yet, so I've <b>cancelled</b> it. Any payment is refunded to the same payment method.`);
      return back();
    }

    if (flow === "invoice") {
      await this.ui.bot("Your receipts are in your Delhaize account: in the app for 3 months and on delhaize.be for 1 year. For online orders the invoice is attached to the order in “My orders”.");
      return back();
    }

    if (flow === "privacy") {
      const used = this.member ? "name, age, city, home store, purchase history, refill cycle, points and marketing consent" : "only what you typed or chose in this chat";
      await this.ui.bot(`In this chat I use: <b>${used}</b>. Photos are analysed on your device and never uploaded. You can see it all under “CRM”.`);
      await this.ui.bot(`To delete your data or get a copy, send a request through the Delhaize contact form (<a href="${HELP_URL}" target="_blank" rel="noopener">help.delhaize.be</a>). I can also clear this chat now.`);
      return this.ui.options([{ label: "Clear this chat", act: "restart" }, { label: "Back to shopping", act: "menu" }]);
    }

    if (flow === "human") {
      await this.ui.bot(`Of course. Delhaize customer service is free on <b>${PHONE}</b> (Mon–Fri 7–21, Sat 8–18, Sun 8–13), or via the contact form on <a href="${HELP_URL}" target="_blank" rel="noopener">help.delhaize.be</a>. In store, the service desk is happy to help.`);
      await ticket("Callback note", "Chat transcript attached for the agent", "Mention this reference so you don't have to repeat yourself.");
      return back();
    }

    if (flow === "complaint") {
      if (!ctx.description) { s.pending = { input: "describe", flow }; this.ui.options([]); this.ui.focusInput("Describe what happened…"); return this.ui.bot("I'm really sorry to hear that. What happened? Tell me in a sentence or two and I'll pass it on."); }
      await this.ui.bot("Thank you for telling me – I've passed it on to customer service.");
      await ticket("Complaint", esc(ctx.description.slice(0, 140)), `They'll reply within 2 working days. Urgent? Call ${PHONE} (free).`);
      return back();
    }
    return this.fallback();
  }
}

export const ALL_PRODUCTS = CATALOG;
