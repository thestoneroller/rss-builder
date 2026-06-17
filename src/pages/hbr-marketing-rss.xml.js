import { parseHTML } from "linkedom";
import rss from "@astrojs/rss";

export const prerender = false;

const HBR_TOPICS = [
  {
    url: "https://hbr.org/topic/subject/consumer-behavior",
    name: "Consumer Behavior",
  },
  {
    url: "https://hbr.org/topic/subject/behavioral-economics",
    name: "Behavioral Economics",
  },
  {
    url: "https://hbr.org/topic/subject/marketing",
    name: "Marketing",
  },
  {
    url: "https://hbr.org/topic/subject/advertising",
    name: "Advertising",
  },
];

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml",
};

// --- Cache config ---
// Feedly polls every ~30-60 min. Cache the full RSS response for 30 min
// so repeat hits from Feedly (or other readers) don't re-scrape HBR.
const CACHE_MAX_AGE = 30 * 60; // 30 minutes in seconds
const FETCH_TIMEOUT = 8000; // 8s per-topic timeout to avoid hanging

/**
 * Attempts to parse a date string from HBR's various formats.
 * Examples:
 *   "June 11, 2026"
 *   "From the July–August 2026 Issue"
 *   "From the May–June 2026 Issue"
 */
function parseHBRDate(raw) {
  if (!raw) return new Date();

  const trimmed = raw.trim();

  // Standard date: "June 11, 2026"
  const standard = new Date(trimmed);
  if (!isNaN(standard.getTime())) return standard;

  // Magazine issue: "From the July–August 2026 Issue"
  const issueMatch = trimmed.match(
    /(?:From the\s+)?(\w+)[–\-]\w+\s+(\d{4})\s+Issue/i,
  );
  if (issueMatch) {
    return new Date(`${issueMatch[1]} 1, ${issueMatch[2]}`);
  }

  // Fallback: try to find any month + year
  const fallbackMatch = trimmed.match(/(\w+)\s+(\d{4})/);
  if (fallbackMatch) {
    const attempt = new Date(`${fallbackMatch[1]} 1, ${fallbackMatch[2]}`);
    if (!isNaN(attempt.getTime())) return attempt;
  }

  return new Date();
}

/**
 * Extracts articles from an HBR topic page's HTML.
 */
function extractArticles(html, topicName) {
  const { document } = parseHTML(html);
  const items = [];

  const streamItems = document.querySelectorAll("stream-item.stream-item");

  for (const item of streamItems) {
    const title = item.getAttribute("data-title");
    const relativeUrl = item.getAttribute("data-url");
    const authors = item.getAttribute("data-authors");
    const contentType = item.getAttribute("data-content-type");
    const summary = item.getAttribute("data-summary");
    const imageUrl = item.getAttribute("data-content-image");
    const topic = item.getAttribute("data-topic");

    if (!title || !relativeUrl) continue;

    const timeEl = item.querySelector("time");
    const pubDate = parseHBRDate(timeEl?.textContent);

    const link = `https://hbr.org${relativeUrl}`;

    const imgHtml = imageUrl
      ? `<img src="https://hbr.org${imageUrl}" alt="${title}" /><br/>`
      : "";
    const authorLine = authors ? `<p><strong>By:</strong> ${authors}</p>` : "";
    const typeLine = contentType
      ? `<p><em>${contentType}</em> · ${topic || topicName}</p>`
      : "";
    const descriptionHtml = `${imgHtml}${summary || ""}${authorLine}${typeLine}`;

    items.push({
      title,
      link,
      description: descriptionHtml,
      pubDate,
      _url: relativeUrl,
    });
  }

  return items;
}

/**
 * Fetches a single topic page with a timeout.
 * Returns { articles, error } so failures are non-fatal.
 */
async function fetchTopic(topic) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(topic.url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        articles: [],
        error: `${topic.name}: HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const articles = extractArticles(html, topic.name);

    if (articles.length === 0) {
      return {
        articles: [],
        error: `${topic.name}: page returned 0 articles (possible layout change or block)`,
      };
    }

    return { articles, error: null };
  } catch (err) {
    const reason =
      err.name === "AbortError"
        ? `${topic.name}: timed out after ${FETCH_TIMEOUT / 1000}s`
        : `${topic.name}: ${err.message}`;
    return { articles: [], error: reason };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(context) {
  // --- Fetch all topics in parallel ---
  const results = await Promise.all(HBR_TOPICS.map(fetchTopic));

  // --- Collect articles + errors ---
  const seen = new Set();
  const allItems = [];
  const errors = [];

  for (const { articles, error } of results) {
    if (error) errors.push(error);
    for (const article of articles) {
      if (!seen.has(article._url)) {
        seen.add(article._url);
        allItems.push(article);
      }
    }
  }

  // Sort newest first
  allItems.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  // --- Surface errors as a pinned RSS item so they're visible in Feedly ---
  if (errors.length > 0) {
    allItems.unshift({
      title: `⚠️ Feed errors (${errors.length}/${HBR_TOPICS.length} topics)`,
      link: "https://hbr.org/topics",
      description: `<p>The following topics failed to load:</p><ul>${errors.map((e) => `<li>${e}</li>`).join("")}</ul><p>The feed will retry on the next poll.</p>`,
      pubDate: new Date(),
      _url: "__error__",
    });
  }

  // Clean internal fields
  const rssItems = allItems.map(({ _url, ...rest }) => rest);

  const rssResponse = await rss({
    title: "HBR: Marketing, Advertising & Consumer Behavior",
    description:
      "Combined feed of Harvard Business Review articles on Consumer Behavior, Behavioral Economics, Marketing, and Advertising.",
    site: context.site || "https://hbr.org",
    items: rssItems,
  });

  // --- Add cache headers so Cloudflare + Feedly don't re-scrape constantly ---
  rssResponse.headers.set(
    "Cache-Control",
    `public, max-age=${CACHE_MAX_AGE}, s-maxage=${CACHE_MAX_AGE}`,
  );

  return rssResponse;
}
