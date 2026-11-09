// Plain-text channel (WhatsApp / SMS / Messenger style): the same dialog core (dialog.js), rendered as text.
// Buttons become numbered choices, cards become short text blocks. Shows that Sam is channel-agnostic –
// only this thin adapter differs from the web UI.
import { BY_ID } from "../catalog.js";

const strip = (h) => String(h).replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const eur = (n) => "€" + n.toFixed(2).replace(".", ",");

export class TextChannel {
  /** @param {(line: string) => void} send  delivers one outgoing message */
  constructor(send) { this.send = send; this.opts = []; this.items = []; }
  // ---- UI interface used by the Bot ----
  async bot(html) { this.send(strip(html)); }
  user() {}
  sys(html) { this.send(`(${strip(html)})`); }
  hint() {}
  options(list) {
    this.opts = [...(this.prefix || []), ...(list || [])];
    this.prefix = null;
    if (this.opts.length) this.send(this.opts.map((o, i) => `${i + 1}. ${o.label}`).join("\n") + "\nReply with a number or type your answer.");
  }
  welcome() { this.send("Reply 1 to log in with SuperPlus or 2 to continue as a guest."); this.opts = [{ label: "Log in with SuperPlus", act: "login" }, { label: "Continue as guest", act: "guestHome" }]; }
  landing() { this.options([{ label: "Skin & beard check (send a selfie)", act: "photo" }, { label: "Find my razor", act: "guest" }, { label: "Help with an order", act: "cat", arg: { id: "order_status" } }]); }
  // persona choices are shown together with the next buttons (e.g. "Continue as guest")
  personas(list) { this.prefix = list.map((c) => ({ label: `${c.name}, ${c.age} – ${c.city}`, act: "persona", arg: c.id })); }
  guide(groups) { this.options(groups.flatMap((g) => g.items.map((it) => ({ label: `${g.title}: ${it.label}`, act: "cat", arg: { id: it.id } })))); }
  advice(a) { this.send(`${a.title}\n${a.tips.map((t, i) => `${i + 1}) ${t}`).join("\n")}\nSource: ${a.source}`); }
  routine(r) { this.send(`Your routine:\n${r.steps.map((s) => `• ${s.label}: ${s.item.short} – ${eur(s.item.price)}`).join("\n")}\nTotal ${eur(r.total)}`); }
  products(ids) { this.send(ids.map((id) => BY_ID[id]).filter(Boolean).map((p) => `• ${p.short} – ${eur(p.price)}`).join("\n")); }
  compare(ids) { this.products(ids); }
  basket(items) { this.items = items; }
  openBasket() { this.send(this.items.length ? `Basket:\n${this.items.map((b) => `• ${b.packs}× ${b.label} – ${eur(b.total)}`).join("\n")}` : "Your basket is empty."); }
  closeBasket() {}
  basketCard() { this.openBasket(); }
  storePicker({ stores, preferred }) {
    const list = preferred ? [...stores.filter((s) => s.id === preferred), ...stores.filter((s) => s.id !== preferred)] : stores;
    this.prefix = list.slice(0, 5).map((s) => ({ label: `${s.name}, ${s.postcode} ${s.city}`, act: "store", arg: s.id }));
  }
  ticket(t) { this.send(`${t.type} – reference ${t.id}\n${strip(t.details)}\n${t.next}`); }
  orderTrack(status) { this.send(`Status: ${status}`); }
  photoPrompt() { this.send("Send a front-facing selfie in daylight. (In this channel the photo would be analysed by the server-side model.)"); }
  consultResult(a) { this.send(a.findings.map((f) => `${f.label}: ${f.text}`).join("\n")); }
  openAR() { this.send("Beard try-on needs the camera – open the web version: https://aaron-rz.github.io/gillette-bot/"); }
  step() {} signal() {} profile() {} focusInput() {} restart() {} thinking() {}
  // ---- incoming text: numbers pick a choice, anything else goes to the bot's text understanding ----
  async receive(bot, text) {
    const n = Number(String(text).trim());
    if (Number.isInteger(n) && n >= 1 && n <= this.opts.length) {
      const o = this.opts[n - 1];
      this.opts = [];
      return bot.act(o.act, o.arg);
    }
    return bot.onText(text);
  }
}
