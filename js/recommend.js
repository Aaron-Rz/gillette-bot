// Builds a personal routine (prep · shave/trim · care) from the conversation slots and photo findings.
import { CATALOG, BY_ID } from "./catalog.js";

const ROLE_LABEL = { wash: "Cleanse", prep: "Prep", shave: "Shave", blades: "Shave", trim: "Trim & shape", edge: "Edges", care: "Care" };
const TYPE_ROLES = { razor: ["shave", "blades"], blades: ["blades", "shave"], gel: ["prep"], care: ["care"], oil: ["care"], trimmer: ["trim"] };

function fits(p, s) {
  const area = s.area || "face";
  if (!p.areas.includes(area)) return false;
  const g = s.gender || (s.for === "me" ? s.selfGender : undefined);
  if (p.gender && g && g !== "?" && p.gender !== g) return false;
  if (p.gender === "f" && !g && area !== "body") return false;
  return true;
}

export function score(p, s) {
  let x = p.rank;
  const sensitive = s.skin === "sensitive";
  if (sensitive) x += p.sens * 3; else if (s.skin === "normal" && p.sens === 2) x -= 1;
  for (const c of s.concerns || []) if ((p.concerns || []).includes(c)) x += 2.5;
  if (s.style && (p.styles || []).includes(s.style)) x += 3;
  const low = s.budget === "low" || (typeof s.budget === "number" && s.budget < 25);
  if (low) x += (p.value ? 4 : 0) - p.price / 8;
  if (p.premium && !(typeof s.budget === "number" && s.budget >= 80)) x -= 6;
  if (s.gender === "f" && p.gender === "f") x += 2;
  if (s.gender === "m" && p.gender === "m") x += 1;
  if (s.freq === "daily" && p.role === "blades") x += 1;
  return x;
}

function best(role, s, exclude = []) {
  const c = CATALOG.filter((p) => p.role === role && fits(p, s) && !exclude.includes(p.id)).sort((a, b) => score(b, s) - score(a, s));
  return c;
}

function bladesFor(s) {
  const o = s.owned;
  if (o === "mach3") return "mach3Blades";
  if (["proglide", "fusion5", "proshield"].includes(o)) return s.budget === "low" ? "fusion5Blades" : "proglideBlades";
  return null;
}

/** Which roles a routine has for these slots. */
function rolesFor(s) {
  const area = s.area || "face";
  if (area === "beard") {
    if (s.style === "clean") return ["prep", "shave", "care"];
    if (s.style === "stubble") return ["trim", "wash", "care"];
    return ["wash", "trim", "care"];
  }
  if (area === "body") return ["prep", "shave"];
  const r = ["prep", s.handle === "yes" && bladesFor(s) ? "blades" : "shave"];
  if (s.skin === "sensitive" || (s.concerns || []).length || s.budget !== "low") r.push("care");
  return r;
}

export function recommend(s) {
  const steps = [];
  const used = [];
  let roles = rolesFor(s);
  // a specific product type was asked for → lead with it, keep one complement
  const want = s.wantType && TYPE_ROLES[s.wantType];
  if (want) {
    const lead = want.find((r) => r === "blades" ? bladesFor(s) : best(r, s).length);
    if (lead) roles = [lead, ...roles.filter((r) => r !== lead && !(lead === "blades" && r === "shave") && !(lead === "shave" && r === "blades"))].slice(0, 2);
  }
  for (const role of roles) {
    let pick, alts;
    if (role === "blades") {
      pick = BY_ID[bladesFor(s)];
      alts = [pick.id === "proglideBlades" ? BY_ID.fusion5Blades : null].filter(Boolean);
    } else {
      const c = best(role === "edge" ? "shave" : role, s, used);
      if (!c.length) continue;
      [pick, ...alts] = c;
    }
    used.push(pick.id);
    steps.push({ role, label: ROLE_LABEL[role], item: pick, alt: alts.find((a) => a && !used.includes(a.id)) || null, why: reason(pick, s, role) });
  }
  // budget
  const budget = typeof s.budget === "number" ? s.budget : null;
  const notes = [];
  const droppedRoles = [];
  if (budget) {
    const total = () => steps.reduce((t, x) => t + x.item.price, 0);
    for (const role of ["care", "wash", "prep", "edge"]) {
      if (total() <= budget) break;
      const i = steps.findIndex((x) => x.role === role);
      if (i >= 0 && steps.length > 1) { notes.push(`Left out ${steps[i].item.short} (${role}) to stay within €${budget}.`); droppedRoles.push(role); steps.splice(i, 1); }
    }
    for (const st of steps) {
      if (total() <= budget) break;
      const cheaper = best(st.role === "blades" ? "shave" : st.role, s).filter((p) => p.price < st.item.price).sort((a, b) => a.price - b.price)[0];
      if (cheaper) { st.alt = st.item; st.item = cheaper; st.why = reason(cheaper, s, st.role) + " Fits your budget."; }
    }
    // re-add dropped steps with the best item that still fits the remaining budget
    for (const role of droppedRoles) {
      const room = budget - total();
      const fit = best(role, s, steps.map((x) => x.item.id)).filter((p) => p.price <= room)[0];
      if (fit) {
        steps.push({ role, label: ROLE_LABEL[role], item: fit, alt: null, why: reason(fit, s, role) });
        const k = notes.findIndex((n) => n.includes(`(${role})`));
        if (k >= 0) notes.splice(k, 1);
      }
    }
    notes.forEach((n, i) => (notes[i] = n.replace(/ \((\w+)\)/, "")));
    if (total() > budget) notes.push(`The cheapest fitting option is €${total().toFixed(2).replace(".", ",")} – a little over €${budget}.`);
    const order = ["wash", "prep", "trim", "shave", "blades", "edge", "care"];
    steps.sort((x, y) => order.indexOf(x.role) - order.indexOf(y.role));
  }
  const total = steps.reduce((t, x) => t + x.item.price, 0);
  return { steps, total, notes, summary: summary(s) };
}

