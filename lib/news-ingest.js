const DEFAULT_QUERIES = [
  '"artificial intelligence" layoffs OR "AI layoffs" OR "AI job cuts"',
  '"AI" "workforce reduction" OR "AI" "job cuts"',
  '"automation" layoffs OR "automation" "replace workers"',
  '"workers replaced by AI" OR "jobs replaced by AI"',
  '"AI" "white collar" layoffs OR "AI" "support jobs"'
];

const DEFAULT_RSS_QUERIES = [
  "AI layoffs",
  "AI job cuts",
  "artificial intelligence workforce reduction",
  "automation layoffs",
  "workers replaced by AI"
];

const AI_TERMS = [
  /\bai\b/i,
  /artificial intelligence/i,
  /automation/i,
  /automated/i,
  /robot/i,
  /machine learning/i,
  /generative/i
];

const WORK_TERMS = [
  /layoff/i,
  /job cuts?/i,
  /cuts? jobs?/i,
  /workforce reduction/i,
  /headcount/i,
  /replace[sd]? workers?/i,
  /replaced by/i,
  /displac/i,
  /redundan/i,
  /firing/i,
  /eliminat/i,
  /white-collar/i,
  /support jobs?/i
];

function parseDate(value) {
  const raw = String(value || "").trim();
  const gdelt = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw);
  if (gdelt) {
    const [, year, month, day, hour, minute, second] = gdelt;
    return new Date(Date.UTC(
      Number(year), Number(month) - 1, Number(day),
      Number(hour), Number(minute), Number(second)
    )).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function canonicalUrl(input) {
  try {
    const url = new URL(String(input || "").trim());
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) => {
      url.searchParams.delete(key);
    });
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function sourceFromUrl(input) {
  try {
    const host = new URL(input).hostname.replace(/^www\./, "");
    return host || "Unknown source";
  } catch (_error) {
    return "Unknown source";
  }
}

function relevanceScore(title, source = "") {
  const haystack = `${title} ${source}`;
  const aiHits = AI_TERMS.filter((term) => term.test(haystack)).length;
  const workHits = WORK_TERMS.filter((term) => term.test(haystack)).length;
  if (!aiHits || !workHits) return 0;
  return (aiHits * 10) + (workHits * 12);
}

function gdeltUrl(query, daysBack, maxRecords) {
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: String(maxRecords),
    sort: "HybridRel",
    timespan: `${Math.max(Number(daysBack || 14), 1)}d`
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

function googleNewsRssUrl(query, daysBack) {
  const scopedQuery = `${query} when:${Math.max(Number(daysBack || 14), 1)}d`;
  const params = new URLSearchParams({
    q: scopedQuery,
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

async function fetchJson(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl(url, {
      headers: { "Accept": "application/json", "User-Agent": "aitookmyjob-news-ingest/1.0" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl(url, {
      headers: { "Accept": "application/rss+xml, application/xml, text/xml", "User-Agent": "aitookmyjob-news-ingest/1.0" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeXml(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstTag(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? decodeXml(match[1]) : "";
}

function parseRssItems(xml) {
  const matches = String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return matches.map((itemXml) => ({
    title: firstTag(itemXml, "title"),
    link: firstTag(itemXml, "link"),
    source: firstTag(itemXml, "source"),
    pubDate: firstTag(itemXml, "pubDate"),
    description: firstTag(itemXml, "description")
  }));
}

function normalizeGdeltArticle(article) {
  const url = canonicalUrl(article.url);
  const title = String(article.title || "").replace(/\s+/g, " ").trim();
  const score = relevanceScore(title, article.domain || url);
  if (!url || title.length < 12 || score < 20) return null;

  return {
    title: { en: title },
    source: article.domain || sourceFromUrl(url),
    url,
    publishedAt: parseDate(article.seendate || article.datetime || article.publishedAt),
    region: "global",
    language: "en",
    summary: "Monitored public coverage mentioning AI and workforce displacement.",
    status: "published",
    relevanceScore: score,
    discoveredAt: new Date().toISOString()
  };
}

function normalizeRssArticle(article) {
  const url = canonicalUrl(article.link);
  const source = article.source || sourceFromUrl(url);
  let title = String(article.title || "").replace(/\s+/g, " ").trim();
  if (source) {
    title = title.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "");
  }
  const score = relevanceScore(title, source);
  if (!url || title.length < 12 || score < 20) return null;

  return {
    title: { en: title },
    source,
    url,
    publishedAt: parseDate(article.pubDate),
    region: "global",
    language: "en",
    summary: "Monitored public coverage mentioning AI and workforce displacement.",
    status: "published",
    relevanceScore: score,
    discoveredAt: new Date().toISOString()
  };
}

async function collectGdeltNews(options = {}) {
  const queries = Array.isArray(options.queries) && options.queries.length ? options.queries : DEFAULT_QUERIES;
  const daysBack = Number(options.daysBack || process.env.NEWS_INGEST_DAYS_BACK || 14);
  const maxRecords = Math.min(Math.max(Number(options.maxRecords || process.env.NEWS_INGEST_MAX_RECORDS || 25), 1), 100);
  const fetchImpl = options.fetchImpl || fetch;
  const seen = new Set();
  const items = [];
  const errors = [];

  for (const query of queries) {
    try {
      const data = await fetchJson(gdeltUrl(query, daysBack, maxRecords), fetchImpl);
      for (const article of data.articles || []) {
        const item = normalizeGdeltArticle(article);
        if (!item || seen.has(item.url)) continue;
        seen.add(item.url);
        items.push(item);
      }
    } catch (error) {
      errors.push({ query, message: error.message });
    }
  }

  items.sort((a, b) => (b.relevanceScore - a.relevanceScore) || (new Date(b.publishedAt) - new Date(a.publishedAt)));
  return { items, errors };
}

async function collectGoogleNewsRss(options = {}) {
  const queries = Array.isArray(options.rssQueries) && options.rssQueries.length ? options.rssQueries : DEFAULT_RSS_QUERIES;
  const daysBack = Number(options.daysBack || process.env.NEWS_INGEST_DAYS_BACK || 14);
  const fetchImpl = options.fetchImpl || fetch;
  const seen = new Set();
  const items = [];
  const errors = [];

  for (const query of queries) {
    try {
      const xml = await fetchText(googleNewsRssUrl(query, daysBack), fetchImpl);
      for (const article of parseRssItems(xml)) {
        const item = normalizeRssArticle(article);
        if (!item || seen.has(item.url)) continue;
        seen.add(item.url);
        items.push(item);
      }
    } catch (error) {
      errors.push({ query, message: error.message });
    }
  }

  items.sort((a, b) => (b.relevanceScore - a.relevanceScore) || (new Date(b.publishedAt) - new Date(a.publishedAt)));
  return { items, errors };
}

async function collectNews(options = {}) {
  const [gdelt, rss] = await Promise.all([
    collectGdeltNews(options),
    collectGoogleNewsRss(options)
  ]);
  const seen = new Set();
  const items = [];
  for (const item of [...rss.items, ...gdelt.items]) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
  }
  items.sort((a, b) => (b.relevanceScore - a.relevanceScore) || (new Date(b.publishedAt) - new Date(a.publishedAt)));
  return { items, errors: [...gdelt.errors, ...rss.errors] };
}

async function ingestNews(ctx, options = {}) {
  const collected = await collectNews(options);
  const result = await ctx.storageUpsertNewsItems(collected.items);
  return {
    provider: "gdelt+google-news-rss",
    fetched: collected.items.length,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    errors: collected.errors
  };
}

module.exports = {
  DEFAULT_QUERIES,
  DEFAULT_RSS_QUERIES,
  collectNews,
  collectGdeltNews,
  collectGoogleNewsRss,
  ingestNews,
  normalizeGdeltArticle,
  normalizeRssArticle,
  parseRssItems,
  relevanceScore
};
