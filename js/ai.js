// Optional AI layer for turns the built-in engine is unsure about. Two hosts:
//  - claude.ai Artifact: Claude on the viewer's own account (sample capability, real tool calls, photo analysis);
//  - presenter version (server/sam-ai.mjs on the owner's tailnet): Claude on the owner's own subscription,
//    returns {reply, actions} which run through the same page tools.
// On GitHub Pages neither exists and this returns null – the engine (classifier + guide) handles everything.
import { CATALOG, BY_ID } from "./catalog.js";
import { summary } from "./recommend.js";

const POLICY = `Facts you may use (do not invent others):
- In-store purchases: quality problems → bring product + packaging to the service desk of that store with proof of purchase; Delhaize refunds. Digital receipt counts (app 3 months, delhaize.be 1 year).
- Home delivery: withdraw within 14 days of receipt without reason; refund on same payment method within 14 days; return by post at own cost or pick-up €10 (free with next delivery). Sealed hygiene products (e.g. razor blades) whose seal was broken cannot be withdrawn.
- Delhaize Collect: free pick-up at ~170 collect points, minimum €30, pay at pick-up; change/cancel until 10:00 the day before; check goods at pick-up and refuse items there.
- Home delivery (Delhaize Delivery): from the next day, Mon–Sat 7–14h or 14–21h, fee roughly €6–13 shown before confirming, minimum order €60.
- Online card payments: Delhaize reserves the total + 5% and captures the real amount at delivery; the rest is released (can look like a double charge for a few days).
- Wrong/missing items: refuse at handover; found later → report to customer service as soon as possible (klantendienst@delhaize.be, replies within 48 h).
- Defects: 2-year legal guarantee.
- Customer service: free 0800 95 713 (Mon–Fri 7–21, Sat 8–18, Sun 8–13), help.delhaize.be.
- Promotion 4–18 Nov 2026: SuperPlus members get 2+2 free on ProGlide / ProGlide Power refills and GilletteLabs body blades.
- Refills: Fusion5 and ProGlide fit each other's handles; Mach3 only Mach3; Labs and SkinGuard have their own.
- Injuries: cold water, pressure, alcohol-free balm; doctor if bleeding >10 min, swelling, hives; emergency 112.`;

const SLOT_SCHEMA = {
  type: "object",
  properties: {
    for: { enum: ["me", "gift"] }, recipient: { type: "string" }, gender: { enum: ["m", "f", "?"] },
    area: { enum: ["face", "beard", "body", "head"] }, skin: { enum: ["sensitive", "normal"] },
    concerns: { type: "array", items: { enum: ["razor burn", "redness", "ingrown hairs", "dryness", "oily skin", "breakouts", "irritation"] } },
    owned: { enum: ["mach3", "proglide", "fusion5", "labs", "skinguard", "venus", "disposable", "safety", "electric"] }, handle: { enum: ["yes", "no"] },
    style: { enum: ["clean", "stubble", "short", "full", "circle", "moustache"] }, budget: { type: "number" }, freq: { enum: ["daily", "weekly", "rarely"] },
    wantType: { enum: ["razor", "blades", "gel", "care", "oil", "trimmer"] },
  },
};

const catalogText = () => CATALOG.map((p) => `${p.id}|${p.short}|${p.line}|${p.role}|€${p.price}|${p.areas.join("/")}|sens${p.sens}${p.gender ? "|" + p.gender : ""}`).join("\n");
const SERVICE = ["refund", "order_status", "delivery_info", "wrong_item", "billing", "defect", "injury", "cancel", "invoice", "privacy", "human", "complaint"];
const ADVICE_TOPICS = ["how_to_shave", "blade_change", "razor_burn", "ingrown", "beard_trim", "beard_grow", "beard_care", "head_shave", "body_shave"];

function rulesFor(bot) {
  const s = bot.s;
  const state = {
    mode: s.mode || "none", member: s.profile && !s.profile.isNew ? { name: s.profile.name, age: s.profile.age, city: s.profile.city, store: s.profile.store, owns: s.profile.razor, lastOrder: s.profile.lastOrder, consent: s.profile.consent } : null,
    known: summary(s.slots), slots: s.slots, routine: s.rec ? s.rec.steps.map((x) => x.item.id) : null, basket: s.basket.map((b) => b.label), entry: s.entry,
    engineGuess: bot.lastClass ? bot.lastClass.ranked.slice(0, 3).map((x) => `${x.id} ${x.score.toFixed(2)}`) : null,
  };
  return `You are Sam, Gillette's shave expert inside Delhaize's shopping chat (a student concept). Be warm, short and concrete.
Reply in the shopper's language (English, French, Dutch or German). Act through the tools – they show cards, buttons and tickets in the chat.
The built-in engine was unsure about this message; its top guesses are in the state. Work out what the shopper wants and lead them to the right place.
- Product needs: set_needs with everything you understood, then recommend_routine if area+skin are known (and for face shaving whether they own a handle), otherwise ask_next_question.
- Shaving/beard how-to questions: give_advice with the topic.
- Service requests: open_service with the flow.
- Photo/skin/beard analysis → start_photo_check. Beard styles / "how would I look" → start_ar. Basket → show_basket. Paying → go_checkout.
- Nothing fits (off-topic): no tool, reply briefly that you help with shaving, beard care and Delhaize orders, and suggest one concrete thing.
- Only recommend products from the catalogue. Never invent prices, policies or order data.
- Your reply appears below the cards the tools showed: at most 2 short sentences, no lists, no emojis, don't repeat card contents, don't say "below".
${POLICY}
Catalogue (id|name|line|role|price|areas|sensitivity 0-2|gender):
${catalogText()}
Current state: ${JSON.stringify(state)}`;
}

