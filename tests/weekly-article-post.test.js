const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const scriptPath = path.join(REPO_ROOT, "scripts", "plan-weekly-article-post.js");
const {
  MIN_RELEVANCE_SCORE,
  buildPost,
  composeCopy,
  parseFeedItems,
  isStraightNewsArticle,
  scoreArticle,
  selectArticle,
} = require(scriptPath);

function sampleArticle(overrides = {}) {
  return {
    description: "A whistleblower alleged fraud and retaliation after reporting misconduct.",
    link: "https://www.theguardian.com/world/example-whistleblower",
    publishedAt: new Date("2026-06-02T16:00:00Z"),
    source: "The Guardian",
    title: "Whistleblower says reporting fraud led to retaliation",
    ...overrides,
  };
}

test("scores whistleblower-related accountability articles above the publish threshold", () => {
  assert.ok(scoreArticle(sampleArticle()) >= MIN_RELEVANCE_SCORE);
});

test("selects a current whistleblower-related article from an approved source", () => {
  const selected = selectArticle(
    [
      sampleArticle({
        description: "A sports recap from the weekend.",
        title: "Local sports scores from Sunday",
      }),
      sampleArticle(),
    ],
    { date: "2026-06-03", usedUrls: new Set() },
  );

  assert.equal(selected.title, "Whistleblower says reporting fraud led to retaliation");
  assert.ok(selected.relevanceScore >= MIN_RELEVANCE_SCORE);
});

test("rejects blocked or previously used article sources and URLs", () => {
  const selected = selectArticle(
    [
      sampleArticle({ source: "Breitbart", link: "https://example.com/blocked" }),
      sampleArticle({ source: "Unknown Blog", link: "https://example.com/unknown" }),
      sampleArticle({ link: "https://example.com/used" }),
    ],
    { date: "2026-06-03", usedUrls: new Set(["https://example.com/used"]) },
  );

  assert.equal(selected, null);
});

test("rejects opinion and commentary URLs even from approved sources", () => {
  assert.equal(
    isStraightNewsArticle(sampleArticle({
      link: "https://www.theatlantic.com/ideas/2026/06/example-whistleblower/",
    })),
    false,
  );
  assert.equal(
    isStraightNewsArticle(sampleArticle({
      link: "https://www.theguardian.com/commentisfree/2026/jun/03/example",
    })),
    false,
  );
});

test("builds professional article copy with the article link and Hush Line signup CTA", () => {
  const article = { ...sampleArticle(), relevanceScore: scoreArticle(sampleArticle()) };
  const post = buildPost(article, { date: "2026-06-03" });

  assert.equal(post.publish_mode, "text");
  assert.equal(post.article_url, article.link);
  assert.match(post.social.linkedin, /The Guardian: Whistleblower says reporting fraud led to retaliation/);
  assert.match(post.social.linkedin, /https:\/\/www\.theguardian\.com\/world\/example-whistleblower/);
  assert.match(post.social.linkedin, /Sign up for Hush Line: https:\/\/hushline\.app\./);
  assert.ok(post.social.bluesky.length <= 300);
});

test("parses RSS feeds and dry-runs a weekly article post from a fixture feed", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-article-feed-"));
  const feedPath = path.join(tempRoot, "feed.xml");
  const feedsPath = path.join(tempRoot, "feeds.json");

  fs.writeFileSync(
    feedPath,
    `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Whistleblower says reporting fraud led to retaliation]]></title>
      <link>https://www.theguardian.com/world/example-whistleblower</link>
      <description><![CDATA[A whistleblower alleged fraud and retaliation after reporting misconduct.]]></description>
      <pubDate>Tue, 02 Jun 2026 16:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`,
  );
  fs.writeFileSync(
    feedsPath,
    JSON.stringify([{ source: "The Guardian", url: `file://${feedPath}` }]),
  );

  try {
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--date",
        "2026-06-03",
        "--feed-file",
        feedsPath,
        "--dry-run",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );
    const post = JSON.parse(output);

    assert.equal(post.source, "The Guardian");
    assert.equal(post.publish_mode, "text");
    assert.match(post.social.linkedin, /Sign up for Hush Line/);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("parses RSS item fields without including markup in descriptions", () => {
  const [article] = parseFeedItems(
    `<rss><channel><item><title>Whistleblower report</title><link>https://example.com/a</link><description><![CDATA[<p>Protected disclosure details.</p>]]></description></item></channel></rss>`,
    "BBC News",
  );

  assert.equal(article.title, "Whistleblower report");
  assert.equal(article.description, "Protected disclosure details.");
});

test("network copy stays within configured limits", () => {
  const social = composeCopy(sampleArticle({
    title: "Whistleblower alleges misconduct in a very long accountability investigation with major implications for reporting channels",
  }));

  assert.ok(social.linkedin.length <= 3000);
  assert.ok(social.mastodon.length <= 500);
  assert.ok(social.bluesky.length <= 300);
});
