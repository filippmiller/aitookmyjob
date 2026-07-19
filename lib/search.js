/**
 * Unified search, entity discovery pages, and saved searches.
 *
 * Indexes public-safe surfaces only:
 *   stories, public vents, news, insider summaries,
 *   companies, professions, groups, resources, regions
 *
 * Never returns evidence, private vents, or blocked authors (when social available).
 * Empty query → empty results (no fabricated content).
 *
 * Bead: aitj-z8q.17
 */

"use strict";

const { customAlphabet } = require("nanoid");
const domain = require("./domain-contract");

const {
  ENTITY,
  STORY_STATUS,
  VENT_STATUS,
  NEWS_STATUS,
  INSIDER_SIGNAL_STATUS,
  RESOURCE_STATUS,
  SOCIAL_GROUP_STATUS,
  VISIBILITY,
  isPubliclyListable
} = domain;

const idGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);

const SEARCH_DOC_TYPES = Object.freeze([
  "story",
  "vent",
  "news",
  "insider_summary",
  "company",
  "profession",
  "group",
  "resource",
  "region"
]);

const ENTITY_PAGE_TYPES = Object.freeze(["company", "profession", "region"]);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_OFFSET = 5000;
const MAX_QUERY_LEN = 200;
const MAX_TYPES = 12;

/** Evidence and other non-public surfaces — hard-excluded from search. */
const FORBIDDEN_SEARCH_TYPES = Object.freeze([
  "evidence",
  "moderation_case",
  "appeal",
  "notification",
  "sanction",
  "anonymous_inbox",
  "takedown_request",
  "news_submission"
]);

// ── In-memory stores (dev without DATABASE_URL) ─────────────────────────────

const memory = {
  savedSearches: new Map(),
  documents: new Map()
};

function memoryReset() {
  memory.savedSearches.clear();
  memory.documents.clear();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function usePg(options = {}) {
  return Boolean(options.usePostgres && options.getPool);
}

function getPoolOrThrow(options) {
  const pool = options.getPool?.();
  if (!pool) throw new Error("search requires getPool when usePostgres is true");
  return pool;
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(n), 1), MAX_LIMIT);
}

function clampOffset(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), MAX_OFFSET);
}

function sanitizeQuery(q) {
  if (q == null) return "";
  return String(q)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY_LEN);
}

function parseTypes(raw) {
  if (!raw) return [...SEARCH_DOC_TYPES];
  let list = raw;
  if (typeof raw === "string") {
    list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(list)) return [...SEARCH_DOC_TYPES];
  const out = [];
  for (const t of list.slice(0, MAX_TYPES)) {
    const type = String(t).toLowerCase().trim();
    if (FORBIDDEN_SEARCH_TYPES.includes(type)) continue;
    if (SEARCH_DOC_TYPES.includes(type) && !out.includes(type)) out.push(type);
  }
  return out.length ? out : [...SEARCH_DOC_TYPES];
}

function titleFromNews(item) {
  if (!item) return "";
  if (typeof item.title === "string") return item.title;
  if (item.title && typeof item.title === "object") {
    return item.title.en || Object.values(item.title).find(Boolean) || "";
  }
  return "";
}

/**
 * Relevance score: phrase > token coverage > recency bump.
 * Higher is better. Returns 0 if no match.
 */
function scoreMatch(doc, qLower, tokens) {
  if (!qLower) return 0;
  const title = String(doc.title || "").toLowerCase();
  const body = String(doc.body || "").toLowerCase();
  const company = String(doc.company || "").toLowerCase();
  const profession = String(doc.profession || "").toLowerCase();
  const slug = String(doc.slug || "").toLowerCase();
  const region = String(doc.region || "").toLowerCase();
  const hay = `${title} ${body} ${company} ${profession} ${slug} ${region}`;

  if (!hay.includes(qLower) && !tokens.some((t) => hay.includes(t))) {
    return 0;
  }

  let score = 0;
  if (title === qLower || slug === qLower || company === qLower || profession === qLower) {
    score += 100;
  }
  if (title.includes(qLower)) score += 40;
  if (company.includes(qLower) || profession.includes(qLower)) score += 30;
  if (slug.includes(qLower)) score += 25;
  if (body.includes(qLower)) score += 15;
  if (region.includes(qLower)) score += 10;

  for (const t of tokens) {
    if (title.includes(t)) score += 8;
    else if (company.includes(t) || profession.includes(t)) score += 6;
    else if (body.includes(t) || slug.includes(t) || region.includes(t)) score += 3;
  }

  if (doc.publishedAt) {
    const ageDays = Math.max(0, (Date.now() - new Date(doc.publishedAt).getTime()) / 86400000);
    score += Math.max(0, 10 - Math.min(10, ageDays / 30));
  }

  return score;
}

function toResultHit(doc, score) {
  return {
    id: doc.sourceId || doc.id,
    type: doc.docType,
    title: doc.title || "",
    snippet: String(doc.body || "").slice(0, 240),
    company: doc.company || undefined,
    profession: doc.profession || undefined,
    region: doc.region || undefined,
    language: doc.language || undefined,
    slug: doc.slug || undefined,
    href: doc.urlPath || undefined,
    publishedAt: doc.publishedAt || null,
    score: Number(score.toFixed(2)),
    metadata: doc.metadata && Object.keys(doc.metadata).length ? doc.metadata : undefined
  };
}

