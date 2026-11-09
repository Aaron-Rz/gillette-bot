// Optional AI mode: when the page runs as a claude.ai Artifact, Claude (on the viewer's own account) takes over
// free-text turns and photo analysis, acting through page tools. Everywhere else this returns null.
import { CATALOG, BY_ID } from "./catalog.js";
import { summary } from "./recommend.js";

const POLICY = `Facts you may use (do not invent others):
- In-store purchases: quality problems → bring product + packaging to the service desk of that store with proof of purchase; Delhaize refunds. Digital receipt counts (app 3 months, delhaize.be 1 year).
- Home delivery: withdraw within 14 days of receipt without reason; refund on same payment method within 14 days; return by post at own cost or pick-up €10 (free with next delivery). Sealed hygiene products (e.g. razor blades) whose seal was broken cannot be withdrawn.
- Collect&Go: check goods at pick-up and refuse items there.
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

export async function initAI(onStatus) {
  if (!window.claude || typeof window.claude.use !== "function") return null;
  const sample = await window.claude.use("sample").catch(() => null);
  if (!sample) return null;
  const limits = await sample.limits().catch(() => null);
  let disabled = false;
  const history = [];
  const catalogText = CATALOG.map((p) => `${p.id}|${p.short}|${p.line}|${p.role}|€${p.price}|${p.areas.join("/")}|sens${p.sens}${p.gender ? "|" + p.gender : ""}`).join("\n");
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
      const s = bot.s;
      const state = {
        mode: s.mode || "none", member: s.profile && !s.profile.isNew ? { name: s.profile.name, age: s.profile.age, city: s.profile.city, store: s.profile.store, owns: s.profile.razor, lastOrder: s.profile.lastOrder, consent: s.profile.consent } : null,
        known: summary(s.slots), slots: s.slots, routine: s.rec ? s.rec.steps.map((x) => x.item.id) : null, basket: s.basket.map((b) => b.label), entry: s.entry,
      };
      const rules = `You are Sam, Gillette's shave expert inside Delhaize's shopping chat (a student concept). Be warm, short and concrete.
Reply in the shopper's language (English, French or Dutch). Act through the tools – they show cards, buttons and tickets in the chat.
- Product needs: call set_needs with everything you understood, then recommend_routine if area+skin are known (and for face shaving whether they own a handle), otherwise ask_next_question.
- Service requests (refund, return, order status, defect, injury, cancel, invoice, privacy, human, complaint): call open_service.
- Photo/skin/beard analysis → start_photo_check. Beard styles / "how would I look" → start_ar.
- Only recommend products from the catalogue. Never invent prices, policies or order data.
- Your final message is shown after the tool output: at most 2 short sentences, no lists, don't repeat card contents.
${POLICY}
Catalogue (id|name|line|role|price|areas|sensitivity 0-2|gender):
${catalogText}
Current state: ${JSON.stringify(state)}`;
      history.push({ role: "user", content: text });
      while (history.length > 12) history.shift();
      const tools = [
        { name: "set_needs", description: "Store what the shopper needs (only fields you understood). Returns the summary and what is still missing.", inputSchema: SLOT_SCHEMA,
          execute: (inp) => { for (const [k, v] of Object.entries(inp || {})) if (k in SLOT_SCHEMA.properties && v !== null && v !== "") s.slots[k] = v; bot.ui.profile(s); bot.sig("AI: needs", JSON.stringify(inp)); return { known: summary(s.slots) }; } },
        { name: "ask_next_question", description: "Show the next missing question with answer buttons.", execute: async () => { await bot.consult(); return "asked"; } },
        { name: "recommend_routine", description: "Show the personal routine card for the stored needs. Returns the chosen products and total.", execute: async () => { await bot.recommendNow(!!s.rec); return { items: s.rec.steps.map((x) => x.item.short), total: s.rec.total }; } },
        { name: "show_products", description: "Show product cards by catalogue id.", inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
          execute: (inp) => { const ids = (inp.ids || []).filter((id) => BY_ID[id]).slice(0, 6); bot.ui.products(ids); return { shown: ids }; } },
        { name: "add_to_basket", description: "Add products to the basket (deal=true applies SuperPlus 2+2 for members) and offer checkout.", inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, deal: { type: "boolean" } }, required: ["ids"] },
          execute: async (inp) => { const ids = (inp.ids || []).filter((id) => BY_ID[id]); bot.addItems(ids, !!inp.deal); await bot.afterAdd(); return { basket: s.basket.map((b) => b.label) }; } },
        { name: "open_service", description: "Handle a customer-service request with the official flow (shows instructions/tickets).", inputSchema: { type: "object", properties: { flow: { enum: ["refund", "order_status", "defect", "injury", "cancel", "invoice", "privacy", "human", "complaint"] }, orderNo: { type: "string" }, channel: { enum: ["store", "delivery", "collect"] }, reason: { enum: ["unopened", "opened", "defect", "skin"] }, description: { type: "string" } }, required: ["flow"] },
          execute: async (inp) => { const ctx = {}; for (const k of ["orderNo", "channel", "reason", "description"]) if (inp[k]) ctx[k] = inp[k]; await bot.service(inp.flow, ctx); return "shown"; } },
        { name: "start_photo_check", description: "Ask for a selfie for the skin & beard check.", execute: async () => { await bot.photoStart(); return "photo prompt shown"; } },
        { name: "start_ar", description: "Open the beard-style try-on.", inputSchema: { type: "object", properties: { style: { enum: ["clean", "stubble", "short", "full", "circle", "moustache"] } } }, execute: async (inp) => { await bot.arStart(inp?.style); return "opened"; } },
        { name: "go_checkout", description: "Show basket and pick-up/delivery choice.", execute: async () => { await bot.checkout(); return "shown"; } },
      ];
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
