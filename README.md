# Garage Door Blog Agent

Daily AI blog post generator for **ASAP Garage Door Services**. Runs on GitHub Actions cron — drafts one SEO-targeted blog post per day via Claude, generates a branded hero image, and pushes it to the website repo. Vercel auto-deploys.

## How it works

```
                ┌─────────────────────┐
                │ GitHub Actions cron │
                │  (every day 9 AM ET) │
                └──────────┬──────────┘
                           │
                           ▼
                    npm run post
                           │
   ┌───────────────────────┼────────────────────────┐
   │                       │                        │
   ▼                       ▼                        ▼
state.json            src/lib/topics.ts        Anthropic Claude
(skip published)     (30 seeded topics)       → drafts JSON post
   │                       │                        │
   └───────────────────────┼────────────────────────┘
                           ▼
                  Pick first un-published topic
                           │
                           ▼
                OpenAI gpt-image-1 → hero image
                           │
                           ▼
                  Logo overlay (sharp)
                           │
                           ▼
              Clone website repo (gh token)
              Write /blog/[slug]/index.html
              Write /blog/[slug]/hero.jpg
              Regenerate /blog/index.html
              Append URL to /sitemap.xml
              Commit + push → Vercel deploy
                           │
                           ▼
              Save state.json (in THIS repo)
              Commit state.json back
```

State.json (this repo) is what's been published. The website repo is the deploy target.

## What gets created per post

Each daily run adds to the **website repo** (`danelas/garagedoor`):

| Path | What |
|---|---|
| `/blog/[slug]/index.html` | The full post — title, hero, body, FAQs, CTA |
| `/blog/[slug]/hero.jpg` | 1200×630 OG-ratio image with logo overlay |
| `/blog/index.html` | Regenerated index of all posts (newest first) |
| `/sitemap.xml` | Updated with the new blog URL |

The post HTML includes:
- `<title>` + meta description tuned for the topic's keywords
- Article JSON-LD + FAQPage JSON-LD (Rich Results eligible)
- BreadcrumbList JSON-LD
- Same topbar / promo / footer as the rest of the site
- 5–7 H2 sections, totaling 1,000–1,500 words
- 5 FAQs in `<details>` elements
- Internal links to relevant `/service-area/[city]/[service]` pages
- CTA section at the bottom with phone + form link
- Google Ads gtag

## Setup (one-time)

### 1. Personal Access Token for cross-repo commits

The agent commits to a *different* repo (`danelas/garagedoor`) than where it lives. GitHub's default `GITHUB_TOKEN` can't cross repos, so you need a PAT.

