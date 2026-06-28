// Cross-repo publisher. Shallow-clones the website repo, writes the new
// blog files + regenerates the blog index and sitemap, commits + pushes.

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { mkdir, writeFile, copyFile, readFile, rm, readdir, stat } from "node:fs/promises";
import { renderBlogIndex } from "./render.ts";
import type { DraftedPost, PublishedRecord } from "./types.ts";

const WEBSITE_CLONE_DIR = resolve(process.cwd(), "website-clone");
const SITE = "https://www.aiseparations.com";

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolveFn, reject) => {
    const proc = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolveFn(stdout);
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\nSTDERR: ${stderr}`));
    });
  });
}

export async function cloneWebsite(): Promise<string> {
  // .trim() everywhere — pasted secrets often pick up stray whitespace,
  // and a token with a newline becomes an unauthenticated clone (silent fail).
  const repo = (process.env.WEBSITE_REPO ?? "").trim();
  const branch = (process.env.WEBSITE_BRANCH ?? "main").trim() || "main";
  const token = (process.env.WEBSITE_REPO_TOKEN ?? "").trim();
  // A missing GitHub Actions secret is passed to the job as an EMPTY string,
  // not unset — so `??` (which only catches null/undefined) lets "" through
  // and git then fails with "empty ident name". Use `||` so a blank/whitespace
  // value falls back to the default too.
  const authorName = (process.env.GIT_AUTHOR_NAME ?? "").trim() || "AI Separations Blog Agent";
  // Vercel refuses to deploy commits whose author email isn't tied to a real
  // GitHub account, so this MUST be the email on the repo owner's GitHub login
  // (not a vanity bot address) or deployments silently fail to publish.
  const authorEmail = (process.env.GIT_AUTHOR_EMAIL ?? "").trim() || "danamazon6@gmail.com";
  if (!repo) throw new Error("WEBSITE_REPO not set");
  if (!token) throw new Error("WEBSITE_REPO_TOKEN not set");

  await rm(WEBSITE_CLONE_DIR, { recursive: true, force: true });
  const url = `https://x-access-token:${token}@github.com/${repo}.git`;
  console.log(`[publish] cloning ${repo}#${branch}…`);
  await run("git", ["clone", "--depth", "1", "--branch", branch, url, WEBSITE_CLONE_DIR], process.cwd());

  await run("git", ["config", "user.name",  authorName],  WEBSITE_CLONE_DIR);
  await run("git", ["config", "user.email", authorEmail], WEBSITE_CLONE_DIR);

  return WEBSITE_CLONE_DIR;
}

export async function writePostFiles(opts: {
  postHtml: string;
  postSlug: string;
  heroPath: string;
}): Promise<{ relHtmlPath: string; relHeroPath: string }> {
  const blogDir = resolve(WEBSITE_CLONE_DIR, "blog", opts.postSlug);
  await mkdir(blogDir, { recursive: true });

  const htmlPath = resolve(blogDir, "index.html");
  await writeFile(htmlPath, opts.postHtml, "utf-8");

  const heroDest = resolve(blogDir, "hero.jpg");
  await copyFile(opts.heroPath, heroDest);

  return {
    relHtmlPath: `blog/${opts.postSlug}/index.html`,
    relHeroPath: `blog/${opts.postSlug}/hero.jpg`,
  };
}

/** Scans /blog/ in the website clone and returns the list of slugs found. */
export async function scanExistingBlogSlugs(): Promise<string[]> {
  const blogDir = resolve(WEBSITE_CLONE_DIR, "blog");
  try {
    const entries = await readdir(blogDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Pull a card title + excerpt out of a rendered blog post's index.html. */
function extractCard(html: string): { title: string; excerpt: string } {
  const t = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = t.replace(/\s*\|\s*AI Separations\s*$/i, "").trim();
  const d = html.match(/<meta name="description" content="([\s\S]*?)">/i)?.[1] ?? "";
  const excerpt = d.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  return { title, excerpt };
}

/**
 * Rebuilds blog/index.html by SCANNING every blog/<slug>/index.html on disk —
 * so hand-written posts that predate the agent are preserved, not dropped.
 * Newest first by directory mtime.
 */
export async function writeBlogIndex(): Promise<void> {
  const blogDir = resolve(WEBSITE_CLONE_DIR, "blog");
  const entries = await readdir(blogDir, { withFileTypes: true });
  const posts: Array<{ slug: string; title: string; excerpt: string; mtime: number }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const idx = resolve(blogDir, e.name, "index.html");
    try {
      const html = await readFile(idx, "utf-8");
      const { title, excerpt } = extractCard(html);
      const st = await stat(idx);
      posts.push({ slug: e.name, title: title || e.name, excerpt, mtime: st.mtimeMs });
    } catch {
      /* skip dirs without an index.html */
    }
  }
  posts.sort((a, b) => b.mtime - a.mtime);
  const html = renderBlogIndex(posts.map(({ slug, title, excerpt }) => ({ slug, title, excerpt })));
  await mkdir(blogDir, { recursive: true });
  await writeFile(resolve(blogDir, "index.html"), html, "utf-8");
}

/**
 * Appends the new blog post URL to the website's sitemap.xml if it isn't
 * already there. Preserves the existing 74 URLs.
 */
export async function appendToSitemap(postSlug: string): Promise<void> {
  const sitemapPath = resolve(WEBSITE_CLONE_DIR, "sitemap.xml");
  const today = new Date().toISOString().slice(0, 10);
  const url = `${SITE}/blog/${postSlug}`;

  let xml = await readFile(sitemapPath, "utf-8");
  if (xml.includes(`<loc>${url}</loc>`)) return; // already present

  const newEntry = `  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
`;

  // Also ensure /blog itself is in there.
  const blogIndexEntry = `  <url>
    <loc>${SITE}/blog</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>
`;
  if (!xml.includes(`<loc>${SITE}/blog</loc>`)) {
    xml = xml.replace("</urlset>", blogIndexEntry + "</urlset>");
  }

  xml = xml.replace("</urlset>", newEntry + "</urlset>");
  await writeFile(sitemapPath, xml, "utf-8");
}

export async function commitAndPush(message: string): Promise<string> {
  const status = await run("git", ["status", "--porcelain"], WEBSITE_CLONE_DIR);
  if (!status.trim()) {
    console.log("[publish] no changes to commit");
    return "";
  }
  await run("git", ["add", "."], WEBSITE_CLONE_DIR);
  await run("git", ["commit", "-m", message], WEBSITE_CLONE_DIR);
  const sha = (await run("git", ["rev-parse", "HEAD"], WEBSITE_CLONE_DIR)).trim();
  await run("git", ["push"], WEBSITE_CLONE_DIR);
  return sha;
}
