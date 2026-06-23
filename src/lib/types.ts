// Shape of a blog topic in the queue.
export type Topic = {
  id: string;                 // stable slug; never reuse
  title: string;              // working title; Claude may refine it
  intent: string;             // 1-sentence summary of search intent
  keywords: string[];         // primary phrases to weave in naturally
  linkedPages?: string[];     // site page slugs to internally link, e.g.
                              // "screen-print-quote-calculator", "print-readiness-check",
                              // "separate-to-my-inks", "screen-print-profit-calculator"
  category: "separation" | "pricing" | "dtf" | "ink" | "fileprep" | "general";
};

// What Claude returns (we ask for structured JSON output).
export type DraftedPost = {
  title: string;              // SEO-tuned final title
  slug: string;               // URL slug
  metaDescription: string;    // <meta name="description">
  h1: string;                 // top heading (may differ from <title>)
  excerpt: string;            // 2-sentence summary used on blog index
  sections: Array<{ heading: string; body: string }>;  // H2 sections
  faqs: Array<{ question: string; answer: string }>;
  heroImagePrompt: string;
};

// What gets recorded in state.json after a successful publish.
export type PublishedRecord = {
  topicId: string;
  slug: string;
  publishedAt: string;
  url: string;
  commitSha?: string;
};

export type State = {
  published: PublishedRecord[];
};
