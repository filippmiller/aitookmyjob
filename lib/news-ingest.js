/**
 * Multi-source news ingest: GDELT + Google News RSS.
 * Dedupe by canonical URL hash + content hash; entity extraction;
 * relevance scoring; predictable merge of duplicates (aitj-z8q.10).
 */

"use strict";

const crypto = require("crypto");
const { NEWS_STATUS, NEWS_SOURCE_STATUS } = require("./domain-contract");

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

/** Well-known company names for lightweight entity extraction (order = longer first). */
const KNOWN_COMPANIES = [
  "Google", "Alphabet", "Microsoft", "Amazon", "Meta", "Facebook", "Apple",
  "IBM", "Intel", "Nvidia", "OpenAI", "Anthropic", "Salesforce", "Oracle",
  "SAP", "Accenture", "Deloitte", "PwC", "Ernst & Young", "KPMG",
  "Uber", "Lyft", "Airbnb", "Netflix", "Spotify", "Twitter", "X Corp",
  "Tesla", "SpaceX", "Samsung", "Sony", "Adobe", "Cisco", "HP", "Dell",
  "Walmart", "Target", "Disney", "Comcast", "AT&T", "Verizon",
  "Goldman Sachs", "JPMorgan", "Morgan Stanley", "Bank of America",
  "Citi", "Wells Fargo", "McKinsey", "BCG", "Bain",
  "Shopify", "Stripe", "PayPal", "Block", "Square",
  "Duolingo", "Chegg", "BuzzFeed", "Vice", "Gannett",
  "Klarna", "Swiggy", "Bytedance", "TikTok", "Baidu", "Alibaba", "Tencent"
].sort((a, b) => b.length - a.length);

const KNOWN_PROFESSIONS = [
  "software engineer", "software developer", "data scientist", "data analyst",
  "product manager", "project manager", "customer support", "customer service",
  "content writer", "copywriter", "journalist", "editor",
  "graphic designer", "ux designer", "ui designer",
  "accountant", "bookkeeper", "paralegal", "lawyer",
  "recruiter", "hr manager", "human resources",
  "marketing manager", "sales representative", "call center",
  "translator", "teacher", "nurse", "radiologist",
  "warehouse worker", "driver", "truck driver",
  "white-collar", "blue-collar", "knowledge worker",
  "engineer", "developer", "analyst", "designer", "writer"
].sort((a, b) => b.length - a.length);

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_reader", "fbclid", "gclid", "gbraid", "wbraid",
  "mc_cid", "mc_eid", "msclkid", "igshid", "ref", "ref_src",
  "source", "s", "si", "spm", "ocid", "ncid"
]);

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

/**
 * Normalize a URL for deduplication:
 * - lowercase host, strip www.
 * - drop hash and common tracking query params
 * - drop trailing slash (except root)
 * - sort remaining query params
 */
