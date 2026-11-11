// Ranks every typed message against the category catalogue (intents.js).
// Lexical similarity (typo-corrected words, light stemming, synonyms, word + char-trigram TF-IDF)
// against the example phrasings, boosted by the precise regex intents in nlu.js.
// Optionally blended with sentence embeddings (embed.js) when they are loaded.
import { normalize, correctToken, parse, osa } from "./nlu.js";
import { CATEGORIES, INTENT_TO_CAT, BY_CAT } from "./intents.js";
import { FOLLOW } from "./context.js";

const STOP = new Set(`a an the i me my mine you your yours it its is are was were be been am do does did to of in on at for with and or but so
this that these those there here just really very please can could would will shall should may might im i'm it's its' we our us they them he she his her
le la les un une des de du et ou je tu il elle mon ma mes ton ta tes est sont pour avec dans sur
de het een en ik je jij mijn is zijn voor met op in van
der die das und ich mein meine ist ein eine mit fur`.split(/\s+/).filter(Boolean));

// map variants onto one token (after stemming)
const SYN = {
  cart: "basket", panier: "basket", winkelmand: "basket", trolley: "basket",
  parcel: "order", package: "order", commande: "order", bestelling: "order", delivery: "deliver", livraison: "deliver", levering: "deliver", deliveri: "deliver",
  blunt: "dull", worn: "dull", bot: "dull",
  irritation: "irritat", irritated: "irritat", irritating: "irritat", irritate: "irritat",
  refunds: "refund", remboursement: "refund", rembourser: "refund", terugbetaling: "refund", terugbetalen: "refund", reimburse: "refund", money: "refund",
  cheap: "cheaper", cheapest: "cheaper", affordable: "cheaper", pricey: "expensive", cher: "expensive", duur: "expensive",
  cost: "price", costs: "price", coute: "price", kost: "price", much: "price", prix: "price", prijs: "price",
  deal: "promo", deals: "promo", discount: "promo", korting: "promo", offer: "promo", sale: "promo", coupon: "promo", promotion: "promo",
  rasoir: "razor", scheermes: "razor", rasierer: "razor", shaver: "razor",
  barbe: "beard", baard: "beard", bart: "beard", stubble: "beard", moustache: "beard", mustache: "beard",
  lame: "blade", lames: "blade", mesje: "blade", mesjes: "blade", klinge: "blade", klingen: "blade", cartridge: "blade", refill: "blade",
  peau: "skin", huid: "skin", haut: "skin",
  cadeau: "gift", present: "gift", geschenk: "gift", birthday: "gift", christmas: "gift", valentine: "gift",
  boyfriend: "someone", husband: "someone", dad: "someone", father: "someone", brother: "someone", son: "someone", partner: "someone", copain: "someone", vriend: "someone", mari: "someone", papa: "someone", girlfriend: "someone", wife: "someone",
  broken: "broke", kapot: "broke", casse: "broke", defective: "broke", faulty: "broke", damaged: "broke",
  bleeding: "bleed", blood: "bleed",
  bumps: "bump", pimple: "bump", pimples: "bump", spots: "bump", incarnes: "ingrown", ingegroeide: "ingrown",
  selfie: "photo", picture: "photo", pic: "photo", foto: "photo",
  person: "human", someone: "someone", agent: "human", medewerker: "human", employee: "human",
  invoice: "receipt", facture: "receipt", factuur: "receipt", bill: "receipt",
  legs: "leg", jambes: "leg",
  // French / Dutch / German domain words
  annuler: "cancel", annuleren: "cancel", stornieren: "cancel", opzeggen: "cancel",
  acties: "promo", actie: "promo", aanbieding: "promo", aanbiedingen: "promo", soldes: "promo", reduction: "promo", angebot: "promo",
  elektrische: "electric", electrique: "electric", electriques: "electric", elektrisch: "electric", elektrischer: "electric",
  scheerapparaat: "razor", scheerapparaten: "razor", scheermesje: "blade", rasoirs: "razor", scheermessen: "razor",
  rayon: "aisle", gang: "aisle", schap: "aisle", rek: "aisle",
  winkelmandje: "basket", mandje: "basket", warenkorb: "basket",
  caisse: "checkout", afrekenen: "checkout", payer: "checkout", betalen: "checkout", kassa: "checkout", bezahlen: "checkout",
  reactie: "reaction", allergische: "allergic", allergique: "allergic", allergie: "allergic",
  opnieuw: "restart", recommencer: "restart", herbeginnen: "restart",
  hoi: "hello", salut: "hello", bonjour: "hello", hallo: "hello", dag: "hello", goedemorgen: "hello",
  crane: "head", hoofd: "head", kopf: "head", tete: "head", kaal: "bald", chauve: "bald",
  livrez: "deliver", livrer: "deliver", leveren: "deliver", liefern: "deliver", bezorgen: "deliver", bezorging: "deliver", lieferung: "deliver",
  essayer: "try", proberen: "try", ausprobieren: "try", virtuellement: "virtual", virtueel: "virtual",
  goedkoper: "cheaper", goedkoop: "cheaper", moins: "cheaper", billig: "cheaper", gunstiger: "cheaper",
  bijknippen: "trim", knippen: "trim", trimmen: "trim", tailler: "trim", couper: "trim", bijwerken: "trim",
  tirent: "pull", tire: "pull", trekt: "pull", trekken: "pull",
  changer: "change", vervangen: "change", wechseln: "change", remplacer: "change",
  kapotte: "broke", werkt: "work", marche: "work", fonctionne: "work", funktioniert: "work",
  betaling: "payment", paiement: "payment", zahlung: "payment", mislukt: "fail", echoue: "fail", afgeschreven: "charg", debite: "charg", abgebucht: "charg",
  verkeerd: "wrong", verkeerde: "wrong", mauvais: "wrong", falsch: "wrong", ontbreekt: "missing", manque: "missing", fehlt: "missing",
  retourner: "return", terugsturen: "return", retour: "return", zuruckgeben: "return",
  suivre: "track", volgen: "track", waar: "where", ou: "where", wo: "where",
  combien: "price", hoeveel: "price", wieviel: "price", kosten: "price",
  conseil: "recommend", conseiller: "recommend", raad: "recommend", aanraden: "recommend", empfehlen: "recommend", empfehlung: "recommend",
  cherche: "looking", zoek: "looking", suche: "looking",
  broer: "someone", frere: "someone", fils: "someone", zoon: "someone", vader: "someone", vriendin: "someone", copine: "someone", bruder: "someone", freund: "someone",
  cadeautje: "gift", kado: "gift", kadootje: "gift",
  scheren: "shave", raser: "shave", rasage: "shave", rasieren: "shave", scheer: "shave",
  rasierschaum: "gel", mousse: "gel", schuim: "gel",
  punten: "points", punkte: "points", fidelite: "points",
  donnees: "data", gegevens: "data", daten: "data", supprimer: "delete", verwijderen: "delete", loschen: "delete",
  parler: "talk", spreken: "talk", sprechen: "talk", quelqu: "human", iemand: "human", jemand: "human", mens: "human",
  plainte: "complaint", klacht: "complaint", beschwerde: "complaint", decu: "disappointed", teleurgesteld: "disappointed",
  bon: "receipt", kassabon: "receipt", ticket: "receipt", rechnung: "receipt", quittance: "receipt",
  jambe: "leg", benen: "leg", been: "leg", beine: "leg", aisselles: "armpit", oksels: "armpit",
  irritee: "irritat", geirriteerd: "irritat", brule: "burn", brandt: "burn", brennt: "burn", rougeur: "red", roodheid: "red",
  pousse: "grow", groeien: "grow", wachsen: "grow", gratte: "itch", jeukt: "itch", juckt: "itch", jeuk: "itch",
  photos: "photo", fotos: "photo",
  itches: "itch", itchy: "itch", itched: "itch", scratchy: "itch", juckreiz: "itch", demangeaison: "itch", demangeaisons: "itch",
  conseillez: "recommend", conseilles: "recommend", adviseer: "recommend", advies: "recommend",
  wachtwoord: "password", passwort: "password", inloggen: "login", aanmelden: "login", anmelden: "login", connecter: "login", connexion: "login",
  seche: "dry", droog: "dry", trocken: "dry", reche: "rough", ruw: "rough",
  intimbereich: "intimate", intime: "intimate", schaamstreek: "intimate", bikinilijn: "bikini",
  gespeichert: "stored", opgeslagen: "stored", bewaard: "stored", stockees: "stored", conserve: "stored", saved: "stored",
  dure: "last", duurt: "last", lame: "blade", durer: "last",
  helo: "hello", hii: "hello", heya: "hello",
  shipping: "deliver", ship: "deliver", shipped: "deliver", verzending: "deliver", envoi: "deliver", versand: "deliver",
  billed: "charg", charged: "charg", charge: "charg", overcharged: "charg",
  saigne: "bleed", bloed: "bleed", bloedt: "bleed", blutet: "bleed", coupe: "cut", gesneden: "cut", hives: "allergic", netelroos: "allergic",
  ontevreden: "disappointed", mecontent: "disappointed", unzufrieden: "disappointed",
  thx: "thanks", ty: "thanks", merci: "thanks", bedankt: "thanks", danke: "thanks", dankjewel: "thanks",
  scalp: "head", cuir: "head", voorraad: "stock", stock: "stock", winkel: "store", magasin: "store", filiale: "store", geschaft: "store",
  vaak: "often", souvent: "often", oft: "often",
};