// ── Document builders (from live sources) ───────────────────────────────────

function storyToDoc(story) {
  if (!story || !isPubliclyListable(ENTITY.STORY, story.status || STORY_STATUS.PUBLISHED)) {
    return null;
  }
  if (story.status !== STORY_STATUS.PUBLISHED) return null;
  const visibility = story.visibility || VISIBILITY.PUBLIC;
  if (visibility !== VISIBILITY.PUBLIC && visibility !== VISIBILITY.COMMUNITY) return null;
  const company = story.company || "";
  const profession = story.profession || "";
  return {
    id: `story:${story.id}`,
    docType: "story",
    sourceId: story.id,
    title: `${profession || "Worker"} at ${company || "Undisclosed"}`.trim(),
    body: [story.reason, story.story].filter(Boolean).join(" ").slice(0, 2000),
    company,
    profession,
    region: story.country || "global",
    language: story.language || "en",
    status: story.status,
    visibility,
    authorId: story.submittedBy || story.userId || story.createdBy || null,
    slug: slugify(company) || story.id,
    urlPath: `/story/${story.id}`,
    publishedAt: story.createdAt || null,
    metadata: { foundNewJob: Boolean(story.foundNewJob) }
  };
}

function ventToDoc(vent, { includeCommunity = false } = {}) {
  if (!vent || vent.status !== VENT_STATUS.PUBLISHED) return null;
  const visibility = vent.visibility || VISIBILITY.COMMUNITY;
  if (visibility === VISIBILITY.PUBLIC) {
    /* ok for everyone */
  } else if (visibility === VISIBILITY.COMMUNITY && includeCommunity) {
    /* ok for signed-in */
  } else {
    return null;
  }
  return {
    id: `vent:${vent.id}`,
    docType: "vent",
    sourceId: vent.id,
    title: vent.title || "Community vent",
    body: String(vent.body || "").slice(0, 2000),
    company: vent.company || "",
    profession: "",
    region: vent.country || "global",
    language: vent.language || "en",
    status: vent.status,
    visibility,
    authorId: vent.submittedBy || vent.createdBy || null,
    slug: vent.id,
    urlPath: `/vents/${vent.id}`,
    publishedAt: vent.createdAt || null,
    metadata: { desiredResponse: vent.desiredResponse || "empathy" }
  };
}

function newsToDoc(item) {
  if (!item || item.status !== NEWS_STATUS.PUBLISHED) return null;
  if (item.mergedIntoId) return null;
  const title = titleFromNews(item);
  const companies = Array.isArray(item.companies) ? item.companies : [];
  const professions = Array.isArray(item.professions) ? item.professions : [];
  return {
    id: `news:${item.id}`,
    docType: "news",
    sourceId: item.id,
    title: title || item.source || "News",
    body: String(item.summary || "").slice(0, 2000),
    company: companies[0] || "",
    profession: professions[0] || "",
    region: item.region || "global",
    language: item.language || "en",
    status: item.status,
    visibility: VISIBILITY.PUBLIC,
    authorId: null,
    slug: item.id,
    urlPath: `/news/${item.id}`,
    publishedAt: item.publishedAt || item.discoveredAt || null,
    metadata: {
      source: item.source || "",
      companies,
      professions,
      url: item.url || item.canonicalUrl || ""
    }
  };
}

function insiderToDoc(signal) {
  if (!signal) return null;
  const status = signal.status || "";
  if (status !== INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY && !isPubliclyListable(ENTITY.INSIDER_SIGNAL, status)) {
    return null;
  }
  // Only public summary fields — never evidence / restricted body / author
  const summary = signal.summary || signal.summaryPublic || "";
  const companyName = signal.companyName || signal.company || "";
  const companySlug = signal.companySlug || slugify(companyName);
  return {
    id: `insider_summary:${signal.id}`,
    docType: "insider_summary",
    sourceId: signal.id,
    title: companyName ? `Insider summary: ${companyName}` : "Insider summary",
    body: String(summary).slice(0, 2000),
    company: companyName,
    profession: Array.isArray(signal.rolesAffected) ? signal.rolesAffected[0] || "" : "",
    region: "global",
    language: "en",
    status: INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY,
    visibility: VISIBILITY.PUBLIC,
    authorId: null,
    slug: companySlug || signal.id,
    urlPath: `/signals/${signal.id}`,
    publishedAt: signal.publishedAt || null,
    metadata: {
      verificationLevel: signal.verificationLevel || "uncorroborated",
      automationType: signal.automationType || "",
      linkedReportCount: Number(signal.linkedReportCount || 0)
    }
  };
}

function resourceToDoc(resource) {
  if (!resource || !isPubliclyListable(ENTITY.RESOURCE, resource.status || RESOURCE_STATUS.PUBLISHED)) {
    return null;
  }
  if (resource.status !== RESOURCE_STATUS.PUBLISHED) return null;
  return {
    id: `resource:${resource.id}`,
    docType: "resource",
    sourceId: resource.id,
    title: resource.title || "Resource",
    body: String(resource.summary || resource.description || "").slice(0, 2000),
    company: resource.provider || "",
    profession: resource.profession || "",
    region: resource.region || resource.country || "global",
    language: resource.language || "en",
    status: resource.status,
    visibility: VISIBILITY.PUBLIC,
    authorId: null,
    slug: resource.id,
    urlPath: `/resources#${resource.id}`,
    publishedAt: resource.createdAt || resource.lastVerifiedAt || null,
    metadata: {
      cost: resource.cost || "free",
      verificationState: resource.verificationState || "unverified",
      url: resource.url || ""
    }
  };
}