function toolsFor(bot) {
  const s = bot.s;
  return [
    { name: "set_needs", description: "Store what the shopper needs (only fields you understood). Returns the summary.", inputSchema: SLOT_SCHEMA,
      execute: (inp) => { for (const [k, v] of Object.entries(inp || {})) if (k in SLOT_SCHEMA.properties && v !== null && v !== "") s.slots[k] = v; if (!s.mode) s.mode = "guest"; bot.ui.profile(s); bot.sig("AI: needs", JSON.stringify(inp)); return { known: summary(s.slots) }; } },
    { name: "ask_next_question", description: "Show the next missing question with answer buttons.", execute: async () => { await bot.consult(); return "asked"; } },
    { name: "recommend_routine", description: "Show the personal routine card for the stored needs. Returns the chosen products and total.", execute: async () => { await bot.recommendNow(!!s.rec); return { items: s.rec.steps.map((x) => x.item.short), total: s.rec.total }; } },
    { name: "show_products", description: "Show product cards by catalogue id.", inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
      execute: (inp) => { const ids = (inp.ids || []).filter((id) => BY_ID[id]).slice(0, 6); bot.ui.products(ids); return { shown: ids }; } },
    { name: "add_to_basket", description: "Add products to the basket (deal=true applies SuperPlus 2+2 for members) and offer checkout.", inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, deal: { type: "boolean" } }, required: ["ids"] },
      execute: async (inp) => { const ids = (inp.ids || []).filter((id) => BY_ID[id]); bot.addItems(ids, !!inp.deal); await bot.afterAdd(); return { basket: s.basket.map((b) => b.label) }; } },
    { name: "give_advice", description: "Show Gillette's tips card for a shaving or beard topic.", inputSchema: { type: "object", properties: { topic: { enum: ADVICE_TOPICS } }, required: ["topic"] },
      execute: async (inp) => { await bot.advice(inp.topic); return "shown"; } },
    { name: "open_service", description: "Handle a customer-service request with the official flow (shows instructions/tickets).", inputSchema: { type: "object", properties: { flow: { enum: SERVICE }, orderNo: { type: "string" }, channel: { enum: ["store", "delivery", "collect"] }, reason: { enum: ["unopened", "opened", "defect", "skin"] }, description: { type: "string" } }, required: ["flow"] },
      execute: async (inp) => { const ctx = {}; for (const k of ["orderNo", "channel", "reason", "description"]) if (inp[k]) ctx[k] = inp[k]; await bot.service(inp.flow, ctx); return "shown"; } },
    { name: "start_photo_check", description: "Ask for a selfie for the skin & beard check.", execute: async () => { await bot.photoStart(); return "photo prompt shown"; } },
    { name: "start_ar", description: "Open the beard-style try-on.", inputSchema: { type: "object", properties: { style: { enum: ["clean", "stubble", "short", "full", "circle", "moustache"] } } }, execute: async (inp) => { await bot.arStart(inp?.style); return "opened"; } },
    { name: "show_basket", description: "Open the basket.", execute: async () => { await bot.showBasket(true); return "shown"; } },
    { name: "go_checkout", description: "Show basket total and the pick-up/delivery choice.", execute: async () => { await bot.checkout(); return "shown"; } },
  ];
}

