# Shave Assistant – Gillette at Delhaize

Student project for EDHEC Business School, *Omnichannel, E-commerce & Web Marketing* (session 8,
"Automated conversations"): a conversational shopping assistant that helps Delhaize shoppers find the
right Gillette product and buy it.

**Live demo:** https://aaron-rz.github.io/gillette-bot/
**Shelf QR entry:** https://aaron-rz.github.io/gillette-bot/?src=shelf

## What it shows
- Opening choice: **log in with SuperPlus** (personalised from CRM data) or **continue as guest**.
- 6-step path to conversion: Welcome → Needs → Recommend → Objections → Checkout → Follow-up.
- Three demo CRM customers (Lucas, Marc, Sophie) trigger different journeys: replenishment, upgrade, gifting.
- Guests answer 3–5 questions (zero-party data); they can join SuperPlus inside the chat to unlock 2+2.
- "Behind the scenes" panel shows which customer data drives each message.

## Tech
Static HTML/CSS/JS, no backend, no tracking, no API keys. Flow is data in `app.js` (`NODES`),
products and demo customers in `data.js`. Prices checked on delhaize.be on 9 Nov 2026; items marked
"indicative" had no online price.

Not affiliated with Delhaize or Gillette. All customers are fictitious.
