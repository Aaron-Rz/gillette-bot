// Demo customers as they would appear in Delhaize's CRM (SuperPlus loyalty programme). All fictitious.
export const CRM = [
  {
    id: "lucas", name: "Lucas", surname: "Peeters", age: 24, city: "Ixelles (Brussels)", store: "Delhaize Flagey",
    segment: "Young urban, price-aware", skin: "sensitive", area: "face", freq: "daily", owned: "fusion5", handle: "yes",
    razor: "Fusion5 handle", preferredGel: "fusion5SensitiveGel",
    lastPurchase: { product: "proglideBlades", daysAgo: 34 }, cycle: 35,
    history: [
      { date: "06 Oct 2026", item: "ProGlide blades 4×", channel: "Store (locked case)" },
      { date: "06 Oct 2026", item: "Fusion5 Ultra Sensitive gel", channel: "Store" },
      { date: "29 Aug 2026", item: "ProGlide blades 4×", channel: "Delhaize Collect" },
    ],
    lastOrder: { no: "CG-482913", channel: "Delhaize Collect", status: "ready", items: "ProGlide blades 4×" },
    points: 1240, channel: "App push", consent: true, email: "lucas.peeters@example.be",
  },
  {
    id: "marc", name: "Marc", surname: "De Smet", age: 47, city: "Ghent", store: "Delhaize Ledeberg",
    segment: "Loyal, convenience-driven", skin: "normal", area: "beard", style: "short", freq: "weekly", owned: "mach3", handle: "yes",
    razor: "Mach3 handle", preferredGel: "labsShavingGel",
    lastPurchase: { product: "mach3Blades", daysAgo: 61 }, cycle: 60,
    history: [
      { date: "09 Sep 2026", item: "Mach3 blades 4×", channel: "Delivery" },
      { date: "09 Sep 2026", item: "King C. Gillette beard oil", channel: "Delivery" },
      { date: "12 Jul 2026", item: "Mach3 blades 4×", channel: "Delivery" },
    ],
    lastOrder: { no: "DL-731554", channel: "Home delivery", status: "delivered", items: "Mach3 blades, beard oil" },
    points: 3860, channel: "E-mail", consent: true, email: "marc.desmet@example.be",
  },
  {
    id: "sophie", name: "Sophie", surname: "Lambert", age: 31, city: "Liège", store: "Delhaize Fragnée",
    segment: "Family shopper, buys for the household", skin: "normal", area: "body", freq: "weekly", owned: "venus", gender: "f",
    razor: "Venus", preferredGel: "satinCareAloeGel",
    lastPurchase: { product: "venusSmoothSensitive", daysAgo: 22 }, cycle: 45,
    household: "Partner Thomas (33), beard – no Gillette purchase recorded", occasion: "December gifting season",
    history: [
      { date: "18 Oct 2026", item: "Venus Smooth Sensitive", channel: "Store" },
      { date: "18 Oct 2026", item: "Satin Care aloe gel", channel: "Store" },
      { date: "02 Sep 2026", item: "Venus Smooth Sensitive", channel: "Store" },
    ],
    lastOrder: null,
    points: 2105, channel: "E-mail", consent: false, email: "sophie.lambert@example.be",
  },
];
