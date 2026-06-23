import dotenv from "dotenv";
dotenv.config({ override: true });

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { PILLARS, planPost } from "./planner.ts";
import { generateImage } from "./generators/image.ts";
import { postToUploadPost, type Platform } from "./posters/uploadpost.ts";
import { makePreviewDir, writeJson, writeText } from "./util/preview.ts";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_IMAGE = process.argv.includes("--force-image");
const FORCE_VIDEO = process.argv.includes("--force-video");

// Platforms to publish to. Trim to whatever you've connected in Upload-Post.
const IMAGE_PLATFORMS: Platform[] = ["instagram", "facebook"];
const VIDEO_PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube", "facebook"];

// Pre-rendered promo clip reused on video days (no Remotion needed).
const PROMO_VIDEO = resolve(process.cwd(), "assets/clips/promo-vertical.mp4");

async function main() {
  const dir = await makePreviewDir();
  const dayIndex = Math.floor(Date.now() / 86400000);

  // ~1 in 4 days is a video (the promo clip); the rest are fresh AI images.
  let isVideo = dayIndex % 4 === 0;
  if (FORCE_IMAGE) isVideo = false;
  if (FORCE_VIDEO) isVideo = true;
  if (isVideo && !existsSync(PROMO_VIDEO)) {
    console.warn(`[social] no promo clip at ${PROMO_VIDEO} — falling back to an image post`);
    isVideo = false;
  }

  const pillar = PILLARS[((dayIndex % PILLARS.length) + PILLARS.length) % PILLARS.length];
  console.log(`[social] dry-run=${DRY_RUN} media=${isVideo ? "video" : "image"}`);
  console.log(`[social] pillar: ${pillar.slice(0, 70)}…`);

  const plan = await planPost(pillar);
  await writeJson(resolve(dir, "plan.json"), plan);
  console.log(`[social] theme="${plan.theme}"`);

  const tags = plan.hashtags.map((h) => `#${h.replace(/^#/, "")}`);
  const igCaption = `${plan.captionInstagram}\n\n${tags.join(" ")}`.trim();
  const shortCaption = `${plan.captionShort} ${tags.slice(0, 5).join(" ")}`.trim();
  await writeText(resolve(dir, "caption.txt"), igCaption);

  if (isVideo) {
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
    return;
  }

  const imgPath = resolve(dir, "image.png");
  await generateImage(plan.imagePrompt, imgPath, "1024x1536");
  console.log("[social] image generated:", imgPath);

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
