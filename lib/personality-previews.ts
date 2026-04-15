/**
 * Sample conversations for each industry × personality combination.
 * Used by the WhatsApp preview component during signup.
 * Each industry has one typical customer question, and 3 personality-flavoured responses.
 */

export const INDUSTRY_QUESTIONS: Record<string, string> = {
  accountant: "Hi, I'm a sole trader and haven't filed my self-assessment yet. Can you help?",
  solicitor: "I need help with a house purchase. Do you handle conveyancing?",
  plumber: "Hi, do you do emergency callouts? My kitchen tap is leaking badly",
  electrician: "Hi, I need an EICR done on my rental property. How much?",
  builder: "We're looking to get a loft conversion done. Can you give us a quote?",
  landscaper: "Hi! We want our garden completely redesigned. Do you do free quotes?",
  roofer: "Got a leak coming through the ceiling after last night's rain. Can you help?",
  gardener: "Looking for someone to do regular garden maintenance. Monthly visits?",
  fencing: "Need about 30 metres of close board fencing. What's your rate?",
  paving: "Want the front drive done in block paving. Can you come take a look?",
  decking: "Thinking about getting composite decking in the back garden. Options?",
  "tree-surgeon": "Got a massive oak that needs reducing. It's overhanging the neighbour's",
  cleaner: "Need a deep clean for a 3-bed house. Moving out end of the month",
  dental: "Hi, I've got really bad toothache. Can I get an emergency appointment?",
  "estate-agent": "We're thinking of selling our 3-bed semi. What's the market like?",
  recruitment: "Looking for 3 qualified electricians for a 6-month contract in Leeds",
  "hair-salon": "Hi! Do you do balayage? Looking for a natural sun-kissed look",
  "dog-groomer": "My cockapoo is matted to bits. Can you fit him in this week?",
}

