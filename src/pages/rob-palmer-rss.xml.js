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
 * Formats a single blog post object into an RSS item structure.
 */
function formatPostItem({
  title,
  slug,
  date,
  category,
  readingTime,
  description,
  heroImage,
}) {
  if (!slug || !title) return null;
  const link = new URL(`/blog/${slug}`, "https://robpalmer.com").href;
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const pubDate = date ? new Date(date) : new Date();
  const summary = (description || "").replace(/\s+/g, " ").trim();

  let imageUrl = "";
  if (heroImage) {
    if (heroImage.includes("url=")) {
      try {
        const parsedUrl = new URL(heroImage, "https://robpalmer.com");
        const decoded = parsedUrl.searchParams.get("url");
        if (decoded) {
          imageUrl = new URL(decoded, "https://robpalmer.com").href;
        }
      } catch {
        // fallback to raw heroImage
      }
    }
    if (!imageUrl) {
      imageUrl = new URL(heroImage, "https://robpalmer.com").href;
    }
  }

  const imgHtml = imageUrl
    ? `<p><img src="${imageUrl}" alt="${cleanTitle.replace(/"/g, "&quot;")}" /></p>`
    : "";
  const metaParts = [
    category ? `<strong>Category:</strong> ${category}` : "",
    readingTime ? `<em>${readingTime}</em>` : "",
  ].filter(Boolean);
  const metaLine =
    metaParts.length > 0 ? `<p>${metaParts.join(" · ")}</p>` : "";
  const summaryLine = summary ? `<p>${summary}</p>` : "";

  return {
    title: cleanTitle,
    link,
    pubDate,
    description: `${imgHtml}${summaryLine}${metaLine}`,
    categories: category ? [category] : [],
  };
}

/**
 * Extracts articles from Next.js App Router RSC inline payload.
 * robpalmer.com uses Next.js with client-side bailout on /blog,
 * delivering the posts array inside self.__next_f.push scripts.
 */
function extractArticlesFromRSC(html) {
  const pushRegex = /self\.__next_f\.push\(\[([0-9]+),\s*(".*?")\]\)/gs;
  const chunks = [];
  let match;
  while ((match = pushRegex.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse(match[2]));
    } catch {
      // ignore unparseable chunk
    }
  }

  const fullPayload = chunks.join("");
  if (!fullPayload) return [];

  const postsMarker = '{"posts":[';
  const startIdx = fullPayload.indexOf(postsMarker);
  if (startIdx === -1) return [];

  const arrayStart = startIdx + '{"posts":'.length;
  let depth = 0;
  let inString = false;
  let escape = false;
  let arrayEnd = -1;

  for (let i = arrayStart; i < fullPayload.length; i++) {
    const ch = fullPayload[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"' && !escape) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") {
        depth--;
        if (depth === 0 && ch === "]") {
          arrayEnd = i + 1;
          break;
        }
      }
    }
  }

  if (arrayEnd === -1) return [];

  try {
    const posts = JSON.parse(fullPayload.slice(arrayStart, arrayEnd));
    if (Array.isArray(posts)) {
      return posts
        .map((p) =>
          formatPostItem({
            title: p.title,
            slug: p.slug,
            date: p.date,
            category: p.category,
            readingTime: p.readingTime,
            description: p.description || p.metaDescription,
            heroImage: p.heroImage,
          })
        )
        .filter(Boolean);
    }
  } catch {
    // fallback if parsing fails
  }

  return [];
}

/**
 * Fallback DOM extractor if the page markup contains traditional HTML article links.
 */
function extractArticlesFromDOM(html) {
  const { document } = parseHTML(html);
  const items = [];

  // Match all blog post links excluding pagination, blog home, search
  const links = document.querySelectorAll(
    'a[href^="/blog/"]:not([href*="/page/"]):not([href="/blog"]):not([href*="search="])'
  );

  for (const a of links) {
    const href = a.getAttribute("href");
    if (!href) continue;

    const slug = href.replace(/^\/blog\//, "").split("?")[0].replace(/\/$/, "");
    if (!slug) continue;

    const titleEl = a.querySelector("h2, h3");
    if (!titleEl) continue;
    const title = titleEl.textContent;

    const descEl = a.querySelector("p");
    const summary = descEl ? descEl.textContent : "";

    const timeEl = a.querySelector("time");
    const date = timeEl
      ? timeEl.getAttribute("datetime") || timeEl.textContent.trim()
      : "";

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

    const imgEl = a.querySelector("img");
    const heroImage = imgEl ? imgEl.getAttribute("src") : "";

    const item = formatPostItem({
      title,
      slug,
      date,
      category,
      readingTime,
      description: summary,
      heroImage,
    });

    if (item) {
      items.push(item);
    }
  }

  return items;
}

/**
 * Extracts articles from the blog HTML.
 * Supports Next.js RSC payload stream and standard HTML DOM markup.
 */
export function extractArticles(html) {
  if (!html || typeof html !== "string") return [];

  // 1. Primary: Extract from Next.js RSC payload (used on robpalmer.com)
  const rscItems = extractArticlesFromRSC(html);
  if (rscItems.length > 0) {
    return rscItems;
  }

  // 2. Secondary fallback: Extract from standard HTML DOM
  return extractArticlesFromDOM(html);
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

  // Fallback notice if scraping returned 0 articles or failed
  if (items.length === 0) {
    const reason = fetchError || "No articles could be extracted from page";
    items.push({
      title: `⚠️ Unable to load Rob Palmer articles (${reason})`,
      link: BLOG_URL,
      description: `<p>Failed to retrieve the latest articles from <a href="${BLOG_URL}">${BLOG_URL}</a> (${reason}). The feed will retry automatically on the next poll.</p>`,
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
