// The same dialog core in a plain-text channel (WhatsApp/SMS style).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Bot } from "../js/dialog.js";
import { CRM } from "../js/crm.js";
import { TextChannel } from "../js/channels/text.js";

test("text channel: guest → typed need → routine → basket → collect → e-mail → confirmation", async () => {
  const out = [];
  const ch = new TextChannel((m) => out.push(m));
  const bot = new Bot(ch, CRM);
  await bot.start();
  assert.match(out.join("\n"), /Reply 1 to log in/);
  await ch.receive(bot, "2");
  assert.equal(bot.s.mode, "guest");
  await ch.receive(bot, "razor for my face, I have no razor yet, normal skin");
  assert.match(out.join("\n"), /Your routine:/);
  assert.ok(!/<[a-z]/.test(out.join("\n")), "no HTML leaks into the text channel");
  const addIdx = ch.opts.findIndex((o) => /Add routine/.test(o.label)) + 1;
  await ch.receive(bot, String(addIdx));
  const collect = ch.opts.findIndex((o) => /Delhaize Collect/.test(o.label)) + 1;
  await ch.receive(bot, String(collect));
  await ch.receive(bot, "1");
  await ch.receive(bot, "anna@example.com");
  assert.match(out.join("\n"), /Order DL-\d{6} confirmed/);
});
test("text channel: member login by number and service request by text", async () => {
  const out = [];
  const ch = new TextChannel((m) => out.push(m));
  const bot = new Bot(ch, CRM);
  await bot.start();
  await ch.receive(bot, "1");
  await ch.receive(bot, "2"); // Marc
  assert.match(out.join("\n"), /Hi Marc/);
  await ch.receive(bot, "where is my order?");
  assert.match(out.join("\n"), /DL-731554/);
});