export const PERSONALITY_RESPONSES: Record<string, Record<string, string>> = {
  accountant: {
    optimistic: "Yes, absolutely — we help sole traders with self-assessment all the time and it's much less scary than it sounds! We'll walk you through everything and make sure you're not paying a penny more than you need to. Do you have your invoices and expenses together, or do you need help with that side too?",
    balanced: "Yes, we handle self-assessment for sole traders. Our standard fee starts from £150+VAT. Could you let me know roughly what your turnover was for the year and whether you have your records ready?",
    analytical: "Yes, we can help. A few quick questions to assess the scope: Is this just the self-assessment, or do you also need bookkeeping catch-up? What tax year are we talking about? And do you have your invoices and bank statements to hand, or are the records also disorganised? That determines both the timeline and the fee.",
  },
  solicitor: {
    optimistic: "Yes, we do conveyancing and we genuinely enjoy helping people through what can feel like a stressful process! We'll keep you updated every step of the way and make it as smooth as possible. Happy to get a quote over to you today — just share the property details!",
    balanced: "Yes, we handle residential conveyancing. To prepare a fee estimate, I'll need the property address and purchase price. Are you using a mortgage or cash purchase?",
    analytical: "We do. To give you an accurate quote and timeline, a few questions: Is this freehold or leasehold? Are you in a chain? And have you already had an offer accepted, or is this at the early enquiry stage? That shapes the complexity and timescales significantly.",
  },
  plumber: {
    optimistic: "Hey! Don't worry — we'll get this sorted for you today! We do emergency callouts 24/7 and our team is great at getting there fast. A kitchen tap leak is usually a quick fix. What's your postcode and I'll find the nearest available engineer? 🔧",
    balanced: "Yes, we do emergency callouts. For a leaking tap, we can typically be with you within 2 hours. Could you share your postcode and best contact number?",
    analytical: "Yes, we cover emergency callouts. A few quick questions so I can get the right engineer to you: Is the leak from the tap itself or the pipework underneath? Can you isolate it at the stopcock? And what's your postcode? That'll help me match you with the right person.",
  },
  electrician: {
    optimistic: "Great news — yes, we do loads of EICR certificates for landlords! The pricing is really straightforward and we turn the certificate around quickly. For a standard rental it's usually around £150-180. When would you like to get it booked in?",
    balanced: "Yes, we carry out EICR inspections. For a 3-bed rental, pricing starts at £150. We issue the certificate within 24 hours. What date works for you?",
    analytical: "Yes, we do EICRs. To give you an accurate quote, I need a few details: How many bedrooms? When was the last electrical inspection done, if ever? And is the property currently tenanted — we're happy to work around tenants. That'll let me give you a firm price.",
  },
  builder: {
    optimistic: "A loft conversion — brilliant choice! It really transforms a home and adds so much space and value. We've done loads locally and love the results. Happy to come round for a free site visit and chat through the options — no pressure at all. When would suit you?",
    balanced: "Yes, we do loft conversions. We'd need to do a site visit to provide an accurate quote — there's no charge for that. What's your availability this week or next?",
    analytical: "We'd be happy to quote. Before arranging a visit, a few things help us prepare: Is the loft currently boarded or open? Do you know the ridge height — roughly 2.2m+ is ideal for a full conversion. And are you thinking Velux, dormer, or hip-to-gable? That helps me bring the right plans.",
  },
  landscaper: {
    optimistic: "Yes, absolutely free! A full garden redesign is one of our favourite projects — there's something amazing about transforming an outdoor space. I'd love to come round, see what you're working with, and put some ideas together. When are you free for a visit? 🌿",
    balanced: "Yes, we offer free site visits and quotes for garden redesigns. Could you share your postcode so I can check availability and arrange a convenient time?",
    analytical: "We do, and for a full redesign, seeing the space is essential before any figure makes sense. A few things help me prepare: rough size of the garden, whether there are existing structures to keep, and what style you're drawn to. Could we also do a quick video call first so I can see the space?",
  },
  roofer: {
    optimistic: "Yes, don't worry — a ceiling leak after rain is something we deal with all the time and most are very fixable! We can get someone out to have a look as soon as possible. What's your address and I'll check nearest availability?",
    balanced: "Yes, we can help. We can arrange an inspection — usually next working day. Could you share your address and a contact number?",
    analytical: "Yes, we can help. A few things help us locate the source faster when we arrive: Is the water coming through in a single spot or spread across the ceiling? Is the stain near a chimney, valley, or flat section? And how old is the roof roughly? That helps me know what we're likely dealing with.",
  },
  gardener: {
    optimistic: "Yes! Monthly maintenance is exactly what we love doing — it's so satisfying to keep a garden looking its best through the seasons. We'd pop round for a free visit first to see the space and chat about what you need. When are you free? 🌸",
    balanced: "Yes, we offer monthly garden maintenance contracts. We'd need to visit the property to assess the work involved and provide a quote. What's your postcode?",
    analytical: "Monthly visits work well for most clients. Before quoting, it helps to know: roughly how large is the garden? Is it mainly lawn, beds, or mixed? And are there any trees or hedges that need regular attention? That tells me whether one person for a few hours covers it or whether it needs a two-person visit.",
  },
  fencing: {
    optimistic: "30 metres of close board — a nice solid job! We do loads of these and the results always look great. We'll need to pop round to give you an accurate price as ground conditions can vary, but it's a free visit. When would work for you?",
    balanced: "For close board fencing, pricing depends on ground conditions and access. We'd need a site visit to quote accurately — it's free and takes around 20 minutes. What's your postcode?",
    analytical: "Pricing for close board varies depending on a few factors: Is the ground flat or sloped? Concrete or soft ground for the posts? Are there existing panels to remove? And is there a gate needed in the run? Once I have those, I can give you a much more accurate ballpark before the site visit.",
  },
  paving: {
    optimistic: "Block paving on the front drive is such a brilliant upgrade — it really transforms the whole look of the house! We'd love to come take a look and show you some styles. Completely free, no pressure. When are you free? ✨",
    balanced: "Yes, we can arrange a site visit. It's free and allows us to measure the area, check the base condition, and show you style options. What's your availability?",
    analytical: "Of course. A few details help me come prepared: Is there existing concrete or tarmac to break out, or is it currently gravel or grass? Do you have a preference on pattern or colour? And roughly what size is the drive in square metres? That shapes the quote significantly.",
  },
  decking: {
    optimistic: "Great choice — composite decking looks incredible and the low-maintenance aspect is a real game-changer! We work with some brilliant brands and there are so many gorgeous colour options. I'd love to come round with some samples — free of course. When suits? 🌿",
    balanced: "Yes, we install composite decking. We carry several brands including Trex and Millboard. A site visit with samples is the best next step — no charge. When are you available?",
    analytical: "Composite decking varies quite a bit in price and quality depending on brand and board thickness. Before coming out with samples, it helps to know: rough size in square metres, whether it's raised or ground-level, and your rough budget range. That way I bring the right options rather than overwhelming you.",
  },
  "tree-surgeon": {
    optimistic: "Good news — this is exactly the kind of job we love! Overhanging trees can feel complicated but we handle these all the time. We'll assess it properly, do what's right for the tree and the relationship with your neighbour, and give you a clear quote. When suits for a visit? 🌳",
    balanced: "Yes, we handle tree reduction work. We're NPTC qualified and fully insured. I can arrange a site inspection to assess the oak and provide a quote. What's your postcode?",
    analytical: "We can definitely help. Before the visit it's useful to know: is the tree covered by a TPO (Tree Preservation Order)? Has your neighbour raised a formal complaint, or is this proactive? And roughly how high is the tree and how far are the branches overhanging? That shapes the planning and the quote significantly.",
  },
  cleaner: {
    optimistic: "A deep clean for the move-out — we do loads of these and they really make a difference! We'll leave it looking brilliant so you can get your deposit back worry-free. What's your move-out date? We'll get you booked in! 🧹",
    balanced: "Yes, we offer end-of-tenancy deep cleans. For a 3-bed house it typically takes 4-6 hours. Could you confirm the date you need it done and your postcode?",
    analytical: "Happy to help. A few things affect the quote and booking: Is it a furnished or unfurnished clean? Are carpets included or just hard floors? And do you need a specific date, or is end of month flexible by a day or two? That helps me schedule the right team size.",
  },
  dental: {
    optimistic: "Oh no — toothache is miserable but you've come to the right place! We keep emergency slots open every day for exactly this. Let me check what's available today and get you seen as soon as possible. What's your name and are you an existing patient?",
    balanced: "Yes, we have emergency appointments available. Please give me your name and I'll check our earliest slot today. Are you an existing patient with us?",
    analytical: "We do have emergency appointments. To prioritise correctly: on a scale of 1-10 how bad is the pain? Is it constant or does it come and go? Any swelling or sensitivity to hot and cold? That helps me know whether to book you urgently today or first thing tomorrow.",
  },
  "estate-agent": {
    optimistic: "Really good news — it's a great time to be selling! 3-bed semis are moving well right now and there's strong buyer demand. We'd love to come round and give you a proper valuation — it's free, no obligation, and you might be pleasantly surprised at the number! When suits?",
    balanced: "The market for 3-bed semis is performing well with good buyer demand. I'd recommend a free valuation to give you a realistic price for your specific property. What's your availability?",
    analytical: "It's a solid market for that property type right now. To give you a meaningful picture, it helps to know: your approximate postcode, the condition and any recent improvements, and whether you're in a hurry to sell or happy to wait for the right buyer. That shapes the pricing strategy and how we'd market it.",
  },
  recruitment: {
    optimistic: "Great — you've come to the right place! We work with a brilliant network of qualified electricians across Yorkshire and placing 3 for a 6-month contract is absolutely something we can do. We'd love to help get this sorted quickly. When do you need them to start?",
    balanced: "We can help with that. We have qualified electricians on our books in the Leeds area. To shortlist candidates, I'll need: CSCS card requirements, start date, and the day rate or salary range.",
    analytical: "We cover electrical trades placements in Yorkshire. To find the right fit rather than just any three candidates, a few questions: What type of electrical work — commercial, industrial, or domestic? Are they working under a supervisor or running their own jobs? And what CSCS and NVQ level is required? That lets me target the right people.",
  },
  "hair-salon": {
    optimistic: "Yes! Balayage is one of our most popular services and a natural sun-kissed look is absolutely gorgeous. You're going to love the result! We'd start with a free consultation to find the perfect tones for your hair. Want to get that booked in? ☀️",
    balanced: "Yes, we offer balayage. We recommend a free consultation first to assess your hair and agree on the technique and tones. When would suit you?",
    analytical: "Yes, we do balayage regularly. For a really natural result, a few factors affect the approach: What's your natural base colour and length? Has your hair been previously coloured? And do you have any reference photos? That helps us match the style precisely rather than guessing.",
  },
  "dog-groomer": {
    optimistic: "Ah, cockapoos! They're the absolute best but yes, they do love to get matted! Don't worry — we'll have him looking gorgeous again in no time. We've got space this week. What's his name and which day works best for you? 🐶",
    balanced: "Yes, we have availability this week. For a matted cockapoo, allow around 1.5-2 hours. What days work for you, and what's his name?",
    analytical: "We can fit him in. A couple of quick questions so I can prep properly: How severe is the matting — patches or all over? Has he been professionally groomed before? And how old is he? Younger dogs sometimes need extra time to settle. That lets me block the right slot.",
  },
}

export function getPreviewConversation(industry: string, personality: string): { question: string; answer: string } {
  const question = INDUSTRY_QUESTIONS[industry] ?? INDUSTRY_QUESTIONS['plumber']
  const responses = PERSONALITY_RESPONSES[industry] ?? PERSONALITY_RESPONSES['plumber']
  const answer = responses[personality] ?? responses['balanced']
  return { question, answer }
}