function groupToDoc(group) {
  if (!group || group.status !== SOCIAL_GROUP_STATUS.OPEN) return null;
  return {
    id: `group:${group.id}`,
    docType: "group",
    sourceId: group.id,
    title: group.name || "Group",
    body: String(group.description || "").slice(0, 2000),
    company: "",
    profession: group.profession || "",
    region: group.region || "global",
    language: "en",
    status: group.status,
    visibility: VISIBILITY.PUBLIC,
    authorId: group.createdBy || null,
    slug: group.slug || slugify(group.name) || group.id,
    urlPath: `/groups/${group.slug || group.id}`,
    publishedAt: group.createdAt || null,
    metadata: {
      type: group.type || "interest",
      memberCount: Number(group.memberCount || group.member_count || 0)
    }
  };
}

function companyEntityDoc(name, stats = {}) {
  const slug = slugify(name);
  if (!slug) return null;
  return {
    id: `company:${slug}`,
    docType: "company",
    sourceId: slug,
    title: name,
    body: `${stats.storiesCount || 0} published stories`,
    company: name,
    profession: "",
    region: stats.region || "global",
    language: "en",
    status: "published",
    visibility: VISIBILITY.PUBLIC,
    authorId: null,
    slug,
    urlPath: `/entity/company/${slug}`,
    publishedAt: stats.latestAt || null,
    metadata: { storiesCount: Number(stats.storiesCount || 0) }
  };
}

function professionEntityDoc(name, stats = {}) {
  const slug = slugify(name);
  if (!slug) return null;
  return {
    id: `profession:${slug}`,
    docType: "profession",
    sourceId: slug,
    title: name,
    body: `${stats.storiesCount || 0} published stories`,
    company: "",
    profession: name,
    region: stats.region || "global",
    language: "en",
    status: "published",
    visibility: VISIBILITY.PUBLIC,
    authorId: null,
    slug,
    urlPath: `/entity/profession/${slug}`,
    publishedAt: stats.latestAt || null,
    metadata: { storiesCount: Number(stats.storiesCount || 0) }
  };
}

function regionEntityDoc(code, stats = {}) {
  const slug = slugify(code) || "global";
  return {
    id: `region:${slug}`,
    docType: "region",
    sourceId: slug,
    title: String(code || "global").toUpperCase(),
    body: `${stats.storiesCount || 0} published stories in region`,
    company: "",
    profession: "",
    region: slug,
    language: "en",
    status: "published",
    visibility: VISIBILITY.PUBLIC,
    authorId: null,
    slug,
    urlPath: `/entity/region/${slug}`,
    publishedAt: stats.latestAt || null,
    metadata: { storiesCount: Number(stats.storiesCount || 0) }
  };
}

// ── Collect documents from ctx / options ────────────────────────────────────

/**
 * Build a live document corpus from storage adapters.
 * options.ctx — app context with storage* helpers
 * options.sources — optional preloaded arrays for tests
 */
