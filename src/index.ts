import dotenv from "dotenv";
dotenv.config({ override: true });

import { resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { TOPICS } from "./lib/topics.ts";
import { draftPost } from "./lib/anthropic.ts";
import { generateHeroImage } from "./lib/image.ts";
import { brandHero } from "./lib/logo.ts";
import { renderBlogPost } from "./lib/render.ts";
import { loadState, hasPublished, recordPublish, saveState } from "./lib/state.ts";
import {
  cloneWebsite,
  writePostFiles,
  writeBlogIndex,
  appendToSitemap,
  commitAndPush,
} from "./lib/publish.ts";
import type { PublishedRecord } from "./lib/types.ts";

const DRY_RUN = process.argv.includes("--dry-run");
const PRINT_NEXT = process.argv.includes("--print-next");

const PREVIEW_DIR = resolve(process.cwd(), "preview");
const SITE = "https://www.aiseparations.com";

async function main(): Promise<void> {
  console.log(`[blog] dry-run=${DRY_RUN} print-next=${PRINT_NEXT}`);

  const state = await loadState();
  console.log(`[blog] state: ${state.published.length} posts already published`);

  const next = TOPICS.find((t) => !hasPublished(state, t.id));
  if (!next) {
    console.log("[blog] no topics left in the queue — add more to src/lib/topics.ts");
    return;
  }

  console.log(`[blog] next topic: ${next.id} — "${next.title}"`);

  if (PRINT_NEXT) {
    console.log("---");
    console.log(JSON.stringify(next, null, 2));
    return;
  }

  // 1) Draft the post via Claude.
  console.log("[blog] drafting via Claude…");
  const post = await draftPost(next);
  console.log(`[blog] drafted "${post.title}" (slug=${post.slug}, ${post.sections.length} sections, ${post.faqs.length} faqs)`);

  // 2) Generate a hero image via OpenAI.
  console.log("[blog] generating hero image…");
  const rawHero = await generateHeroImage(post.heroImagePrompt, `${post.slug}-raw.png`);

  // 3) Crop + composite the logo overlay.
  const brandedHero = resolve(PREVIEW_DIR, `${post.slug}-hero.jpg`);
  await brandHero(rawHero, brandedHero);
  console.log(`[blog] branded hero: ${brandedHero}`);

  // 4) Render the post HTML.
  const publishedAt = new Date().toISOString();
  const html = renderBlogPost(post, publishedAt);

  // Save the rendered HTML + raw plan JSON to preview/ BEFORE anything that
  // can fail (clone, push). This way the GitHub Actions preview artifact
  // always contains the generated article — even when the website push fails
  // with a 403 or network error. User can download from Actions → Artifacts
  // and see exactly what was generated.
  await mkdir(PREVIEW_DIR, { recursive: true });
  const previewHtmlPath = resolve(PREVIEW_DIR, `${post.slug}.html`);
  const previewJsonPath = resolve(PREVIEW_DIR, `${post.slug}.json`);
  await writeFile(previewHtmlPath, html, "utf-8");
  await writeFile(previewJsonPath, JSON.stringify(post, null, 2), "utf-8");
  console.log(`[blog] preview HTML saved: ${previewHtmlPath}`);

  if (DRY_RUN) {
    console.log("[blog] dry-run — skipping publish. Drafted HTML length:", html.length, "chars");
    console.log("---");
    console.log("META TITLE:", post.title);
    console.log("META DESC :", post.metaDescription);
    console.log("FIRST 400 CHARS OF FIRST SECTION:", post.sections[0]?.body?.slice(0, 400));
    return;
  }

  // 5) Clone the website repo + commit the post.
  await cloneWebsite();
  await writePostFiles({ postHtml: html, postSlug: post.slug, heroPath: brandedHero });

  // 6) Build the title + excerpt lookup needed by the blog index.
  const newRecord: PublishedRecord = {
    topicId: next.id,
    slug: post.slug,
    publishedAt,
    url: `${SITE}/blog/${post.slug}`,
  };
  // Regenerate the blog index by scanning every post on disk (preserves the
  // existing hand-written posts, includes the one we just wrote).
  await writeBlogIndex();
  await appendToSitemap(post.slug);

  // 7) Commit + push to the website repo.
  const sha = await commitAndPush(`Blog: ${post.title} [skip ci]`);
  console.log(`[blog] ✅ published — ${SITE}/blog/${post.slug} (sha=${sha.slice(0, 7)})`);
  newRecord.commitSha = sha;

  // 8) Write state.json in THIS repo so the next run skips this topic.
  const finalState = recordPublish(state, newRecord);
  await saveState(finalState);
  console.log(`[blog] state.json updated — ${finalState.published.length} total posts`);
}

main().catch((err) => {
  console.error("[blog] fatal:", err);
  process.exit(1);
});
