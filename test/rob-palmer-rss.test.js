import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractArticles, GET } from "../src/pages/rob-palmer-rss.xml.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("extractArticles extracts all posts from Next.js RSC payload fixture", () => {
  const fixturePath = path.join(__dirname, "fixtures", "rob-palmer-sample.html");
  const html = fs.readFileSync(fixturePath, "utf8");

  const articles = extractArticles(html);
  assert.equal(articles.length, 12, "Should extract all 12 articles from RSC stream");

  const first = articles[0];
  assert.equal(
    first.title,
    "Creative Strategist Salary & Rates in 2026: What the Data Actually Shows"
  );
  assert.equal(
    first.link,
    "https://robpalmer.com/blog/creative-strategist-salary"
  );
  assert.ok(first.pubDate instanceof Date, "pubDate should be a Date instance");
  assert.equal(first.categories[0], "Career Insights");
  assert.ok(first.description.includes("<img"), "Description should contain hero image");
  assert.ok(first.description.includes("9 min read"), "Description should contain reading time");
  assert.ok(
    first.description.includes("Creative strategist salary and rate data for 2026"),
    "Description should contain summary"
  );
});

test("extractArticles extracts articles from standard DOM fallback markup", () => {
  const domHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <main>
          <ul>
            <li>
              <a href="/blog/test-article-one">
                <img src="/images/blog/test-one.jpg" alt="Test One" />
                <span>Marketing</span>
                <span>5 min read</span>
                <h2>Test Article One Headline</h2>
                <p>This is a summary for test article one.</p>
                <time datetime="2026-08-15">August 15, 2026</time>
              </a>
            </li>
            <li>
              <a href="/blog/test-article-two">
                <h3>Test Article Two Headline</h3>
                <p>This is a summary for test article two.</p>
                <time datetime="2026-08-10">August 10, 2026</time>
              </a>
            </li>
          </ul>
        </main>
      </body>
    </html>
  `;

  const articles = extractArticles(domHtml);
  assert.equal(articles.length, 2, "Should extract 2 articles from DOM");

  assert.equal(articles[0].title, "Test Article One Headline");
  assert.equal(articles[0].link, "https://robpalmer.com/blog/test-article-one");
  assert.equal(articles[0].categories[0], "Marketing");
  assert.ok(articles[0].description.includes("5 min read"));
  assert.ok(articles[0].description.includes("https://robpalmer.com/images/blog/test-one.jpg"));

  assert.equal(articles[1].title, "Test Article Two Headline");
  assert.equal(articles[1].link, "https://robpalmer.com/blog/test-article-two");
});

test("extractArticles returns empty array for null, empty or invalid HTML", () => {
  assert.deepEqual(extractArticles(""), []);
  assert.deepEqual(extractArticles(null), []);
  assert.deepEqual(extractArticles(undefined), []);
  assert.deepEqual(extractArticles("<html><body><p>No articles here</p></body></html>"), []);
});

test("GET returns valid RSS XML response with extracted items", async () => {
  const fixturePath = path.join(__dirname, "fixtures", "rob-palmer-sample.html");
  const sampleHtml = fs.readFileSync(fixturePath, "utf8");

  // Mock global fetch to return our sample HTML
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sampleHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  try {
    const res = await GET({ site: "https://test.local" });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("Cache-Control").includes("s-maxage=1800"));
    assert.ok(res.headers.get("Cache-Control").includes("max-age=60"));

    const xml = await res.text();
    assert.ok(xml.includes("<rss version=\"2.0\">"), "Response should be valid RSS 2.0 XML");
    assert.ok(xml.includes("<channel>"), "Response should contain channel element");
    assert.ok(xml.includes("<title>Rob Palmer - Direct Response Copywriting"), "Should contain channel title");
    assert.ok(
      xml.includes("<title>Creative Strategist Salary &amp; Rates in 2026"),
      "Should contain first article title"
    );
    assert.ok(
      xml.includes("<link>https://robpalmer.com/blog/creative-strategist-salary</link>"),
      "Should contain article link"
    );

    // Count <item> elements in generated RSS
    const itemCount = (xml.match(/<item>/g) || []).length;
    assert.equal(itemCount, 12, "RSS feed should contain exactly 12 items");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET returns fallback notice item when fetch fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network offline test");
  };

  try {
    const res = await GET({ site: "https://test.local" });
    assert.equal(res.status, 200);

    const xml = await res.text();
    assert.ok(xml.includes("<rss version=\"2.0\">"));
    assert.ok(xml.includes("<item>"), "Should contain at least one item");
    assert.ok(xml.includes("Unable to load Rob Palmer articles"), "Should contain fallback item title");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
