// Natural-language understanding for the shave assistant: typo-tolerant intent + entity extraction.
// Pure functions, no DOM – runs in the browser and in node (tests).

// ---------- normalisation ----------
const ACCENTS = /[̀-ͯ]/g;
export function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(ACCENTS, "")
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/€\s*(\d+(?:[.,]\d+)?)/g, "$1 eur")
    .replace(/(\d)\s*€/g, "$1 eur")
    .replace(/(\d),(\d{1,2})\b/g, "$1.$2")
    .replace(/[^a-z0-9.#+\-' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- typo tolerance ----------
function osa(a, b, max) {
  // optimal string alignment distance with early exit
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

// Words the patterns below care about. Unknown tokens within 1 (≥5 chars) or 2 (≥9 chars) edits are corrected.
const VOCAB = new Set(`
refund refunds reimburse reimbursement money back return returns returned returning exchange replace replacement
order orders ordered delivery delivered arrive arrived arriving tracking track parcel package shipping late missing
broken defective damaged faulty working rusty rust cracked leaking battery charge charging charger snapped fell blunt dull
cut cuts bleeding bleed blood nick nicks allergic allergy reaction rash swelling swollen burning
cancel cancellation unsubscribe subscription invoice receipt bill
delete privacy personal data gdpr forget
human person agent employee staff someone somebody colleague customer service phone call email
complaint complain unhappy disappointed terrible awful worst angry annoyed
recommend recommendation suggest suggestion looking need want buy purchase best which should choose find help advice
gift present birthday christmas valentine fathers anniversary
compare comparison difference versus better
cheap cheaper cheapest expensive budget affordable price prices cost costs much pricey
compatible compatibility fit fits work works
promo promotion discount offer offers deal deals sale coupon superplus
store shop aisle shelf stock available find opening hours where located
basket cart remove items checkout pay
photo picture selfie upload analyse analyze analysis consultation consult scan camera image
try virtual augmented reality styles style look
hello hey hiya morning evening bonjour salut hallo goedendag goeiedag dag
thanks thank cheers merci dank bedankt
goodbye bye later
restart start over reset again
login log sign account card
yes yeah yep sure okay please
nope not now
boyfriend husband partner dad father daddy brother son friend grandpa grandfather uncle colleague boss
girlfriend wife mum mom mother sister daughter grandma
myself
face cheeks chin neck jaw jawline beard moustache mustache stubble goatee facial hair sideburns
legs body chest back arms armpits pubic intimate bikini underarms head bald scalp
sensitive irritation irritated redness red razor burn bumps ingrown itchy itching dry oily acne spots pimples normal problems tight tightness
short long full trimmed boxed clean shaven
mach3 mach fusion fusion5 proglide power labs gillettelabs skinguard venus disposable disposables safety electric shaver trimmer sensor3 blue3 king
daily every day week weekly sometimes occasionally rarely twice
under below less than maximum max upto most
razor razors blade blades cartridge cartridges refill refills gel foam cream balm moisturiser moisturizer oil wash cleanser
remboursement rembourser retour retourner terugbetaling terugbetalen terugsturen commande bestelling livraison levering
cadeau vriend copain mari papa barbe baard peau huid gevoelig sensible`.split(/\s+/).filter(Boolean));
// Common words that must never be "corrected" into a vocabulary word.
const KEEP = new Set(`shave shaves shaving shaver skin hair hairs about would could should think thing things there their
these those where which while always never really maybe something anything everything thanks great hello other
another little first second third right wrong today tomorrow yesterday month weeks years since after before
started start lately often again still using works worked shower water smooth close closer quick quickly
comfortable comfort gentle soft rough thick thin dark light bought brought should store stores model models
wrote write written answer question please price white black brand brands gillette delhaize euros under every
people person guys woman women have this that with what when your mine like make good very much more some just also does done they them were will well time kind line sure only then than even from into over each both many here ever once last next week days said says told tell give take came come went goes been such feel feels gets used love hate okay young older teenager student students years shape shaped lines edges design`.split(/\s+/).filter(Boolean));
const VOCAB_LIST = [...VOCAB];

export function correctToken(tok) {
  if (VOCAB.has(tok) || KEEP.has(tok) || tok.length < 4 || /\d/.test(tok)) return tok;
  const max = tok.length >= 9 ? 2 : 1;
  const short = tok.length === 4;
  let best = tok, bestD = max + 1;
  for (const w of VOCAB_LIST) {
    if (Math.abs(w.length - tok.length) > max || (w[0] !== tok[0] && (max === 1)) || (short && w.length < 4)) continue;
    const d = osa(tok, w, max);
    if (d < bestD) { bestD = d; best = w; if (d === 1 && max === 1) break; }
  }
  return bestD <= max ? best : tok;
}
export function correct(norm) {
  return norm.split(" ").map(correctToken).join(" ");
}

// ---------- intents ----------
// [name, weight, regex]. Scores add up; the highest wins. Service intents get a bonus so they interrupt shopping.
const I = (name, w, re) => ({ name, w, re });
const INTENTS = [
  // service (typed only)
  I("refund", 3, /\b(refunds?|reimburse(ment)?|money back|get my money|return(ing|ed)? (it|this|them|my|the|an?)|want to return|send (it|them) back|bring (it|them) back|exchange|replacement|rembours\w*|retour\w*|terugbetal\w*|terugsturen)\b/),
  I("refund", 2, /\breturns?\b/),
  I("order_status", 3, /\b(where is my (order|parcel|package|delivery)|order status|track(ing)?( my)?( order| parcel)?|(hasn'?t|has not|didn'?t|did not|not|never) (arrived?|delivered|come|came)|still waiting|delivery (is )?late|late delivery|when will (it|my order|my parcel) (arrive|come)|commande|bestelling|livraison|levering)\b/),
  I("order_status", 2.5, /\b((has|did|is) my (order|parcel|package|delivery) (arrived?|come|coming|here|shipped|ready)|my (order|parcel|package)\b)/),
  I("defect", 3, /\b(broken|defective|damaged|faulty|(doesn'?t|does not|stopped|isn'?t|not) work(ing)?|rust(y)?|cracked|leak(ing|s)?|snapped|fell (off|apart)|won'?t (charge|turn on)|battery (is )?(dead|empty)|missing (part|blade|piece))\b/),
  I("injury", 3, /\b(cut (myself|my)|i cut|bleed(ing)?|blood|nicked|allerg(ic|y)|(skin )?reaction|rash|swell(ing|ed|en)|bad razor burn|burns? (a lot|badly))\b/),
  I("cancel", 3, /\b(cancel(lation)?|unsubscribe|stop (my )?(subscription|order))\b/),
  I("invoice", 2, /\b(invoice|receipt|bill|factuur|facture)\b/),
  I("privacy", 3, /\b(delete my (data|account|information)|gdpr|privacy|personal data|forget me|what (data )?(do you )?(know|have|store|keep) about me|my data)\b/),
  I("human", 2.5, /\b(human|real person|(talk|speak) to (a |an |some)?(one|someone|somebody|person|agent|employee|staff|colleague)|customer service|call me|phone number|contact (you|delhaize|gillette))\b/),
  I("complaint", 2, /\b(complain(t)?|unhappy|disappointed|terrible|awful|worst|angry|annoyed|not happy|bad (experience|service|quality))\b/),
  // shopping
  I("recommend", 1, /\b(recommend\w*|suggest\w*|looking for|i need|i want|want to buy|buy|purchase|best|which (razor|blade|gel|one|product)|what (should|do you recommend|would you)|help me (choose|find|pick)|razor for|advice|gift|present|birthday|christmas)\b/),
  I("compare", 1.5, /\b(compare|comparison|difference|versus|vs\.?|better than|which is better)\b/),
  I("cheaper", 1.5, /\b(cheap(er|est)?|(too|so|very) expensive|pricey|budget|affordable|less (money|expensive)|save money|lower price)\b/),
  I("price", 1, /\b(how much|price|prices|cost|costs)\b/),
  I("compat", 2, /\b(fits?|compatible|compatibility|(work|works) (with|on)|use (it )?with|same handle)\b/),
  I("promo", 1.5, /\b(promo(tion)?s?|discounts?|offers?|deals?|sale|coupons?|2\s?\+\s?2|superplus (deal|offer|price))\b/),
  I("store", 1.5, /\b(where (can i find|is|are|do you have)|in (the )?store|aisle|shelf|in stock|stock|available (in|at)|opening hours|which store|nearest)\b/),
  I("basket", 1.5, /\b(basket|cart|my items|what did i (add|buy)|remove|checkout|check out|pay now)\b/),
  I("photo", 2, /\b(photo|picture|selfie|upload|(analy[sz]e|scan|check) my (skin|face|beard)|skin (analysis|check|type)|consult(ation)?|camera)\b/),
  I("ar", 2, /\b(try (it )?on|try beard|beard styles?|virtual(ly)?|augmented|\bar\b|how would i look|what would i look like|which (beard )?style)\b/),
  I("login", 2, /\b(log ?in|sign ?in|my account|superplus card|my card)\b/),
  I("greeting", 0.6, /^(hi|hey|hello|hiya|yo|good (morning|evening|afternoon)|bonjour|salut|hallo|goedendag|goeiedag|dag)\b/),
  I("thanks", 0.8, /\b(thanks?|thank you|cheers|merci|dank (je|u)|bedankt)\b/),
  I("bye", 0.8, /\b(bye|goodbye|that'?s all|see you|ciao)\b/),
  I("restart", 3, /\b(start (over|again)|restart|reset|new chat|from the beginning)\b/),
  I("yes", 0.5, /^(yes|yeah|yep|yup|sure|ok(ay)?|please( do)?|go ahead|sounds good|perfect|great|do it|why not)\b/),
  I("no", 0.5, /^(no|nope|nah|not now|no thanks|not really|maybe later)\b/),
  I("no", 1, /^(no thanks?|no thank you)\b/),
];

// ---------- entities ----------
const RECIPIENT = [
  [/\b(boyfriend|husband|partner|dad|daddy|father|papa|brother|son|grandpa|grandfather|uncle|copain|mari|vriend)\b/, "m"],
  [/\b(girlfriend|wife|mum|mom|mother|sister|daughter|grandma)\b/, "f"],
  [/\b(friend|colleague|boss)\b/, "?"],
];
const AREA = [
  ["beard", /\b(beard|moustache|mustache|stubble|goatee|facial hair|sideburns|barbe|baard)\b/],
  ["body", /\b(legs?|body|chest|back hair|arms?|armpits?|underarms?|pubic|intimate|bikini|manscap\w*)\b/],
  ["head", /\b(head|bald|scalp)\b/],
  ["face", /\b(face|cheeks?|chin|neck|jaw(line)?|clean shave|shave my face|shaving)\b/],
];
const CONCERNS = [
  ["razor burn", /\brazor burn|burning\b/],
  ["redness", /\b(red|redness|blotchy)\b/],
  ["ingrown hairs", /\b(ingrown|bumps|razor bumps)\b/],
  ["dryness", /\b(dry|tight(ness)?|flaky)\b/],
  ["oily skin", /\b(oily|greasy|shiny)\b/],
  ["breakouts", /\b(acne|spots|pimples|breakouts?)\b/],
  ["irritation", /\b(irritat\w*|itch\w*|sting\w*)\b/],
];
const OWNED = [
  ["mach3", /\bmach ?3\b/], ["proglide", /\bpro ?glide\b/], ["fusion5", /\bfusion ?5?\b/], ["labs", /\b(gillette ?)?labs\b/],
  ["skinguard", /\bskin ?guard\b/], ["venus", /\bvenus\b/], ["disposable", /\bdisposables?\b/], ["safety", /\bsafety razor|double edge\b/],
  ["electric", /\belectric( shaver| razor)?\b/],
];
const STYLE = [
  ["clean", /\bclean[- ]?shaven|no beard|smooth face\b/],
  ["stubble", /\bstubble|3 day|designer stubble\b/],
  ["short", /\bshort beard|trimmed beard|boxed\b/],
  ["full", /\bfull beard|long beard|big beard|lumberjack\b/],
  ["goatee", /\bgoatee\b/],
];

export function extractEntities(t) {
  const e = {};
  // recipient / for
  for (const [re, g] of RECIPIENT) {
    const m = t.match(re);
    if (m) { e.for = "gift"; e.recipient = m[1]; e.gender = g; break; }
  }
  if (!e.for && /\b(gift|present|cadeau|birthday|christmas|valentine)\b/.test(t)) e.for = "gift";
  if (!e.for && /\b(for me|myself|for my own|i shave|my (face|beard|skin|legs))\b/.test(t)) e.for = "me";
  // area
  for (const [k, re] of AREA) if (re.test(t)) { e.area = k; break; }
  if (e.area === "face" && /\bbeard\b/.test(t)) e.area = "beard";
  // skin + concerns (with simple negation)
  const neg = /\b(not|no|never|isn'?t|without)\s+(\w+\s+)?(sensitive|irritat\w*|problems?|issues?|red\w*)\b/.test(t);
  const concerns = CONCERNS.filter(([, re]) => re.test(t)).map(([k]) => k);
  if (/\b(sensitive|sensible|gevoelig)\b/.test(t) && !neg) e.skin = "sensitive";
  else if (concerns.length && !neg) e.skin = "sensitive";
  else if (neg || /\b(normal|no problems?|fine|robust|tough)\b( skin)?/.test(t) && /\bskin|problem|fine|normal\b/.test(t)) e.skin = "normal";
  if (concerns.length && !neg) e.concerns = concerns;
  // owned razor & handle
  for (const [k, re] of OWNED) if (re.test(t)) { e.owned = k; break; }
  if (e.owned && /\b(i have|i own|i use|i've got|got a|my|using)\b/.test(t)) e.handle = ["mach3", "proglide", "fusion5", "labs", "skinguard"].includes(e.owned) ? "yes" : undefined;
  if (/\b(no (razor|handle)|don'?t have (a )?(razor|handle)|new to shaving|first (razor|time))\b/.test(t)) e.handle = "no";
  // beard style
  for (const [k, re] of STYLE) if (re.test(t)) { e.style = k; break; }
  // budget
  const b = t.match(/\b(?:under|below|less than|max(?:imum)?|up ?to|no more than|at most|around|about|budget(?: of| is)?)\s*(\d{1,3})(?:\.\d+)?\s*(?:eur|euro|euros)?\b/) || t.match(/\b(\d{1,3})\s*(?:eur|euro|euros)\b/);
  if (b) e.budget = Number(b[1]);
  else if (/\b(cheap|cheapest|budget|affordable|not too expensive|low price)\b/.test(t)) e.budget = "low";
  // frequency
  if (/\b(every ?day|daily|each day|every morning)\b/.test(t)) e.freq = "daily";
  else if (/\b(few times a week|every (other|second) day|twice a week|3 times a week|weekly)\b/.test(t)) e.freq = "weekly";
  else if (/\b(rarely|sometimes|occasionally|once a week|now and then|not often)\b/.test(t)) e.freq = "rarely";
  // order number
  const o = t.match(/\b(?:order|bestelling|commande|nr|no|number)?\s*#?\s*([a-z]{0,3}-?\d{5,})\b/);
  if (o) e.orderNo = o[1].toUpperCase();
  // product type wanted
  if (/\b(trimmer|clippers?)\b/.test(t)) e.wantType = "trimmer";
  else if (/\b(gel|foam|cream)\b/.test(t)) e.wantType = "gel";
  else if (/\b(balm|moisturi[sz]er|after ?shave|aftershave)\b/.test(t)) e.wantType = "care";
  else if (/\b(beard oil|oil)\b/.test(t)) e.wantType = "oil";
  else if (/\b(blades?|refills?|cartridges?)\b/.test(t)) e.wantType = "blades";
  else if (/\b(razors?)\b/.test(t)) e.wantType = "razor";
  return e;
}

// ---------- main ----------
export function parse(text, opts = {}) {
  const norm = normalize(text);
  const fixed = correct(norm);
  const scores = {};
  for (const it of INTENTS) if (it.re.test(fixed)) scores[it.name] = (scores[it.name] || 0) + it.w;
  // "razor burn" alone is a skin concern, not an injury
  if (scores.injury && /\brazor burn\b/.test(fixed) && !/\b(bad|badly|bleed|blood|cut|rash|allerg)/.test(fixed)) delete scores.injury;
  // "return" in "in return" etc. is weak; product compatibility beats generic recommend
  if (scores.compat && scores.recommend) scores.recommend -= 0.5;
  const entities = extractEntities(fixed);
  // product mentions via catalog aliases
  if (opts.aliases) {
    const hits = [];
    for (const [id, re] of opts.aliases) if (re.test(fixed)) hits.push(id);
    if (hits.length) entities.products = hits;
  }
  const slotCount = ["for", "area", "skin", "budget", "freq", "handle", "style", "owned", "wantType"].filter((k) => entities[k] !== undefined).length;
  if (slotCount && !scores.recommend) scores.recommend = 0.4 * slotCount;
  const intents = Object.entries(scores).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
  return { text, norm, fixed, intents, top: intents[0]?.name || null, entities, slotCount };
}

export const SERVICE_INTENTS = ["refund", "order_status", "defect", "injury", "cancel", "invoice", "privacy", "human", "complaint"];
