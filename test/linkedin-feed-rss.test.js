import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractArticles,
  repairTruncatedTitle,
  parseDate,
  extractImage,
  GET,
  BLOG_URL,
} from '../src/pages/linkedin-feed-rss.xml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('extractArticles extracts all 12 articles from linkedinblog fixture', () => {
  const fixturePath = path.join(
    __dirname,
    'fixtures',
    'linkedin-feed-sample.html',
  );
  const html = fs.readFileSync(fixturePath, 'utf8');

  const articles = extractArticles(html);
  assert.equal(
    articles.length,
    12,
    'Should extract all 12 articles from the fixture',
  );

  // Verify first article
  const first = articles[0];
  assert.equal(
    first.title,
    'Engineering the next generation of LinkedIn’s Feed',
  );
  assert.ok(
    first.link.startsWith(
      'https://www.linkedin.com/blog/engineering/feed/engineering-the',
    ),
    'First article link should point to LinkedIn blog',
  );
  assert.ok(first.pubDate instanceof Date, 'pubDate should be a Date instance');
  assert.equal(first.categories[0], 'Feed');
  assert.ok(
    first.description.includes('<img'),
    'Description should contain image',
  );
  assert.ok(
    first.description.includes('Hristo Danchev'),
    'Description should contain author',
  );
  assert.ok(
    first.description.includes('Topic:</strong> Feed'),
    'Description should contain topic',
  );
  assert.ok(
    first.description.includes('Read on LinkedIn Engineering Blog'),
    'Description should contain read more link',
  );

  // Verify article with author Sakshi Jain and topic Feed
  const second = articles[1];
  assert.ok(second.description.includes('Sakshi Jain'));
  assert.equal(second.categories[0], 'Feed');

  // Verify article with Nisheedh Raveendran and topic Infrastructure
  const third = articles[2];
  assert.equal(
    third.title,
    'FishDB: a generic retrieval engine for scaling LinkedIn’s feed',
  );
  assert.equal(third.categories[0], 'Infrastructure');
  assert.ok(third.description.includes('Nisheedh Raveendran'));
});

test('repairTruncatedTitle restores full headline using slug tokens', () => {
  // Untruncated title
  assert.equal(
    repairTruncatedTitle(
      'Engineering the next generation of LinkedIn’s Feed',
      'https://www.linkedin.com/blog/engineering/feed/engineering-the-next-generation-of-linkedins-feed',
    ),
    'Engineering the next generation of LinkedIn’s Feed',
  );

  // Truncated with ellipsis
  assert.equal(
    repairTruncatedTitle(
      'Putting members first: testing and measuring how content appea...',
      'https://www.linkedin.com/blog/engineering/feed/putting-members-first-testing-and-measuring-how-content-appears-in-your-feed',
    ),
    'Putting members first: testing and measuring how content appears in your feed',
  );

  // Truncated with hyphenated word
  assert.equal(
    repairTruncatedTitle(
      'Java heap memory and garbage collection: tuning for high-perfo...',
      'https://www.linkedin.com/blog/engineering/infrastructure/java-heap-memory-and-garbage-collection-tuning-for-high-performance-services',
    ),
    'Java heap memory and garbage collection: tuning for high-performance services',
  );

  // Fallback when slug is truncated or not matching
  assert.equal(
    repairTruncatedTitle(
      'Article without full slug...',
      'https://www.linkedin.com/blog/engineering/feed/article...',
    ),
    'Article without full slug',
  );

  assert.equal(repairTruncatedTitle('', ''), '');
});

test('parseDate parses standard date strings and handles fallbacks', () => {
  const d1 = parseDate('Mar 12, 2026');
  assert.equal(d1.getFullYear(), 2026);
  assert.equal(d1.getMonth(), 2); // 0-indexed March

  const d2 = parseDate('Nov 20, 2025');
  assert.equal(d2.getFullYear(), 2025);

  const fallback = parseDate('invalid date string');
  assert.ok(fallback instanceof Date);
  assert.ok(!isNaN(fallback.getTime()));

  const empty = parseDate('');
  assert.ok(empty instanceof Date);
});

test('extractArticles returns empty array for invalid or empty HTML', () => {
  assert.deepEqual(extractArticles(''), []);
  assert.deepEqual(extractArticles(null), []);
  assert.deepEqual(extractArticles(undefined), []);
  assert.deepEqual(
    extractArticles('<html><body><p>No posts here</p></body></html>'),
    [],
  );
});

test('GET returns valid RSS 2.0 XML response with extracted items', async () => {
  const fixturePath = path.join(
    __dirname,
    'fixtures',
    'linkedin-feed-sample.html',
  );
  const sampleHtml = fs.readFileSync(fixturePath, 'utf8');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sampleHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });

  try {
    const res = await GET({ site: 'https://test.local' });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('Cache-Control').includes('s-maxage=1800'));
    assert.ok(res.headers.get('Cache-Control').includes('max-age=60'));

    const xml = await res.text();
    assert.ok(
      xml.includes('<rss version="2.0">'),
      'Response should be valid RSS 2.0 XML',
    );
    assert.ok(
      xml.includes('<channel>'),
      'Response should contain channel element',
    );
    assert.ok(
      xml.includes('<title>LinkedIn Engineering - Feed</title>'),
      'Should contain channel title',
    );
    assert.ok(
      xml.includes('Engineering the next generation of LinkedIn’s Feed'),
      'Should contain first article title',
    );

    const itemCount = (xml.match(/<item>/g) || []).length;
    assert.equal(itemCount, 12, 'RSS feed should contain exactly 12 items');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET returns fallback notice item when fetch fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('LinkedIn blocked test');
  };

  try {
    const res = await GET({ site: 'https://test.local' });
    assert.equal(res.status, 200);

    const xml = await res.text();
    assert.ok(xml.includes('<rss version="2.0">'));
    assert.ok(xml.includes('<item>'), 'Should contain fallback item');
    assert.ok(
      xml.includes('Unable to load LinkedIn Feed articles'),
      'Should contain fallback error title',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
