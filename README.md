# Gillette Shave Expert “Sam” – at Delhaize

Student concept for EDHEC Business School, *Omnichannel, E-commerce & Web Marketing* (session 8, automated
conversations): a conversational shopping assistant that helps Delhaize shoppers find the right Gillette products.
Not an official Gillette or Delhaize service. Product images are hot-linked from Gillette's web shop (© P&G).

**Live:** https://aaron-rz.github.io/gillette-bot/ · shelf-QR entry: `?src=shelf`

## What it does
- **Understands typed messages** (typo-tolerant, EN + basic FR/NL): one sentence like *“gift for my boyfriend, short
  beard, sensitive skin, max €30”* fills all needs at once; the bot only asks what is still missing.
- **Service requests by typing:** refunds/returns (official Delhaize rules), order status, defects (2-year guarantee),
  cuts/skin reactions (first aid), cancellations, receipts, privacy, human handover, complaints – with reference tickets.
- **Login vs guest:** three fictitious SuperPlus customers drive CRM-based journeys (replenishment, upgrade, gifting).
- **Skin & beard check:** selfie → on-device face analysis (MediaPipe) → facial hair, redness, shine, texture →
  personal routine. The photo never leaves the device.
- **AR beard try-on:** live camera (or a photo) with 6 beard styles and 4 colours → products to get the look.
- **Routines across the range:** razors, blades, gels, after-shave, King C. Gillette beard care, GilletteLabs, body, Venus.
- **AI mode:** opened as a claude.ai Artifact, Claude (on the viewer's own account) handles free text and photos via
  page tools; elsewhere the built-in engine runs.

## Code
Static ES modules, no backend: `js/nlu.js` (intents/entities), `js/dialog.js` (dialog manager), `js/recommend.js`,
`js/catalog.js` (34 products), `js/vision.js`, `js/ar.js`, `js/ai.js`, `js/ui.js`, `js/main.js`.
Tests: `npm test` (node:test, 113 cases).
