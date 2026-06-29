import dotenv from "dotenv";
dotenv.config({ override: true });

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { PILLARS, planPost, planDemo } from "./planner.ts";
import { generateImage } from "./generators/image.ts";
import { separateToCard, separateToVideo } from "./generators/demo.ts";
import { postToUploadPost, type Platform } from "./posters/uploadpost.ts";
import { makePreviewDir, writeJson, writeText } from "./util/preview.ts";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_IMAGE = process.argv.includes("--force-image");   // plain abstract image
const FORCE_VIDEO = process.argv.includes("--force-video");
const FORCE_DEMO = process.argv.includes("--force-demo");      // before/after engine demo
const NO_DEMO = process.argv.includes("--no-demo");

// Platforms to publish to. Trim to whatever you've connected in Upload-Post.
const IMAGE_PLATFORMS: Platform[] = ["instagram", "facebook"];
const VIDEO_PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube", "facebook"];

// Pre-rendered promo clip reused on video days (no Remotion needed).
const PROMO_VIDEO = resolve(process.cwd(), "assets/clips/promo-vertical.mp4");

async function main() {
  const dir = await makePreviewDir();
  const dayIndex = Math.floor(Date.now() / 86400000);

  // ~1 in 4 days is a video (the promo clip); the rest are image days.
  let isVideo = dayIndex % 4 === 0;
  if (FORCE_IMAGE || FORCE_DEMO) isVideo = false;
  if (FORCE_VIDEO) isVideo = true;

  if (isVideo) {
    // Prefer a fresh animated before/after reveal; fall back to the static
    // promo clip, then to a demo image, so a video day never goes silent.
    try {
      return await runDemoVideo(dir);
    } catch (err) {
      console.warn("[social] demo video failed, trying promo clip:", err);
    }
    if (existsSync(PROMO_VIDEO)) {
      return runVideo();
    }
    console.warn("[social] no promo clip — falling back to a demo image");
  }

  // Image days default to a real before/after engine demo (the strongest proof
  // for screen printers); fall back to a plain abstract image if it can't run.
  const wantDemo = !FORCE_IMAGE && !NO_DEMO;
  if (wantDemo) {
    try {
      return await runDemo(dir);
    } catch (err) {
      console.warn("[social] demo post failed, falling back to abstract image:", err);
    }
  }
  return runAbstractImage(dir, dayIndex);
}

async function runVideo() {
  // Reuse a varied pillar caption for the promo clip.
  const dayIndex = Math.floor(Date.now() / 86400000);
  const pillar = PILLARS[((dayIndex % PILLARS.length) + PILLARS.length) % PILLARS.length];
  const plan = await planPost(pillar);
  const tags = plan.hashtags.map((h) => `#${h.replace(/^#/, "")}`);
  const shortCaption = `${plan.captionShort} ${tags.slice(0, 5).join(" ")}`.trim();
  if (DRY_RUN) {
    console.log("[social] dry-run — would post VIDEO to", VIDEO_PLATFORMS.join("+"));
    console.log(shortCaption);
    return;
  }
  const r = await postToUploadPost({
    caption: shortCaption,
    title: "AI Separations — prepress & quoting studio",
    mediaPath: PROMO_VIDEO,
    mediaKind: "video",
    platforms: VIDEO_PLATFORMS,
  });
  console.log("[social] video posted:", r);
}

