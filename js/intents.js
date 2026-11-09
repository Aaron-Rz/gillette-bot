// Category catalogue for typed messages. Every message is ranked against these categories
// (see classify.js). `label` is the button text used when Sam asks "Did you mean …?".
// Examples are the classifier's training data – the held-out test set lives separately in test/.

export const GROUPS = {
  shop: "Shopping",
  advice: "Shaving & beard advice",
  consult: "Skin check & try-on",
  service: "Orders & help",
  meta: "Chat",
};

const C = (id, group, label, examples) => ({ id, group, label, examples: examples.trim().split("\n").map((s) => s.trim()).filter(Boolean) });

export const CATEGORIES = [
  // ---------------- shopping ----------------
  C("find_product", "shop", "Find the right product", `
    which razor should i buy
    i need a new razor
    recommend me something for shaving
    what's the best razor for me
    looking for a good razor for sensitive skin
    i need new blades
    which shaving gel is good
    show me razors
    i don't know what to buy
    help me choose a razor
    what do you recommend for my beard
    i want a trimmer
    something for dry skin after shaving
    i need an aftershave balm
    razor for a teenager starting to shave
    best product for a close shave
    i have sensitive skin what should i use
    what should i use for my beard
    i want to buy a beard oil
    need refills
    je cherche un rasoir
    welk scheermes raad je aan
    ich brauche einen rasierer
    which razor is good for women
    show me the shaving range
    i want a complete shaving routine
  `),
  C("gift", "shop", "Find a gift", `
    gift for my boyfriend
    present for my dad
    christmas gift ideas for a man with a beard
    what can i buy my husband for his birthday
    something for my brother
    gift set for fathers day
    i want to surprise my partner
    cadeau pour mon copain
    cadeau voor mijn vriend
    looking for a present under 30 euros
    gift for a guy who has everything
    valentine gift for him
    a gift for my girlfriend who shaves her legs
    my son just started shaving what should i get him
  `),
  C("compare", "shop", "Compare products", `
    what's the difference between fusion and proglide
    compare mach3 and fusion5
    is proglide better than fusion
    which is better skinguard or proglide
    difference between the trimmer and the style master
    mach3 vs fusion5
    compare the razors
    labs or proglide which one
    what makes the expensive razor better
    quelle est la difference entre fusion et proglide
    gel or foam which is better
    is the more expensive razor worth it
  `),
  C("budget", "shop", "Cheaper options", `
    too expensive
    do you have something cheaper
    i'm on a budget
    what's the cheapest razor
    cheaper option please
    blades are so expensive
    anything under 10 euros
    i can't afford that
    less expensive alternative
    c'est trop cher
    te duur
    something affordable
  `),
  C("price", "shop", "Check a price", `
    how much is the proglide
    what does the fusion5 cost
    price of the beard oil
    how much are the blades
    what's the price of a trimmer
    how much does it cost
    combien coute le rasoir
    hoeveel kost dat
    price please
    how much for the gel
  `),
  C("promo", "shop", "Current deals", `
    any deals right now
    is there a promotion
    do you have discounts
    what's on sale
    2+2 offer
    any coupons
    special offers on blades
    is anything on sale this week
    promo gillette
    korting op mesjes
    best deal on blades
  `),
  C("superplus_info", "shop", "About SuperPlus", `
    what is superplus
    how do i join superplus
    how does the loyalty card work
    superplus points
    is superplus free
    how do i get a superplus card
    what are the benefits of superplus
    c'est quoi superplus
    wat is superplus
    loyalty programme
    how many points do i get
    do i earn points on blades
  `),
  C("compat", "shop", "Do the blades fit?", `
    do proglide blades fit my fusion handle
    will these refills fit my razor
    are mach3 blades compatible with fusion
    can i use fusion5 blades on proglide
    which blades fit my handle
    does it work with my old razor
    same handle for all gillette blades
    my handle is a mach3 which refills
    passen die klingen
    compatible avec mon rasoir
    can i use these blades on another handle
  `),
  C("availability", "shop", "Is it in the range?", `
    do you sell electric shavers
    do you have king c gillette
    do you sell venus razors
    do you have safety razors
    is there a gillette electric razor
    do you carry gillettelabs
    do you have the heated razor
    do you sell beard trimmers
    do you have shaving cream
    any razors for women
    est-ce que vous avez des rasoirs electriques
    do you stock venus
    do you sell shaving foam
  `),
  C("store_stock", "shop", "Find it in store", `
    where can i find razors in the store
    which aisle are the blades
    is it in stock at my delhaize
    where are the gillette products
    is the proglide available in ixelles
    why are the blades locked
    which store has it
    nearest delhaize
    opening hours of the store
    where is delhaize gent
    can i pick it up today
  `),
  C("basket", "shop", "Open my basket", `
    what's in my basket
    show my cart
    remove the gel
    take the blades out of my basket
    show basket
    what did i add
    empty my cart
    change the quantity
    mon panier
    winkelmand
  `),
  C("checkout", "shop", "Go to checkout", `
    i want to pay
    checkout
    i'm ready to order
    let's buy it
    proceed to payment
    order now
    i'll take it
    place my order
    buy now
    how do i pay
    finish my order
    complete the purchase
    ok let's order that
    je veux payer
    ik wil afrekenen
  `),

  // ---------------- advice ----------------
  C("how_to_shave", "advice", "How to shave", `
    how do i shave properly
    how to shave my face
    tips for a better shave
    first time shaving what do i do
    should i shave with or against the grain
    how do i get a closer shave
    do i need shaving gel
    shave before or after shower
    how to use a razor
    comment bien se raser
    hoe scheer ik me goed
    best way to shave
    shaving technique
    what direction should i shave
    steps for a good shave
  `),
  C("blade_change", "advice", "When to change blades", `
    how often should i change blades
    when do i need new blades
    my blade is dull
    how long does a blade last
    blades get blunt quickly
    how many shaves per cartridge
    the blade pulls my hairs
    when to replace my razor
    how do i know the blade is worn out
    combien de rasages par lame
    is it time for new blades
    the razor pulls my hair
  `),
  C("razor_burn", "advice", "Stop razor burn", `
    my skin burns after shaving
    i get red after shaving
    how to avoid razor burn
    my skin is irritated after i shave
    shaving makes my neck red
    my skin hurts after shaving
    tips for sensitive skin shaving
    redness after shave
    it stings after i shave
    rash from shaving how to prevent
    ma peau brule apres le rasage
    rode huid na het scheren
    how do i stop razor burn
    my face stings after shaving
    shaving tips for sensitive skin
  `),
  C("ingrown", "advice", "Ingrown hairs & bumps", `
    i get ingrown hairs
    razor bumps on my neck
    red bumps after shaving
    how to prevent ingrown hairs
    i have curly hair and get bumps
    pimples after shaving
    bumps on my legs after shaving
    poils incarnes
    ingegroeide haren
  `),
  C("beard_trim", "advice", "Trim & shape a beard", `
    how do i trim my beard
    how to shape my beard
    how to do a neckline
    clean up my beard lines
    how short should i trim my stubble
    how to line up my cheeks
    which guard length for stubble
    keep my beard tidy
    how to trim a moustache
    comment tailler ma barbe
    baard bijwerken
  `),
  C("beard_grow", "advice", "Grow a beard", `
    i want to grow a beard
    how long does it take to grow a beard
    my beard is patchy
    how to grow a fuller beard
    my beard won't grow on the cheeks
    should i trim while growing my beard
    tips for growing a beard
    ma barbe ne pousse pas
    baard laten groeien
    how many weeks does a beard take
  `),
  C("beard_care", "advice", "Beard care", `
    my beard is itchy
    my beard feels rough
    how to soften my beard
    beard oil or balm
    how do i wash my beard
    dandruff in my beard
    my beard is dry
    how to use beard oil
    how often should i oil my beard
    beard care routine
    ma barbe gratte
  `),
  C("head_shave", "advice", "Shave your head", `
    i shave my head
    how to shave my head
    best razor for a bald head
    tips for shaving my scalp
    head shaving
    my head gets bumps when i shave it
    shaving a bald head
    how do i shave my scalp smooth
  `),
  C("body_shave", "advice", "Body & legs", `
    how to shave my legs
    i want smooth legs
    shaving my chest
    how to shave my body
    shaving intimate areas
    manscaping
    shaving my armpits
    razor for legs and bikini line
    body hair removal
    se raser les jambes
    how do i shave my legs properly
    shaving down there
    hoe scheer ik mijn benen
  `),

  // ---------------- consult ----------------
  C("photo", "consult", "Skin & beard check (photo)", `
    analyse my skin
    can you check my face from a photo
    i want a skin analysis
    upload a selfie
    check my beard with a picture
    what's my skin type
    scan my face
    take a photo of me
    do a skin consultation
    photo analyse
    look at my face and tell me what suits me
    analyse my beard from a photo
  `),
  C("ar", "consult", "Try beard styles", `
    try on beard styles
    how would i look with a beard
    show me with a full beard
    virtual try on
    which beard style suits me
    try a moustache on me
    augmented reality beard
    let me see different beards
    can i see myself with stubble
    show me how a beard would look on me
    test beard styles with my camera
    see myself with a goatee
  `),

  // ---------------- service ----------------
  C("refund", "service", "Return or refund", `
    i want a refund
    i want to return my order
    how do i return something
    can i get my money back
    return policy
    i'd like to send it back
    i want to exchange the razor
    remboursement
    je veux retourner un produit
    ik wil terugbetaling
    terugsturen
  `),
  C("order_status", "service", "Where is my order?", `
    where is my order
    my order hasn't arrived
    track my order
    when will my parcel arrive
    my delivery is late
    has my order been shipped
    still waiting for my package
    is my collect and go order ready
    ou est ma commande
    waar is mijn bestelling
  `),
  C("delivery_info", "service", "Delivery info", `
    how long does delivery take
    do you deliver to ghent
    how much is delivery
    what are the delivery costs
    is there a minimum order
    can i choose a delivery slot
    do you deliver on sunday
    how does collect and go work
    free delivery
    livraison combien de temps
    leveringskosten
  `),
  C("wrong_item", "service", "Wrong or missing item", `
    i got the wrong product
    you sent me the wrong blades
    an item is missing from my order
    my order was incomplete
    the gel wasn't in the bag
    i received something i didn't order
    wrong size in my delivery
    il manque un article
    verkeerd product ontvangen
    i ordered a razor but got gel
    the refills were not in the box
    my order has the wrong product
    something is missing in my delivery
    ik kreeg het verkeerde artikel
  `),
  C("billing", "service", "Payment problem", `
    you charged me twice
    i was double charged
    wrong amount on my card
    i paid too much
    payment failed but money was taken
    the price at checkout was different
    my discount wasn't applied
    debite deux fois
    twee keer betaald
    i was charged more than the order total
    money was taken but the payment failed
    the amount on my bank statement is wrong
    ik heb te veel betaald
  `),
  C("defect", "service", "Broken product", `
    my razor broke
    the trimmer stopped working
    the handle is broken
    the blades are rusty
    my trimmer won't charge
    the product is defective
    the gel can is leaking
    it arrived damaged
    kapot
    casse
    it doesn't work anymore
    the razor stopped working
    the head is stuck
    mijn trimmer werkt niet meer
    le rasoir ne marche plus
  `),
  C("injury", "service", "Cut or skin reaction", `
    i cut myself badly
    i'm bleeding from shaving
    i had an allergic reaction
    my skin is swollen after using the gel
    i got a rash from the product
    nicked myself and it won't stop bleeding
    allergie
    i got hives after shaving
    my skin swelled up after the gel
  `),
  C("cancel", "service", "Cancel something", `
    cancel my order
    i want to cancel
    stop the reminders
    unsubscribe me
    annuler ma commande
    bestelling annuleren
    don't send me emails anymore
    i want to cancel my order
    annuleer mijn bestelling
  `),
  C("invoice", "service", "Receipt or invoice", `
    i need an invoice
    where is my receipt
    can i get a receipt
    send me the invoice
    facture
    factuur
    proof of purchase
  `),
  C("privacy", "service", "My data", `
    delete my data
    what do you know about me
    privacy policy
    gdpr request
    remove my account
    what data do you store
    supprimer mes donnees
    do you save my photos
    is my picture stored
    what happens with my data
  `),
  C("human", "service", "Talk to a person", `
    can i talk to someone
    i want a real person
    customer service phone number
    call me back
    speak to an agent
    contact delhaize
    is there a human
    je veux parler a quelqu'un
    medewerker spreken
  `),
  C("complaint", "service", "Make a complaint", `
    i want to complain
    this is terrible service
    i'm very disappointed
    bad experience at the store
    the staff was rude
    i'm not happy at all
    worst shopping experience
    plainte
    klacht
    i'm unhappy with your service
    ik ben niet tevreden
  `),

  // ---------------- meta ----------------
  C("capabilities", "meta", "What Sam can do", `
    help
    what can you do
    how does this work
    who are you
    what are you
    what can i ask you
    options
    menu
    are you a bot
    aide
    what can you help me with
    wat kan je doen
    que peux-tu faire
    was kannst du
  `),
  C("greeting", "meta", "Say hi", `
    hi
    hello
    hey there
    good morning
    bonjour
    hallo
    hey sam
  `),
  C("thanks", "meta", "Thanks", `
    thanks
    thank you
    cheers
    merci
    dank je
    great thanks
  `),
  C("bye", "meta", "Goodbye", `
    bye
    goodbye
    see you
    that's all
    au revoir
    tot ziens
  `),
  C("restart", "meta", "Start over", `
    start over
    restart
    reset the chat
    new chat
    begin again
    recommencer
  `),
  C("login", "meta", "Log in", `
    log in
    sign in
    my account
    use my superplus card
    i'm a member
    connect my card
    se connecter
    inloggen
  `),
  C("out_of_scope", "meta", "Something else", `
    what's the weather
    tell me a joke
    are your products vegan
    is gillette tested on animals
    who will win the election
    asdf
    lol
    what's the meaning of life
    can you book a taxi
    who is the president
    what time is it
  `),
];

export const BY_CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// Old regex intent names (nlu.js) → category ids, so precise patterns keep boosting the right category.
export const INTENT_TO_CAT = {
  recommend: "find_product", cheaper: "budget", store: "store_stock",
  refund: "refund", order_status: "order_status", defect: "defect", injury: "injury", cancel: "cancel",
  invoice: "invoice", privacy: "privacy", human: "human", complaint: "complaint", compare: "compare",
  price: "price", compat: "compat", promo: "promo", basket: "basket", photo: "photo", ar: "ar",
  login: "login", greeting: "greeting", thanks: "thanks", bye: "bye", restart: "restart",
};

// Categories shown when Sam has to guide (low confidence), in this order.
export const GUIDE = [
  ["shop", ["find_product", "gift", "promo"]],
  ["advice", ["how_to_shave", "razor_burn", "beard_trim"]],
  ["consult", ["photo", "ar"]],
  ["service", ["order_status", "refund", "human"]],
];