async function collectDocuments(options = {}) {
  const includeCommunity = Boolean(options.includeCommunity);
  const docs = [];
  const sources = options.sources || {};
  const ctx = options.ctx;

  let stories = sources.stories;
  if (!stories && ctx?.storageGetStories) {
    stories = await ctx.storageGetStories();
  }
  stories = Array.isArray(stories) ? stories : [];

  let vents = sources.vents;
  if (!vents && ctx?.storageGetVents) {
    vents = await ctx.storageGetVents();
  }
  vents = Array.isArray(vents) ? vents : [];

  let news = sources.news;
  if (!news && ctx?.storageGetNews) {
    news = await ctx.storageGetNews({ country: "global", limit: 100, status: NEWS_STATUS.PUBLISHED });
  }
  news = Array.isArray(news) ? news : [];

  let resources = sources.resources;
  if (!resources && ctx?.storageGetResources) {
    resources = await ctx.storageGetResources({ includeNonPublic: false });
  }
  resources = Array.isArray(resources) ? resources : [];

  let groups = sources.groups;
  if (!groups) {
    try {
      const social = options.social || require("./social");
      groups = await social.listGroups({ status: SOCIAL_GROUP_STATUS.OPEN }, {
        usePostgres: options.usePostgres,
        getPool: options.getPool,
        useMemory: !options.usePostgres || options.useMemory
      });
    } catch (_e) {
      groups = [];
    }
  }
  groups = Array.isArray(groups) ? groups : [];

  let insiderSignals = sources.insiderSignals;
  if (!insiderSignals) {
    try {
      const insider = options.insider || require("./insider");
      const listed = await insider.listPublicSummaries(
        { limit: 100, offset: 0 },
        {
          usePostgres: options.usePostgres,
          getPool: options.getPool,
          useMemory: !options.usePostgres || options.useMemory
        }
      );
      insiderSignals = listed.signals || [];
    } catch (_e) {
      insiderSignals = [];
    }
  }
  insiderSignals = Array.isArray(insiderSignals) ? insiderSignals : [];

  for (const s of stories) {
    const d = storyToDoc(s);
    if (d) docs.push(d);
  }
  for (const v of vents) {
    const d = ventToDoc(v, { includeCommunity });
    if (d) docs.push(d);
  }
  for (const n of news) {
    const d = newsToDoc(n);
    if (d) docs.push(d);
  }
  for (const r of resources) {
    const d = resourceToDoc(r);
    if (d) docs.push(d);
  }
  for (const g of groups) {
    const d = groupToDoc(g);
    if (d) docs.push(d);
  }
  for (const sig of insiderSignals) {
    const d = insiderToDoc(sig);
    if (d) docs.push(d);
  }

  // Entity facets derived from published stories (no fabrication beyond real aggregates)
  const companyMap = new Map();
  const professionMap = new Map();
  const regionMap = new Map();
  for (const s of stories) {
    if (s.status !== STORY_STATUS.PUBLISHED) continue;
    if (s.company) {
      const key = s.company;
      const cur = companyMap.get(key) || { storiesCount: 0, latestAt: null, region: s.country || "global" };
      cur.storiesCount += 1;
      if (!cur.latestAt || new Date(s.createdAt) > new Date(cur.latestAt)) cur.latestAt = s.createdAt;
      companyMap.set(key, cur);
    }
    if (s.profession) {
      const key = s.profession;
      const cur = professionMap.get(key) || { storiesCount: 0, latestAt: null };
      cur.storiesCount += 1;
      if (!cur.latestAt || new Date(s.createdAt) > new Date(cur.latestAt)) cur.latestAt = s.createdAt;
      professionMap.set(key, cur);
    }
    const region = s.country || "global";
    const curR = regionMap.get(region) || { storiesCount: 0, latestAt: null };
    curR.storiesCount += 1;
    if (!curR.latestAt || new Date(s.createdAt) > new Date(curR.latestAt)) curR.latestAt = s.createdAt;
    regionMap.set(region, curR);
  }
  for (const [name, stats] of companyMap) {
    const d = companyEntityDoc(name, stats);
    if (d) docs.push(d);
  }
  for (const [name, stats] of professionMap) {
    const d = professionEntityDoc(name, stats);
    if (d) docs.push(d);
  }
  for (const [code, stats] of regionMap) {
    docs.push(regionEntityDoc(code, stats));
  }

  return docs;
}

async function filterBlocked(docs, viewerId, options = {}) {
  if (!viewerId) return docs;
  try {
    const social = options.social || require("./social");
    return await social.filterBlockedAuthors(
      viewerId,
      docs,
      "authorId",
      {
        usePostgres: options.usePostgres,
        getPool: options.getPool,
        useMemory: !options.usePostgres || options.useMemory
      }
    );
  } catch (_e) {
    return docs;
  }
}

// ── PG FTS path (optional; falls back to live collect) ──────────────────────

async function searchPostgresFts(query, types, filters, options = {}) {
  const pool = getPoolOrThrow(options);
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const q = sanitizeQuery(query);
  if (!q) {
    return { results: [], total: 0, limit: 0, offset, emptyQuery: true };
  }

  // Prefer FTS if table has rows; otherwise caller falls back
  const countRes = await pool.query("SELECT COUNT(*)::int AS n FROM search_documents;");
  if (!countRes.rows[0] || countRes.rows[0].n === 0) {
    return null; // signal fallback
  }

  const params = [];
  const clauses = ["status IN ('published', 'open', 'published_summary')"];
  // Visibility: public always; community only when viewer present
  if (options.includeCommunity) {
    clauses.push("visibility IN ('public', 'community')");
  } else {
    clauses.push("visibility = 'public'");
  }

  params.push(types);
  clauses.push(`doc_type = ANY($${params.length}::text[])`);

  // Hard exclude evidence-like types (defense in depth)
  clauses.push("doc_type <> 'evidence'");

  if (filters.country && filters.country !== "global") {
    params.push(filters.country);
    clauses.push(`(region = $${params.length} OR region = 'global')`);
  }
  if (filters.company) {
    params.push(`%${filters.company.toLowerCase()}%`);
    clauses.push(`lower(company) LIKE $${params.length}`);
  }
  if (filters.profession) {
    params.push(`%${filters.profession.toLowerCase()}%`);
    clauses.push(`lower(profession) LIKE $${params.length}`);
  }

  params.push(q);
  const qParam = params.length;
  clauses.push(`(
    search_vector @@ plainto_tsquery('english', $${qParam})
    OR lower(title) LIKE '%' || lower($${qParam}) || '%'
    OR lower(body) LIKE '%' || lower($${qParam}) || '%'
    OR lower(company) LIKE '%' || lower($${qParam}) || '%'
    OR lower(profession) LIKE '%' || lower($${qParam}) || '%'
  )`);

  const where = clauses.join(" AND ");
  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const sql = `
    SELECT id, doc_type, source_id, title, body, company, profession, region,
           language, status, visibility, author_id, slug, url_path, published_at, metadata,
           ts_rank_cd(search_vector, plainto_tsquery('english', $${qParam})) AS rank
    FROM search_documents
    WHERE ${where}
    ORDER BY rank DESC NULLS LAST, published_at DESC NULLS LAST
    LIMIT $${limitParam} OFFSET $${offsetParam};
  `;
  const countSql = `SELECT COUNT(*)::int AS n FROM search_documents WHERE ${where};`;
  const countParams = params.slice(0, qParam);

  const [rowsRes, totalRes] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, countParams)
  ]);

  let docs = rowsRes.rows.map((row) => ({
    id: row.id,
    docType: row.doc_type,
    sourceId: row.source_id,
    title: row.title,
    body: row.body,
    company: row.company,
    profession: row.profession,
    region: row.region,
    language: row.language,
    status: row.status,
    visibility: row.visibility,
    authorId: row.author_id,
    slug: row.slug,
    urlPath: row.url_path,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {},
    _rank: Number(row.rank || 0)
  }));

  docs = await filterBlocked(docs, options.viewerId, options);
  const hits = docs.map((doc) => toResultHit(doc, (doc._rank || 0) * 100 + 1));

  return {
    results: hits,
    total: totalRes.rows[0]?.n || hits.length,
    limit,
    offset,
    emptyQuery: false
  };
}

