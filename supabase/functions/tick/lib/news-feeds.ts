export const TOPIC_FEEDS: Record<string, string[]> = {
  tech: [
    "https://techcrunch.com/feed/",
    "https://www.theverge.com/rss/index.xml",
    "https://arstechnica.com/feed/",
  ],
  ai: [
    "https://www.artificialintelligence-news.com/feed/",
    "https://www.marktechpost.com/feed/",
    "https://venturebeat.com/category/ai/feed/",
  ],
  dev: [
    "https://dev.to/feed",
    "https://www.smashingmagazine.com/feed/",
    "https://hnrss.org/frontpage",
  ],
  web2: [
    "https://techcrunch.com/category/enterprise/feed/",
    "https://www.saastr.com/feed/",
  ],
  web3: [
    "https://cointelegraph.com/rss",
    "https://decrypt.co/feed",
  ],
  startups: [
    "https://techcrunch.com/category/startups/feed/",
    "https://www.indiehackers.com/feed.xml",
  ],
  design: [
    "https://www.smashingmagazine.com/feed/",
    "https://uxdesign.cc/feed",
  ],
  security: [
    "https://www.bleepingcomputer.com/feed/",
    "https://thehackernews.com/feeds/posts/default",
  ],
  devops: [
    "https://devops.com/feed/",
    "https://thenewstack.io/feed/",
  ],
  productivity: [
    "https://lifehacker.com/rss",
    "https://www.fastcompany.com/section/productivity/rss",
  ],
};

export const GLOBAL_FALLBACK_FEEDS: string[] = [
  "https://hnrss.org/frontpage",
  "https://techcrunch.com/feed/",
];
