// Conversation context helpers: product references ("the Mach3", "the second one", "the cheaper one",
// "blades for it") and topic follow-ups. Pure functions – used by dialog.js and classify.js.
import { BY_ID } from "./catalog.js";

// Razor systems → handle (razor) and refills
export const SYSTEMS = {
  mach3: { razor: "mach3Razor", blades: "mach3Blades", name: "Mach3" },
  fusion5: { razor: "fusion5Razor", blades: "fusion5Blades", name: "Fusion5" },
  proglide: { razor: "proglideRazor", blades: "proglideBlades", name: "ProGlide" },
  skinguard: { razor: "skinguardRazor", blades: null, name: "SkinGuard" },
  labs: { razor: "labsExfoliatingRazor", blades: null, name: "GilletteLabs" },
  venus: { razor: "venusSmoothSensitive", blades: null, name: "Venus" },
};
const SYS_RE = [["mach3", /\bmach ?3\b/], ["fusion5", /\bfusion ?5?\b/], ["proglide", /\bpro ?glide\b/], ["skinguard", /\bskin ?guard\b/], ["labs", /\b(gillette ?)?labs\b/], ["venus", /\bvenus\b/]];
const BLADE_WORDS = /\b(blades?|refills?|cartridges?|mesjes?|lames?|klingen?|navulling\w*|recharges?)\b/;
const RAZOR_WORDS = /\b(razors?|handles?|rasoirs?|scheermes\w*|rasierer|houder)\b/;

/** System of a product id (e.g. fusion5Blades → fusion5). */
export function systemOf(id) {
  for (const [k, v] of Object.entries(SYSTEMS)) if (v.razor === id || v.blades === id) return k;
  if (id === "proglidePowerRazor") return "proglide";
  return null;
}
/** Systems named in a text, in order of mention. */
export function systemsIn(fixed) {
  return SYS_RE.map(([k, re]) => [k, fixed.search(re)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([k]) => k);
}
/** Product ids meant by a text: system names resolved to razor or blades depending on the words used. */
export function productsIn(fixed, aliasHits = []) {
  const sys = systemsIn(fixed);
  const wantBlades = BLADE_WORDS.test(fixed) && !RAZOR_WORDS.test(fixed);
  const out = sys.map((k) => (wantBlades && SYSTEMS[k].blades) || SYSTEMS[k].razor);
  for (const id of aliasHits) if (!systemOf(id) && !out.includes(id)) out.push(id);
  return out.filter((id) => BY_ID[id]);
}
export const wantsBlades = (fixed) => BLADE_WORDS.test(fixed);

const ORD = { first: 0, "1st": 0, one: 0, second: 1, "2nd": 1, two: 1, third: 2, "3rd": 2, three: 2, last: -1, premier: 0, premiere: 0, deuxieme: 1, eerste: 0, tweede: 1, derde: 2, erste: 0, zweite: 1 };
/** "the second one", "2nd", "number 2" → index (or null). */
export function ordinalIn(fixed) {
  const m = fixed.match(/\b(first|1st|second|2nd|third|3rd|last|premiere?|deuxieme|eerste|tweede|derde|erste|zweite)\b/) || fixed.match(/\b(?:number|nr|no|nummer|numero) ?([123])\b/);
  if (!m) return null;
  return /^\d$/.test(m[1]) ? Number(m[1]) - 1 : ORD[m[1]];
}
export const mentionsCheaper = (fixed) => /\b(cheap(er|est)?|less expensive|lower price|goedkoper|moins cher|billiger|budget)\b/.test(fixed);
export const mentionsAdd = (fixed) => /\b(add (it|that|this|them|to (my )?(cart|basket))|i'?ll take (it|that|this|the|them)|take (it|that|the)|buy (it|that|this)|put (it|that) in|in (my|the) (cart|basket)|toevoegen|ajoute[rz]?|hinzufugen)\b/.test(fixed);
export const asksPrice = (fixed) => /\b(how much|price|cost|costs|combien|hoeveel|wieviel|prix|prijs)\b/.test(fixed);
export const refersToIt = (fixed) => /\b(it|that one|this one|for it|fit it|for that|ervoor|pour (ca|lui)|dafur)\b/.test(fixed);

/** Topic follow-ups: after category X, short messages lean towards these categories. */
export const FOLLOW = {
  beard_grow: ["beard_care", "beard_trim"], beard_care: ["beard_grow", "beard_trim"], beard_trim: ["beard_grow", "beard_care"],
  how_to_shave: ["razor_burn", "ingrown", "blade_change"], head_shave: ["ingrown", "razor_burn", "how_to_shave"], razor_burn: ["ingrown", "how_to_shave"],
  ingrown: ["razor_burn"], blade_change: ["compat", "promo"], body_shave: ["razor_burn", "ingrown"],
  injury: ["defect", "razor_burn", "human"], defect: ["refund", "human"], billing: ["complaint", "human", "refund"], wrong_item: ["refund", "human"],
  order_status: ["delivery_info", "cancel", "wrong_item"], delivery_info: ["order_status", "store_stock"], cancel: ["order_status", "refund"],
  superplus_info: ["promo", "login"], promo: ["superplus_info", "price"], compare: ["price", "budget"], price: ["budget", "promo"],
  refund: ["wrong_item", "defect", "human"], complaint: ["human"], login: ["human"], store_stock: ["delivery_info"],
};
