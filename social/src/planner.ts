// Plans one social post for AI Separations via Claude. Rotates through content
// pillars so the feed stays varied. Returns structured JSON we can post directly.

import Anthropic from "@anthropic-ai/sdk";

export type PostPlan = {
  theme: string;                 // short internal label
  captionInstagram: string;      // 2-5 short lines
  captionShort: string;          // <=150 chars for TikTok/Shorts
  hashtags: string[];            // without the # prefix
  imagePrompt: string;           // for gpt-image-1 (portrait)
};

// Content pillars — rotated by day so the feed isn't repetitive.
export const PILLARS = [
  "A practical color-separation tip (simulated process vs spot, white underbase, halftone LPI, trapping). Teach one useful thing.",
  "Highlight one AI Separations tool and the problem it solves: AI Print Doctor (catch file problems before you print), Instant Quote (know what to charge), Profit Mode (cheapest/fastest/best quality), or Ink Inventory Matching (separate to inks you own).",
  "Screen print vs DTF: when each one wins for a given job, color count, or run length.",
  "A pricing / profit insight for shops: setup fees, screens, press time, margins, break-even vs DTF.",
  "A file-prep tip: resolution at print size, gradients that band, transparent edges and DTF glue residue, fine detail that closes up.",
  "Ink: Pantone matching with plastisol, mixing from stock inks, separating to the inks already on your shelf.",
];

const SYSTEM = `You write punchy, useful social posts for AI Separations (aiseparations.com), a standalone prepress & quoting app for screen printers and DTF shops (AI color separation, Print Doctor file checks, instant quoting, profit modes, ink matching — no Photoshop, $179 one-time, free trial).

AUDIENCE: working screen printers and print-shop owners. They respond to specific, real tips — not hype.

VOICE: confident, concrete, friendly. Short lines. One idea per post. Teach something real, then connect it to the app where it genuinely fits (don't hard-sell every post). Never invent stats or testimonials. Never mention competitors by name.

OUTPUT: return ONE JSON object, no markdown:
{
  "theme": "<3-5 word internal label>",
  "captionInstagram": "<2-5 short lines, line breaks with \\n; a hook first line; end with a soft CTA like 'Free trial at aiseparations.com'>",
  "captionShort": "<one line, <=150 chars, for TikTok/Shorts>",
  "hashtags": ["screenprinting", "...8-12 relevant tags, no # prefix..."],
  "imagePrompt": "<a 2-3 sentence prompt for gpt-image-1, PORTRAIT. Clean screen-print / prepress imagery: a printed tee on press, neat ink tubs and squeegee, color swatches + halftone dots, or an abstract color-separation. Deep indigo and cyan palette on near-black. NO realistic faces, NO text/letters/numbers, NO logos or brand names. Tidy and professional.>"
}`;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

// ---- Before/after demo posts -----------------------------------------------
// A "demo" post shows real engine output: a piece of artwork → its separated
// spot-color screens. Claude invents a fresh artwork concept + the gpt-image-1
// prompt to render it, plus the caption framing. The actual color count and
// ink recommendation are filled in from the engine afterwards, so we never
// invent the numbers here.

export type DemoPlan = {
  concept: string;               // short internal label, e.g. "retro surf sunset"
  artPrompt: string;             // gpt-image-1 prompt for the artwork to separate
  captionInstagram: string;      // before/after framing, ends with a {{RESULT}} placeholder line
  captionShort: string;          // <=150 chars
  hashtags: string[];
};

const DEMO_SYSTEM = `You create "before/after" demo posts for AI Separations (aiseparations.com) — a prepress app that turns finished artwork into press-ready spot-color screens for screen printing (no Photoshop, $179 one-time, free trial).

The post shows a real artwork on top and its automatically-separated ink screens below. Your job: invent ONE fresh piece of artwork to feature, and write the caption.

The artwork must be a BOLD, FLAT, LIMITED-COLOR design that looks like real client art a shop would print on a tee — think mascots, badges, retro/vintage logos, illustrative graphics. It must separate cleanly into a few spot colors.

OUTPUT: return ONE JSON object, no markdown:
{
  "concept": "<3-5 word label, e.g. 'snarling tiger mascot'>",
  "artPrompt": "<2-3 sentence gpt-image-1 prompt. A bold flat vector-style screen-print graphic of the concept, limited palette (3-5 solid colors), clean shapes, centered on a PLAIN white or solid background. NO photographic realism, NO gradients/soft shading, NO text/letters/numbers, NO logos or brand names, NO faces of real people. Looks like artwork ready for a t-shirt.>",
  "captionInstagram": "<2-4 short lines. Hook first line about dropping this art into AI Separations and getting press-ready screens out. Do NOT state a specific number of colors — that gets appended automatically. End the lines, then on its own final line put exactly: {{RESULT}}>",
  "captionShort": "<one line, <=150 chars, before/after framing, no specific color count>",
  "hashtags": ["screenprinting", "...8-12 relevant tags, no # prefix..."]
}`;

export async function planDemo(): Promise<DemoPlan> {
  const c = client();
  const resp = await c.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1000,
    system: DEMO_SYSTEM,
    messages: [{ role: "user", content: "Invent today's demo artwork and write the post. Return ONLY the JSON object." }],
  });
  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Claude returned no text");
  let raw = block.text.trim();
  if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
  const plan = JSON.parse(raw) as DemoPlan;
  if (!plan.artPrompt || !plan.captionInstagram) throw new Error("demo plan missing fields");
  if (!Array.isArray(plan.hashtags)) plan.hashtags = [];
  if (!plan.captionShort) plan.captionShort = plan.captionInstagram.split("\n")[0] ?? plan.concept;
  if (!plan.concept) plan.concept = "demo";
  return plan;
}

export async function planPost(pillar: string): Promise<PostPlan> {
  const c = client();
  const resp = await c.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1200,
    system: SYSTEM,
    messages: [{ role: "user", content: `Today's pillar: ${pillar}\n\nWrite the post. Return ONLY the JSON object.` }],
  });
  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Claude returned no text");
  let raw = block.text.trim();
  if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
  const plan = JSON.parse(raw) as PostPlan;
  if (!plan.captionInstagram || !plan.imagePrompt) throw new Error("plan missing fields");
  if (!Array.isArray(plan.hashtags)) plan.hashtags = [];
  if (!plan.captionShort) plan.captionShort = plan.captionInstagram.split("\n")[0] ?? plan.theme;
  return plan;
}
