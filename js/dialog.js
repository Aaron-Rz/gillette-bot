// Dialog manager: frame-based. Every message fills what it can, then the bot asks only what is still missing
// or jumps to the answer. Service requests (refunds, orders, complaints …) are recognised from typed text.
import { parse, normalize, SERVICE_INTENTS } from "./nlu.js";
import { classify, decide, tokens } from "./classify.js";
import { BY_CAT, GROUPS, GUIDE } from "./intents.js";
import { ADVICE } from "./advice.js";
import { STORES, storeById, storeByName } from "./stores.js";
const DELIVERY = { slotNote: "Delivery is possible from the next day, Mon–Sat, 7:00–14:00 or 14:00–21:00; the fee is shown before you confirm." };
import { recommend, cheapest, compatibility, summary, styleName } from "./recommend.js";
import { BY_ID, CATALOG } from "./catalog.js";
import { STYLES } from "./ar.js";

const eur = (n) => "€" + n.toFixed(2).replace(".", ",");
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rnd = (n) => Math.floor(Math.random() * 10 ** n).toString().padStart(n, "0");
const mask = (e) => e.replace(/^(.)[^@]*(@.*)$/, (m, a, b) => a + "•••••" + b);
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

const SERVICE_CATS = new Set(["refund", "order_status", "delivery_info", "wrong_item", "billing", "defect", "injury", "cancel", "invoice", "privacy", "human", "complaint"]);

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
    await this.ui.bot(shelf ? "Hi, I'm Sam, your Gillette shave expert. You scanned the code at the <b>shaving shelf</b>." : "Hi, I'm Sam, your Gillette shave expert at Delhaize.");
    await this.ui.bot("Log in with your <b>SuperPlus</b> card for personal offers and your orders – or continue as a guest.");
    this.opt([]);
    this.ui.welcome();
  }
  async guestHome() {
    const s = this.s;
    if (!s.mode) { s.mode = "guest"; this.sig("session", "Guest – no CRM record, learns from the chat"); this.ui.profile(s); }
    await this.ui.bot("Welcome. What can I do for you? Pick a start below – or just type, e.g. <i>“gift for my dad under €30”</i> or <i>“where is my order?”</i>");
    this.opt([]);
    this.ui.landing();
  }
  menu() {
    const o = [];
    if (!this.s.mode) o.push({ label: "Log in with SuperPlus", act: "login", primary: true, icon: "key" }, { label: "Continue as guest", act: "guestHome", icon: "user" });
    else o.push({ label: "Skin & beard check", act: "photo", icon: "camera" }, { label: "Try beard styles", act: "ar", icon: "beard" }, { label: "Find my razor", act: "guest", icon: "razor" }, { label: "Basket", act: "basket", icon: "basket" });
    this.opt(o);
  }
  /** Show buttons and remember them, so a typed answer can be matched to them. */
  opt(list) { this.lastOpts = list || []; this.ui.options(list); }

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
      case "fulfil": return this.fulfil(arg);
      case "consent": return this.consent(arg);
      case "rate": return this.rate(arg);
      case "signup": return this.signup();
      case "basket": return this.showBasket(true);
      case "menu": this.ui.step(1); await this.ui.bot("What else can I do for you? Type anything – or pick:"); return this.menu();
      case "restart": return this.ui.restart();
      case "member": return this.memberAct(arg);
      case "svc": return this.service(arg.flow, arg);
      case "typeHint": this.ui.focusInput(arg); return;
      case "guestHome": return this.guestHome();
      case "cat": this.misses = 0; return this.runCat(arg.id, parse(arg.text || "", { aliases: ALIASES }), arg.text ? this.applyEntities(parse(arg.text, { aliases: ALIASES }).entities) : []);
      case "guideMenu": return this.guide();
      case "store": return this.setStore(arg);
      case "pickStore": return this.pickStore();
      case "emailOk": this.s.email = this.s.email || this.s.profile?.email; return this.finish();
      case "emailOther": return this.askEmail();
      case "qty": return this.setQty(arg.i, arg.packs);
      case "advice": return this.advice(arg);
      default: return this.fallback();
    }
  }

  // ---------- free text ----------
  async onText(text) {
    const s = this.s;
    this.ui.user(esc(text));
    const p = parse(text, { aliases: ALIASES });
    const r = classify(text, { parsed: p });
    const d = decide(r);
    this.lastClass = r;
    const isService = SERVICE_CATS.has(r.top);
    // 1. a typed value Sam asked for (name, e-mail, order number, postcode, description …)
    if (s.pending?.input && !(d === "act" && (isService || r.top === "restart") && r.score >= 0.6 && !["orderNo", "email", "postcode"].includes(s.pending.input))) {
      const pend = s.pending; s.pending = null;
      return this.onInput(pend, text, p);
    }
    if (!s.mode) { s.mode = "guest"; this.sig("session", "Guest – started typing without logging in"); this.ui.sys("Continuing as guest"); this.ui.profile(s); }
    // 2. short yes / no
    const words = tokens(text).length;
    if ((p.top === "yes" || p.top === "no") && words <= 3 && !(d === "act" && r.top !== "thanks" && r.top !== "bye")) return this.yesNo(p.top === "yes");
    // 3. an answer to the buttons Sam just showed ("the first one", "home delivery", "unopened" …)
    const picked = this.matchOption(text, d);
    if (picked) { this.misses = 0; return this.act(picked.act, picked.arg); }
    // 4. facts in the message always count
    const learned = this.applyEntities(p.entities);
    // 5. Claude (presenter version / artifact) when Sam isn't sure
    if (d !== "act" && this.opts.ai?.available?.()) {
      const ok = await this.opts.ai.turn(text, this).catch(() => false);
      if (ok) { this.misses = 0; return; }
    }
    const shopTop = BY_CAT[r.top]?.group === "shop";
    if (d === "act" || (learned.length && (shopTop || d === "guide"))) {
      this.misses = 0;
      const cat = d === "act" ? r.top : r.top === "gift" ? "gift" : "find_product";
      return this.runCat(cat, p, learned);
    }
    if (learned.length && s.rec) { this.misses = 0; return this.shop(learned); } // refining an existing routine
    if (d === "clarify") return this.clarify(r, text, learned);
    return this.guide(text);
  }

  /** Match a typed reply to the buttons on screen. */
  matchOption(text, d) {
    const list = (this.lastOpts || []).filter((o) => o.act && o.label);
    if (!list.length) return null;
    const t = normalize(text);
    const ord = t.match(/^(the )?(first|1st|second|2nd|third|3rd|last|1|2|3)( one| option)?$/);
    if (ord) {
      const i = { first: 0, "1st": 0, 1: 0, second: 1, "2nd": 1, 2: 1, third: 2, "3rd": 2, 3: 2, last: list.length - 1 }[ord[2]];
      return list[i] || null;
    }
    if (d === "act" && this.lastClass.score > 0.55) return null; // a clear new request wins over the buttons
    const tt = new Set(tokens(text));
    if (!tt.size || tt.size > 7) return null;
    let best = null, bs = 0, second = 0;
    for (const o of list) {
      const lt = new Set(tokens(o.label.replace(/<[^>]+>/g, "")));
      if (!lt.size) continue;
      const hit = [...tt].filter((w) => lt.has(w)).length;
      // how much of what was typed is in the label, with a little weight on covering the label
      const sc = hit ? 0.8 * (hit / tt.size) + 0.2 * (hit / lt.size) : 0;
      if (sc > bs) { second = bs; bs = sc; best = o; } else if (sc > second) second = sc;
    }
    return bs >= 0.5 && bs > second ? best : null;
  }

  /** Run the handler of a category. */
  async runCat(id, p, learned = []) {
    const s = this.s;
    p = p || parse("", {});
    if (SERVICE_CATS.has(id)) return this.service(id, { p });
    if (ADVICE[id]) return this.advice(id);
    switch (id) {
      case "find_product": return this.shop(learned);
      case "gift": if (s.slots.for !== "gift") { s.slots.for = "gift"; learned = [...learned, "for"]; } return this.shop(learned);
      case "compare": return this.compare(p.entities?.products);
      case "budget": if (s.rec) return this.cheaper(); if (!s.slots.budget) { s.slots.budget = "low"; learned = [...learned, "budget"]; } return this.shop(learned);
      case "price": return this.price(p);
      case "promo": return this.promo();
      case "superplus_info": return this.superplusInfo();
      case "compat": return this.compat(p);
      case "availability": return this.availability(p);
      case "store_stock": return this.store();
      case "basket": return /\b(remove|delete|take out)\b/.test(p.fixed || "") ? this.removeFromBasket(p) : this.showBasket(true);
      case "checkout": return this.checkout();
      case "photo": return this.photoStart();
      case "ar": return this.arStart(p.entities?.style);
      case "capabilities": return this.capabilities();
      case "greeting": if (!learned.length) { await this.ui.bot(`Hi${this.name ? " " + esc(this.name) : ""}. What can I do for you – a new razor, beard care, or help with an order?`); return this.menu(); } return this.shop(learned);
      case "thanks": await this.ui.bot(`You're welcome${this.name ? ", " + esc(this.name) : ""}. Anything else?`); return this.menu();
      case "bye": await this.ui.bot("Thanks for chatting – enjoy your shave."); return this.opt([{ label: "Start over", act: "restart", primary: true, icon: "refresh" }]);
      case "restart": return this.ui.restart();
      case "login": return this.login();
      case "out_of_scope": return this.outOfScope(p);
      default: return this.guide();
    }
  }

  /** Shopping: acknowledge what was understood, then ask only what's missing. */
  async shop(learned = []) {
    const s = this.s;
    if (learned.length) {
      await this.ui.bot(`Got it: <b>${esc(summary(s.slots).join(" · "))}</b>.`);
      for (const k of learned) this.sig(k, `Understood from text: “${k} = ${Array.isArray(s.slots[k]) ? s.slots[k].join(", ") : s.slots[k]}”`);
      this.ui.profile(s);
      if (s.rec) return this.recommendNow(true);
    }
    return this.consult();
  }

  /** Medium confidence: offer the most likely categories. */
  async clarify(r, text, learned = []) {
    let cands = r.ranked.filter((x) => x.score >= 0.12 && x.id !== "out_of_scope").slice(0, 3);
    if (learned.length && !cands.some((c) => c.id === "find_product")) cands = [...cands.slice(0, 2), { id: "find_product", score: 0 }];
    if (cands.length < 2) return cands.length ? this.runCat(cands[0].id, parse(text, { aliases: ALIASES }), learned) : this.guide(text);
    this.sig("intent unclear", `Top guesses: ${cands.map((c) => `${c.id} ${c.score.toFixed(2)}`).join(", ")}`);
    await this.ui.bot("Just to make sure I help with the right thing – do you mean:");
    this.opt([...cands.map((c, i) => ({ label: BY_CAT[c.id].label, act: "cat", arg: { id: c.id, text }, primary: i === 0 })), { label: "Something else", act: "guideMenu" }]);
  }

  /** Low confidence: show what Sam can do, grouped; after two misses offer a person. */
  async guide(text) {
    this.misses = (this.misses || 0) + 1;
    if (this.misses >= 2) {
      this.sig("handover", "Two unclear messages in a row → offer a person");
      await this.ui.bot(`Sorry, I'm still not sure what you need. A colleague can help: Delhaize customer service is free on <b>${PHONE}</b>. Or pick a topic below.`);
    } else await this.ui.bot(text ? "I'm not sure I understood that. Here's what I can help with – pick a topic or rephrase:" : "Here's what I can help with:");
    this.ui.guide(GUIDE.map(([g, ids]) => ({ title: GROUPS[g], items: ids.map((id) => ({ id, label: BY_CAT[id].label })) })));
    this.opt(this.misses >= 2 ? [{ label: "Talk to a person", act: "cat", arg: { id: "human" }, icon: "phone" }] : []);
  }

  async capabilities() {
    await this.ui.bot("I'm Sam, Gillette's shave expert at Delhaize. I can find the right razor, blades or beard care for you or as a gift, check your skin and beard from a photo, let you try beard styles, give shaving tips, and help with orders, returns and refunds.");
    this.misses = 0;
    return this.guide();
  }
  async outOfScope(p) {
    if (/\b(vegan|animal|tested|cruelty|ingredient)/.test(p.fixed || "")) {
      await this.ui.bot(`I don't have verified information on that here. Gillette's owner P&G states that it no longer tests consumer products on animals unless required by law – see <a href="https://us.pg.com/cruelty-free/" target="_blank" rel="noopener">pg.com</a>.`);
    } else await this.ui.bot("That's outside what I can help with – I'm here for shaving, beard care and your Delhaize orders.");
    this.misses = 0;
    return this.guide();
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
      const name = text.trim().replace(/^(hi|hello|ok|sure)[,! ]+/i, "").replace(/^(my name is|my name's|i'm|i am|it's|call me|je m'appelle|je suis|ik ben|ik heet|ich bin|ich heiße)\s+/i, "").split(/\s+/)[0].replace(/[^\p{L}-]/gu, "").slice(0, 20);
      if (!name) { s.pending = pend; return this.ui.bot("Just your first name, please."); }
      s.profile = { name: name.charAt(0).toUpperCase() + name.slice(1), isNew: true, consent: false, channel: "E-mail" };
      s.mode = "member";
      this.sig("new member", `Guest converted to SuperPlus: ${s.profile.name}`);
      Object.keys(s.slots).forEach((k) => this.sig(k, "Carried over from the guest chat into the new CRM record"));
      this.ui.profile(s);
      await this.ui.bot(`Welcome to SuperPlus, ${esc(s.profile.name)}. Your <b>2+2 deal</b> is unlocked.`);
      return this.askEmail("signup");
    }
    if (pend.input === "email") {
      const m = text.match(/[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i);
      if (!m) { s.pending = pend; this.ui.focusInput("name@example.com"); return this.ui.bot("That doesn't look like an e-mail address – please type it like <b>name@example.com</b>."); }
      s.email = m[0].toLowerCase();
      if (s.profile) s.profile.email = s.email;
      this.sig("email", pend.next === "signup" ? "Given at sign-up – needed for the card and reminders" : "Given for the order confirmation (demo: not sent, not stored)");
      this.ui.profile(s);
      if (pend.next === "signup") {
        await this.ui.bot("May we remind you when your blades are probably running out? You can stop it any time.");
        return this.opt([{ label: "Yes, remind me", act: "consent", arg: "signup-yes", primary: true }, { label: "No thanks", act: "consent", arg: "signup-no" }]);
      }
      return this.finish();
    }
    if (pend.input === "postcode") {
      const m = text.match(/\b[1-9]\d{3}\b/);
      if (!m) { s.pending = pend; this.ui.focusInput("Postcode, e.g. 1050"); return this.ui.bot("Please type a Belgian postcode – four digits, e.g. <b>1050</b>."); }
      s.postcode = m[0];
      this.sig("postcode", `Delivery postcode ${m[0]}`);
      await this.ui.bot(`Delivery to <b>${m[0]}</b>. ${DELIVERY.slotNote}`);
      return this.needEmail();
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

  async fallback() { return this.guide(); }

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
    this.opt([{ label: "Continue as guest", act: "guest" }]);
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
      await this.ui.bot(`Welcome back, ${p.name}.`);
      await this.ui.bot(`Your last <b>${lp.short}</b> were ${p.lastPurchase.daysAgo} days ago – you usually restock every ~5 weeks, so they're probably getting dull.`);
      await this.ui.bot(`Good timing: <b>2+2 free</b> on ProGlide this week with your SuperPlus card – 16 blades for ${eur(lp.price * 2)} (${eur((lp.price * 2) / 16)} per blade).`);
      return this.opt([{ label: "Restock my usual", act: "member", arg: "restock", primary: true }, { icon: "camera", label: "Check my skin first", act: "photo" }, { label: "Show me something new", act: "member", arg: "new" }]);
    }
    if (id === "marc") {
      this.sig("lastPurchase 61 d / cycle 60 d", "Replenishment trigger: Mach3 + beard oil due");
      this.sig("area = beard, razor = Mach3", "Upgrade idea: King C. trimmer for the short beard");
      await this.ui.bot(`Hi ${p.name}, good to see you.`);
      await this.ui.bot(`Your Mach3 blades and King C. Gillette beard oil from 9 September are probably running out – that was ${p.lastPurchase.daysAgo} days ago.`);
      await this.ui.bot("Reorder the usual with home delivery, or shall I show you how to keep that short beard sharper?");
      return this.opt([{ label: "Reorder the usual", act: "member", arg: "reorder", primary: true }, { label: "Upgrade my beard routine", act: "member", arg: "upgrade" }, { icon: "beard", label: "Try other styles", act: "ar" }]);
    }
    this.sig("lastPurchase 22 d / cycle 45 d", "No refill push – too early, avoids spam");
    this.sig("household + occasion", "Gift idea for her partner (December)");
    await this.ui.bot(`Hi ${p.name}.`);
    await this.ui.bot("Your Venus razor from 18 October should last a few more weeks – no need to restock yet.");
    await this.ui.bot("December is coming though: looking for a gift for <b>Thomas</b>? He has a beard, and King C. Gillette sets are popular.");
    return this.opt([{ label: "Yes, gift for Thomas", act: "member", arg: "gift", primary: true }, { label: "Something for me", act: "member", arg: "me" }]);
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
      return this.opt([{ label: "For me", act: "set", arg: { for: "me" } }, { label: "A gift", act: "set", arg: { for: "gift" } }]);
    }
    if (!sl.area) {
      await this.ui.bot(sl.for === "gift" ? "Nice! What does the person shave?" : "What do you want to shave or groom?");
      return this.opt([
        { label: "Face – clean shave", act: "set", arg: { area: "face" } },
        { label: "Beard – trim & care", act: "set", arg: { area: "beard" } },
        { label: "Legs & body", act: "set", arg: { area: "body" } },
        { label: "Head", act: "set", arg: { area: "head" } },
      ]);
    }
    if (sl.area === "beard" && !sl.style) {
      await this.ui.bot(sl.for === "gift" ? "What kind of beard does he have?" : "Which beard do you have – or want?");
      return this.opt([
        { label: "Stubble", act: "set", arg: { style: "stubble" } }, { label: "Short beard", act: "set", arg: { style: "short" } },
        { label: "Full beard", act: "set", arg: { style: "full" } }, ...(sl.for === "me" ? [{ icon: "beard", label: "Not sure – try styles", act: "ar" }] : []),
      ]);
    }
    if (sl.area === "body" && sl.for === "me" && !sl.gender) {
      await this.ui.bot("Which range should I show you?");
      return this.opt([{ label: "GilletteLabs Body (men)", act: "set", arg: { gender: "m" } }, { label: "Venus (women)", act: "set", arg: { gender: "f" } }]);
    }
    if ((sl.area === "face" || sl.area === "head") && sl.for !== "gift" && !sl.handle) {
      await this.ui.bot("Do you already have a Gillette razor handle at home?");
      return this.opt([
        { label: "Yes – Fusion5 / ProGlide", act: "set", arg: { handle: "yes", owned: "fusion5" } },
        { label: "Yes – Mach3", act: "set", arg: { handle: "yes", owned: "mach3" } },
        { label: "No / not sure", act: "set", arg: { handle: "no" } },
      ]);
    }
    if (!sl.skin) {
      await this.ui.bot(sl.for === "gift" ? "Do you know how their skin reacts to shaving?" : "How does your skin react to shaving?");
      return this.opt([
        { label: "Sensitive / redness", act: "set", arg: { skin: "sensitive" } },
        { label: "No problems", act: "set", arg: { skin: "normal" } },
        sl.for === "gift" ? { label: "Not sure", act: "set", arg: { skin: "sensitive" } } : { icon: "camera", label: "Check it with a photo", act: "photo" },
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
    if (hasPromo && this.promoOn()) o.push({ label: "Add routine with 2+2", act: "addRoutine", arg: true, primary: true });
    o.push({ label: "Add routine to basket", act: "addRoutine", arg: false, primary: !(hasPromo && this.promoOn()) });
    if (hasPromo && !this.member) o.push({ label: "Join SuperPlus for 2+2", act: "signup" });
    o.push({ label: "Cheaper option", act: "cheaper" }, { label: "Compare", act: "compare" });
    if (s.slots.area === "beard" || s.slots.style) o.push({ icon: "beard", label: "Try styles", act: "ar" });
    if (!s.photo && s.slots.for !== "gift" && s.slots.area !== "body") o.push({ icon: "camera", label: "Check with photo", act: "photo" });
    o.push({ label: "Not now", act: "later" });
    this.opt(o);
    this.ui.hint("Tip: type to refine, e.g. “cheaper”, “I have a Mach3” or “my skin gets red”.");
  }

  // ---------- basket ----------
  line(b) {
    const p = BY_ID[b.id];
    const free = b.deal ? Math.floor(b.packs / 4) * 2 : 0;
    b.qty = b.packs; b.total = p.price * (b.packs - free); b.saved = p.price * free;
    b.label = p.short + (b.deal ? " – 2+2 deal" : "");
    return b;
  }
  addItems(ids, deal) {
    const bk = this.s.basket;
    for (const id of ids) {
      const p = BY_ID[id];
      const useDeal = !!(deal && p.promo && this.promoOn());
      const ex = bk.find((b) => b.id === id && b.deal === useDeal);
      if (ex) { ex.packs += useDeal ? 4 : 1; this.line(ex); } else bk.push(this.line({ id, packs: useDeal ? 4 : 1, deal: useDeal }));
      this.ui.sys(`Added: <b>${esc(useDeal ? p.short + " – 2+2 deal (4 packs)" : p.short)}</b>`);
    }
    this.ui.basket(bk);
  }
  setQty(i, packs) {
    const bk = this.s.basket;
    if (!bk[i]) return;
    if (packs <= 0) bk.splice(i, 1); else this.line(Object.assign(bk[i], { packs }));
    this.ui.basket(bk);
  }
  totals() {
    const b = this.s.basket;
    return { n: b.reduce((t, x) => t + x.packs, 0), total: b.reduce((t, x) => t + x.total, 0), saved: b.reduce((t, x) => t + (x.saved || 0), 0) };
  }
  async addRoutine(deal) { this.addItems(this.s.rec.steps.map((x) => x.item.id), deal); return this.checkout(); }
  async afterAdd() { this.opt([{ label: "Go to checkout", act: "checkout", primary: true }, { label: "View basket", act: "basket", icon: "basket" }, { label: "Keep shopping", act: "menu" }]); }
  async showBasket(withOptions) {
    const b = this.s.basket;
    if (!b.length) { await this.ui.bot("Your basket is empty for now."); return withOptions && this.menu(); }
    this.ui.openBasket();
    if (withOptions) this.opt([{ label: "Go to checkout", act: "checkout", primary: true }, { label: "Keep shopping", act: "menu" }]);
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
    this.opt(o);
  }
  async irritation() {
    const s = this.s;
    s.slots.skin = "sensitive"; s.slots.concerns = Array.from(new Set([...(s.slots.concerns || []), "irritation"]));
    if (this.member) this.sig("skin → sensitive", "Profile updated from the conversation (zero-party data)");
    await this.ui.bot("Irritation usually comes from three things: a dull blade, shaving dry, and going against the grain.");
    await this.ui.bot("3 tips: wet your skin for a minute first · shave with the grain · change the blade when the lubrication strip has faded. I've switched your routine to sensitive-skin products:");
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
    this.opt(o);
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
      await this.ui.bot(ok ? `Yes – <b>${names[mentioned[0]]}</b> and <b>${names[mentioned[1]]}</b> share the same click system – the refills fit each other's handles (except the battery-powered ProGlide Power, which takes Power refills).` : `No – <b>${names[mentioned[0]]}</b> and <b>${names[mentioned[1]]}</b> use different systems, so the blades don't fit. Fusion5 and ProGlide refills are interchangeable; Mach3 has its own.`);
    } else await this.ui.bot("Quick guide: <b>Fusion5 and ProGlide</b> refills fit each other's handles · <b>Mach3</b> refills fit only Mach3 handles · <b>GilletteLabs</b> and <b>SkinGuard</b> have their own blades. Which handle do you have?");
    if (owned) { this.s.slots.owned = owned; this.s.slots.handle = "yes"; }
    this.opt([{ label: "Show me refills", act: "set", arg: { wantType: "blades", area: this.s.slots.area || "face", handle: "yes", owned: owned || mentioned[0] || "fusion5" } }, { label: "Something else", act: "menu" }]);
  }
  async price(p) {
    const ids = p.entities.products || [];
    if (ids.length) { const it = BY_ID[ids[0]]; await this.ui.bot(`<b>${esc(it.short)}</b> costs ${eur(it.price)}${it.verified ? " at Delhaize" : " (indicative price)"}.${it.promo ? ` With SuperPlus: ${it.promo}.` : ""}`); this.ui.products([it.id]); return this.menu(); }
    if (this.s.rec) { await this.ui.bot(`Your routine comes to <b>${eur(this.s.rec.total)}</b>. Want a cheaper option?`); this.s.pending = { confirm: { yes: "cheaper", no: "menu" } }; return this.opt([{ label: "Cheaper option", act: "cheaper" }, { label: "Add routine", act: "addRoutine", arg: this.promoOn(), primary: true }]); }
    await this.ui.bot("Prices start at under €10 for disposables and go up to premium GilletteLabs razors. Tell me what you need and your budget, e.g. “razor under €20”.");
  }
  async promo() {
    await this.ui.bot(`This week (4–18 Nov) SuperPlus members get <b>2+2 free</b> on ProGlide and ProGlide Power refills and GilletteLabs body blades. ${this.member ? "Your card is linked, so it applies automatically." : "SuperPlus is free – want to join?"}`);
    this.ui.products(["proglideBlades"]);
    this.opt(this.member ? [{ label: "Add ProGlide 2+2", act: "add", arg: "proglideBlades", primary: true }, { label: "Something else", act: "menu" }] : [{ label: "Join SuperPlus", act: "signup", primary: true }, { label: "Find my razor", act: "guest" }]);
  }
  async store() {
    const st = this.member ? this.s.profile.store : "your Delhaize";
    await this.ui.bot(`In ${esc(st)} you'll find Gillette in the <b>personal care aisle</b>. Razor blades are in locked cases – tap “Pick up at the service desk” at checkout and a colleague hands them over, no waiting.`);
    this.menu();
  }

  async superplusInfo() {
    await this.ui.bot("<b>SuperPlus</b> is Delhaize's free loyalty programme: you collect points on your shopping, get personal offers like this week's <b>2+2 free</b> on ProGlide blades, and can use points to lower the delivery fee.");
    this.opt(this.member ? [{ label: "Show my deals", act: "promo", primary: true }, { label: "Back to shopping", act: "menu" }] : [{ label: "Join SuperPlus (30 seconds)", act: "signup", primary: true }, { label: "Log in", act: "login", icon: "key" }, { label: "Back to shopping", act: "menu" }]);
  }
  async availability(p) {
    const t = p.fixed || "";
    if (/\belectric|battery|shaver\b/.test(t)) {
      await this.ui.bot("Gillette doesn't make electric foil shavers in this range. For quick trimming without a blade, look at the <b>King C. Gillette beard trimmer</b> or the <b>Style Master</b> – both battery-powered.");
      this.ui.products(["kingCBeardTrimmer", "kingCStyleMaster"]);
    } else if (/\bsafety|double edge\b/.test(t)) {
      await this.ui.bot("Yes – the <b>King C. Gillette safety razor</b> (double-edge, chrome handle).");
      this.ui.products(["kingCSafetyRazor"].filter((id) => BY_ID[id]));
    } else {
      const ids = (p.entities?.products || []).filter((id) => BY_ID[id]);
      if (ids.length) { await this.ui.bot("Yes, that's in the range:"); this.ui.products(ids.slice(0, 3)); }
      else { await this.ui.bot("At Delhaize you'll find the Gillette razors and blades (Mach3, Fusion5, ProGlide, SkinGuard, GilletteLabs), gels and foams, King C. Gillette beard care and trimmers, and Venus for women. What are you looking for?"); }
    }
    this.opt([{ label: "Find my razor", act: "guest", primary: true, icon: "razor" }, { label: "Something else", act: "menu" }]);
  }
  async advice(topic) {
    const a = ADVICE[topic];
    if (!a) return this.guide();
    this.ui.step(4);
    this.sig("advice", `${topic} – tips from ${a.sourceName}`);
    await this.ui.bot(a.intro);
    this.ui.advice({ title: a.title, tips: a.tips, source: a.source, sourceName: a.sourceName });
    if (a.slots) Object.assign(this.s.slots, a.slots);
    const o = (a.next || []).map((n, i) => ({ ...n, primary: i === 0 }));
    o.push({ label: "Something else", act: "menu" });
    this.opt(o);
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
      return this.opt(err === "load" ? [{ label: "OK", act: "set", arg: {} }] : [{ icon: "camera", label: "Try another photo", act: "photo", primary: true }, { label: "Skip – answer questions", act: "set", arg: {} }]);
    }
    s.photo = a;
    this.ui.profile(s);
    this.sig("photo", a.source === "ai" ? "Analysed by Claude in the viewer's own account" : "Analysed on this device – the image is not uploaded");
    this.ui.consultResult(a);
    if (a.quality !== "ok") await this.ui.bot(`The photo is a bit ${a.quality} – the results may be less precise.`);
    await this.ui.bot(`Did I get your facial hair right? It looks like <b>${a.beardLabel}</b>.`);
    const opts = [["clean", "Clean-shaven"], ["stubble", "Stubble"], ["short", "Short beard"], ["full", "Full beard"]];
    this.opt(opts.map(([k, l]) => ({ label: l, act: "beardIs", arg: k, primary: a.slots.style === k })));
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
    this.opt([{ label: "Keep & shape it", act: "goal", arg: "keep", primary: true }, { label: "Shave it off", act: "goal", arg: "shave" }, { icon: "beard", label: "Try other styles", act: "ar" }]);
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
    const t = this.totals();
    await this.ui.bot(`Your basket: <b>${t.n} item${t.n > 1 ? "s" : ""}, ${eur(t.total)}</b>${t.saved ? ` – you save ${eur(t.saved)} with 2+2` : ""}. How would you like to get it?`);
    const o = [];
    if (s.entry === "shelf") o.push({ label: "Pick up now at the service desk", act: "fulfil", arg: "desk", primary: true });
    o.push({ label: "Delhaize Collect pick-up", act: "fulfil", arg: "collect", primary: s.entry !== "shelf", icon: "pin" }, { label: "Home delivery", act: "fulfil", arg: "delivery", icon: "box" }, { label: "View basket", act: "basket", icon: "basket" });
    this.opt(o);
  }
  async fulfil(how) {
    const s = this.s;
    s.fulfil = how;
    const min = { collect: 30, delivery: 60 }[how], t = this.totals();
    if (min && t.total < min) await this.ui.bot(`Note: online orders need at least <b>€${min}</b> (${how === "collect" ? "Delhaize Collect" : "home delivery"}) – most people add razors to their weekly groceries. For this demo we'll continue.`);
    if (how === "collect") return this.pickStore();
    if (how === "delivery") {
      s.pending = { input: "postcode" };
      this.opt([]);
      this.ui.focusInput("Postcode, e.g. 1050");
      return this.ui.bot(this.member ? `Delivery to your address in <b>${esc(s.profile.city)}</b>? Type the postcode to confirm, or a different one.` : "What's the delivery postcode?");
    }
    return this.needEmail();
  }
  async pickStore() {
    const s = this.s;
    const home = this.member ? storeByName(s.profile.store) : null;
    await this.ui.bot(home ? `Where do you want to pick it up? Your usual store <b>${esc(home.name)}</b> is at the top – or search another one.` : "Where do you want to pick it up? Search by city or postcode, or use your location.");
    if (home) this.sig("home store", `Pre-selected from the CRM: ${home.name}`);
    this.ui.storePicker({ stores: STORES, preferred: home?.id });
    this.opt(home ? [{ label: `Pick up at ${home.name.replace("Delhaize ", "")}`, act: "store", arg: home.id, primary: true }] : []);
  }
  async setStore(id) {
    const s = this.s, st = storeById(id);
    if (!st) return this.pickStore();
    s.store = st;
    this.sig("pick-up store", `${st.name}, ${st.postcode} ${st.city}`);
    await this.ui.bot(`Pick-up at <b>${esc(st.name)}</b>, ${esc(st.street)}, ${esc(st.postcode)} ${esc(st.city)}.`);
    return this.needEmail();
  }
  async needEmail() {
    const s = this.s;
    if (s.email) return this.finish();
    const crm = s.profile?.email;
    if (crm) {
      this.sig("email", "Taken from the CRM record – no need to ask");
      await this.ui.bot(`I'll send the confirmation to <b>${esc(mask(crm))}</b>.`);
      return this.opt([{ label: "Yes, send it there", act: "emailOk", primary: true, icon: "mail" }, { label: "Use another e-mail", act: "emailOther" }]);
    }
    return this.askEmail();
  }
  async askEmail(next) {
    this.s.pending = { input: "email", next };
    this.opt([]);
    this.ui.focusInput("name@example.com");
    return this.ui.bot(next === "signup" ? "And your e-mail address, so we can send you your card and reminders? <span class=\"muted\">(Demo – nothing is sent or stored.)</span>" : "Which e-mail address should the confirmation go to? <span class=\"muted\">(Demo – nothing is sent or stored.)</span>");
  }
  async finish() {
    const s = this.s; this.ui.step(6);
    if (!s.email && s.profile?.email) s.email = s.profile.email;
    const how = s.fulfil || "collect";
    const t = this.totals();
    const where = how === "desk" ? "Show this chat at the service desk – they'll hand you your order, no waiting at the locked case."
      : how === "delivery" ? `It will be delivered to ${esc(s.postcode || "your address")} – you can pick a delivery slot in the confirmation e-mail.`
      : `We'll let you know when it's ready for pick-up at ${esc(s.store?.name || "your Delhaize")}.`;
    await this.ui.bot(`Thank you${this.name ? ", " + esc(this.name) : ""}. Order <b>DL-${rnd(6)}</b> confirmed (${eur(t.total)}). ${where}${s.email ? ` Confirmation sent to <b>${esc(mask(s.email))}</b>.` : ""}`);
    if (this.member && !s.profile.isNew) { await this.ui.bot(`+${Math.round(t.total)} SuperPlus points – you now have ${s.profile.points + Math.round(t.total)}.`); this.sig("points", "Updated after purchase"); }
    if (this.member && s.profile.consent) {
      const days = s.profile.cycle || 35;
      await this.ui.bot(`I'll send you a reminder (${esc(s.profile.channel.toLowerCase())}) in about ${Math.round(days / 7)} weeks when your blades are due.`);
      this.sig("follow-up", `Replenishment reminder in ~${days} days`);
    }
    await this.ui.bot("One quick question: was this chat helpful?");
    const o = [];
    if (this.member && !s.profile.consent) o.push({ label: "Remind me when blades run out", act: "consent", arg: "yes" });
    if (!this.member) o.push({ label: "Join SuperPlus for next time", act: "signup" });
    o.push({ label: "Helpful", act: "rate", arg: "up", icon: "thumbUp" }, { label: "Not really", act: "rate", arg: "down", icon: "thumbDown" });
    this.opt(o);
  }
  async consent(v) {
    const s = this.s;
    const yes = v === "yes" || v === "signup-yes";
    if (s.profile) { s.profile.consent = yes; this.ui.profile(s); }
    this.sig(`marketing consent = ${yes ? "yes" : "no"}`, yes ? "Explicit opt-in (GDPR)" : "Respected – no reminders");
    if (v.startsWith("signup")) return s.fulfil && s.rating === null ? this.rate() : s.rec ? this.recommendNow(false, true) : this.consult();
    await this.ui.bot(yes ? `Done – I'll remind you by ${(s.profile?.channel || "e-mail").toLowerCase()}.` : "OK, no reminders.");
    return this.opt([{ icon: "thumbUp", label: "Helpful", act: "rate", arg: "up" }, { icon: "thumbDown", label: "Not really", act: "rate", arg: "down" }]);
  }
  async rate(v) {
    if (v) this.s.rating = v;
    await this.ui.bot(v === "down" ? "Thanks for the honest feedback – a colleague will review this chat to improve me." : "Thanks – enjoy your shave.");
    this.opt([{ icon: "refresh", label: "Start over", act: "restart", primary: true }, { label: "Something else", act: "menu" }]);
  }
  async signup() {
    this.ui.step(4);
    this.s.pending = { input: "name" };
    await this.ui.bot("Great choice! SuperPlus is free. What's your first name?");
    this.opt([]);
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
    const back = () => this.opt([{ label: "Back to shopping", act: "menu" }, { label: "That's all, thanks", act: "rate" }]);

    if (flow === "refund") {
      if (!ctx.channel) {
        if (ctx.orderNo) ctx.channel = "delivery";
        else {
          await this.ui.bot("Sorry it didn't work out. Where did you buy it?");
          const o = [];
          if (lastOrder) { this.sig("lastOrder", `Offered order ${lastOrder.no} from the CRM`); o.push({ label: `My order ${lastOrder.no} (${lastOrder.channel})`, act: "svc", arg: { flow, channel: lastOrder.channel === "Delhaize Collect" ? "collect" : "delivery", orderNo: lastOrder.no }, primary: true }); }
          o.push({ label: "In a Delhaize store", act: "svc", arg: { flow, channel: "store" } }, { label: "Online – home delivery", act: "svc", arg: { flow, channel: "delivery" } }, { label: "Online – Delhaize Collect", act: "svc", arg: { flow, channel: "collect" } });
          return this.opt(o);
        }
      }
      if (ctx.channel === "store") {
        await this.ui.bot("For products bought in store: bring the product and its packaging to the <b>service desk of the store where you bought it</b>. Delhaize refunds the product when you show your proof of purchase.");
        await this.ui.bot("No paper receipt? Your digital receipt works too (in the Delhaize app for 3 months, on delhaize.be for 1 year), or the desk can look it up with the date, payment method and total.");
        return back();
      }
      if (ctx.channel === "collect") {
        await this.ui.bot("For <b>Delhaize Collect</b> orders you check your products at pick-up and can refuse items right there. If you notice a quality problem later, the store's service desk refunds it with your receipt.");
        return back();
      }
      if (!ctx.orderNo) { s.pending = { input: "orderNo", flow, channel: "delivery" }; this.opt([]); this.ui.focusInput("Order number, e.g. DL-731554"); return this.ui.bot("What's your order number? It's in your confirmation e-mail (e.g. DL-731554)."); }
      if (!ctx.reason) {
        await this.ui.bot(`Order <b>${esc(ctx.orderNo)}</b> – what's the reason?`);
        return this.opt([["unopened", "Unopened – changed my mind"], ["opened", "Opened – didn't like it"], ["defect", "Damaged or defective"], ["skin", "Skin reaction"]].map(([k, l]) => ({ label: l, act: "svc", arg: { flow, channel: "delivery", orderNo: ctx.orderNo, reason: k } })));
      }
      if (ctx.reason === "unopened") {
        await this.ui.bot("You can withdraw from a home-delivery purchase <b>within 14 days of receiving it</b>, no reason needed. You'll get the money back on the same payment method within 14 days.");
        await ticket("Return", `Withdrawal for order ${ctx.orderNo} (unopened)`, "Send it back by post at your own cost, or have it picked up for €10 – free with your next delivery.");
        return back();
      }
      if (ctx.reason === "opened") {
        await this.ui.bot("I'm sorry – sealed hygiene products like razor blades can't be returned once the seal is broken, for health reasons. But if something is wrong with the product, it's covered.");
        await this.ui.bot("Want me to find something that suits you better instead?");
        return this.opt([{ label: "Yes, find a better match", act: "set", arg: {}, primary: true }, { label: "It's actually defective", act: "svc", arg: { flow: "defect", orderNo: ctx.orderNo } }]);
      }
      if (ctx.reason === "skin") return this.service("injury", { orderNo: ctx.orderNo });
      return this.service("defect", { orderNo: ctx.orderNo });
    }

    if (flow === "order_status") {
      const no = ctx.orderNo || lastOrder?.no;
      if (!no) { s.pending = { input: "orderNo", flow }; this.opt([]); this.ui.focusInput("Order number, e.g. DL-731554"); return this.ui.bot("Let me check. What's your order number? (It's in your confirmation e-mail, e.g. DL-731554.)"); }
      if (!ctx.orderNo && lastOrder) this.sig("lastOrder", `Order ${no} picked from CRM – no need to ask`);
      const st = lastOrder && lastOrder.no === no ? lastOrder.status : ["preparing", "out", "ready", "delivered"][parseInt(no.replace(/\D/g, "").slice(-1), 10) % 4];
      const txt = { preparing: "is being prepared – it'll be ready within 2 hours", out: "is <b>out for delivery</b> – expected today between 14:00 and 16:00", ready: `is <b>ready for pick-up</b>${this.member ? " at " + esc(s.profile.store) : ""}`, delivered: "was <b>delivered</b> – if something is missing, tell me" }[st];
      await this.ui.bot(`Order <b>${esc(no)}</b> ${txt}.`);
      this.ui.orderTrack(st);
      return back();
    }

    if (flow === "defect") {
      const prod = ctx.product ? BY_ID[ctx.product] : null;
      if (!prod && !ctx.productText) { s.pending = { input: "product", flow, orderNo: ctx.orderNo }; this.opt([]); this.ui.focusInput("Product and what's wrong…"); return this.ui.bot("I'm sorry about that. Which product is it, and what's wrong with it?"); }
      const what = prod ? prod.short : ctx.productText;
      await this.ui.bot(`Products have a <b>2-year legal guarantee</b>. ${ctx.orderNo ? "For your online order I've opened a case:" : "Bring it with your receipt to the service desk – or I can open a case now:"}`);
      await ticket("Defect", `${esc(what)}${ctx.orderNo ? " · order " + esc(ctx.orderNo) : ""}`, ctx.orderNo ? "Customer service contacts you within 1 working day for a replacement or refund." : "Show this reference at the service desk.");
      return back();
    }

    if (flow === "injury") {
      await this.ui.bot("I'm sorry! First aid: rinse with <b>cold water</b>, press a clean tissue on small cuts for a few minutes, then apply an alcohol-free balm. Don't shave the area for a day or two.");
      await this.ui.bot("<b>Important:</b> if bleeding doesn't stop after 10 minutes, or you notice swelling, hives or trouble breathing, see a doctor – in an emergency call <b>112</b>.");
      await ticket("Product report", `Skin reaction / injury${ctx.orderNo ? " · order " + esc(ctx.orderNo) : ""}`, `Our quality team may contact you. You can also call customer service free on ${PHONE}.`);
      this.opt([{ label: "Show sensitive-skin products", act: "irritation", primary: true }, { label: "Back to shopping", act: "menu" }]);
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
      if (!no) { s.pending = { input: "orderNo", flow }; this.opt([]); this.ui.focusInput("Order number, e.g. DL-731554"); return this.ui.bot("Which order should I cancel? Please type the order number."); }
      await this.ui.bot(`Order <b>${esc(no)}</b> wasn't prepared yet, so I've <b>cancelled</b> it. Any payment is refunded to the same payment method.`);
      return back();
    }

    if (flow === "delivery_info") {
      await this.ui.bot(`<b>Home delivery</b> (Delhaize Delivery): from the next day, Monday–Saturday in two windows (7:00–14:00 or 14:00–21:00). The fee depends on day and slot – roughly €6–13, shown before you confirm – and the minimum order is €60. Enter your postcode on delhaize.be to see if your area is served.`);
      await this.ui.bot(`<b>Delhaize Collect</b>: free pick-up at one of ~170 collect points, minimum €30, you pay when you pick up. You can change or cancel until 10:00 the day before.`);
      this.sig("source", "Delhaize terms & help centre (Nov 2026)");
      return this.opt([{ label: "Find a pick-up store", act: "pickStore", icon: "pin" }, { label: "Back to shopping", act: "menu" }]);
    }

    if (flow === "wrong_item") {
      const no = ctx.orderNo || lastOrder?.no;
      if (!no) { s.pending = { input: "orderNo", flow }; this.opt([]); this.ui.focusInput("Order number, e.g. DL-731554"); return this.ui.bot("Sorry about that. Which order was it? (The number is in your confirmation e-mail, e.g. DL-731554.)"); }
      if (!ctx.orderNo && lastOrder) this.sig("lastOrder", `Order ${no} picked from the CRM`);
      await this.ui.bot(`Sorry about order <b>${esc(no)}</b>. Tip for next time: you can check the crates at the door or the collect point and refuse wrong items right there – they're taken off the bill. Found it later? I've reported it to customer service:`);
      await ticket("Wrong / missing item", `Order ${esc(no)}`, "Customer service contacts you within 48 hours about a replacement or a refund. Keep the wrong item until then.");
      return back();
    }

    if (flow === "billing") {
      await this.ui.bot("For online orders Delhaize first <b>reserves</b> the order total plus 5% on your card and only charges the real amount at delivery – the rest of the reservation is released by your bank. That can look like a double or too-high charge for a few days.");
      await ticket("Payment check", `${ctx.orderNo ? "Order " + esc(ctx.orderNo) : "Online order"} – amount on card looks wrong`, `If it's still there after a few days, customer service checks it: free on ${PHONE} or klantendienst@delhaize.be.`);
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
      return this.opt([{ label: "Clear this chat", act: "restart" }, { label: "Back to shopping", act: "menu" }]);
    }

    if (flow === "human") {
      await this.ui.bot(`Of course. Delhaize customer service is free on <b>${PHONE}</b> (Mon–Fri 7–21, Sat 8–18, Sun 8–13), or via the contact form on <a href="${HELP_URL}" target="_blank" rel="noopener">help.delhaize.be</a>. In store, the service desk is happy to help.`);
      await ticket("Callback note", "Chat transcript attached for the agent", "Mention this reference so you don't have to repeat yourself.");
      return back();
    }

    if (flow === "complaint") {
      if (!ctx.description) { s.pending = { input: "describe", flow }; this.opt([]); this.ui.focusInput("Describe what happened…"); return this.ui.bot("I'm really sorry to hear that. What happened? Tell me in a sentence or two and I'll pass it on."); }
      await this.ui.bot("Thank you for telling me – I've passed it on to customer service.");
      await ticket("Complaint", esc(ctx.description.slice(0, 140)), `They'll reply within 2 working days. Urgent? Call ${PHONE} (free).`);
      return back();
    }
    return this.fallback();
  }
}

export const ALL_PRODUCTS = CATALOG;