function stem(w) {
  if (SYN[w]) return SYN[w];
  let s = w;
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return SYN[s] || s;
}

// vocabulary of the example phrasings (word → count), used to correct typos towards words Sam knows
let VOC = null;
function vocab() {
  if (VOC) return VOC;
  VOC = new Map();
  for (const c of CATEGORIES) for (const ex of c.examples) for (const w of normalize(ex).replace(/['.#+-]/g, " ").split(/\s+/)) if (w) VOC.set(w, (VOC.get(w) || 0) + 1);
  return VOC;
}
function fix(w) {
  const V = vocab();
  if (V.has(w) || w.length < 4 || /\d/.test(w)) return w;
  const max = w.length >= 8 ? 2 : 1;
  let best = null, bd = max + 1, bf = 0;
  for (const [v, f] of V) {
    if (Math.abs(v.length - w.length) > max || v.length < 4) continue;
    const d = osa(w, v, max);
    if (d < bd || (d === bd && f > bf)) { best = v; bd = d; bf = f; }
  }
  return bd <= max ? best : correctToken(w);
}

let VOC_IN = null;
/** Share of words in a message that Sam knows at all (example vocabulary, synonyms or common words). */
export function knownShare(text) {
  const raw = normalize(text).replace(/['.#+-]/g, " ").split(/\s+/).filter(Boolean);
  if (!raw.length) return 0;
  if (!VOC_IN) { VOC_IN = new Set(); for (const c of CATEGORIES) if (c.id !== "out_of_scope") for (const ex of c.examples) for (const w of normalize(ex).replace(/['.#+-]/g, " ").split(/\s+/)) if (w) VOC_IN.add(w); }
  return raw.filter((w) => VOC_IN.has(w) || SYN[w] || STOP.has(w) || VOC_IN.has(fix(w))).length / raw.length;
}

export function tokens(text) {
  // known foreign/synonym words are kept as they are; everything else gets typo-corrected
  return normalize(text).replace(/['.#+-]/g, " ").split(/\s+/)
    .map((w) => (SYN[w] || STOP.has(w) ? w : fix(w)))
    .filter((w) => w && !STOP.has(w)).map(stem);
}

function features(text) {
  const toks = tokens(text);
  const f = new Map();
  const add = (k, w) => f.set(k, (f.get(k) || 0) + w);
  toks.forEach((t, i) => {
    add("w:" + t, 1);
    if (i) add("b:" + toks[i - 1] + "_" + t, 0.8);
    const g = `_${t}_`;
    if (t.length > 3) for (let j = 0; j + 3 <= g.length; j++) add("c:" + g.slice(j, j + 3), 0.18);
  });
  return f;
}

// ---------- model (built once from the examples) ----------
let MODEL = null;
function build() {
  const docs = [];
  for (const c of CATEGORIES) for (const ex of c.examples) docs.push({ cat: c.id, f: features(ex) });
  const df = new Map();
  for (const d of docs) for (const k of d.f.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = docs.length;
  const idf = (k) => Math.log((N + 1) / ((df.get(k) || 0) + 1)) + 1;
  const vec = (f) => {
    const v = new Map();
    let n = 0;
    for (const [k, x] of f) { const w = x * idf(k); v.set(k, w); n += w * w; }
    n = Math.sqrt(n) || 1;
    for (const [k, w] of v) v.set(k, w / n);
    return v;
  };
  for (const d of docs) d.v = vec(d.f);
  MODEL = { docs, vec };
  return MODEL;
}
function cos(a, b) {
  let s = 0;
  const [x, y] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, w] of x) { const o = y.get(k); if (o) s += w * o; }
  return s;
}

/**
 * Rank all categories for a message.
 * @returns {{ ranked: {id, score}[], top, score, margin, parsed }}
 */
export function classify(text, opts = {}) {
  const m = MODEL || build();
  const v = m.vec(features(text));
  const per = new Map();
  for (const d of m.docs) {
    const s = cos(v, d.v);
    const a = per.get(d.cat) || [0, 0];
    if (s > a[0]) per.set(d.cat, [s, a[0]]); else if (s > a[1]) per.set(d.cat, [a[0], s]); else per.set(d.cat, a);
  }
  const scores = {};
  for (const c of CATEGORIES) { const [a, b] = per.get(c.id) || [0, 0]; scores[c.id] = 0.75 * a + 0.25 * b; }
  // precise regex intents from nlu.js
  const parsed = opts.parsed || parse(text, opts);
  for (const it of parsed.intents) {
    if (it.name === "recommend" && it.score < 1) continue; // synthetic "has slots" score – not evidence of shopping intent
    if (it.name === "price" && /\b(deliver\w*|shipping|collect|livraison|levering)\b/.test(parsed.fixed)) continue; // "delivery cost" is delivery info
    const cat = INTENT_TO_CAT[it.name];
    if (cat && scores[cat] !== undefined) scores[cat] += Math.min(0.45, 0.13 * it.score);
  }
  // conversation context: short follow-ups lean towards the topic just discussed
  if (opts.context && BY_CAT[opts.context]) {
    const near = new Set(FOLLOW[opts.context] || []);
    const grp = BY_CAT[opts.context].group;
    const short = tokens(text).length <= 8;
    for (const c of CATEGORIES) {
      if (c.id === opts.context || near.has(c.id)) scores[c.id] += short ? 0.12 : 0.06;
      else if (c.group === grp && grp !== "meta") scores[c.id] += short ? 0.05 : 0.02;
    }
  }
  // "how much is delivery" / "combien coûte la livraison" is delivery info, not a product price
  if (/\b(deliver\w*|shipping|livraison|levering|lieferung|bezorg\w*)\b/.test(parsed.fixed) && scores.price > scores.delivery_info) scores.delivery_info = scores.price + 0.05;
  // an explicit farewell ("merci, bonne journée") ends the chat even if it also contains a greeting word
  if (parsed.intents.some((i) => i.name === "bye" && i.score >= 3)) scores.bye = Math.max(...Object.values(scores)) + 0.1;
  // semantic layer (optional)
  if (opts.semantic) for (const [id, s] of Object.entries(opts.semantic)) if (scores[id] !== undefined) scores[id] = 0.45 * scores[id] + 0.55 * s;
  const ranked = Object.entries(scores).map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const ctxHit = !!(opts.context && top && (top.id === opts.context || (FOLLOW[opts.context] || []).includes(top.id)));
  return { ranked, top: top.score > 0 ? top.id : null, score: top.score, margin: top.score - (ranked[1]?.score || 0), parsed, ctxHit };
}

/** act | clarify | guide */
export function decide(r) {
  if (!r.top) return "guide";
  if (r.score >= 0.5 && r.margin >= 0.08) return "act";
  if (r.ctxHit && r.score >= 0.42 && r.margin >= 0.15) return "act"; // a clear follow-up to the topic just discussed
  if (r.score >= 0.62) return "act";
  if (r.score >= 0.15) return "clarify";
  return "guide";
}
