// Talk to Sam in the terminal – the plain-text channel (same dialog core as the web page).
//   node tools/chat-cli.mjs
import readline from "node:readline/promises";
import { Bot } from "../js/dialog.js";
import { CRM } from "../js/crm.js";
import { TextChannel } from "../js/channels/text.js";

const ch = new TextChannel((m) => console.log("\nSam: " + m.replace(/\n/g, "\n     ")));
const bot = new Bot(ch, CRM);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await bot.start();
for (;;) {
  const t = await rl.question("\nYou: ");
  if (/^(quit|exit)$/i.test(t.trim())) break;
  await ch.receive(bot, t);
}
rl.close();
