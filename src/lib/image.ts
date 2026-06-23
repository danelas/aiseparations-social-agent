// Generates a 1200x630 blog hero via OpenAI gpt-image-1, writes PNG to disk.

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import OpenAI from "openai";

const PREVIEW_DIR = resolve(process.cwd(), "preview");

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client) return _client;
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  _client = new OpenAI({ apiKey });
  return _client;
}

// gpt-image-1's safety system sometimes blocks service-trade scenes (e.g.
// garage doors / tools read as break-in imagery). The block happens at the
// OUTPUT stage, so it's stochastic — the same prompt can pass one day and fail
// the next, and a prompt that reliably trips it will kill every run for the
// same topic. When that happens we retry once with this deliberately bland
// background; we still composite the logo over the bottom-right, so a generic
// backdrop produces a usable hero instead of a dead run.
const SAFE_FALLBACK_PROMPT =
  "A clean, modern abstract background of overlapping translucent color swatches " +
  "and a subtle halftone dot pattern, deep indigo and cyan on a near-black field, " +
  "soft studio lighting, no people. Leave the bottom-right 15% of the image empty " +
  "and uncluttered for a logo overlay. Absolutely no text, letters, numbers, logos, " +
  "or watermarks anywhere in the image.";

function isModerationBlocked(err: unknown): boolean {
  const e = err as { code?: string; error?: { code?: string } };
  return e?.code === "moderation_blocked" || e?.error?.code === "moderation_blocked";
}

export async function generateHeroImage(prompt: string, outFilename: string): Promise<string> {
  const outPath = resolve(PREVIEW_DIR, outFilename);
  await mkdir(dirname(outPath), { recursive: true });

  let resp;
  console.log(`[image] generating: "${prompt.slice(0, 100)}…"`);
  try {
    resp = await client().images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",   // closest gpt-image-1 size to OG 1200x630 — we'll crop later
      n: 1,
    });
  } catch (err) {
    if (!isModerationBlocked(err)) throw err;
    console.warn(
      `[image] prompt blocked by OpenAI moderation — retrying with the generic fallback background`
    );
    resp = await client().images.generate({
      model: "gpt-image-1",
      prompt: SAFE_FALLBACK_PROMPT,
      size: "1536x1024",
      n: 1,
    });
  }
  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI did not return image bytes");
  const buf = Buffer.from(b64, "base64");
  await writeFile(outPath, buf);
  console.log(`[image] wrote ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
  return outPath;
}
