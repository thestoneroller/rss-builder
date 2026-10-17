import { parseHTML } from 'linkedom';
import rss from '@astrojs/rss';

export const prerender = false;

export const BLOG_URL = 'https://www.linkedin.com/blog/engineering/feed';
const CACHE_MAX_AGE = 30 * 60; // 30 minutes cache
const FETCH_TIMEOUT = 10000; // 10s timeout

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Parses article publication dates in "MMM DD, YYYY" format (e.g. "Mar 12, 2026").
 */
export function parseDate(rawDate) {
  if (!rawDate) return new Date();
  const trimmed = rawDate.trim();
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Reconstructs titles truncated by LinkedIn's lithograph template (ending in "...")
 * using words from the canonical article URL slug when available.
 */
export function repairTruncatedTitle(rawTitle, link) {
  if (!rawTitle) return '';
  const title = rawTitle.replace(/\s+/g, ' ').trim();
  if (!title.endsWith('...') && !title.endsWith('…')) {
    return title;
  }
  const prefix = title.replace(/(\.\.\.|…)$/, '').trim();
  if (!link) return prefix;

  try {
    const pathname = new URL(link, 'https://www.linkedin.com').pathname;
    const slug = pathname.split('/').filter(Boolean).pop();
    if (!slug || slug.endsWith('...')) return prefix;

    const slugTokens = slug.split('-');
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    const prefixTokens = prefix.split(/[\s-]+/).filter(Boolean);

    let bestSlugIdx = -1;
    let pIdx = 0;
    for (
      let sIdx = 0;
      sIdx < slugTokens.length && pIdx < prefixTokens.length;
      sIdx++
    ) {
      const pWord = norm(prefixTokens[pIdx]);
      if (!pWord) {
        pIdx++;
        continue;
      }
      if (slugTokens[sIdx] === pWord || slugTokens[sIdx].startsWith(pWord)) {
        if (pIdx === prefixTokens.length - 1) {
          bestSlugIdx = sIdx;
          break;
        }
        pIdx++;
      }
    }

    if (bestSlugIdx !== -1 && bestSlugIdx < slugTokens.length) {
      const remainingTokens = slugTokens.slice(bestSlugIdx);
      const lastToken = prefixTokens[prefixTokens.length - 1];
      const cutRegex = new RegExp(lastToken + '$', 'i');
      const basePrefix = prefix.replace(cutRegex, '').trim();
      const suffix = remainingTokens.join(' ');
      if (basePrefix.endsWith('-')) {
        return basePrefix + suffix;
      }
      return basePrefix ? `${basePrefix} ${suffix}` : suffix;
    }
  } catch {
    // fallback to prefix
  }

  return prefix;
}

/**
 * Extracts a valid hero image URL, resolving lazy-loaded attributes.
 */
export function extractImage(imgEl) {
  if (!imgEl) return '';
  const ghostUrl = imgEl.getAttribute('data-ghost-url') || '';
  const delayedUrl = imgEl.getAttribute('data-delayed-url') || '';
  const src = imgEl.getAttribute('src') || '';
  const dataSrc = imgEl.getAttribute('data-src') || '';

  for (const candidate of [src, delayedUrl, dataSrc]) {
    if (
      candidate &&
      candidate !== ghostUrl &&
      !candidate.startsWith('data:') &&
      !candidate.includes('ghost-url')
    ) {
      return candidate;
    }
  }
  return '';
}

/**
 * Extracts LinkedIn Engineering Feed articles from the HTML markup.
 */
export function extractArticles(html) {
  if (!html || typeof html !== 'string') return [];

  const { document } = parseHTML(html);
  const items = [];

  // Match grid posts in the feed listing, avoiding pagination items
  const postElements = document.querySelectorAll(
    '.grid-layout__posts > li.grid-post, li.post-list__item.grid-post, .grid-post',
  );

  for (const post of postElements) {
    const linkEl = post.querySelector('.grid-post__link');
    if (!linkEl) continue;

    const rawHref = linkEl.getAttribute('href') || '';
    if (!rawHref || rawHref.includes('page0=')) continue;

    const fullUrl = new URL(rawHref, 'https://www.linkedin.com').href;
    const rawTitle = linkEl.textContent.trim();
    if (!rawTitle) continue;

    const cleanTitle = repairTruncatedTitle(rawTitle, fullUrl);

    const topicEl =
      post.querySelector('.grid-post__topic a') ||
      post.querySelector('.grid-post__topic');
    const topic = topicEl ? topicEl.textContent.trim() : '';

    const authorEl = post.querySelector('.grid-post__author');
    const author = authorEl ? authorEl.textContent.trim() : '';

    const dateEl = post.querySelector('.grid-post__date');
    const pubDate = parseDate(dateEl ? dateEl.textContent : '');

    const imgEl = post.querySelector('.post__image, img');
    const imageUrl = extractImage(imgEl);

    // Build rich HTML description for RSS readers
    const imgHtml = imageUrl
      ? `<p><img src="${imageUrl}" alt="${cleanTitle.replace(/"/g, '&quot;')}" /></p>`
      : '';

    const metaParts = [
      topic ? `<strong>Topic:</strong> ${topic}` : '',
      author ? `<strong>Author:</strong> ${author}` : '',
    ].filter(Boolean);

    const metaLine =
      metaParts.length > 0 ? `<p>${metaParts.join(' · ')}</p>` : '';
    const readMoreLine = `<p><a href="${fullUrl}">Read on LinkedIn Engineering Blog →</a></p>`;

    const description = `${imgHtml}${metaLine}${readMoreLine}`;

    items.push({
      title: cleanTitle,
      link: fullUrl,
      pubDate,
      description,
      categories: topic ? [topic] : [],
    });
  }

  return items;
}

export async function GET(context) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let html = '';
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
    fetchError = err.name === 'AbortError' ? 'Request timed out' : err.message;
  } finally {
    clearTimeout(timer);
  }

  let items = [];
  if (html) {
    items = extractArticles(html);
  }

  // Graceful fallback if fetching or scraping yielded 0 items
  if (items.length === 0) {
    const reason = fetchError || 'No articles could be extracted from page';
    items.push({
      title: `⚠️ Unable to load LinkedIn Feed articles (${reason})`,
      link: BLOG_URL,
      description: `<p>Failed to retrieve the latest articles from <a href="${BLOG_URL}">${BLOG_URL}</a> (${reason}). The feed will retry automatically on the next poll.</p>`,
      pubDate: new Date(),
    });
  }

  const rssResponse = await rss({
    title: 'LinkedIn Engineering - Feed',
    description:
      "Engineering behind LinkedIn's Feed: ranking algorithms, machine learning, infrastructure, and member experience.",
    site: context.site || BLOG_URL,
    items,
  });

  rssResponse.headers.set(
    'Cache-Control',
    `public, max-age=60, s-maxage=${CACHE_MAX_AGE}`,
  );

  return rssResponse;
}