1. https://github.com/settings/tokens/new (classic) — or **fine-grained tokens** for tighter scope
2. **Note:** "ASAP Blog Agent — write to garagedoor"
3. **Expiration:** 1 year (set a reminder to renew)
4. **Repository access (fine-grained):** Only `danelas/garagedoor`
5. **Permissions:** Repository → **Contents: Read and Write**
6. Generate → copy the token (starts with `github_pat_...` or `ghp_...`)
7. Save it somewhere (you won't see it again)

### 2. GitHub Actions secrets (this repo)

Repo → **Settings → Secrets and variables → Actions**:

| Name | Value | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | From https://console.anthropic.com/ | ✅ |
| `OPENAI_API_KEY` | From https://platform.openai.com/api-keys | ✅ |
| `WEBSITE_REPO_TOKEN` | The PAT from step 1 | ✅ |

### 3. (Optional) Repository variables

Same screen, **Variables** tab:

| Name | Default | Purpose |
|---|---|---|
| `WEBSITE_REPO` | `danelas/garagedoor` | Where to publish |
| `WEBSITE_BRANCH` | `main` | Branch Vercel deploys from |
| `GIT_AUTHOR_NAME` | `ASAP Blog Agent` | Shown in git history |
| `GIT_AUTHOR_EMAIL` | `blog-bot@asapgaragedoorservices.us` | Shown in git history |

### 4. Test it

1. https://github.com/danelas/garagedoorblogagent/actions
2. **Daily Blog Post** → **Run workflow** → set "Dry run" to **true** → Run
3. Watch the logs. You should see:
   - "drafting via Claude…" → JSON parsed successfully
   - "generating hero image…" → ~10 sec
   - "branded hero: …" → logo overlaid
   - "dry-run — skipping publish" with title + meta-desc preview
4. If it looks right, run again with **Dry run = false**
5. Within ~30 sec the website's `/blog/[slug]` URL is live (after Vercel redeploys)

## Cost per post

- **Claude Sonnet 4.5** drafting (~5-8K output tokens): **~$0.06**
- **OpenAI gpt-image-1** hero (1024×1024 or 1536×1024): **~$0.04**
- **GitHub Actions** runtime (~2 min): free under the public-repo limit
- **Total per post:** ~$0.10
- **30 posts/month:** **~$3.00** total content cost

## Adding new topics

Open [`src/lib/topics.ts`](src/lib/topics.ts) and append to the `TOPICS` array:

```ts
{
  id: "my-new-topic-slug",                  // never reuse
  title: "Working title — Claude may refine",
  intent: "Single-sentence search intent description",
  keywords: ["primary phrase", "secondary phrase"],
  linkedServices: ["spring-repair"],         // /service-area/miami/spring-repair → linked in post
  linkedCities: ["miami", "doral"],          // /service-area/miami → linked in post
  category: "spring",                        // for filtering later
},
```

Commit + push → next scheduled run picks it up.

## Cadence

Default: **daily at 9 AM ET** (`0 13 * * *`).

To change: edit `.github/workflows/daily.yml`. Common alternatives:
- Mon/Wed/Fri only: `0 13 * * 1,3,5`
- Weekdays only: `0 13 * * 1-5`
- Twice a week (Mon + Thu): `0 13 * * 1,4`

30 topics × daily = **30 days of content** before you need to add more. Most contractor blogs never reach 30 posts; you'll be ahead of nearly every Miami competitor.

## Safety nets

- **State.json** is the source of truth for "what's been published." Committed atomically after every successful run.
- **Dry-run mode** prints the draft title + meta + first section without publishing.
- **State.json commits use `[skip ci]`** so they don't trigger another run.
- **Idempotent sitemap update**: re-running for the same slug won't duplicate the URL.

## Folder layout

```
garagedoorblogagent/
├── .github/workflows/daily.yml
├── src/
│   ├── lib/
│   │   ├── anthropic.ts        # Claude API + structured-JSON drafting
│   │   ├── image.ts            # OpenAI hero generation
│   │   ├── logo.ts             # Sharp-based logo overlay
│   │   ├── publish.ts          # Cross-repo clone + commit + push
│   │   ├── render.ts           # Post JSON → HTML
│   │   ├── state.ts            # state.json read/write
│   │   ├── topics.ts           # 30 seeded blog topics (the queue)
│   │   └── types.ts
│   └── index.ts                # Orchestrator
├── assets/logo.jpg
├── state.json                   # auto-updated, committed back by the workflow
├── package.json
└── README.md
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `WEBSITE_REPO_TOKEN not set` | PAT missing in secrets | Add to Settings → Secrets |
| `Claude response was not valid JSON` | Model returned non-JSON (rare) | Re-run; or simplify the topic intent |
| `git push exited 128` with auth error | PAT lacks Contents:Write on website repo | Regenerate PAT with correct scope |
| Workflow says "no topics left in queue" | All topics in `topics.ts` already in `state.json` | Add more topics |
| Post published but not live on site | Vercel still building | Wait ~60 sec, hard-refresh |
| Hero image looks wrong | gpt-image-1 ignored the "leave bottom-right empty" instruction | Re-run; or edit the prompt template in `anthropic.ts` to be more explicit |
