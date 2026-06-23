// Blog topic queue. Agent walks this list in order, picking the first
// topic not in state.json's published list. Add new topics at the end;
// never reorder or reuse ids.

import type { Topic } from "./types.ts";

const QUOTE = "screen-print-quote-calculator";
const PROFIT = "screen-print-profit-calculator";
const DOCTOR = "print-readiness-check";
const INKS = "separate-to-my-inks";
const AISEP = "ai-color-separation-software";

export const TOPICS: Topic[] = [
  // ---------- Separation fundamentals ----------
  // (simulated-process-vs-spot-color and color-separation-without-photoshop
  //  already exist as hand-written posts on the site, so they're not in the queue.)
  {
    id: "how-many-screens-does-my-design-need",
    title: "How Many Screens Does My Design Actually Need?",
    intent: "Shop estimating screen count from artwork before quoting.",
    keywords: ["how many screens screen printing", "screen count", "colors per design"],
    linkedPages: [QUOTE, PROFIT],
    category: "separation",
  },
  {
    id: "what-is-a-white-underbase",
    title: "What Is a White Underbase and When Do You Need One?",
    intent: "Printer learning why prints on dark garments need an underbase.",
    keywords: ["white underbase", "underbase screen printing", "printing on dark shirts"],
    linkedPages: [DOCTOR],
    category: "separation",
  },
  {
    id: "halftones-lpi-mesh-explained",
    title: "Halftones, LPI and Mesh Count: A Plain-English Guide",
    intent: "Printer trying to pick LPI and mesh to avoid moiré and dot gain.",
    keywords: ["halftone LPI screen printing", "mesh count for halftones", "dot gain"],
    linkedPages: [DOCTOR],
    category: "separation",
  },

  // ---------- File prep / readiness ----------
  {
    id: "is-my-artwork-print-ready",
    title: "Is My Artwork Print Ready? A Pre-Flight Checklist",
    intent: "Customer or printer checking a file before committing to print.",
    keywords: ["is my artwork print ready", "print ready artwork", "screen printing artwork requirements"],
    linkedPages: [DOCTOR],
    category: "fileprep",
  },
  {
    id: "artwork-resolution-for-screen-printing",
    title: "What Resolution Does Screen-Print Artwork Need?",
    intent: "Printer judging whether a low-res customer file will hold up at size.",
    keywords: ["artwork resolution screen printing", "dpi for screen printing", "low resolution artwork"],
    linkedPages: [DOCTOR],
    category: "fileprep",
  },
  {
    id: "fix-low-resolution-customer-art",
    title: "How to Rescue a Low-Resolution Customer File",
    intent: "Shop handed a small JPEG that needs to print larger.",
    keywords: ["fix low resolution artwork", "upscale artwork for printing", "blurry customer file"],
    linkedPages: [DOCTOR],
    category: "fileprep",
  },

  // ---------- DTF ----------
  {
    id: "dtf-vs-screen-print",
    title: "DTF vs Screen Printing: When Each One Wins",
    intent: "Shop choosing between DTF and screen print for a given job and run length.",
    keywords: ["dtf vs screen printing", "when to use dtf", "dtf or screen print"],
    linkedPages: [PROFIT, DOCTOR],
    category: "dtf",
  },
  {
    id: "dtf-glue-residue-causes-fixes",
    title: "DTF Glue Residue: Why It Happens and How to Stop It",
    intent: "Printer seeing a hazy adhesive halo around DTF transfers.",
    keywords: ["dtf glue residue", "dtf adhesive halo", "transparent edges dtf"],
    linkedPages: [DOCTOR],
    category: "dtf",
  },

  // ---------- Pricing / profit ----------
  {
    id: "how-to-price-a-screen-printing-job",
    title: "How to Price a Screen Printing Job (Step by Step)",
    intent: "New shop owner who doesn't know how to build a quote.",
    keywords: ["how to price screen printing", "screen printing pricing", "screen print quote"],
    linkedPages: [QUOTE, PROFIT],
    category: "pricing",
  },
  {
    id: "screen-printing-cost-per-shirt",
    title: "What Does It Really Cost to Print a Shirt?",
    intent: "Owner breaking down true per-shirt cost: blanks, ink, screens, labor.",
    keywords: ["screen printing cost per shirt", "cost to print a shirt", "screen print job cost"],
    linkedPages: [PROFIT, QUOTE],
    category: "pricing",
  },
  {
    id: "setup-fees-screen-printing",
    title: "Setup Fees in Screen Printing: What to Charge and Why",
    intent: "Printer unsure how to charge for screens and setup time.",
    keywords: ["screen printing setup fee", "screen charge", "screen printing minimum"],
    linkedPages: [QUOTE],
    category: "pricing",
  },
  {
    id: "fewer-colors-more-profit",
    title: "Can Fewer Colors Make You More Money?",
    intent: "Shop weighing color count against margin and press time.",
    keywords: ["reduce colors screen printing", "screen printing profit margin", "fewer screens"],
    linkedPages: [PROFIT],
    category: "pricing",
  },

  // ---------- Ink ----------
  {
    id: "separate-to-inks-you-own",
    title: "Separate to the Inks You Already Own",
    intent: "Shop tired of buying new ink for every job instead of using stock.",
    keywords: ["ink inventory matching", "use stock inks", "plastisol ink matching"],
    linkedPages: [INKS],
    category: "ink",
  },
  {
    id: "pantone-matching-screen-printing",
    title: "Pantone Matching for Screen Printing, Demystified",
    intent: "Printer matching a brand Pantone with plastisol on press.",
    keywords: ["pantone matching screen printing", "pms color match plastisol", "delta e ink match"],
    linkedPages: [INKS],
    category: "ink",
  },
  {
    id: "mixing-plastisol-ink-recipes",
    title: "Mixing Plastisol Ink: Recipes, Ratios and Reality",
    intent: "Shop mixing a custom color from base inks they stock.",
    keywords: ["mixing plastisol ink", "ink mixing recipe", "custom plastisol color"],
    linkedPages: [INKS],
    category: "ink",
  },

  // ---------- AI / answer-engine topics (own the "AI" query gap) ----------
  {
    id: "best-ai-color-separation-software",
    title: "The Best AI Color Separation Software for Screen Printers",
    intent: "Shop searching for an AI-powered separation tool and finding mostly non-AI options.",
    keywords: ["best ai color separation software", "ai color separation software", "ai separation software"],
    linkedPages: [AISEP],
    category: "separation",
  },
  {
    id: "is-there-ai-screen-printing-software",
    title: "Is There AI Screen Printing Software? Yes — Here's What It Does",
    intent: "Printer wondering whether real AI tools exist for screen printing prepress.",
    keywords: ["ai screen printing software", "is there ai for screen printing", "ai for screen printers"],
    linkedPages: [AISEP, DOCTOR],
    category: "separation",
  },
  {
    id: "automatic-color-separation-explained",
    title: "Automatic Color Separation: How It Works and What to Expect",
    intent: "Printer evaluating automated/AI separation vs hand-separating in Photoshop.",
    keywords: ["automatic color separation", "auto color separation software", "automated screen printing seps"],
    linkedPages: [AISEP],
    category: "separation",
  },
  {
    id: "ai-vs-manual-color-separation",
    title: "AI vs Manual Color Separation: Which Is Better?",
    intent: "Experienced separator weighing AI-assisted seps against hand separation.",
    keywords: ["ai vs manual color separation", "ai color separation accuracy", "should i use ai for seps"],
    linkedPages: [AISEP, PROFIT],
    category: "separation",
  },
];
