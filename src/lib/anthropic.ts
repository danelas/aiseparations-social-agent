// Calls Claude to draft a blog post. Asks for structured JSON so we can
// render predictable HTML without parsing prose.

import Anthropic from "@anthropic-ai/sdk";
import type { Topic, DraftedPost } from "./types.ts";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;

  const raw = process.env.ANTHROPIC_API_KEY ?? "";
  const apiKey = raw.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  // Detect non-HTTP-safe characters inside the (already-trimmed) key, so we
  // fail with a clear diagnostic instead of the cryptic "*** is not a legal
  // HTTP header value" from node-fetch deep in the stack.
  const badIdx = [...apiKey].findIndex((c) => {
    const code = c.charCodeAt(0);
    return code < 0x20 || code > 0x7e; // outside printable ASCII
  });
  if (badIdx !== -1) {
    const bad = apiKey.charCodeAt(badIdx);
    throw new Error(
      `ANTHROPIC_API_KEY contains a character that's not allowed in HTTP headers ` +
        `(char code 0x${bad.toString(16)} at position ${badIdx}). ` +
        `Most likely a smart quote, em-dash, or pasted whitespace. ` +
        `Re-create the key in console.anthropic.com → settings/keys → copy with single-click + Ctrl+C → re-paste into GitHub secrets.`,
    );
  }
  if (apiKey.length < 50) {
    throw new Error(`ANTHROPIC_API_KEY looks too short (${apiKey.length} chars) — Anthropic keys are usually ~100 chars. Re-paste from console.anthropic.com.`);
  }
  if (raw.length !== apiKey.length) {
    console.warn(`[anthropic] trimmed ${raw.length - apiKey.length} whitespace char(s) from ANTHROPIC_API_KEY`);
  }

  _client = new Anthropic({ apiKey });
  return _client;
}

const SYSTEM = `You are a senior content marketer writing for AI Separations (aiseparations.com), a standalone desktop app for screen printers and DTF shops. It is an AI prepress & quoting studio: AI color separation, an AI Print Doctor file-readiness check, an Instant Quote generator, Profit Mode separation strategies, and ink-inventory matching — no Photoshop required, $179 one-time. Your writing is:

VOICE
- Direct, practical, written for working screen printers and shop owners. Short, varied sentences.
- Honest and genuinely useful. If there's a free or manual way to do something, say so — trust wins long-term.
- Industry-aware. Use real screen-print / DTF terms correctly: simulated process vs spot color, halftone LPI, dot gain, underbase, highlight white, choke/trap, mesh count, flash cure, Pantone matching, DTF gel/adhesive powder, gang sheets.
- Product-led but not pushy: show how a task is done well, and where AI Separations makes it faster — don't sales-pitch every paragraph.

THE AI SEPARATIONS PRODUCT (weave in naturally where it genuinely helps)
- Standalone Windows app — no Photoshop, no Adobe subscription
- AI color separation (simulated process + spot), white underbase, highlight white, trapping
- AI Print Doctor: flags low resolution, too many colors, banding gradients, DTF glue-residue risk, fine detail loss, underbase need, and screen-vs-DTF
- Instant Quote generator: screens, setup, press time, suggested retail + customer quote with profit margin
- Profit Mode: re-separates a design for cheapest / fastest / best-quality / fewest screens / premium
- Ink inventory matching: separate to the inks you already stock (Wilflex, FN-INK, custom)
- $179 one-time, free trial at aiseparations.com

WHAT NOT TO WRITE
- No fake review counts, customer quotes, or invented testimonials
- No invented statistics — only general, defensible industry facts
- No unverifiable claims ("trusted by 10,000 shops")
- No purple prose. No "in today's fast-paced world." No "Here at AI Separations..."
- No keyword stuffing — write naturally; SEO follows good content
- Never name or link competitors (UltraSeps, Separation Studio, etc. — describe the category instead)

OUTPUT FORMAT
You will return a single JSON object with this exact shape (no markdown, no preamble, just JSON):
{
  "title": "<final SEO-tuned title under 65 chars>",
  "slug": "<url-slug-lowercase-hyphens-no-stopwords>",
  "metaDescription": "<155-160 char meta description with primary keyword + CTA>",
  "h1": "<page H1 — can match title or be slightly different>",
  "excerpt": "<2-sentence summary used on the blog index>",
  "sections": [
    { "heading": "<H2 heading>", "body": "<2-4 paragraphs of HTML — use <p>, <strong>, <em>, <ul><li>, <a href=...> for internal links>" },
    ... aim for 5-7 sections, totaling 1,000-1,500 words across all section bodies combined ...
  ],
  "faqs": [
    { "question": "<question>", "answer": "<1-3 sentence answer in plain text>" },
    ... include exactly 5 FAQs ...
  ],
  "heroImagePrompt": "<a 2-3 sentence detailed prompt for gpt-image-1 to generate a hero image; dark indigo/cyan brand palette on near-black; NO realistic people; NO trademarks/logos/brand names; LEAVE BOTTOM-RIGHT 15% empty for a logo overlay. Depict clean screen-printing / prepress imagery: a printed tee on a press, neat ink tubs and a squeegee, color swatches and halftone dot patterns, or an abstract color-separation of channels. Keep it tidy and professional — no messy or damaged scenes.>"
}`;

const PROMPT_TEMPLATE = (topic: Topic) => `Topic ID: ${topic.id}
Working title: ${topic.title}
Search intent: ${topic.intent}
Target keywords: ${topic.keywords.join(", ")}
Category: ${topic.category}

Internal links you SHOULD include where relevant (use <a href="..."> in HTML):
${topic.linkedPages?.map((s) => `- /${s}/  (link naturally where the topic touches ${s.replace(/-/g, " ")})`).join("\n") || "- /  (link to the homepage / free trial)"}
- /blog/  is the blog hub; link to another relevant guide if it fits.

End the post with a short CTA paragraph: invite the reader to try AI Separations free at aiseparations.com (the standalone app, no Photoshop, $179 one-time to unlock).

Return ONLY the JSON object — no prose, no markdown fence.`;

export async function draftPost(topic: Topic): Promise<DraftedPost> {
  const c = client();
  const response = await c.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: PROMPT_TEMPLATE(topic) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  // Strip any accidental markdown fences.
  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();

  let parsed: DraftedPost;
  try {
    parsed = JSON.parse(raw) as DraftedPost;
  } catch (err) {
    throw new Error(
      `Claude response was not valid JSON. First 400 chars:\n${raw.slice(0, 400)}\n\nError: ${(err as Error).message}`,
    );
  }

  // Sanity-check the response shape.
  const required: Array<keyof DraftedPost> = [
    "title", "slug", "metaDescription", "h1", "excerpt", "sections", "faqs", "heroImagePrompt",
  ];
  for (const k of required) {
    if (!(k in parsed)) throw new Error(`Claude response missing required field: ${k}`);
  }
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error("Claude returned no sections");
  }
  if (!Array.isArray(parsed.faqs)) parsed.faqs = [];

  return parsed;
}
