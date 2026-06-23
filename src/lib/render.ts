// Renders DraftedPost JSON + the blog index into HTML pages that match the
// AI Separations site (same /style.css, nav, hero, .prose, .callout, footer).

import type { DraftedPost } from "./types.ts";

const SITE = "https://www.aiseparations.com";

function esc(s: string): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const HEAD_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">`;

const NAV = `<nav><div class="nav-wrap">
  <a class="brand" href="/"><img class="mark" src="/logo.png" alt="AI Separations logo" width="32" height="32"><b>AI Separations</b></a>
  <a class="nav-cta" href="/">Download free trial</a>
</div></nav>`;

const FOOTER = `<footer><div class="wrap">
  <div>&copy; 2026 AI Separations &middot; aiseparations.com</div>
  <div><a href="/">Home</a> &middot; <a href="/blog/">Blog</a> &middot; <a href="mailto:support@aiseparations.com">Support</a></div>
</div></footer>`;

function jsonLd(post: DraftedPost, url: string, heroUrl: string, publishedAt: string): string {
  const graph: any[] = [
    {
      "@type": "BlogPosting",
      headline: post.title,
      description: post.metaDescription,
      image: heroUrl,
      datePublished: publishedAt,
      dateModified: publishedAt,
      author: { "@type": "Organization", name: "AI Separations", url: SITE + "/" },
      publisher: {
        "@type": "Organization", name: "AI Separations",
        logo: { "@type": "ImageObject", url: `${SITE}/logo.png` },
      },
      mainEntityOfPage: url,
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog/` },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ];
  if (post.faqs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: post.faqs.map((f) => ({
        "@type": "Question", name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}

export function renderBlogPost(post: DraftedPost, publishedAt: string): string {
  const url = `${SITE}/blog/${post.slug}/`;
  const heroUrl = `${SITE}/blog/${post.slug}/hero.jpg`;

  const sectionsHtml = post.sections
    .map((s) => `\n  <h2>${esc(s.heading)}</h2>\n  ${s.body}`)
    .join("\n");

  const faqsHtml = post.faqs.length > 0
    ? `\n  <h2>Frequently asked questions</h2>\n  ` +
      post.faqs.map((f) =>
        `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`
      ).join("\n  ")
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0B0D12">
<title>${esc(post.title)} | AI Separations</title>
<meta name="description" content="${esc(post.metaDescription)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="AI Separations">
<meta property="og:title" content="${esc(post.title)}">
<meta property="og:description" content="${esc(post.metaDescription)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${heroUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="article:published_time" content="${publishedAt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(post.title)}">
<meta name="twitter:description" content="${esc(post.metaDescription)}">
<meta name="twitter:image" content="${heroUrl}">
${HEAD_FONTS}
<script type="application/ld+json">${jsonLd(post, url, heroUrl, publishedAt)}</script>
<style>
  .post-hero{width:100%;border-radius:14px;border:1px solid var(--line);margin:0 0 22px;display:block}
  .prose details{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0;background:var(--panel)}
  .prose summary{cursor:pointer;font-weight:600;color:var(--heading)}
  .prose details p{margin:10px 0 0}
</style>
</head>
<body>
${NAV}

<header class="hero"><div class="wrap">
  <div class="kicker"><a href="/blog/">Blog</a> &middot; Guide</div>
  <h1>${esc(post.h1)}</h1>
  <p class="lead">${esc(post.excerpt)}</p>
</div></header>

<section><div class="wrap prose">
  <img class="post-hero" src="hero.jpg" alt="${esc(post.title)}" width="1200" height="630" loading="eager">
${sectionsHtml}
${faqsHtml}

  <div class="callout">
    <h3>Try it on your own artwork</h3>
    <p>AI Separations is a standalone prepress &amp; quoting studio for screen printing &amp; DTF — AI color
      separation, an instant quote, a print-readiness check, and ink matching. No Photoshop, $179 one-time,
      free trial.</p>
    <div class="cta-row" style="margin-bottom:0"><a class="btn btn-primary" href="/">Download the free trial</a></div>
  </div>
</div></section>

${FOOTER}
</body>
</html>
`;
}

export function renderBlogIndex(posts: Array<{ slug: string; title: string; excerpt: string }>): string {
  const url = `${SITE}/blog/`;
  const cards = posts.length === 0
    ? `<p class="muted" style="text-align:center">No posts yet — check back soon.</p>`
    : posts.map((p) => `    <a class="post" href="/blog/${esc(p.slug)}/">
      <h3>${esc(p.title)}</h3>
      <p>${esc(p.excerpt)}</p>
    </a>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0B0D12">
<title>Color Separation Guides &amp; Tips | AI Separations Blog</title>
<meta name="description" content="Practical guides on color separation, pricing, and file prep for screen printing and DTF — from the team behind AI Separations.">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AI Separations">
<meta property="og:title" content="Color Separation Guides &amp; Tips | AI Separations Blog">
<meta property="og:description" content="Practical guides on color separation, pricing, and file prep for screen printing and DTF.">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
${HEAD_FONTS}
</head>
<body>
${NAV}

<header class="hero"><div class="wrap">
  <div class="kicker">Blog</div>
  <h1>Color separation, explained</h1>
  <p class="lead">Plain-English guides on separating, pricing, and prepping artwork for screen printing
    and DTF — from the team behind AI Separations.</p>
</div></header>

<section><div class="wrap">
  <div class="posts">
${cards}
  </div>
</div></section>

${FOOTER}
</body>
</html>
`;
}
