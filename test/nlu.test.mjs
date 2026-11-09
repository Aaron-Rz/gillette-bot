import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../js/nlu.js";

// [utterance, expected top intent (or null for "don't care"), expected entity subset]
const CASES = [
  // service – refunds / returns
  ["I want a refund", "refund", {}],
  ["i want my money back for the blades", "refund", {}],
  ["Can I return the razor I bought last week?", "refund", {}],
  ["how do I send them back", "refund", {}],
  ["refnud please", "refund", {}],
  ["I'd like a reimbursment", "refund", {}],
  ["je veux un remboursement", "refund", {}],
  ["ik wil een terugbetaling", "refund", {}],
  ["return order 123456", "refund", { orderNo: "123456" }],
  ["can I exchange the gel for another one", "refund", {}],
  // order status
  ["where is my order?", "order_status", {}],
  ["my parcel hasn't arrived yet", "order_status", {}],
  ["order 778899 still not delivered", "order_status", { orderNo: "778899" }],
  ["track my order", "order_status", {}],
  ["when will my order arrive", "order_status", {}],
  ["waar is mijn bestelling", "order_status", {}],
  ["ma commande n'est pas arrivée", "order_status", {}],
  // defects / injury / complaint
  ["the trimmer is broken", "defect", {}],
  ["my razor stopped working", "defect", {}],
  ["the handle is cracked", "defect", {}],
  ["the blades are rusty after two days", "defect", {}],
  ["the trimmer won't charge", "defect", {}],
  ["I cut myself badly with the new blades", "injury", {}],
  ["I'm bleeding after shaving", "injury", {}],
  ["I think I have an allergic reaction to the gel", "injury", {}],
  ["I'm really disappointed with the quality", "complaint", {}],
  ["this is the worst service ever", "complaint", {}],
  // other service
  ["cancel my order", "cancel", {}],
  ["unsubscribe me", "cancel", {}],
  ["I need an invoice", "invoice", {}],
  ["delete my data please", "privacy", {}],
  ["what data do you know about me", "privacy", {}],
  ["can I talk to a real person", "human", {}],
  ["I want to speak to someone", "human", {}],
  ["customer service phone number?", "human", {}],
  // shopping – multi-slot sentences
  ["I'm looking for a gift for my boyfriend, he has a beard and sensitive skin, max 30 euros", "recommend", { for: "gift", area: "beard", skin: "sensitive", budget: 30 }],
  ["present for my dad under €25", "recommend", { for: "gift", budget: 25 }],
  ["I need a razor for my face, I shave every day and get razor burn", "recommend", { area: "face", freq: "daily", skin: "sensitive" }],
  ["my skin is not sensitive", null, { skin: "normal" }],
  ["no problems with my skin", null, { skin: "normal" }],
  ["I have a Mach3 and need new blades", null, { owned: "mach3", handle: "yes", wantType: "blades" }],
  ["I use a proglide", null, { owned: "proglide", handle: "yes" }],
  ["I don't have a razor yet", null, { handle: "no" }],
  ["I want to shave my legs", "recommend", { area: "body" }],
  ["something for my girlfriend", "recommend", { for: "gift", gender: "f" }],
  ["best trimmer for a full beard", "recommend", { area: "beard", wantType: "trimmer", style: "full" }],
  ["I keep a short beard and my skin gets dry", null, { area: "beard", style: "short", skin: "sensitive" }],
  ["ingrown hairs on my neck", null, { area: "face", skin: "sensitive" }],
  ["recomend me a razr", "recommend", { wantType: "razor" }],
  ["wich razor is best for sensitve skin", "recommend", { skin: "sensitive", wantType: "razor" }],
  ["I shave my head", null, { area: "head" }],
  ["cadeau pour mon copain avec une barbe", null, { for: "gift", area: "beard" }],
  ["mijn huid is gevoelig", null, { skin: "sensitive" }],
  ["something cheap please", null, { budget: "low" }],
  ["I shave a few times a week", null, { freq: "weekly" }],
  ["only now and then", null, { freq: "rarely" }],
  ["aftershave balm for dry skin", null, { wantType: "care", skin: "sensitive" }],
  ["beard oil", null, { wantType: "oil", area: "beard" }],
  // shopping – other intents
  ["compare proglide and mach3", "compare", {}],
  ["what's the difference between fusion5 and proglide", "compare", {}],
  ["that's too expensive", "cheaper", {}],
  ["anything cheaper?", "cheaper", {}],
  ["how much is it", "price", {}],
  ["does the proglide blade fit my fusion5 handle", "compat", { owned: "proglide" }],
  ["are these compatible with mach3?", "compat", { owned: "mach3" }],
  ["any promotions this week?", "promo", {}],
  ["is there a discount", "promo", {}],
  ["where can I find the blades in store", "store", {}],
  ["is it in stock in Ixelles", "store", {}],
  ["show my basket", "basket", {}],
  ["remove the gel", "basket", {}],
  ["can you analyse my skin from a photo", "photo", {}],
  ["I want to upload a selfie", "photo", {}],
  ["skin analysis", "photo", {}],
  ["which beard style suits me", "ar", {}],
  ["can I try beard styles on", "ar", {}],
  ["how would I look with a goatee", "ar", { style: "goatee" }],
  ["log in", "login", {}],
  ["I have a superplus card", "login", {}],
  // small talk
  ["hello", "greeting", {}],
  ["bonjour", "greeting", {}],
  ["thanks a lot", "thanks", {}],
  ["merci", "thanks", {}],
  ["bye", "bye", {}],
  ["start over", "restart", {}],
  ["yes please", "yes", {}],
  ["no thanks", "no", {}],
];

for (const [utt, intent, ents] of CASES) {
  test(utt, () => {
    const r = parse(utt);
    if (intent) assert.equal(r.top, intent, `top intent for "${utt}" was ${r.top} (${JSON.stringify(r.intents)}) fixed="${r.fixed}"`);
    for (const [k, v] of Object.entries(ents)) assert.deepEqual(r.entities[k], v, `entity ${k} for "${utt}": ${JSON.stringify(r.entities)} fixed="${r.fixed}"`);
  });
}

test("razor burn alone is a concern, not an injury", () => {
  const r = parse("I always get razor burn on my neck");
  assert.notEqual(r.top, "injury");
  assert.equal(r.entities.skin, "sensitive");
});
test("typos do not turn normal words into vocabulary words", () => {
  const r = parse("I shave in the shower with warm water");
  assert.equal(r.fixed, "i shave in the shower with warm water");
});