function reason(p, s, role) {
  const bits = [];
  const c = (p.concerns || []).filter((x) => (s.concerns || []).includes(x));
  if (c.length) bits.push(`targets ${c.join(" & ")}`);
  else if (s.skin === "sensitive" && p.sens >= 2) bits.push("made for sensitive skin");
  if (s.style && (p.styles || []).includes(s.style)) bits.push(`keeps a ${styleName(s.style)} in shape`);
  if (role === "blades") bits.push(`fits your ${s.owned === "mach3" ? "Mach3" : "Fusion5/ProGlide"} handle`);
  if (p.value && (s.budget === "low" || typeof s.budget === "number")) bits.push("best value");
  if (!bits.length) bits.push(p.pitch.split(/[.;]/)[0].toLowerCase());
  const t = bits.join(", ");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}
export function styleName(s) { return { clean: "clean shave", stubble: "stubble look", short: "short beard", full: "full beard", circle: "circle beard", moustache: "moustache" }[s] || s; }

export function summary(s) {
  const out = [];
  if (s.for === "gift") out.push(s.recipient ? `gift for your ${s.recipient}` : "a gift");
  const area = { face: "face", beard: "beard", body: "legs & body", head: "head" }[s.area];
  if (area) out.push(area);
  if (s.style) out.push(styleName(s.style));
  if (s.skin === "sensitive") out.push(s.concerns?.length ? `sensitive skin (${s.concerns.join(", ")})` : "sensitive skin");
  if (s.skin === "normal") out.push("no skin problems");
  if (s.owned) out.push(`uses ${{ mach3: "Mach3", proglide: "ProGlide", fusion5: "Fusion5", labs: "GilletteLabs", skinguard: "SkinGuard", venus: "Venus", disposable: "disposables", safety: "a safety razor", electric: "an electric shaver", proshield: "ProShield" }[s.owned] || s.owned}`);
  if (typeof s.budget === "number") out.push(`max €${s.budget}`);
  else if (s.budget === "low") out.push("small budget");
  if (s.freq) out.push({ daily: "shaves daily", weekly: "shaves a few times a week", rarely: "shaves now and then" }[s.freq]);
  return out;
}

/** Cheapest way to cover the main need. */
export function cheapest(s) {
  const r = rolesFor(s).find((x) => ["shave", "blades", "trim"].includes(x)) || "shave";
  const pool = r === "blades" ? [BY_ID[bladesFor(s)], ...best("shave", s)] : best(r, s);
  let list = pool.filter(Boolean);
  const g = s.gender || (s.owned === "venus" ? "f" : null);
  if (g && list.some((p) => p.gender === g)) list = list.filter((p) => p.gender === g); // stay in her/his range
  return list.sort((a, b) => a.price - b.price)[0];
}

/** Compatibility answers for "does X fit Y?" questions. */
export function compatibility(a, b) {
  const fam = (id) => BY_ID[id]?.fam || { mach3: "mach3", proglide: "fusion", fusion5: "fusion", proshield: "fusion", labs: "labs", skinguard: "skinguard", venus: "venus" }[id];
  const fa = fam(a), fb = fam(b);
  if (!fa || !fb) return null;
  return fa === fb;
}