// ── Public search API ───────────────────────────────────────────────────────

/**
 * Unified search across indexed public surfaces.
 *
 * @param {object} query
 * @param {string} query.q
 * @param {string[]|string} [query.types]
 * @param {number} [query.limit]
 * @param {number} [query.offset]
 * @param {string} [query.country]
 * @param {string} [query.company]
 * @param {string} [query.profession]
 * @param {string} [query.viewerId]
 * @param {boolean} [query.includeCommunity]
 * @param {object} options — storage options + ctx + sources
 */
async function search(query = {}, options = {}) {
  const q = sanitizeQuery(query.q || query.query || "");
  const limit = clampLimit(query.limit ?? options.limit);
  const offset = clampOffset(query.offset ?? options.offset);
  const types = parseTypes(query.types || query.type);
  const filters = {
    country: query.country ? String(query.country).toLowerCase() : "global",
    company: query.company ? String(query.company).trim() : "",
    profession: query.profession ? String(query.profession).trim() : ""
  };
  const includeCommunity = Boolean(query.includeCommunity || options.includeCommunity);
  const viewerId = query.viewerId || options.viewerId || null;

  // Empty query: no fabricated results
  if (!q) {
    return {
      q: "",
      results: [],
      total: 0,
      limit,
      offset,
      types,
      filters,
      emptyQuery: true,
      empty: true,
      message: "Enter a search query to find stories, news, companies, and more."
    };
  }

  // Reject if caller asked only for forbidden types
  const rawTypes = query.types || query.type;
  if (rawTypes) {
    const requested = (Array.isArray(rawTypes) ? rawTypes : String(rawTypes).split(","))
      .map((t) => String(t).toLowerCase().trim())
      .filter(Boolean);
    if (requested.length && requested.every((t) => FORBIDDEN_SEARCH_TYPES.includes(t))) {
      return {
        q,
        results: [],
        total: 0,
        limit,
        offset,
        types: [],
        filters,
        emptyQuery: false,
        empty: true,
        forbidden: true,
        message: "Requested types are not searchable."
      };
    }
  }

  const searchOpts = {
    ...options,
    limit,
    offset,
    includeCommunity,
    viewerId
  };

  if (usePg(options) && !options.forceMemory) {
    try {
      const fts = await searchPostgresFts(q, types, filters, searchOpts);
      if (fts) {
        return {
          q,
          ...fts,
          types,
          filters,
          empty: fts.total === 0,
          message: fts.total === 0 ? "No results found." : undefined
        };
      }
    } catch (_e) {
      // fall through to live collect
    }
  }

  let docs = await collectDocuments({
    ...options,
    includeCommunity
  });

  // Type filter
  docs = docs.filter((d) => types.includes(d.docType));

  // Region / company / profession filters
  if (filters.country && filters.country !== "global") {
    docs = docs.filter(
      (d) => d.region === filters.country || d.region === "global" || d.docType === "region"
    );
  }
  if (filters.company) {
    const c = filters.company.toLowerCase();
    docs = docs.filter(
      (d) =>
        String(d.company).toLowerCase().includes(c) ||
        (d.docType === "company" && String(d.title).toLowerCase().includes(c))
    );
  }
  if (filters.profession) {
    const p = filters.profession.toLowerCase();
    docs = docs.filter(
      (d) =>
        String(d.profession).toLowerCase().includes(p) ||
        (d.docType === "profession" && String(d.title).toLowerCase().includes(p))
    );
  }

  // Block filter (permission-aware)
  docs = await filterBlocked(docs, viewerId, options);

  // Score + match
  const qLower = q.toLowerCase();
  const tokens = qLower.split(/\s+/).filter((t) => t.length >= 2);
  const scored = [];
  for (const doc of docs) {
    // Hard ban evidence-shaped docs
    if (doc.docType === "evidence" || FORBIDDEN_SEARCH_TYPES.includes(doc.docType)) continue;
    const score = scoreMatch(doc, qLower, tokens);
    if (score > 0) scored.push({ doc, score });
  }
  scored.sort((a, b) => b.score - a.score || String(b.doc.publishedAt || "").localeCompare(String(a.doc.publishedAt || "")));

  const total = scored.length;
  const page = scored.slice(offset, offset + limit).map(({ doc, score }) => toResultHit(doc, score));

  return {
    q,
    results: page,
    total,
    limit,
    offset,
    types,
    filters,
    emptyQuery: false,
    empty: total === 0,
    message: total === 0 ? "No results found." : undefined
  };
}

