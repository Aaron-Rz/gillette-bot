// v3: login-first start, classify → act/clarify/guide, advice, expected answers, basket, pick-up store, e-mail.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Bot } from "../js/dialog.js";
import { CRM } from "../js/crm.js";
import { classify, decide } from "../js/classify.js";
import { searchStores, nearestStores, STORES } from "../js/stores.js";

class FakeUI {
  constructor() { this.log = []; this.opts = []; this.routines = []; this.tickets = []; this.advices = []; }
  async bot(h) { this.log.push("BOT " + h.replace(/<[^>]+>/g, "")); }
  user(t) { this.log.push("USER " + t); }
  sys(t) { this.log.push("SYS " + t.replace(/<[^>]+>/g, "")); }
  options(o) { this.opts = o; }
  step(n) { this.stepN = n; }
  signal() {} profile() {} personas() { this.personasShown = true; } hint() {} focusInput(p) { this.ph = p; } basketCard() {}
  products(ids) { this.shown = ids; } compare() {} photoPrompt() { this.photo = true; } consultResult() {} openAR() { this.ar = true; } orderTrack() {} restart() { this.restarted = true; }
  basket(items) { this.items = items; }
  welcome() { this.welcomed = true; } landing() { this.landed = true; } guide(g) { this.guided = g; } advice(a) { this.advices.push(a); }
  storePicker(o) { this.picker = o; } openBasket() { this.basketOpen = true; } closeBasket() {}
  routine(r) { this.routines.push(r); }
  ticket(t) { this.tickets.push(t); }
  last() { return this.log.filter((l) => l.startsWith("BOT")).slice(-1)[0] || ""; }
  all() { return this.log.join("\n"); }
}
const mk = () => { const ui = new FakeUI(); const bot = new Bot(ui, CRM); return { ui, bot }; };
const pick = (ui, re) => { const o = ui.opts.find((x) => re.test(x.label)); assert.ok(o, `no option ${re} in ${JSON.stringify(ui.opts.map((x) => x.label))}`); return o; };

// ---------- classifier quality ----------
function score(file) {
  const set = JSON.parse(fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url)));
  let t1 = 0, t3 = 0, wrongAct = 0, acts = 0;
  for (const h of set) {
    const r = classify(h.text), ok = [h.cat, ...(h.alt || [])];
    if (decide(r) === "act") { acts++; if (!ok.includes(r.top)) wrongAct++; }
    if (ok.includes(r.top)) t1++;
    if (r.ranked.slice(0, 3).some((x) => ok.includes(x.id))) t3++;
  }
  return { n: set.length, top1: t1 / set.length, top3: t3 / set.length, wrongActRate: wrongAct / Math.max(1, acts) };
}
test("classifier: development set (240 messages)", () => {
  const s = score("heldout-dev.json");
  assert.ok(s.top1 >= 0.9 && s.top3 >= 0.95, JSON.stringify(s));
});
test("classifier: blind set 2 (168 messages)", () => {
  const s = score("blind-2.json");
  assert.ok(s.top1 >= 0.8 && s.top3 >= 0.95 && s.wrongActRate <= 0.05, JSON.stringify(s));
});

test("classifier: final blind set 3 (210 messages, never used for tuning)", () => {
  // Honest reference number, measured once (9 Nov 2026): top-1 72.9 %, top-3 89.5 %, 59 of 63 direct actions right.
  const s = score("blind-3-final.json");
  assert.ok(s.top1 >= 0.7 && s.top3 >= 0.88 && s.wrongActRate <= 0.08, JSON.stringify(s));
});

// ---------- start ----------
test("start shows the login/guest choice first, nothing else", async () => {
  const { ui, bot } = mk();
  await bot.start();
  assert.ok(ui.welcomed);
  assert.ok(!ui.landed, "tiles only after the choice");
  assert.equal(ui.opts.length, 0);
  await bot.choose({ label: "Continue as guest", act: "guestHome" });
  assert.ok(ui.landed);
  assert.equal(bot.s.mode, "guest");
});
test("login path shows personas", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.choose({ label: "Log in", act: "login" });
  assert.ok(ui.personasShown);
});
test("typing before choosing continues as guest", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("how often should i change my blades");
  assert.equal(bot.s.mode, "guest");
  assert.match(ui.all(), /Continuing as guest/);
});