/** Presenter version: same origin serves /api/turn (server/sam-ai.mjs). */
async function serverAI(onStatus) {
  // Only the presenter host has /api – don't probe on GitHub Pages or other static hosts.
  const presenter = /\.ts\.net$/.test(location.hostname) || location.port === "8117" || new URLSearchParams(location.search).has("ai");
  if (!presenter) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  const h = await fetch("api/health", { signal: ctl.signal, cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  clearTimeout(t);
  if (!h?.ok) return null;
  onStatus?.("Presenter version: when Sam is unsure, Claude (owner's own subscription) takes the turn.");
  const history = [];
  return {
    available: () => true,
    images: () => false,
    async turn(text, bot) {
      const tools = toolsFor(bot);
      const toolDoc = tools.map((x) => `- ${x.name}: ${x.description}${x.inputSchema ? " Input: " + JSON.stringify(x.inputSchema.properties) : ""}`).join("\n");
      history.push({ role: "user", content: text });
      while (history.length > 12) history.shift();
      const system = `${rulesFor(bot)}

Answer with JSON {"reply": string, "actions": [{"tool": name, "input": {...}}]}. The page runs the actions in order (max 4), then shows the reply. Tools:
${toolDoc}`;
      bot.ui.thinking(true);
      try {
        const ctl2 = new AbortController();
        const t2 = setTimeout(() => ctl2.abort(), 40000);
        const r = await fetch("api/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system, messages: history }), signal: ctl2.signal });
        clearTimeout(t2);
        if (!r.ok) throw new Error("http " + r.status);
        const out = await r.json();
        bot.ui.thinking(false);
        bot.sig("AI turn", `Claude: ${out.actions.map((a) => a.tool).join(", ") || "reply only"}`);
        for (const a of out.actions) {
          const tool = tools.find((x) => x.name === a.tool);
          if (tool) await tool.execute(a.input || {});
        }
        const reply = (out.reply || "").replace(/[<>]/g, "").trim();
        if (reply) { history.push({ role: "assistant", content: reply }); await bot.ui.bot(reply); }
        return !!(reply || out.actions.length);
      } catch (e) {
        bot.ui.thinking(false);
        history.pop();
        console.warn("AI turn failed", e);
        return false;
      }
    },
    analyzePhoto: async () => null,
  };
}

export async function initAI(onStatus) {
  if (!window.claude || typeof window.claude.use !== "function") return serverAI(onStatus);
  const sample = await window.claude.use("sample").catch(() => null);
  if (!sample) return null;
  const limits = await sample.limits().catch(() => null);
  let disabled = false;
  const history = [];
  onStatus?.("AI mode: Claude understands free text and photos in this view (uses your own Claude account).");

  function fail(e) {
    if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed", "tools_unavailable"].includes(e?.code)) {
      disabled = true;
      onStatus?.("AI mode off – using the built-in engine.");
    }
    return false;
  }

  return {
    available: () => !disabled && !!limits?.tools,
    images: () => !disabled && !!limits?.images,

    async turn(text, bot) {
      const rules = rulesFor(bot);
      const tools = toolsFor(bot);
      history.push({ role: "user", content: text });
      while (history.length > 12) history.shift();
      bot.ui.thinking(true);
      try {
        const { text: out } = await sample([{ role: "user", content: rules }, ...history], { tools, modelTier: "quick" });
        bot.ui.thinking(false);
        const final = (out || "").split(/\n\s*\n/).pop().trim();
        if (final) { history.push({ role: "assistant", content: final }); await bot.ui.bot(final.replace(/[<>]/g, "")); }
        return true;
      } catch (e) {
        bot.ui.thinking(false);
        history.pop();
        return fail(e);
      }
    },

    async analyzePhoto(file) {
      if (disabled || !limits?.images) return null;
      try {
        const r = await sample.json(`This is a selfie a shopper uploaded for a cosmetic grooming check in a shaving shop (not medical). Reply with only JSON:
{"face": boolean, "beard": "clean"|"stubble"|"short"|"full", "redness": 0..1, "shine": 0..1, "texture": 0..1, "notes": {"beard": string, "redness": string, "shine": string, "texture": string}}
Each note: one short friendly English sentence about what you see. If there is no clear face, set face false.`, { images: [file], modelTier: "default" });
        if (!r || !r.face) return { noFace: true };
        const cls = ["clean", "stubble", "short", "full"].indexOf(r.beard);
        const beardClass = cls < 0 ? 0 : cls;
        const labels = ["clean-shaven", "stubble", "short beard", "full beard"];
        const v = (x) => Math.max(0, Math.min(1, Number(x) || 0));
        const findings = [
          { key: "beard", label: "Facial hair", value: [0.05, 0.3, 0.6, 0.9][beardClass], text: r.notes?.beard || `Looks like ${labels[beardClass]}.` },
          { key: "redness", label: "Redness", value: v(r.redness), text: r.notes?.redness || "" },
          { key: "shine", label: "Shine (T-zone)", value: v(r.shine), text: r.notes?.shine || "" },
          { key: "texture", label: "Skin texture", value: v(r.texture), text: r.notes?.texture || "" },
        ];
        const concerns = [];
        if (v(r.redness) > 0.3) concerns.push("redness");
        if (v(r.shine) > 0.5) concerns.push("oily skin");
        if (v(r.texture) > 0.6) concerns.push("ingrown hairs");
        return { source: "ai", beardClass, beardLabel: labels[beardClass], findings, quality: "ok",
          slots: { area: beardClass >= 2 ? "beard" : "face", style: ["clean", "stubble", "short", "full"][beardClass], ...(concerns.length ? { skin: "sensitive", concerns } : {}) } };
      } catch (e) { fail(e); return null; }
    },
  };
}