// ── Entity pages ────────────────────────────────────────────────────────────

/**
 * Company / profession / regional entity page with filters.
 * Returns aggregates from real data only — empty state when nothing matches.
 */
async function getEntityPage(type, slug, filters = {}, options = {}) {
  const entityType = String(type || "").toLowerCase();
  const entitySlug = slugify(slug);
  if (!ENTITY_PAGE_TYPES.includes(entityType) || !entitySlug) {
    return { ok: false, reason: "invalid_entity", entity: null };
  }

  const country = filters.country ? String(filters.country).toLowerCase() : "global";
  const q = sanitizeQuery(filters.q || "");
  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);
  const includeCommunity = Boolean(filters.includeCommunity || options.includeCommunity);

  const docs = await collectDocuments({ ...options, includeCommunity });
  const stories = docs.filter((d) => d.docType === "story");
  const news = docs.filter((d) => d.docType === "news");
  const insiders = docs.filter((d) => d.docType === "insider_summary");
  const groups = docs.filter((d) => d.docType === "group");
  const resources = docs.filter((d) => d.docType === "resource");

  function matchesEntity(doc) {
    if (entityType === "company") {
      return slugify(doc.company) === entitySlug || (doc.docType === "company" && doc.slug === entitySlug);
    }
    if (entityType === "profession") {
      return slugify(doc.profession) === entitySlug || (doc.docType === "profession" && doc.slug === entitySlug);
    }
    // region
    return doc.region === entitySlug || (doc.docType === "region" && doc.slug === entitySlug);
  }

  let relatedStories = stories.filter(matchesEntity);
  let relatedNews = news.filter(matchesEntity);
  let relatedInsiders = insiders.filter(matchesEntity);
  let relatedGroups = groups.filter(matchesEntity);
  let relatedResources = resources.filter(matchesEntity);

  if (country !== "global") {
    const inCountry = (d) => d.region === country || d.region === "global";
    relatedStories = relatedStories.filter(inCountry);
    relatedNews = relatedNews.filter(inCountry);
    relatedGroups = relatedGroups.filter(inCountry);
    relatedResources = relatedResources.filter(inCountry);
  }

  if (q) {
    const qLower = q.toLowerCase();
    const tokens = qLower.split(/\s+/).filter((t) => t.length >= 2);
    const matchQ = (d) => scoreMatch(d, qLower, tokens) > 0;
    relatedStories = relatedStories.filter(matchQ);
    relatedNews = relatedNews.filter(matchQ);
    relatedInsiders = relatedInsiders.filter(matchQ);
    relatedGroups = relatedGroups.filter(matchQ);
    relatedResources = relatedResources.filter(matchQ);
  }

  const entityDoc = docs.find(
    (d) => d.docType === entityType && d.slug === entitySlug
  );

  const displayName =
    entityDoc?.title ||
    relatedStories[0]?.company ||
    relatedStories[0]?.profession ||
    entitySlug;

  const totalItems =
    relatedStories.length +
    relatedNews.length +
    relatedInsiders.length +
    relatedGroups.length +
    relatedResources.length;

  if (totalItems === 0 && !entityDoc) {
    return {
      ok: true,
      empty: true,
      entity: {
        type: entityType,
        slug: entitySlug,
        name: displayName,
        href: `/entity/${entityType}/${entitySlug}`
      },
      filters: { country, q, limit, offset },
      stories: [],
      news: [],
      insiderSummaries: [],
      groups: [],
      resources: [],
      totals: {
        stories: 0,
        news: 0,
        insiderSummaries: 0,
        groups: 0,
        resources: 0
      },
      message: "No published content for this entity yet."
    };
  }

  const slice = (arr) => arr.slice(offset, offset + limit).map((d) => toResultHit(d, 1));

  return {
    ok: true,
    empty: totalItems === 0,
    entity: {
      type: entityType,
      slug: entitySlug,
      name: entityType === "region" ? entitySlug.toUpperCase() : displayName,
      href: `/entity/${entityType}/${entitySlug}`,
      storiesCount: relatedStories.length
    },
    filters: { country, q, limit, offset },
    stories: slice(relatedStories),
    news: slice(relatedNews),
    insiderSummaries: slice(relatedInsiders),
    groups: slice(relatedGroups),
    resources: slice(relatedResources),
    totals: {
      stories: relatedStories.length,
      news: relatedNews.length,
      insiderSummaries: relatedInsiders.length,
      groups: relatedGroups.length,
      resources: relatedResources.length
    },
    message: totalItems === 0 ? "No published content for this entity yet." : undefined
  };
}

// ── Saved searches ──────────────────────────────────────────────────────────

function mapSavedSearchRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    name: row.name || "",
    query: row.query || "",
    types: Array.isArray(row.types) ? row.types : [],
    filters: typeof row.filters === "string" ? JSON.parse(row.filters) : row.filters || {},
    notify: Boolean(row.notify),
    notifyChannel: row.notify_channel ?? row.notifyChannel ?? "email",
    lastNotifiedAt: row.last_notified_at
      ? new Date(row.last_notified_at).toISOString()
      : row.lastNotifiedAt || null,
    lastResultCount:
      row.last_result_count != null
        ? Number(row.last_result_count)
        : row.lastResultCount != null
          ? Number(row.lastResultCount)
          : null,
    status: row.status || "active",
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : row.createdAt || null,
    updatedAt: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : row.updatedAt || null
  };
}

