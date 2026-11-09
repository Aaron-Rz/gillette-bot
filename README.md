# Gillette Shave Expert “Sam” – at Delhaize

Student concept for EDHEC Business School, *Omnichannel, E-commerce & Web Marketing* (session 8, automated
conversations): a conversational shopping assistant that helps Delhaize shoppers find the right Gillette products.
Not an official Gillette or Delhaize service. Product images are hot-linked from Gillette's web shop (© P&G).

**Live:** https://aaron-rz.github.io/gillette-bot/ · shelf-QR entry: `?src=shelf` · how it works: [docs/flow.html](docs/flow.html)

## What it does (v3)
- **Login first:** the chat opens with *Log in with SuperPlus* (three fictitious CRM customers: replenishment, upgrade,
  gifting) or *Continue as guest* (zero-party data only).
- **Every typed message lands somewhere:** typo-tolerant understanding (EN + common FR/NL/DE) ranks the message against
  42 categories in 5 groups (shopping, advice, skin check & try-on, orders & help, chat). Sure → acts; unsure → *“Just
  to make sure – do you mean …?”* with the top matches as buttons; lost → topic menu, after two misses a person
  (0800 95 713). Typed answers are matched to the buttons on screen (“the second one”, “unopened”).
- **Advice** from Gillette's own guides (shaving, blade change, razor burn, ingrown hairs, beard trim/growth/care, head,
  body) with source links; **service flows** by typing: refund/return, order status, delivery info, wrong item,
  payment check, defect, injury, cancel, invoice, privacy, human, complaint – grounded in Delhaize's terms.
- **Skin & beard check:** selfie → on-device MediaPipe face mesh → measured over face zones (forehead, cheeks, upper
  lip, chin & jaw, neck) → facial hair, redness, shine, texture with switchable overlays. The photo never leaves the device.
- **AR beard try-on:** the beard is painted in face-mesh texture space and warped onto the 3D landmarks (WebGL2), so it
  follows head turns, tilt and distance; hair strands, lighting from the camera image, mouth kept clear.
- **Basket & checkout:** basket drawer (quantities, SuperPlus 2+2 maths), **Delhaize Collect** pick-up at 25 real
  collect points (search, near me, member home store pre-selected) or home delivery (postcode), confirmation e-mail
  from the CRM or asked and validated (demo: nothing is sent).
- **Channel-agnostic core:** the same dialog runs in a plain-text channel (`js/channels/text.js`, WhatsApp/SMS style):
  `node tools/chat-cli.mjs`.

## Claude (only where allowed)
- **Public site:** built-in engine only.
- **claude.ai Artifact:** Claude on the *viewer's own* account handles unclear turns and photos through page tools.
- **Presenter version** (owner's tailnet only): `server/sam-ai.mjs` serves the app and passes unclear turns to
  `claude -p` (Haiku, no tools, JSON actions) on the owner's own subscription. Never exposed publicly.

## Measured
`npm test` (node:test). Classifier on a final blind set of 210 messages written independently and never used for tuning:
top-1 72.9 %, top-3 89.5 %, 59 of 63 direct actions correct; the rest are clarified with buttons or guided.

## Code
Static ES modules: `js/dialog.js` (dialog manager), `js/classify.js` + `js/intents.js` (categories), `js/nlu.js`
(entities), `js/advice.js`, `js/recommend.js`, `js/catalog.js` (34 products), `js/stores.js`, `js/vision.js`,
`js/facemesh.js` (MediaPipe canonical face model, Apache-2.0), `js/ar-gl.js`, `js/ar.js`, `js/ai.js`, `js/ui.js`,
`js/icons.js`, `js/main.js`.
