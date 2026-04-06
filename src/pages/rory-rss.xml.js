import { parseHTML } from "linkedom";
import rss from "@astrojs/rss";

export const prerender = false;

export async function GET(context) {
  const AUTHOR_URL = "https://www.spectator.co.uk/writer/rory-sutherland/";

  // 1. Fetch the page masking as a standard browser to bypass basic bot protection
  const response = await fetch(AUTHOR_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml",
    },
  });

  // 2. Parse the HTML using LinkeDOM (Native DOM APIs on the server)
  const html = await response.text();
  const { document } = parseHTML(html);
  const items = [];

  // 3. Extract data based on the specific Spectator DOM structure provided
  // The date is a sibling to the article grid, so we loop over the parent '.mosaic' blocks
  const mosaics = document.querySelectorAll(".mosaic");

  for (const mosaic of mosaics) {
    // Extract the datetime attribute from the <time> tag
    const timeElement = mosaic.querySelector("time.archive-entry__timestamp");
    const rawDate = timeElement
      ? timeElement.getAttribute("datetime")
      : new Date().toISOString();
    const pubDate = new Date(rawDate);

    // Find all articles within this specific date block
    const articles = mosaic.querySelectorAll("article");

    for (const article of articles) {
      const titleLink = article.querySelector(".article__title-link");
      const excerpt = article.querySelector(".article__excerpt-text");

      if (titleLink) {
        items.push({
          title: titleLink.textContent.trim(),
          link: titleLink.getAttribute("href"),
          description: excerpt ? excerpt.textContent.trim() : "",
          pubDate: pubDate,
        });
      }
    }
  }

  // 3. Return the generated RSS feed using Astro's built-in helper
  return rss({
    title: "Rory Sutherland - The Spectator",
    description: "Latest articles by Rory Sutherland (The Wiki Man)",
    site: context.site || AUTHOR_URL,
    items: items,
  });
}