function publicSavedSearch(row) {
  const s = mapSavedSearchRow(row);
  if (!s || s.status === "deleted") return null;
  return s;
}

async function createSavedSearch(input = {}, options = {}) {
  const userId = input.userId || input.user_id;
  if (!userId) return { ok: false, reason: "auth_required" };
  const query = sanitizeQuery(input.query || input.q || "");
  const name = String(input.name || query || "Saved search").trim().slice(0, 120);
  const types = parseTypes(input.types);
  const filters = {
    country: input.filters?.country || input.country || "global",
    company: input.filters?.company || input.company || "",
    profession: input.filters?.profession || input.profession || ""
  };
  const notify = Boolean(input.notify);
  const notifyChannel = ["email", "telegram", "in_app", "none"].includes(input.notifyChannel)
    ? input.notifyChannel
    : "email";
  const id = `ss_${idGen()}`;
  const now = nowIso();
  const record = {
    id,
    userId,
    name,
    query,
    types,
    filters,
    notify,
    notifyChannel,
    lastNotifiedAt: null,
    lastResultCount: null,
    status: "active",
    createdAt: now,
    updatedAt: now
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO saved_searches (
         id, user_id, name, query, types, filters, notify, notify_channel, status, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,'active',NOW(),NOW())`,
      [id, userId, name, query, types, JSON.stringify(filters), notify, notifyChannel]
    );
    const res = await pool.query("SELECT * FROM saved_searches WHERE id = $1", [id]);
    return { ok: true, savedSearch: publicSavedSearch(res.rows[0]) };
  }

  memory.savedSearches.set(id, record);
  return { ok: true, savedSearch: publicSavedSearch(record) };
}

async function listSavedSearches(userId, options = {}) {
  if (!userId) return [];
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM saved_searches
       WHERE user_id = $1 AND status <> 'deleted'
       ORDER BY updated_at DESC LIMIT 100;`,
      [userId]
    );
    return res.rows.map(publicSavedSearch).filter(Boolean);
  }
  return [...memory.savedSearches.values()]
    .filter((s) => s.userId === userId && s.status !== "deleted")
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(publicSavedSearch)
    .filter(Boolean);
}

async function getSavedSearch(id, userId, options = {}) {
  if (!id) return null;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      "SELECT * FROM saved_searches WHERE id = $1 AND status <> 'deleted' LIMIT 1;",
      [id]
    );
    const row = res.rows[0];
    if (!row) return null;
    if (userId && row.user_id !== userId) return null;
    return publicSavedSearch(row);
  }
  const row = memory.savedSearches.get(id);
  if (!row || row.status === "deleted") return null;
  if (userId && row.userId !== userId) return null;
  return publicSavedSearch(row);
}

async function updateSavedSearch(id, userId, patch = {}, options = {}) {
  const existing = await getSavedSearch(id, userId, options);
  if (!existing) return { ok: false, reason: "not_found" };

  const next = {
    name: patch.name != null ? String(patch.name).trim().slice(0, 120) : existing.name,
    query: patch.query != null || patch.q != null
      ? sanitizeQuery(patch.query ?? patch.q)
      : existing.query,
    types: patch.types != null ? parseTypes(patch.types) : existing.types,
    filters: {
      ...existing.filters,
      ...(patch.filters || {}),
      ...(patch.country != null ? { country: patch.country } : {}),
      ...(patch.company != null ? { company: patch.company } : {}),
      ...(patch.profession != null ? { profession: patch.profession } : {})
    },
    notify: patch.notify != null ? Boolean(patch.notify) : existing.notify,
    notifyChannel:
      patch.notifyChannel && ["email", "telegram", "in_app", "none"].includes(patch.notifyChannel)
        ? patch.notifyChannel
        : existing.notifyChannel,
    status: patch.status === "paused" || patch.status === "active" ? patch.status : existing.status
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE saved_searches SET
         name = $2, query = $3, types = $4::text[], filters = $5::jsonb,
         notify = $6, notify_channel = $7, status = $8, updated_at = NOW()
       WHERE id = $1 AND user_id = $9;`,
      [
        id,
        next.name,
        next.query,
        next.types,
        JSON.stringify(next.filters),
        next.notify,
        next.notifyChannel,
        next.status,
        userId
      ]
    );
    const updated = await getSavedSearch(id, userId, options);
    return { ok: true, savedSearch: updated };
  }

  const mem = memory.savedSearches.get(id);
  Object.assign(mem, next, { updatedAt: nowIso() });
  return { ok: true, savedSearch: publicSavedSearch(mem) };
}

async function deleteSavedSearch(id, userId, options = {}) {
  const existing = await getSavedSearch(id, userId, options);
  if (!existing) return { ok: false, reason: "not_found" };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE saved_searches SET status = 'deleted', notify = FALSE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2;`,
      [id, userId]
    );
    return { ok: true, deleted: true };
  }

  const mem = memory.savedSearches.get(id);
  mem.status = "deleted";
  mem.notify = false;
  mem.updatedAt = nowIso();
  return { ok: true, deleted: true };
}