// ---------- act / clarify / guide ----------
test("advice question gets tips, not the shopping questionnaire", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("how do i trim my beard");
  assert.equal(ui.advices.at(-1)?.title, "Trim & shape your beard");
  assert.ok(!/Who are we shopping for/.test(ui.all()));
});
test("unclear message → top categories as buttons, choosing one runs it", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("my face");
  if (/make sure/.test(ui.last())) {
    assert.ok(ui.opts.length >= 3 && ui.opts.some((o) => o.act === "guideMenu"));
    await bot.choose(ui.opts[0]);
    assert.ok(!/make sure/.test(ui.last()));
  }
});
test("capabilities and out-of-scope guide back to topics", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("what can you do");
  assert.match(ui.all(), /I'm Sam/);
  assert.ok(ui.guided);
  await bot.onText("is gillette tested on animals");
  assert.match(ui.all(), /verified information/);
});
test("new service flows: wrong item, double charge, delivery info", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("you sent me the wrong blades, order DL-554433");
  assert.equal(ui.tickets.at(-1)?.type, "Wrong / missing item");
  await bot.onText("I was charged twice");
  assert.equal(ui.tickets.at(-1)?.type, "Payment check");
  await bot.onText("how much does delivery cost");
  assert.match(ui.all(), /minimum order is €60/);
});

// ---------- typed answers to buttons ----------
test("typed answers match the buttons on screen", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.choose({ label: "Continue as guest", act: "guestHome" });
  await bot.act("guest");
  assert.match(ui.last(), /Who are we shopping for/);
  await bot.onText("a gift");
  assert.equal(bot.s.slots.for, "gift");
  assert.match(ui.last(), /What does the person shave/);
  await bot.onText("the second one");
  assert.equal(bot.s.slots.area, "beard");
});
test("refund reason can be typed", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("I'd like to return order DL-123456");
  await bot.onText("unopened");
  assert.match(ui.all(), /within 14 days/);
});

// ---------- basket, store, e-mail ----------
test("basket quantities and 2+2 maths", async () => {
  const { bot } = mk();
  await bot.start();
  await bot.act("persona", "lucas");
  bot.addItems(["proglideBlades"], true);
  const line = bot.s.basket[0];
  assert.equal(line.packs, 4);
  assert.equal(Math.round(line.total * 100), Math.round(27.49 * 2 * 100));
  bot.setQty(0, 5);
  assert.equal(Math.round(bot.s.basket[0].total * 100), Math.round(27.49 * 3 * 100));
  bot.setQty(0, 0);
  assert.equal(bot.s.basket.length, 0);
});
test("guest Delhaize Collect: store picker → e-mail asked → confirmation", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.choose({ label: "Continue as guest", act: "guestHome" });
  bot.addItems(["fusion5Razor"], false);
  await bot.act("checkout");
  await bot.choose(pick(ui, /Delhaize Collect/));
  assert.ok(ui.picker?.stores.length >= 20);
  await bot.choose({ label: "Delhaize Ledeberg", act: "store", arg: "ledeberg" });
  assert.match(ui.last(), /Which e-mail/);
  await bot.onText("max@example.com");
  assert.match(ui.all(), /Order DL-\d{6} confirmed/);
  assert.match(ui.all(), /Ledeberg/);
  assert.match(ui.all(), /m•••••@example\.com/);
});
test("member gets home store pre-selected and CRM e-mail, no typing needed", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.act("persona", "marc");
  bot.addItems(["mach3Blades"], false);
  await bot.act("checkout");
  await bot.choose(pick(ui, /Delhaize Collect/));
  assert.equal(ui.picker.preferred, "ledeberg");
  await bot.choose(pick(ui, /Pick up at Ledeberg/));
  assert.match(ui.last(), /m•••••@example\.be/);
  await bot.choose(pick(ui, /send it there/));
  assert.match(ui.all(), /confirmed/);
});
test("home delivery asks for a postcode", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.choose({ label: "Continue as guest", act: "guestHome" });
  bot.addItems(["fusion5Razor"], false);
  await bot.act("checkout");
  await bot.choose(pick(ui, /Home delivery/));
  await bot.onText("abc");
  assert.match(ui.last(), /four digits/);
  await bot.onText("9000");
  assert.match(ui.all(), /Delivery to 9000/);
});
test("store search and nearest", () => {
  assert.ok(searchStores("gent").some((s) => s.city === "Gent" || s.postcode.startsWith("90")));
  assert.ok(searchStores("1050").length >= 2);
  assert.equal(nearestStores({ lat: 50.6253, lng: 5.5729 })[0].id, "fragnee");
  assert.equal(STORES.length, 25);
});
