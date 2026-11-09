import { test } from "node:test";
import assert from "node:assert/strict";
import { Bot } from "../js/dialog.js";
import { CRM } from "../js/crm.js";

class FakeUI {
  constructor() { this.log = []; this.opts = []; this.stepN = 0; this.routines = []; this.tickets = []; }
  async bot(h) { this.log.push("BOT " + h.replace(/<[^>]+>/g, "")); }
  user(t) { this.log.push("USER " + t); }
  sys(t) { this.log.push("SYS " + t.replace(/<[^>]+>/g, "")); }
  options(o) { this.opts = o; }
  step(n) { this.stepN = n; }
  signal() {} profile() {} landing() {} personas() {} hint() {} focusInput() {} basket() {} basketCard() {}
  welcome() { this.welcomed = true; } guide(g) { this.guided = g; } advice(a) { this.advices = [...(this.advices || []), a]; } storePicker(o) { this.picker = o; } openBasket() { this.basketOpen = true; } closeBasket() {}
  products() {} compare() {} photoPrompt() {} consultResult() {} openAR() {} orderTrack() {} restart() { this.restarted = true; }
  routine(r) { this.routines.push(r); }
  ticket(t) { this.tickets.push(t); }
  last() { return this.log.filter((l) => l.startsWith("BOT")).slice(-1)[0] || ""; }
  all() { return this.log.join("\n"); }
}
const mk = () => { const ui = new FakeUI(); const bot = new Bot(ui, CRM); return { ui, bot }; };
const ids = (r) => r.steps.map((s) => s.item.id);

test("one typed sentence jumps straight to a routine within budget", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("I'm looking for a gift for my boyfriend, he has a short beard and sensitive skin, max 30 euros");
  assert.equal(ui.stepN, 3, ui.all());
  const r = ui.routines.at(-1);
  assert.ok(r.total <= 30, String(r.total));
  assert.match(ui.all(), /Got it: gift for your boyfriend/);
});
test("partial info → asks only the missing question", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("I need a new razor, I get razor burn");
  assert.match(ui.last(), /Who are we shopping for|What do you want|razor handle/);
  assert.ok(!/How does your skin react/.test(ui.all()));
});
test("refund by typing → asks channel → store instructions", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("I want a refund");
  assert.match(ui.last(), /Where did you buy it/);
  await bot.choose(ui.opts.find((o) => /store/.test(o.label)));
  assert.match(ui.all(), /service desk of the store/);
});
test("refund online with order number and unopened → 14 days + ticket", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("I'd like to return order DL-123456");
  assert.match(ui.last(), /reason/);
  await bot.choose(ui.opts.find((o) => /Unopened/.test(o.label)));
  assert.match(ui.all(), /within 14 days/);
  assert.equal(ui.tickets.length, 1);
});
test("order status asks for number, then answers", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("where is my order");
  assert.match(ui.last(), /order number/);
  await bot.onText("it's 778899");
  assert.match(ui.all(), /Order 778899/);
});
test("member order status uses CRM order without asking", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.act("persona", "lucas");
  await bot.onText("has my order arrived?");
  assert.match(ui.all(), /CG-482913.*ready for pick-up/s);
});
test("injury gives first aid + 112", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("I cut myself and it keeps bleeding");
  assert.match(ui.all(), /112/);
});
test("complaint collects description and opens ticket", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("I'm really disappointed");
  await bot.onText("the blades were blunt after two shaves");
  assert.equal(ui.tickets.length, 1);
});
test("human handover gives phone number", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("can I talk to a real person");
  assert.match(ui.all(), /0800 95 713/);
});
test("compatibility question", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("does proglide fit my mach3?");
  assert.match(ui.all(), /No – /);
});
test("refining after a routine rebuilds it", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("razor for my face, I have no razor yet, normal skin");
  const n = ui.routines.length;
  await bot.onText("actually my skin gets red");
  assert.ok(ui.routines.length > n, ui.all());
});
test("gibberish → helpful fallback", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("asdf qwerty");
  assert.match(ui.last(), /not sure I understood/);
  assert.ok(ui.guided?.length >= 3, "guide menu shown");
  await bot.onText("zzzz blorp");
  assert.match(ui.last(), /0800 95 713/, "second miss offers a person");
});
test("Lucas restock → 2+2 option", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.act("persona", "lucas");
  await bot.choose(ui.opts.find((o) => /Restock/.test(o.label)));
  assert.ok(ui.opts.some((o) => /2\+2/.test(o.label)));
  await bot.choose(ui.opts.find((o) => /2\+2/.test(o.label)));
  assert.equal(ui.stepN, 5);
});
test("guest signup by typing name unlocks promo", async () => {
  const { ui, bot } = mk();
  await bot.start();
  await bot.onText("I need proglide blades for my fusion5 handle, normal skin");
  await bot.choose(ui.opts.find((o) => /Join SuperPlus/.test(o.label)));
  await bot.onText("lea");
  assert.match(ui.all(), /Welcome to SuperPlus, Lea/);
  await bot.onText("not an email");
  assert.match(ui.last(), /doesn't look like an e-mail/);
  await bot.onText("lea@example.com");
  await bot.choose(ui.opts.find((o) => /Yes, remind/.test(o.label)));
  assert.ok(ui.opts.some((o) => /2\+2/.test(o.label)), JSON.stringify(ui.opts));
});