/**
 * Enable notifications for a saved search and enqueue a job stub.
 * Full delivery can land later; enqueue is enough for the AC.
 */
async function enableSavedSearchNotifications(id, userId, options = {}) {
  const updated = await updateSavedSearch(id, userId, { notify: true, status: "active" }, options);
  if (!updated.ok) return updated;

  let jobId = null;
  try {
    const jobs = options.jobs || require("./jobs");
    const enqueued = await jobs.enqueue(
      {
        type: "search.notify",
        payload: {
          savedSearchId: id,
          userId,
          query: updated.savedSearch.query,
          types: updated.savedSearch.types,
          filters: updated.savedSearch.filters
        },
        idempotencyKey: `search-notify-enable:${id}:${Date.now()}`
      },
      {
        usePostgres: options.usePostgres,
        getPool: options.getPool,
        useMemory: options.useMemory === true || !options.usePostgres
      }
    );
    // jobs.enqueue returns { job, created }
    jobId = enqueued?.job?.id || enqueued?.id || null;
  } catch (_e) {
    // enqueue failure must not block saving notify flag
  }

  return { ok: true, savedSearch: updated.savedSearch, jobId, enqueued: Boolean(jobId) };
}

/**
 * Run notification check for one saved search (job handler body).
 * Stub: re-runs search, records count, does not send real email.
 */
async function runSavedSearchNotify(payload = {}, options = {}) {
  const savedSearchId = payload.savedSearchId || payload.saved_search_id;
  const userId = payload.userId || payload.user_id;
  if (!savedSearchId) {
    return { ok: false, reason: "missing_saved_search_id", stub: true };
  }

  const ss = await getSavedSearch(savedSearchId, userId || null, options);
  if (!ss || !ss.notify) {
    return { ok: false, reason: "not_found_or_notify_off", stub: true };
  }

  const result = await search(
    {
      q: ss.query,
      types: ss.types,
      country: ss.filters?.country,
      company: ss.filters?.company,
      profession: ss.filters?.profession,
      limit: 10,
      offset: 0,
      viewerId: ss.userId,
      includeCommunity: true
    },
    options
  );

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE saved_searches SET last_notified_at = NOW(), last_result_count = $2, updated_at = NOW()
       WHERE id = $1;`,
      [savedSearchId, result.total]
    );
  } else {
    const mem = memory.savedSearches.get(savedSearchId);
    if (mem) {
      mem.lastNotifiedAt = nowIso();
      mem.lastResultCount = result.total;
      mem.updatedAt = nowIso();
    }
  }

  return {
    ok: true,
    stub: true,
    savedSearchId,
    resultCount: result.total,
    delivered: false,
    reason: "notification delivery stub — search re-run recorded",
    at: nowIso()
  };
}

// ── Upsert helpers for index maintenance (optional callers) ─────────────────

async function upsertSearchDocument(doc, options = {}) {
  if (!doc || !doc.docType || !doc.sourceId) return { ok: false };
  if (FORBIDDEN_SEARCH_TYPES.includes(doc.docType) || doc.docType === "evidence") {
    return { ok: false, reason: "forbidden_type" };
  }
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO search_documents (
         id, doc_type, source_id, title, body, company, profession, region, language,
         status, visibility, author_id, slug, url_path, published_at, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       ON CONFLICT (doc_type, source_id) DO UPDATE SET
         title = EXCLUDED.title,
         body = EXCLUDED.body,
         company = EXCLUDED.company,
         profession = EXCLUDED.profession,
         region = EXCLUDED.region,
         language = EXCLUDED.language,
         status = EXCLUDED.status,
         visibility = EXCLUDED.visibility,
         author_id = EXCLUDED.author_id,
         slug = EXCLUDED.slug,
         url_path = EXCLUDED.url_path,
         published_at = EXCLUDED.published_at,
         metadata = EXCLUDED.metadata,
         updated_at = NOW();`,
      [
        doc.id || `${doc.docType}:${doc.sourceId}`,
        doc.docType,
        doc.sourceId,
        doc.title || "",
        doc.body || "",
        doc.company || "",
        doc.profession || "",
        doc.region || "global",
        doc.language || "en",
        doc.status || "published",
        doc.visibility || "public",
        doc.authorId || null,
        doc.slug || "",
        doc.urlPath || "",
        doc.publishedAt || null,
        JSON.stringify(doc.metadata || {})
      ]
    );
    return { ok: true };
  }
  memory.documents.set(doc.id || `${doc.docType}:${doc.sourceId}`, doc);
  return { ok: true };
}

module.exports = {
  SEARCH_DOC_TYPES,
  ENTITY_PAGE_TYPES,
  FORBIDDEN_SEARCH_TYPES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,

  memoryReset,
  sanitizeQuery,
  parseTypes,
  clampLimit,
  clampOffset,
  slugify,
  scoreMatch,

  storyToDoc,
  ventToDoc,
  newsToDoc,
  insiderToDoc,
  resourceToDoc,
  groupToDoc,

  collectDocuments,
  search,
  getEntityPage,

  createSavedSearch,
  listSavedSearches,
  getSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  enableSavedSearchNotifications,
  runSavedSearchNotify,
  upsertSearchDocument,

  // test helpers
  _memory: memory
};