async function runDemoVideo(dir: string) {
  console.log("[social] media=demo-video (animated before/after reveal)");
  const plan = await planDemo();
  await writeJson(resolve(dir, "plan.json"), plan);
  console.log(`[social] concept="${plan.concept}"`);

  // 1. Render the artwork to separate.
  const artPath = resolve(dir, "art.png");
  await generateImage(plan.artPrompt, artPath, "1024x1024");

  // 2. Run the real engine → animated 9:16 reveal + separation metadata.
  const videoPath = resolve(dir, "video.mp4");
  const metaPath = resolve(dir, "meta.json");
  const meta = await separateToVideo(artPath, videoPath, metaPath);
  console.log(`[social] separated: ${meta.used} colors, recommend ${meta.recommend}`);

  // 3. Ground the caption in the engine's actual result.
  const resultLine = `→ ${meta.used} spot colors • best as ${meta.recommend}. Free trial at aiseparations.com`;
  const body = plan.captionInstagram.includes("{{RESULT}}")
    ? plan.captionInstagram.replace("{{RESULT}}", resultLine)
    : `${plan.captionInstagram}\n\n${resultLine}`;
  const tags = plan.hashtags.map((h) => `#${h.replace(/^#/, "")}`);
  const shortCaption = `${body.split("\n")[0]} ${tags.slice(0, 5).join(" ")}`.trim();
  await writeText(resolve(dir, "caption.txt"), `${body}\n\n${tags.join(" ")}`.trim());

  if (DRY_RUN) {
    console.log("[social] dry-run — would post DEMO VIDEO to", VIDEO_PLATFORMS.join("+"));
    console.log("[social] dry-run — would also post a LANDSCAPE 16:9 cut to youtube");
    console.log(shortCaption);
    return;
  }
  const r = await postToUploadPost({
    caption: shortCaption,
    title: `AI Separations — ${plan.concept}`,
    mediaPath: videoPath,
    mediaKind: "video",
    platforms: VIDEO_PLATFORMS,
  });
  console.log("[social] demo video posted:", r);

  // YouTube-specific: render a landscape 16:9 cut of the same separation and
  // upload it to YouTube as a regular (long-form) video with a fuller title +
  // description. The vertical above already covers YouTube Shorts. Wrapped so a
  // landscape failure never sinks the vertical that already shipped.
  try {
    const landscapePath = resolve(dir, "video-landscape.mp4");
    await separateToVideo(artPath, landscapePath, resolve(dir, "meta-landscape.json"), {
      aspect: "landscape",
    });
    const ytTitle = `Color separation in 30 seconds — ${plan.concept} | AI Separations`.slice(0, 100);
    const ytDescription = [
      body,
      "",
      "AI Separations turns customer artwork into press-ready color separations — detected spot inks, a white underbase, halftones at your LPI, and a film positive per color. The real engine, no Photoshop.",
      "",
      "▶ Try it free on your own art: https://aiseparations.com/free-separation",
      "▶ Get the desktop app: https://aiseparations.com/#pricing",
      "",
      tags.join(" "),
    ].join("\n");
    const ry = await postToUploadPost({
      caption: ytDescription,
      title: ytTitle,
      mediaPath: landscapePath,
      mediaKind: "video",
      platforms: ["youtube"],
    });
    console.log("[social] youtube landscape posted:", ry);
  } catch (err) {
    console.warn("[social] landscape YouTube upload failed (vertical still shipped):", err);
  }
}

async function runDemo(dir: string) {
  console.log("[social] media=demo (before/after engine separation)");
  const plan = await planDemo();
  await writeJson(resolve(dir, "plan.json"), plan);
  console.log(`[social] concept="${plan.concept}"`);

  // 1. Render the artwork to separate.
  const artPath = resolve(dir, "art.png");
  await generateImage(plan.artPrompt, artPath, "1024x1024");

  // 2. Run the real engine → branded before/after card + separation metadata.
  const cardPath = resolve(dir, "image.png");
  const metaPath = resolve(dir, "meta.json");
  const meta = await separateToCard(artPath, cardPath, metaPath);
  console.log(`[social] separated: ${meta.used} colors, recommend ${meta.recommend}`);

  // 3. Ground the caption in the engine's actual result.
  const resultLine = `→ ${meta.used} spot colors • best as ${meta.recommend}. Free trial at aiseparations.com`;
  const body = plan.captionInstagram.includes("{{RESULT}}")
    ? plan.captionInstagram.replace("{{RESULT}}", resultLine)
    : `${plan.captionInstagram}\n\n${resultLine}`;
  const tags = plan.hashtags.map((h) => `#${h.replace(/^#/, "")}`);
  const igCaption = `${body}\n\n${tags.join(" ")}`.trim();
  await writeText(resolve(dir, "caption.txt"), igCaption);

  if (DRY_RUN) {
    console.log("[social] dry-run — would post DEMO image to", IMAGE_PLATFORMS.join("+"));
    console.log(igCaption);
    return;
  }
  const r = await postToUploadPost({
    caption: igCaption,
    title: `AI Separations — ${plan.concept}`,
    mediaPath: cardPath,
    mediaKind: "image",
    platforms: IMAGE_PLATFORMS,
  });
  console.log("[social] demo posted:", r);
}

async function runAbstractImage(dir: string, dayIndex: number) {
  const pillar = PILLARS[((dayIndex % PILLARS.length) + PILLARS.length) % PILLARS.length];
  console.log(`[social] media=image pillar: ${pillar.slice(0, 70)}…`);
  const plan = await planPost(pillar);
  await writeJson(resolve(dir, "plan.json"), plan);
  console.log(`[social] theme="${plan.theme}"`);

  const tags = plan.hashtags.map((h) => `#${h.replace(/^#/, "")}`);
  const igCaption = `${plan.captionInstagram}\n\n${tags.join(" ")}`.trim();
  await writeText(resolve(dir, "caption.txt"), igCaption);

  const imgPath = resolve(dir, "image.png");
  await generateImage(plan.imagePrompt, imgPath, "1024x1536");

  if (DRY_RUN) {
    console.log("[social] dry-run — would post IMAGE to", IMAGE_PLATFORMS.join("+"));
    console.log(igCaption);
    return;
  }
  const r = await postToUploadPost({
    caption: igCaption,
    title: plan.theme,
    mediaPath: imgPath,
    mediaKind: "image",
    platforms: IMAGE_PLATFORMS,
  });
  console.log("[social] image posted:", r);
}

main().catch((err) => {
  console.error("[social] failed:", err);
  process.exit(1);
});