function canonicalUrl(input) {
  try {
    const url = new URL(String(input || "").trim());
    if (!/^https?:$/i.test(url.protocol)) return "";
    url.hash = "";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    const kept = [];
    for (const [key, value] of url.searchParams.entries()) {
      const k = key.toLowerCase();
      if (TRACKING_PARAMS.has(k)) continue;
      if (k.startsWith("utm_")) continue;
      kept.push([k, value]);
    }
    kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    url.search = "";
    for (const [k, v] of kept) url.searchParams.append(k, v);
    let path = url.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    url.pathname = path;
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

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function urlHash(canonical) {
  const c = canonical || "";
  if (!c) return "";
  return sha256Hex(`url:${c}`);
}

/** Normalize title text for content hashing (case/punct insensitive). */
function normalizeTitleForHash(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[''"]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentHash(title, source = "") {
  const base = normalizeTitleForHash(title);
  if (!base) return "";
  // Include host loosely so identical headlines from different outlets stay distinct
  // unless title-only match is requested via mergeDuplicates.
  const host = String(source || "").toLowerCase().replace(/^www\./, "").trim();
  return sha256Hex(`title:${base}|src:${host}`);
}

/** Title-only hash for cross-source near-duplicate detection. */
function titleContentHash(title) {
  const base = normalizeTitleForHash(title);
  if (!base) return "";
  return sha256Hex(`title-only:${base}`);
}

function relevanceScore(title, source = "") {
  const haystack = `${title} ${source}`;
  const aiHits = AI_TERMS.filter((term) => term.test(haystack)).length;
  const workHits = WORK_TERMS.filter((term) => term.test(haystack)).length;
  if (!aiHits || !workHits) return 0;
  return (aiHits * 10) + (workHits * 12);
}

/**
 * Extract companies and professions from free text.
 * Returns { companies: string[], professions: string[], regions: string[] }
 */
function extractEntities(text, options = {}) {
  const haystack = String(text || "");
  const lower = haystack.toLowerCase();
  const companies = new Set(Array.isArray(options.companies) ? options.companies.map(String) : []);
  const professions = new Set(Array.isArray(options.professions) ? options.professions.map(String) : []);
  const regions = new Set(Array.isArray(options.regions) ? options.regions.map(String) : []);

  for (const name of KNOWN_COMPANIES) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(haystack)) companies.add(name);
  }
  for (const role of KNOWN_PROFESSIONS) {
    if (lower.includes(role.toLowerCase())) professions.add(role);
  }

  // Light region hints
  const regionHints = [
    ["us", /\b(u\.?s\.?a?\.?|united states|america)\b/i],
    ["uk", /\b(u\.?k\.?|united kingdom|britain|england)\b/i],
    ["eu", /\b(european union|\beu\b|europe)\b/i],
    ["de", /\b(germany|deutschland)\b/i],
    ["fr", /\b(france|french)\b/i],
    ["in", /\b(india|indian)\b/i],
    ["cn", /\b(china|chinese)\b/i]
  ];
  for (const [code, re] of regionHints) {
    if (re.test(haystack)) regions.add(code);
  }

  return {
    companies: [...companies].sort((a, b) => a.localeCompare(b)),
    professions: [...professions].sort((a, b) => a.localeCompare(b)),
    regions: [...regions].sort((a, b) => a.localeCompare(b))
  };
}

function mergeEntityLists(...lists) {
  const out = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const v of list) {
      const s = String(v || "").trim();
      if (s) out.add(s);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function mergeEntities(a = {}, b = {}) {
  return {
    companies: mergeEntityLists(a.companies, b.companies),
    professions: mergeEntityLists(a.professions, b.professions),
    regions: mergeEntityLists(a.regions, b.regions)
  };
}

/**
 * Predictable merge of two news items when they are duplicates.
 * Keeps the "survivor" id (prefer earlier discovered, then higher relevance).
 * Returns { survivor, discarded, reason }.
 */
function mergeNewsItems(a, b) {
  if (!a) return { survivor: b, discarded: null, reason: "only_b" };
  if (!b) return { survivor: a, discarded: null, reason: "only_a" };

  const aTime = new Date(a.discoveredAt || a.publishedAt || 0).getTime();
  const bTime = new Date(b.discoveredAt || b.publishedAt || 0).getTime();
  const aScore = Number(a.relevanceScore || 0);
  const bScore = Number(b.relevanceScore || 0);

  // Prefer earlier discovery as canonical id; break ties with higher relevance then stable id
  let survivor = a;
  let discarded = b;
  let reason = "earlier_discovered";
  if (bTime < aTime) {
    survivor = b;
    discarded = a;
    reason = "earlier_discovered";
  } else if (bTime === aTime) {
    if (bScore > aScore) {
      survivor = b;
      discarded = a;
      reason = "higher_relevance";
    } else if (bScore === aScore && String(b.id || "") < String(a.id || "")) {
      survivor = b;
      discarded = a;
      reason = "stable_id";
    }
  }

  const entities = mergeEntities(
    survivor.entities || { companies: survivor.companies, professions: survivor.professions },
    discarded.entities || { companies: discarded.companies, professions: discarded.professions }
  );
  const companies = mergeEntityLists(survivor.companies, discarded.companies, entities.companies);
  const professions = mergeEntityLists(survivor.professions, discarded.professions, entities.professions);
  entities.companies = companies;
  entities.professions = professions;

  const duplicateUrls = mergeEntityLists(
    survivor.duplicateUrls,
    discarded.duplicateUrls,
    survivor.url !== discarded.url ? [discarded.url, discarded.canonicalUrl].filter(Boolean) : []
  ).filter((u) => u && u !== survivor.url && u !== survivor.canonicalUrl);

  const merged = {
    ...survivor,
    title: survivor.title || discarded.title,
    source: survivor.source || discarded.source,
    url: survivor.url || discarded.url,
    canonicalUrl: survivor.canonicalUrl || discarded.canonicalUrl || survivor.url,
    urlHash: survivor.urlHash || discarded.urlHash,
    contentHash: survivor.contentHash || discarded.contentHash,
    titleHash: survivor.titleHash || discarded.titleHash,
    publishedAt: new Date(Math.min(
      new Date(survivor.publishedAt || Date.now()).getTime(),
      new Date(discarded.publishedAt || Date.now()).getTime()
    )).toISOString(),
    discoveredAt: new Date(Math.min(
      new Date(survivor.discoveredAt || Date.now()).getTime(),
      new Date(discarded.discoveredAt || Date.now()).getTime()
    )).toISOString(),
    relevanceScore: Math.max(aScore, bScore),
    summary: (survivor.summary && survivor.summary.length >= (discarded.summary || "").length)
      ? survivor.summary
      : (discarded.summary || survivor.summary || ""),
    entities,
    companies,
    professions,
    region: survivor.region || discarded.region || "global",
    language: survivor.language || discarded.language || "en",
    status: preferStatus(survivor.status, discarded.status),
    duplicateUrls,
    mergedIntoId: null,
    sourceStatus: preferSourceStatus(survivor.sourceStatus, discarded.sourceStatus),
    updatedAt: new Date().toISOString()
  };

  return {
    survivor: merged,
    discarded: {
      ...discarded,
      mergedIntoId: merged.id,
      status: discarded.status || NEWS_STATUS.ARCHIVED
    },
    reason
  };
}

function preferStatus(a, b) {
  const rank = {
    [NEWS_STATUS.PUBLISHED]: 4,
    [NEWS_STATUS.PENDING]: 3,
    [NEWS_STATUS.DISCOVERED]: 2,
    [NEWS_STATUS.ARCHIVED]: 1,
    [NEWS_STATUS.REJECTED]: 0
  };
  const ra = rank[a] ?? -1;
  const rb = rank[b] ?? -1;
  return ra >= rb ? (a || NEWS_STATUS.DISCOVERED) : b;
}

function preferSourceStatus(a, b) {
  const rank = {
    [NEWS_SOURCE_STATUS.OK]: 3,
    [NEWS_SOURCE_STATUS.STALE]: 2,
    [NEWS_SOURCE_STATUS.UNKNOWN]: 1,
    [NEWS_SOURCE_STATUS.BROKEN]: 0
  };
  const ra = rank[a] ?? -1;
  const rb = rank[b] ?? -1;
  return ra >= rb ? (a || NEWS_SOURCE_STATUS.UNKNOWN) : b;
}

/**
 * Deduplicate a batch of candidate items in memory.
 * 1) Same canonical URL / urlHash → merge
 * 2) Same titleContentHash → merge (cross-source same headline)
 * Returns { items, merges }
 */
function dedupeNewsItems(items = []) {
  const byUrlHash = new Map();
  const byTitleHash = new Map();
  const merges = [];

  for (const raw of items) {
    if (!raw) continue;
    const item = enrichNewsCandidate(raw);
    if (!item.canonicalUrl || !item.urlHash) continue;

    let existingKey = null;
    let existing = null;
    if (byUrlHash.has(item.urlHash)) {
      existingKey = "url";
      existing = byUrlHash.get(item.urlHash);
    } else if (item.titleHash && byTitleHash.has(item.titleHash)) {
      existingKey = "title";
      existing = byTitleHash.get(item.titleHash);
    }

    if (existing) {
      const { survivor, discarded, reason } = mergeNewsItems(existing, item);
      merges.push({
        survivorId: survivor.id,
        discardedId: discarded?.id || item.id,
        match: existingKey,
        reason
      });
      byUrlHash.set(survivor.urlHash, survivor);
      if (survivor.titleHash) byTitleHash.set(survivor.titleHash, survivor);
      // Remove discarded keys if they diverged
      if (discarded?.urlHash && discarded.urlHash !== survivor.urlHash) {
        byUrlHash.delete(discarded.urlHash);
      }
      if (discarded?.titleHash && discarded.titleHash !== survivor.titleHash) {
        // only delete if it still points to discarded
        if (byTitleHash.get(discarded.titleHash)?.id === discarded.id) {
          byTitleHash.delete(discarded.titleHash);
        }
      }
    } else {
      byUrlHash.set(item.urlHash, item);
      if (item.titleHash) byTitleHash.set(item.titleHash, item);
    }
  }

  // Unique by id (title map may alias same survivor)
  const seenIds = new Set();
  const out = [];
  for (const item of byUrlHash.values()) {
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    out.push(item);
  }
  out.sort((a, b) => (b.relevanceScore - a.relevanceScore)
    || (new Date(b.publishedAt) - new Date(a.publishedAt)));
  return { items: out, merges };
}

function makeNewsIdFromCanonical(canonical) {
  return `news_${sha256Hex(canonical || "").slice(0, 20)}`;
}

/**
 * Enrich a raw article with hashes, entities, scores.
 */
function enrichNewsCandidate(raw = {}) {
  const titleObj = raw.title && typeof raw.title === "object"
    ? raw.title
    : { en: String(raw.title || "").trim() };
  const titleEn = String(titleObj.en || Object.values(titleObj)[0] || "").replace(/\s+/g, " ").trim();
  const canonical = canonicalUrl(raw.canonicalUrl || raw.url || raw.link || "");
  const url = canonical || String(raw.url || raw.link || "").trim();
  const source = String(raw.source || raw.domain || sourceFromUrl(url) || "Unknown source").trim();
  const entities = extractEntities(
    `${titleEn} ${raw.summary || ""} ${source}`,
    {
      companies: raw.companies || raw.entities?.companies,
      professions: raw.professions || raw.entities?.professions,
      regions: raw.entities?.regions
    }
  );
  const score = Number.isFinite(Number(raw.relevanceScore ?? raw.relevance_score))
    ? Number(raw.relevanceScore ?? raw.relevance_score)
    : relevanceScore(titleEn, source);
  const status = raw.status || NEWS_STATUS.DISCOVERED;
  const uHash = urlHash(canonical);
  const cHash = contentHash(titleEn, source);
  const tHash = titleContentHash(titleEn);
  const id = raw.id || makeNewsIdFromCanonical(canonical || url);

  return {
    id,
    title: titleObj.en !== undefined ? titleObj : { en: titleEn },
    source,
    url,
    canonicalUrl: canonical || url,
    urlHash: uHash,
    contentHash: cHash,
    titleHash: tHash,
    publishedAt: parseDate(raw.publishedAt || raw.published_at || raw.pubDate || raw.seendate),
    region: raw.region || entities.regions[0] || "global",
    language: raw.language || "en",
    summary: String(raw.summary || raw.excerpt || raw.description || "Monitored public coverage mentioning AI and workforce displacement.").trim(),
    status,
    relevanceScore: score,
    entities,
    companies: entities.companies,
    professions: entities.professions,
    discoveredAt: raw.discoveredAt || raw.discovered_at || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString(),
    sourceStatus: raw.sourceStatus || raw.source_status || NEWS_SOURCE_STATUS.UNKNOWN,
    correctionNote: raw.correctionNote || raw.correction_note || "",
    correctedAt: raw.correctedAt || raw.corrected_at || null,
    correctedBy: raw.correctedBy || raw.corrected_by || null,
    mergedIntoId: raw.mergedIntoId || raw.merged_into_id || null,
    duplicateUrls: Array.isArray(raw.duplicateUrls || raw.duplicate_urls)
      ? (raw.duplicateUrls || raw.duplicate_urls)
      : [],
    discussionTopicId: raw.discussionTopicId || raw.discussion_topic_id || null,
    submittedBy: raw.submittedBy || raw.submitted_by || null,
    submissionId: raw.submissionId || raw.submission_id || null
  };
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
      headers: { Accept: "application/json", "User-Agent": "aitookmyjob-news-ingest/1.0" },
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
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "aitookmyjob-news-ingest/1.0"
      },
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

  return enrichNewsCandidate({
    title: { en: title },
    source: article.domain || sourceFromUrl(url),
    url,
    publishedAt: parseDate(article.seendate || article.datetime || article.publishedAt),
    region: "global",
    language: "en",
    summary: "Monitored public coverage mentioning AI and workforce displacement.",
    status: NEWS_STATUS.PUBLISHED,
    relevanceScore: score,
    discoveredAt: new Date().toISOString()
  });
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

  return enrichNewsCandidate({
    title: { en: title },
    source,
    url,
    publishedAt: parseDate(article.pubDate),
    region: "global",
    language: "en",
    summary: article.description
      ? String(article.description).slice(0, 500)
      : "Monitored public coverage mentioning AI and workforce displacement.",
    status: NEWS_STATUS.PUBLISHED,
    relevanceScore: score,
    discoveredAt: new Date().toISOString()
  });
}

async function collectGdeltNews(options = {}) {
  const queries = Array.isArray(options.queries) && options.queries.length ? options.queries : DEFAULT_QUERIES;
  const daysBack = Number(options.daysBack || process.env.NEWS_INGEST_DAYS_BACK || 14);
  const maxRecords = Math.min(Math.max(Number(options.maxRecords || process.env.NEWS_INGEST_MAX_RECORDS || 25), 1), 100);
  const fetchImpl = options.fetchImpl || fetch;
  const items = [];
  const errors = [];
  const sourceErrors = [];

  for (const query of queries) {
    try {
      const data = await fetchJson(gdeltUrl(query, daysBack, maxRecords), fetchImpl);
      for (const article of data.articles || []) {
        const item = normalizeGdeltArticle(article);
        if (item) items.push(item);
      }
    } catch (error) {
      errors.push({ query, source: "gdelt", message: error.message });
      sourceErrors.push({ sourceKey: "gdelt", message: error.message });
    }
  }

  const deduped = dedupeNewsItems(items);
  return { items: deduped.items, errors, merges: deduped.merges, sourceErrors };
}

async function collectGoogleNewsRss(options = {}) {
  const queries = Array.isArray(options.rssQueries) && options.rssQueries.length ? options.rssQueries : DEFAULT_RSS_QUERIES;
  const daysBack = Number(options.daysBack || process.env.NEWS_INGEST_DAYS_BACK || 14);
  const fetchImpl = options.fetchImpl || fetch;
  const items = [];
  const errors = [];
  const sourceErrors = [];

  for (const query of queries) {
    try {
      const xml = await fetchText(googleNewsRssUrl(query, daysBack), fetchImpl);
      for (const article of parseRssItems(xml)) {
        const item = normalizeRssArticle(article);
        if (item) items.push(item);
      }
    } catch (error) {
      errors.push({ query, source: "google-news-rss", message: error.message });
      sourceErrors.push({ sourceKey: "google-news-rss", message: error.message });
    }
  }

  const deduped = dedupeNewsItems(items);
  return { items: deduped.items, errors, merges: deduped.merges, sourceErrors };
}

async function collectNews(options = {}) {
  const [gdelt, rss] = await Promise.all([
    collectGdeltNews(options),
    collectGoogleNewsRss(options)
  ]);
  const deduped = dedupeNewsItems([...rss.items, ...gdelt.items]);
  return {
    items: deduped.items,
    errors: [...gdelt.errors, ...rss.errors],
    merges: [...(gdelt.merges || []), ...(rss.merges || []), ...deduped.merges],
    sourceErrors: [...(gdelt.sourceErrors || []), ...(rss.sourceErrors || [])]
  };
}

/**
 * Valid NEWS_STATUS transitions for moderator / system corrections.
 * Thin wrapper around domain canTransition when available, with offline fallback.
 */
function canTransitionNewsStatus(from, to) {
  try {
    const { canTransition, ENTITY } = require("./domain-contract");
    return canTransition(ENTITY.NEWS, from, to);
  } catch (_e) {
    return false;
  }
}

function canTransitionSubmissionStatus(from, to) {
  try {
    const { canTransition, ENTITY } = require("./domain-contract");
    return canTransition(ENTITY.NEWS_SUBMISSION, from, to);
  } catch (_e) {
    return false;
  }
}

async function ingestNews(ctx, options = {}) {
  const collected = await collectNews(options);
  const result = await ctx.storageUpsertNewsItems(collected.items, {
    merges: collected.merges
  });

  // Record source health for ingest providers when storage supports it
  if (typeof ctx.storageRecordNewsSourceHealth === "function") {
    const byKey = new Map();
    for (const err of collected.sourceErrors || []) {
      byKey.set(err.sourceKey, err);
    }
    for (const key of ["gdelt", "google-news-rss"]) {
      const err = byKey.get(key);
      try {
        await ctx.storageRecordNewsSourceHealth({
          sourceKey: key,
          sourceName: key,
          ok: !err,
          httpStatus: null,
          failureReason: err?.message || ""
        });
      } catch (_e) {
        /* health must not fail ingest */
      }
    }
  }

  return {
    provider: "gdelt+google-news-rss",
    fetched: collected.items.length,
    inserted: result.inserted,
    updated: result.updated,
    merged: result.merged || 0,
    skipped: result.skipped,
    merges: collected.merges?.length || 0,
    errors: collected.errors
  };
}

module.exports = {
  DEFAULT_QUERIES,
  DEFAULT_RSS_QUERIES,
  KNOWN_COMPANIES,
  KNOWN_PROFESSIONS,
  collectNews,
  collectGdeltNews,
  collectGoogleNewsRss,
  ingestNews,
  normalizeGdeltArticle,
  normalizeRssArticle,
  parseRssItems,
  relevanceScore,
  canonicalUrl,
  urlHash,
  contentHash,
  titleContentHash,
  normalizeTitleForHash,
  extractEntities,
  mergeEntities,
  mergeEntityLists,
  mergeNewsItems,
  dedupeNewsItems,
  enrichNewsCandidate,
  makeNewsIdFromCanonical,
  canTransitionNewsStatus,
  canTransitionSubmissionStatus,
  sourceFromUrl,
  sha256Hex
};
