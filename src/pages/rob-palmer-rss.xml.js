import { parseHTML } from "linkedom";
import rss from "@astrojs/rss";

export const prerender = false;

const BLOG_URL = "https://robpalmer.com/blog";
const CACHE_MAX_AGE = 30 * 60; // 30 minutes cache
const FETCH_TIMEOUT = 10000; // 10s timeout

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml",
};

/**
 * Extracts articles from the blog HTML.
 * Tested against Rob Palmer's blog markup structure (see rob.html).
 */
export function extractArticles(html) {
  const { document } = parseHTML(html);
  const items = [];

  // Match all blog post links excluding pagination
  const links = document.querySelectorAll(
    'a[href^="/blog/"]:not([href*="/page/"])'
  );

  for (const a of links) {
    const href = a.getAttribute("href");
    if (!href) continue;

    const link = new URL(href, "https://robpalmer.com").href;

    const titleEl = a.querySelector("h3");
    if (!titleEl) continue;
    const title = titleEl.textContent.replace(/\s+/g, " ").trim();

    const descEl = a.querySelector("p");
    const summary = descEl ? descEl.textContent.replace(/\s+/g, " ").trim() : "";

    const timeEl = a.querySelector("time");
    const rawDate = timeEl
      ? timeEl.getAttribute("datetime") || timeEl.textContent.trim()
      : "";
    const pubDate = rawDate ? new Date(rawDate) : new Date();

    // Extract category & reading time from metadata spans
    const spans = Array.from(a.querySelectorAll("span"))
      .map((s) => s.textContent.trim())
      .filter((t) => t && !t.includes("Read more") && !t.includes("→"));

    let category = "";
    let readingTime = "";
    for (const span of spans) {
      if (/min read/i.test(span)) {
        readingTime = span;
      } else if (!category) {
        category = span;
      }
    }

    // Extract high-resolution image URL from Next.js optimized image
    const imgEl = a.querySelector("img");
    let imageUrl = "";
    if (imgEl) {
      const src = imgEl.getAttribute("src") || "";
      if (src.includes("url=")) {
        try {
          const parsedUrl = new URL(src, "https://robpalmer.com");
          const decoded = parsedUrl.searchParams.get("url");
          if (decoded) {
            imageUrl = new URL(decoded, "https://robpalmer.com").href;
          }
        } catch {
          // fallback to raw src below
        }
      }
      if (!imageUrl && src) {
        imageUrl = new URL(src, "https://robpalmer.com").href;
      }
    }

    // Rich HTML description with image, summary, category, and reading time
    const imgHtml = imageUrl
      ? `<p><img src="${imageUrl}" alt="${title}" /></p>`
      : "";
    const metaParts = [
      category ? `<strong>Category:</strong> ${category}` : "",
      readingTime ? `<em>${readingTime}</em>` : "",
    ].filter(Boolean);
    const metaLine =
      metaParts.length > 0 ? `<p>${metaParts.join(" · ")}</p>` : "";
    const summaryLine = summary ? `<p>${summary}</p>` : "";

    items.push({
      title,
      link,
      pubDate,
      description: `${imgHtml}${summaryLine}${metaLine}`,
      categories: category ? [category] : [],
    });
  }

  return items;
}

export async function GET(context) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let html = "";
  let fetchError = null;

  try {
    const response = await fetch(BLOG_URL, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });

    if (!response.ok) {
      fetchError = `HTTP ${response.status} ${response.statusText}`;
    } else {
      html = await response.text();
    }
  } catch (err) {
    fetchError = err.name === "AbortError" ? "Request timed out" : err.message;
  } finally {
    clearTimeout(timer);
  }

  let items = [];
  if (html) {
    items = extractArticles(html);
  }

  // Fallback notice if scraping failed or returned 0 articles
  if (items.length === 0 && fetchError) {
    items.push({
      title: `⚠️ Unable to load Rob Palmer articles (${fetchError})`,
      link: BLOG_URL,
      description: `<p>Failed to retrieve the latest articles from <a href="${BLOG_URL}">${BLOG_URL}</a> (${fetchError}). The feed will retry automatically on the next poll.</p>`,
      pubDate: new Date(),
    });
  }

  const rssResponse = await rss({
    title: "Rob Palmer - Direct Response Copywriting & Creative Strategy",
    description:
      "Latest articles, direct response copywriting frameworks, and creative strategy insights by Rob Palmer.",
    site: context.site || BLOG_URL,
    items,
  });

  rssResponse.headers.set(
    "Cache-Control",
    `public, max-age=${CACHE_MAX_AGE}, s-maxage=${CACHE_MAX_AGE}`,
  );

  return rssResponse;
}
