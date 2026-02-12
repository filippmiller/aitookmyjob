const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const express = require("express");
const dotenv = require("dotenv");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { customAlphabet } = require("nanoid");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8080);
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const storiesPath = path.join(dataDir, "stories.json");
const usersPath = path.join(dataDir, "users.json");
const forumTopicsPath = path.join(dataDir, "forum-topics.json");
const forumRepliesPath = path.join(dataDir, "forum-replies.json");
const sanctionsPath = path.join(dataDir, "sanctions.json");
const auditLogPath = path.join(dataDir, "audit-log.json");
const authIdentitiesPath = path.join(dataDir, "auth-identities.json");
const storyVersionsPath = path.join(dataDir, "story-versions.json");
const telegramLinksPath = path.join(dataDir, "telegram-links.json");
const transparencyEventsPath = path.join(dataDir, "transparency-events.json");
const resourcesPath = path.join(dataDir, "resources.json");
const newsPath = path.join(dataDir, "news.json");
const takedownsPath = path.join(dataDir, "takedowns.json");
const companyBoardsPath = path.join(dataDir, "company-boards.json");
const petitionsPath = path.join(dataDir, "petitions.json");
const cohortsPath = path.join(dataDir, "cohorts.json");
const anonymousInboxPath = path.join(dataDir, "anonymous-inbox.json");

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-me-admin-token";
const DATABASE_URL = process.env.DATABASE_URL || "";
const PG_SSL = String(process.env.PG_SSL || "false").toLowerCase() === "true";
const AUTH_SECRET = process.env.AUTH_SECRET || "change-me-auth-secret";
const ALLOW_DEV_OTP = String(process.env.ALLOW_DEV_OTP || (process.env.NODE_ENV === "production" ? "false" : "true")).toLowerCase() === "true";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_MOD_CHAT_ID = process.env.TELEGRAM_MOD_CHAT_ID || "";
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const REQUIRE_CAPTCHA = String(process.env.REQUIRE_CAPTCHA || "false").toLowerCase() === "true";
const isProduction = process.env.NODE_ENV === "production";
// HSTS can brick environments with invalid/self-signed certs; make it explicit opt-in.
const ENABLE_HSTS = String(process.env.ENABLE_HSTS || "false").toLowerCase() === "true";
const REQUIRE_STRICT_SECRETS = String(process.env.REQUIRE_STRICT_SECRETS || (isProduction ? "true" : "false")).toLowerCase() === "true";
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 24 * 7);
const defaultCountry = (process.env.DEFAULT_COUNTRY || "global").toLowerCase();
const defaultLang = (process.env.DEFAULT_LANG || "en").toLowerCase();
const rawOrigins = (process.env.CORS_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
const storyId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 12);
const userId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const topicId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const replyId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const sanctionId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const auditId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const phoneOtpCode = customAlphabet("0123456789", 6);
const linkCodeId = customAlphabet("1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", 8);
const usePostgres = Boolean(DATABASE_URL);
let pgPool = null;

const languages = ["en", "ru", "de", "fr", "es"];
const countries = [
  { code: "global", name: "Global", region: "Global" },
  { code: "us", name: "United States", region: "North America" },
  { code: "de", name: "Germany", region: "Europe" },
  { code: "fr", name: "France", region: "Europe" },
  { code: "es", name: "Spain", region: "Europe" },
  { code: "ru", name: "Russia", region: "Europe/Asia" },
  { code: "gb", name: "United Kingdom", region: "Europe" },
  { code: "ca", name: "Canada", region: "North America" },
  { code: "mx", name: "Mexico", region: "North America" },
  { code: "br", name: "Brazil", region: "South America" },
  { code: "ar", name: "Argentina", region: "South America" },
  { code: "in", name: "India", region: "Asia" },
  { code: "jp", name: "Japan", region: "Asia" },
  { code: "kr", name: "South Korea", region: "Asia" },
  { code: "au", name: "Australia", region: "Oceania" },
  { code: "za", name: "South Africa", region: "Africa" },
  { code: "ae", name: "United Arab Emirates", region: "Middle East" },
  { code: "it", name: "Italy", region: "Europe" },
  { code: "nl", name: "Netherlands", region: "Europe" },
  { code: "se", name: "Sweden", region: "Europe" }
];

const roles = [
  "guest",
  "user",
  "verified_user",
  "expert",
  "community_lead",
  "journalist",
  "moderator",
  "admin",
  "superadmin",
  "data_analyst"
];

const forumCategories = [
  { id: "cop", key: "copywriters" },
  { id: "dev", key: "developers-qa" },
  { id: "des", key: "designers-artists" },
  { id: "hr", key: "hr-recruiting" },
  { id: "sup", key: "support-call-centers" },
  { id: "law", key: "legal-rights" },
  { id: "up", key: "reskilling-job-search" },
  { id: "reg", key: "regional-groups" },
  { id: "succ", key: "success-stories" }
];

const forumTopics = [
  { id: "t1", categoryId: "cop", title: "How to pivot from copywriting to UX writing?", replies: 38, lastUpdate: "2026-02-10" },
  { id: "t2", categoryId: "dev", title: "Junior developers: where to get first role in AI-first market", replies: 54, lastUpdate: "2026-02-11" },
  { id: "t3", categoryId: "law", title: "Can my company train model on my work without consent?", replies: 19, lastUpdate: "2026-02-10" },
  { id: "t4", categoryId: "sup", title: "Call-center layoffs: what countries still hire humans", replies: 27, lastUpdate: "2026-02-09" },
  { id: "t5", categoryId: "succ", title: "I found a new role after 6 months — ask me anything", replies: 66, lastUpdate: "2026-02-11" }
];

const defaultResources = [
  {
    id: "res-1",
    type: "reskilling",
    title: "Career Transition Playbook",
    provider: "AI Took My Job",
    region: "global",
    url: "https://example.com/career-transition-playbook",
    summary: "Practical weekly plan to pivot to adjacent roles."
  },
  {
    id: "res-2",
    type: "legal",
    title: "NDA And Layoff Rights Basics",
    provider: "Worker Legal Aid",
    region: "us",
    url: "https://example.com/nda-rights",
    summary: "How to share your story without exposing protected confidential data."
  },
  {
    id: "res-3",
    type: "jobs",
    title: "Human-Centered Roles Board",
    provider: "Community Curated",
    region: "global",
    url: "https://example.com/human-jobs-board",
    summary: "Open positions in customer support, QA, ops, and compliance."
  }
];

const defaultNews = [
  {
    id: "news-1",
    title: "Platform transparency report published",
    source: "AI Took My Job",
    url: "https://example.com/transparency-report",
    publishedAt: "2026-02-10T10:00:00.000Z",
    region: "global"
  },
  {
    id: "news-2",
    title: "Hiring rebounds in support operations after failed chatbot rollout",
    source: "Industry Watch",
    url: "https://example.com/support-hiring-rebound",
    publishedAt: "2026-02-09T14:00:00.000Z",
    region: "us"
  }
];

const defaultCompanyBoards = [
  {
    id: "board-quickhelp-1",
    companySlug: "quickhelp",
    title: "Support team layoffs: appeal and rehiring evidence",
    body: "Collect verifiable reports of post-layoff service quality issues and any rehiring signals.",
    createdBy: "system",
    createdAt: "2026-02-10T09:00:00.000Z"
  }
];

const defaultPetitions = [
  {
    id: "pet-1",
    title: "Require disclosure when companies replace workers with AI",
    description: "Public petition for transparent layoff notices and transition support.",
    goal: 1000,
    signatures: 128,
    status: "open",
    createdAt: "2026-02-09T12:00:00.000Z"
  }
];

const defaultCohorts = [
  {
    id: "cohort-1",
    title: "30-day Support to QA Transition",
    profession: "QA Engineer",
    country: "global",
    capacity: 50,
    enrolled: 12,
    startsAt: "2026-03-01",
    status: "open"
  }
];

const storySchema = z.object({
  name: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(20),
  language: z.enum(languages),
  profession: z.string().trim().min(2).max(80),
  company: z.string().trim().min(1).max(120),
  laidOffAt: z.string().trim().min(4).max(20),
  foundNewJob: z.boolean(),
  reason: z.string().trim().min(8).max(240),
  story: z.string().trim().min(40).max(3000),
  city: z.string().trim().min(1).max(80).optional(),
  tenureYears: z.number().min(0).max(80).optional(),
  salaryBefore: z.number().min(0).max(10000000).optional(),
  salaryAfter: z.number().min(0).max(10000000).optional(),
  layoffType: z.enum(["mass", "individual", "downsizing", "contract_end"]).optional(),
  aiTool: z.string().trim().min(1).max(120).optional(),
  warnedAhead: z.enum(["yes", "no", "partial"]).optional(),
  compensationMonths: z.number().min(0).max(60).optional(),
  searchingMonths: z.number().min(0).max(120).optional(),
  newRoleField: z.string().trim().min(1).max(120).optional(),
  moodScore: z.number().min(1).max(10).optional(),
  ndaConfirmed: z.boolean().optional(),
  evidenceTier: z.enum(["self_report", "doc_verified", "multi_source"]).optional(),
  privacy: z.object({
    nameDisplay: z.enum(["alias", "initials", "first_name", "anonymous"]).optional(),
    companyDisplay: z.enum(["exact", "industry_only", "masked"]).optional(),
    geoDisplay: z.enum(["city", "region", "country", "hidden"]).optional(),
    dateDisplay: z.enum(["exact", "month", "year", "hidden"]).optional()
  }).optional()
});

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(120),
  phone: z.string().trim().min(7).max(30).optional()
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(120)
});

const phoneStartSchema = z.object({
  phone: z.string().trim().min(7).max(30)
});

const phoneVerifySchema = z.object({
  phone: z.string().trim().min(7).max(30),
  code: z.string().trim().length(6)
});

const forumTopicSchema = z.object({
  country: z.string().trim().min(2).max(20).optional(),
  language: z.enum(languages).optional(),
  categoryId: z.string().trim().min(2).max(50),
  title: z.string().trim().min(8).max(200),
  body: z.string().trim().min(20).max(5000)
});

const forumReplySchema = z.object({
  country: z.string().trim().min(2).max(20).optional(),
  language: z.enum(languages).optional(),
  body: z.string().trim().min(2).max(3000)
});

const moderationActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(2).max(300).optional().default("")
});

const sanctionSchema = z.object({
  targetUserId: z.string().trim().min(2).max(80),
  type: z.enum(["warn", "mute", "suspend", "ban"]),
  reason: z.string().trim().min(2).max(400),
  durationDays: z.number().int().min(1).max(3650).optional()
});

const telegramWebhookSchema = z.object({
  message: z.object({
    text: z.string().optional(),
    chat: z.object({
      id: z.union([z.number(), z.string()]),
      type: z.string().optional()
    }),
    from: z.object({
      id: z.union([z.number(), z.string()]),
      username: z.string().optional()
    }).optional()
  }).optional()
});

function normalizeCountry(input) {
  const normalized = String(input || "").toLowerCase();
  return countries.some((c) => c.code === normalized) ? normalized : defaultCountry;
}

function normalizeLanguage(input) {
  const normalized = String(input || "").toLowerCase();
  return languages.includes(normalized) ? normalized : defaultLang;
}

function readStories() {
  try {
    const raw = fs.readFileSync(storiesPath, "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    return [];
  }
}

function readResources() {
  return readJsonArray(resourcesPath);
}

function readNews() {
  return readJsonArray(newsPath);
}

function readCompanyBoards() {
  return readJsonArray(companyBoardsPath);
}

function readPetitions() {
  return readJsonArray(petitionsPath);
}

function readCohorts() {
  return readJsonArray(cohortsPath);
}

function readAnonymousInbox() {
  return readJsonArray(anonymousInboxPath);
}

function writeStories(stories) {
  fs.writeFileSync(storiesPath, JSON.stringify(stories, null, 2));
}

function readJsonArray(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeJsonArray(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  raw.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(rest.join("=") || "");
  });
  return out;
}

function makeSessionToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    AUTH_SECRET,
    { expiresIn: `${SESSION_TTL_HOURS}h` }
  );
}

function setAuthCookie(res, token) {
  const cookie = [
    `auth_token=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_HOURS * 3600}`
  ];
  if (process.env.NODE_ENV === "production") {
    cookie.push("Secure");
  }
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function clearAuthCookie(res) {
  const cookie = [
    "auth_token=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (process.env.NODE_ENV === "production") {
    cookie.push("Secure");
  }
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function mapStoryRow(row) {
  const details = row.details || {};
  const metrics = row.metrics || {};
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    language: row.language,
    profession: row.profession,
    company: row.company,
    laidOffAt: row.laid_off_at,
    foundNewJob: row.found_new_job,
    reason: row.reason,
    story: row.story,
    status: row.status,
    estimatedLayoffs: row.estimated_layoffs,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    city: details.city || null,
    tenureYears: details.tenureYears ?? null,
    salaryBefore: details.salaryBefore ?? null,
    salaryAfter: details.salaryAfter ?? null,
    layoffType: details.layoffType || null,
    aiTool: details.aiTool || null,
    warnedAhead: details.warnedAhead || null,
    compensationMonths: details.compensationMonths ?? null,
    searchingMonths: details.searchingMonths ?? null,
    newRoleField: details.newRoleField || null,
    moodScore: details.moodScore ?? null,
    views: Number(metrics.views || 0),
    meToo: Number(metrics.meToo || 0),
    commentsCount: Number(metrics.commentsCount || 0),
    updateLabel: details.updateLabel || null,
    privacy: row.privacy || {},
    moderation: row.moderation || {},
    submittedBy: row.submitted_by || null,
    details,
    metrics
  };
}

function ensureStoryDefaults(story) {
  const details = story.details || {
    city: story.city || null,
    tenureYears: story.tenureYears ?? null,
    salaryBefore: story.salaryBefore ?? null,
    salaryAfter: story.salaryAfter ?? null,
    layoffType: story.layoffType || null,
    aiTool: story.aiTool || null,
    warnedAhead: story.warnedAhead || null,
    compensationMonths: story.compensationMonths ?? null,
    searchingMonths: story.searchingMonths ?? null,
    newRoleField: story.newRoleField || null,
    moodScore: story.moodScore ?? null,
    updateLabel: story.updateLabel || null,
    evidenceTier: story.evidenceTier || "self_report"
  };
  const metrics = story.metrics || {
    views: Number(story.views || 0),
    meToo: Number(story.meToo || 0),
    commentsCount: Number(story.commentsCount || 0)
  };
  return {
    ...story,
    details,
    metrics,
    views: Number(metrics.views || 0),
    meToo: Number(metrics.meToo || 0),
    commentsCount: Number(metrics.commentsCount || 0),
    updatedAt: story.updatedAt || story.createdAt || new Date().toISOString(),
    city: details.city || null,
    tenureYears: details.tenureYears ?? null,
    salaryBefore: details.salaryBefore ?? null,
    salaryAfter: details.salaryAfter ?? null,
    layoffType: details.layoffType || null,
    aiTool: details.aiTool || null,
    warnedAhead: details.warnedAhead || null,
    compensationMonths: details.compensationMonths ?? null,
    searchingMonths: details.searchingMonths ?? null,
    newRoleField: details.newRoleField || null,
    moodScore: details.moodScore ?? null,
    updateLabel: details.updateLabel || null
    ,
    evidenceTier: details.evidenceTier || "self_report"
  };
}

function makeDbSslConfig() {
  return PG_SSL ? { rejectUnauthorized: false } : undefined;
}

async function testPgConnection(connectionString) {
  const client = new Pool({
    connectionString,
    ssl: makeDbSslConfig(),
    max: 1,
    idleTimeoutMillis: 3000
  });
  try {
    const res = await client.query("SELECT 1 AS ok;");
    return Boolean(res.rows?.[0]?.ok === 1 || res.rows?.[0]?.ok === "1");
  } catch (_error) {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function resolvePinnedDatabaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  if (parsed.hostname !== "postgres") return baseUrl;

  const records = await dns.lookup("postgres", { all: true }).catch(() => []);
  if (!records.length) return baseUrl;
  const prioritized = [
    ...records.filter((r) => r.family === 4),
    ...records.filter((r) => r.family !== 4)
  ];
  for (const rec of prioritized) {
    const candidate = new URL(baseUrl);
    candidate.hostname = rec.address;
    const ok = await testPgConnection(candidate.toString());
    if (ok) {
      return candidate.toString();
    }
  }
  return baseUrl;
}

async function buildPgPool() {
  const pinnedUrl = await resolvePinnedDatabaseUrl(DATABASE_URL);
  return new Pool({
    connectionString: pinnedUrl,
    ssl: makeDbSslConfig()
  });
}

async function initStorage() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const localDefaults = [
    [resourcesPath, defaultResources],
    [newsPath, defaultNews],
    [takedownsPath, []],
    [companyBoardsPath, defaultCompanyBoards],
    [petitionsPath, defaultPetitions],
    [cohortsPath, defaultCohorts],
    [anonymousInboxPath, []]
  ];
  localDefaults.forEach(([file, value]) => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(value, null, 2));
  });

  if (!usePostgres) {
    const defaults = [
      [usersPath, []],
      [forumTopicsPath, forumTopics],
      [forumRepliesPath, []],
      [sanctionsPath, []],
      [auditLogPath, []],
      [authIdentitiesPath, []],
      [storyVersionsPath, []],
      [telegramLinksPath, []],
      [transparencyEventsPath, []],
      [resourcesPath, defaultResources],
      [newsPath, defaultNews],
      [takedownsPath, []],
      [companyBoardsPath, defaultCompanyBoards],
      [petitionsPath, defaultPetitions],
      [cohortsPath, defaultCohorts],
      [anonymousInboxPath, []]
    ];
    defaults.forEach(([file, value]) => {
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(value, null, 2));
      }
    });
    return;
  }

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT NOT NULL,
      language TEXT NOT NULL,
      profession TEXT NOT NULL,
      company TEXT NOT NULL,
      laid_off_at TEXT NOT NULL,
      found_new_job BOOLEAN NOT NULL DEFAULT FALSE,
      reason TEXT NOT NULL,
      story TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      estimated_layoffs INTEGER NOT NULL DEFAULT 1,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      privacy JSONB NOT NULL DEFAULT '{}'::jsonb,
      moderation JSONB NOT NULL DEFAULT '{}'::jsonb,
      submitted_by TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_stories_status_country_created ON stories(status, country, created_at DESC);");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS privacy JSONB NOT NULL DEFAULT '{}'::jsonb;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS moderation JSONB NOT NULL DEFAULT '{}'::jsonb;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS submitted_by TEXT NULL;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();");
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NULL,
      role TEXT NOT NULL DEFAULT 'user',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      muted_until TIMESTAMPTZ NULL,
      banned_until TIMESTAMPTZ NULL
    );
  `);
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);");
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS auth_identities (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email_verified BOOLEAN NOT NULL DEFAULT TRUE,
      phone TEXT NULL,
      phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
      pending_phone TEXT NULL,
      phone_otp_hash TEXT NULL,
      phone_otp_expires_at TIMESTAMPTZ NULL,
      phone_otp_attempts INTEGER NOT NULL DEFAULT 0,
      telegram_link_code TEXT NULL,
      telegram_code_expires_at TIMESTAMPTZ NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS story_versions (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS telegram_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      telegram_user_id TEXT NOT NULL,
      telegram_username TEXT NULL,
      status TEXT NOT NULL DEFAULT 'linked',
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id),
      UNIQUE(telegram_user_id)
    );
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS transparency_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS forum_topics (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'global',
      language TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'published',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS forum_posts (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'global',
      language TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'published',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS sanctions (
      id TEXT PRIMARY KEY,
      target_user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      reason TEXT NOT NULL,
      duration_days INTEGER NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actor_id TEXT NULL,
      target_type TEXT NULL,
      target_id TEXT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const countRes = await pgPool.query("SELECT COUNT(*)::int AS count FROM stories;");
  if (countRes.rows[0].count > 0) return;

  const seed = readStories();
  if (!seed.length) return;

  for (const s of seed) {
    await pgPool.query(
      `INSERT INTO stories (
        id, name, country, language, profession, company, laid_off_at,
        found_new_job, reason, story, status, estimated_layoffs, details, metrics, privacy, moderation, submitted_by, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      ) ON CONFLICT (id) DO NOTHING;`,
      [
        s.id,
        s.name,
        s.country,
        s.language,
        s.profession,
        s.company,
        s.laidOffAt,
        Boolean(s.foundNewJob),
        s.reason,
        s.story,
        s.status || "pending",
        Number(s.estimatedLayoffs || 1),
        JSON.stringify(s.details || {}),
        JSON.stringify(s.metrics || {}),
        JSON.stringify(s.privacy || {}),
        JSON.stringify(s.moderation || {}),
        s.submittedBy || null,
        s.createdAt || new Date().toISOString(),
        s.updatedAt || s.createdAt || new Date().toISOString()
      ]
    );
  }

  const topicCount = await pgPool.query("SELECT COUNT(*)::int AS count FROM forum_topics;");
  if (topicCount.rows[0].count === 0) {
    for (const topic of forumTopics) {
      await pgPool.query(
        `INSERT INTO forum_topics (id, category_id, title, body, country, language, status, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);`,
        [
          topic.id,
          topic.categoryId,
          topic.title,
          "Seed topic body",
          "global",
          "en",
          "published",
          "system",
          topic.lastUpdate || new Date().toISOString()
        ]
      );
    }
  }
}

async function storageGetStories() {
  if (!usePostgres) return readStories().map(ensureStoryDefaults);
  const res = await pgPool.query("SELECT * FROM stories ORDER BY created_at DESC;");
  return res.rows.map(mapStoryRow).map(ensureStoryDefaults);
}

async function storageInsertStory(newStory) {
  if (!usePostgres) {
    const stories = readStories();
    stories.push(newStory);
    writeStories(stories);
    return;
  }

  await pgPool.query(
    `INSERT INTO stories (
      id, name, country, language, profession, company, laid_off_at,
      found_new_job, reason, story, status, estimated_layoffs, details, metrics, privacy, moderation, submitted_by, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
    );`,
    [
      newStory.id,
      newStory.name,
      newStory.country,
      newStory.language,
      newStory.profession,
      newStory.company,
      newStory.laidOffAt,
      newStory.foundNewJob,
      newStory.reason,
      newStory.story,
      newStory.status,
      newStory.estimatedLayoffs,
      JSON.stringify(newStory.details || {}),
      JSON.stringify(newStory.metrics || {}),
      JSON.stringify(newStory.privacy || {}),
      JSON.stringify(newStory.moderation || {}),
      newStory.submittedBy || null,
      newStory.createdAt,
      newStory.updatedAt || newStory.createdAt
    ]
  );
}

async function storageGetUsers() {
  if (!usePostgres) return readJsonArray(usersPath);
  const res = await pgPool.query(
    `SELECT id, email, phone, role, password_hash, created_at, muted_until, banned_until
     FROM users ORDER BY created_at DESC;`
  );
  return res.rows.map((r) => ({
    id: r.id,
    email: r.email,
    phone: r.phone,
    role: r.role,
    passwordHash: r.password_hash,
    createdAt: r.created_at,
    mutedUntil: r.muted_until,
    bannedUntil: r.banned_until
  }));
}

async function storageGetUserByEmail(email) {
  if (!usePostgres) return storageGetUsers().then((x) => x.find((u) => u.email === email) || null);
  const res = await pgPool.query(
    `SELECT id, email, phone, role, password_hash, created_at, muted_until, banned_until
     FROM users WHERE email = $1 LIMIT 1;`,
    [email]
  );
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    email: r.email,
    phone: r.phone,
    role: r.role,
    passwordHash: r.password_hash,
    createdAt: r.created_at,
    mutedUntil: r.muted_until,
    bannedUntil: r.banned_until
  };
}

async function storageGetUserById(id) {
  if (!usePostgres) return storageGetUsers().then((x) => x.find((u) => u.id === id) || null);
  const res = await pgPool.query(
    `SELECT id, email, phone, role, password_hash, created_at, muted_until, banned_until
     FROM users WHERE id = $1 LIMIT 1;`,
    [id]
  );
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    email: r.email,
    phone: r.phone,
    role: r.role,
    passwordHash: r.password_hash,
    createdAt: r.created_at,
    mutedUntil: r.muted_until,
    bannedUntil: r.banned_until
  };
}

async function storageInsertUser(user) {
  if (!usePostgres) {
    const users = readJsonArray(usersPath);
    users.push(user);
    writeJsonArray(usersPath, users);
    return;
  }
  await pgPool.query(
    `INSERT INTO users (id, email, phone, role, password_hash, created_at, muted_until, banned_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8);`,
    [
      user.id,
      user.email,
      user.phone || null,
      user.role,
      user.passwordHash,
      user.createdAt,
      user.mutedUntil || null,
      user.bannedUntil || null
    ]
  );
}

async function storageUpdateUserSanction(userId, patch) {
  if (!usePostgres) {
    const users = readJsonArray(usersPath);
    const idx = users.findIndex((u) => u.id === userId);
    if (idx < 0) return false;
    users[idx] = { ...users[idx], ...patch };
    writeJsonArray(usersPath, users);
    return true;
  }
  const dbPatch = {};
  if (Object.prototype.hasOwnProperty.call(patch, "mutedUntil")) dbPatch.muted_until = patch.mutedUntil;
  if (Object.prototype.hasOwnProperty.call(patch, "bannedUntil")) dbPatch.banned_until = patch.bannedUntil;
  const keys = Object.keys(dbPatch);
  if (!keys.length) return true;
  const fields = [];
  const values = [];
  keys.forEach((k, i) => {
    fields.push(`${k} = $${i + 1}`);
    values.push(dbPatch[k]);
  });
  values.push(userId);
  const res = await pgPool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${values.length};`, values);
  return res.rowCount > 0;
}

async function storageGetIdentityByUserId(userIdValue) {
  if (!usePostgres) {
    return readJsonArray(authIdentitiesPath).find((x) => x.userId === userIdValue) || null;
  }
  const res = await pgPool.query(
    `SELECT user_id, email_verified, phone, phone_verified, pending_phone, phone_otp_hash, phone_otp_expires_at,
      phone_otp_attempts, telegram_link_code, telegram_code_expires_at, updated_at
     FROM auth_identities WHERE user_id = $1 LIMIT 1;`,
    [userIdValue]
  );
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    userId: r.user_id,
    emailVerified: r.email_verified,
    phone: r.phone,
    phoneVerified: r.phone_verified,
    pendingPhone: r.pending_phone,
    phoneOtpHash: r.phone_otp_hash,
    phoneOtpExpiresAt: r.phone_otp_expires_at,
    phoneOtpAttempts: r.phone_otp_attempts,
    telegramLinkCode: r.telegram_link_code,
    telegramCodeExpiresAt: r.telegram_code_expires_at,
    updatedAt: r.updated_at
  };
}

async function storageUpsertIdentity(identity) {
  if (!usePostgres) {
    const rows = readJsonArray(authIdentitiesPath);
    const idx = rows.findIndex((x) => x.userId === identity.userId);
    const next = {
      emailVerified: true,
      phoneVerified: false,
      phoneOtpAttempts: 0,
      ...rows[idx],
      ...identity,
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) rows[idx] = next;
    else rows.push(next);
    writeJsonArray(authIdentitiesPath, rows);
    return next;
  }
  await pgPool.query(
    `INSERT INTO auth_identities (
      user_id, email_verified, phone, phone_verified, pending_phone, phone_otp_hash, phone_otp_expires_at,
      phone_otp_attempts, telegram_link_code, telegram_code_expires_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      email_verified = EXCLUDED.email_verified,
      phone = EXCLUDED.phone,
      phone_verified = EXCLUDED.phone_verified,
      pending_phone = EXCLUDED.pending_phone,
      phone_otp_hash = EXCLUDED.phone_otp_hash,
      phone_otp_expires_at = EXCLUDED.phone_otp_expires_at,
      phone_otp_attempts = EXCLUDED.phone_otp_attempts,
      telegram_link_code = EXCLUDED.telegram_link_code,
      telegram_code_expires_at = EXCLUDED.telegram_code_expires_at,
      updated_at = NOW();`,
    [
      identity.userId,
      identity.emailVerified !== false,
      identity.phone || null,
      Boolean(identity.phoneVerified),
      identity.pendingPhone || null,
      identity.phoneOtpHash || null,
      identity.phoneOtpExpiresAt || null,
      Number(identity.phoneOtpAttempts || 0),
      identity.telegramLinkCode || null,
      identity.telegramCodeExpiresAt || null
    ]
  );
  return storageGetIdentityByUserId(identity.userId);
}

async function storageInsertStoryVersion(entry) {
  if (!usePostgres) {
    const rows = readJsonArray(storyVersionsPath);
    rows.push(entry);
    writeJsonArray(storyVersionsPath, rows.slice(-10000));
    return;
  }
  await pgPool.query(
    `INSERT INTO story_versions (id, story_id, version_no, payload, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6);`,
    [entry.id, entry.storyId, entry.versionNo, JSON.stringify(entry.payload || {}), entry.createdBy || null, entry.createdAt]
  );
}

async function storageCreateOrUpdateTelegramLink(entry) {
  if (!usePostgres) {
    const rows = readJsonArray(telegramLinksPath);
    const idx = rows.findIndex((x) => x.userId === entry.userId || x.telegramUserId === entry.telegramUserId);
    const next = {
      id: entry.id || sanctionId(),
      status: "linked",
      linkedAt: new Date().toISOString(),
      ...rows[idx],
      ...entry
    };
    if (idx >= 0) rows[idx] = next;
    else rows.push(next);
    writeJsonArray(telegramLinksPath, rows);
    return next;
  }
  await pgPool.query(
    `INSERT INTO telegram_links (id, user_id, telegram_user_id, telegram_username, status, linked_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET
       telegram_user_id = EXCLUDED.telegram_user_id,
       telegram_username = EXCLUDED.telegram_username,
       status = EXCLUDED.status,
       linked_at = EXCLUDED.linked_at;`,
    [entry.id || sanctionId(), entry.userId, String(entry.telegramUserId), entry.telegramUsername || null, entry.status || "linked", entry.linkedAt || new Date().toISOString()]
  );
  return entry;
}

async function storageGetTelegramLinkByUserId(userIdValue) {
  if (!usePostgres) {
    return readJsonArray(telegramLinksPath).find((x) => x.userId === userIdValue) || null;
  }
  const res = await pgPool.query(
    `SELECT id, user_id, telegram_user_id, telegram_username, status, linked_at
     FROM telegram_links WHERE user_id = $1 LIMIT 1;`,
    [userIdValue]
  );
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    telegramUserId: r.telegram_user_id,
    telegramUsername: r.telegram_username,
    status: r.status,
    linkedAt: r.linked_at
  };
}

async function storageInsertTransparencyEvent(entry) {
  if (!usePostgres) {
    const rows = readJsonArray(transparencyEventsPath);
    rows.push(entry);
    writeJsonArray(transparencyEventsPath, rows.slice(-5000));
    return;
  }
  await pgPool.query(
    `INSERT INTO transparency_events (id, event_type, status, details, created_at)
     VALUES ($1,$2,$3,$4,$5);`,
    [entry.id || auditId(), entry.eventType, entry.status, JSON.stringify(entry.details || {}), entry.createdAt || new Date().toISOString()]
  );
}

async function storageGetForumTopics(country) {
  if (!usePostgres) {
    return readJsonArray(forumTopicsPath)
      .filter((t) => !country || t.country === country || t.country === "global")
      .sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate));
  }
  const res = await pgPool.query(
    `SELECT t.id, t.category_id, t.title, t.body, t.country, t.language, t.status, t.created_by, t.created_at,
      COALESCE(COUNT(p.id),0)::int AS replies, COALESCE(MAX(p.created_at), t.created_at) AS last_update
     FROM forum_topics t
     LEFT JOIN forum_posts p ON p.topic_id = t.id
     WHERE ($1::text IS NULL OR t.country = $1 OR t.country = 'global')
       AND t.status <> 'deleted'
     GROUP BY t.id
     ORDER BY last_update DESC
     LIMIT 100;`,
    [country || null]
  );
  return res.rows.map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    title: r.title,
    body: r.body,
    country: r.country,
    language: r.language,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    replies: r.replies,
    lastUpdate: r.last_update
  }));
}

async function storageInsertForumTopic(topic) {
  if (!usePostgres) {
    const topics = readJsonArray(forumTopicsPath);
    topics.push(topic);
    writeJsonArray(forumTopicsPath, topics);
    return;
  }
  await pgPool.query(
    `INSERT INTO forum_topics (id, category_id, title, body, country, language, status, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);`,
    [topic.id, topic.categoryId, topic.title, topic.body, topic.country, topic.language, topic.status, topic.createdBy, topic.createdAt]
  );
}

async function storageInsertForumReply(reply) {
  if (!usePostgres) {
    const replies = readJsonArray(forumRepliesPath);
    replies.push(reply);
    writeJsonArray(forumRepliesPath, replies);
    const topics = readJsonArray(forumTopicsPath);
    const idx = topics.findIndex((t) => t.id === reply.topicId);
    if (idx >= 0) {
      topics[idx].replies = Number(topics[idx].replies || 0) + 1;
      topics[idx].lastUpdate = reply.createdAt;
      writeJsonArray(forumTopicsPath, topics);
    }
    return;
  }
  await pgPool.query(
    `INSERT INTO forum_posts (id, topic_id, body, country, language, status, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8);`,
    [reply.id, reply.topicId, reply.body, reply.country, reply.language, reply.status, reply.createdBy, reply.createdAt]
  );
}

async function storageGetModerationQueue() {
  const stories = await storageGetStories();
  const storyQueue = stories
    .filter((s) => s.status === "pending")
    .slice(0, 100)
    .map((s) => ({
      id: `story:${s.id}`,
      type: "story",
      title: `${s.profession} · ${s.name}`,
      story: s.story,
      createdAt: s.createdAt,
      moderation: s.moderation || {}
    }));

  let topicQueue = [];
  if (usePostgres) {
    const res = await pgPool.query(
      `SELECT id, title, body, created_at FROM forum_topics WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100;`
    );
    topicQueue = res.rows.map((t) => ({
      id: `topic:${t.id}`,
      type: "topic",
      title: t.title,
      story: t.body,
      createdAt: t.created_at
    }));
  } else {
    topicQueue = readJsonArray(forumTopicsPath)
      .filter((t) => t.status === "pending")
      .slice(0, 100)
      .map((t) => ({
        id: `topic:${t.id}`,
        type: "topic",
        title: t.title,
        story: t.body,
        createdAt: t.createdAt
      }));
  }

  return [...storyQueue, ...topicQueue].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function storageModerationAction(entryId, action, reason) {
  const [kind, id] = String(entryId || "").split(":");
  if (!kind || !id) return false;
  const next = action === "approve" ? "published" : "rejected";

  if (kind === "story") {
    if (!usePostgres) {
      const stories = readJsonArray(storiesPath);
      const idx = stories.findIndex((s) => s.id === id);
      if (idx < 0) return false;
      stories[idx].status = next;
      stories[idx].moderationReason = reason || "";
      writeJsonArray(storiesPath, stories);
      return true;
    }
    const res = await pgPool.query("UPDATE stories SET status=$1 WHERE id=$2;", [next, id]);
    return res.rowCount > 0;
  }

  if (kind === "topic") {
    if (!usePostgres) {
      const topics = readJsonArray(forumTopicsPath);
      const idx = topics.findIndex((t) => t.id === id);
      if (idx < 0) return false;
      topics[idx].status = next;
      topics[idx].moderationReason = reason || "";
      writeJsonArray(forumTopicsPath, topics);
      return true;
    }
    const res = await pgPool.query("UPDATE forum_topics SET status=$1 WHERE id=$2;", [next, id]);
    return res.rowCount > 0;
  }

  return false;
}

async function storageInsertSanction(entry) {
  if (!usePostgres) {
    const sanctions = readJsonArray(sanctionsPath);
    sanctions.push(entry);
    writeJsonArray(sanctionsPath, sanctions);
    return;
  }
  await pgPool.query(
    `INSERT INTO sanctions (id, target_user_id, type, reason, duration_days, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7);`,
    [entry.id, entry.targetUserId, entry.type, entry.reason, entry.durationDays || null, entry.createdBy, entry.createdAt]
  );
}

async function storageAudit(action) {
  const entry = {
    id: auditId(),
    action: action.action,
    actorId: action.actorId || null,
    targetType: action.targetType || null,
    targetId: action.targetId || null,
    metadata: action.metadata || {},
    ip: action.ip || "",
    createdAt: new Date().toISOString()
  };

  if (!usePostgres) {
    const logs = readJsonArray(auditLogPath);
    logs.push(entry);
    writeJsonArray(auditLogPath, logs.slice(-5000));
    return;
  }
  await pgPool.query(
    `INSERT INTO audit_log (id, action, actor_id, target_type, target_id, metadata, ip, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8);`,
    [entry.id, entry.action, entry.actorId, entry.targetType, entry.targetId, JSON.stringify(entry.metadata), entry.ip, entry.createdAt]
  );
}

async function storageGetAuditRange(fromISO, toISO) {
  if (!usePostgres) {
    return readJsonArray(auditLogPath).filter((e) => {
      const t = new Date(e.createdAt).getTime();
      return t >= new Date(fromISO).getTime() && t <= new Date(toISO).getTime();
    });
  }
  const res = await pgPool.query(
    `SELECT id, action, actor_id, target_type, target_id, metadata, ip, created_at
     FROM audit_log
     WHERE created_at >= $1 AND created_at <= $2
     ORDER BY created_at DESC
     LIMIT 10000;`,
    [fromISO, toISO]
  );
  return res.rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actor_id,
    targetType: r.target_type,
    targetId: r.target_id,
    metadata: r.metadata || {},
    ip: r.ip,
    createdAt: r.created_at
  }));
}

function sanitizeText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function maskStoryByPrivacy(story) {
  const privacy = story.privacy || {};
  const nameDisplay = privacy.nameDisplay || "alias";
  const companyDisplay = privacy.companyDisplay || "exact";
  const dateDisplay = privacy.dateDisplay || "month";

  const out = { ...story };
  const originalName = String(story.name || "");
  if (nameDisplay === "anonymous") out.name = "Anonymous";
  if (nameDisplay === "initials" && originalName) {
    out.name = originalName.split(" ").filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join(" ");
  }
  if (nameDisplay === "first_name" && originalName) out.name = originalName.split(" ")[0];
  if (nameDisplay === "alias" && originalName.includes(" ")) {
    const [first] = originalName.split(" ");
    out.name = `${first} ${originalName.split(" ").slice(1).map((p) => `${p[0]}.`).join("")}`.trim();
  }

  if (companyDisplay === "industry_only") out.company = "Technology company";
  if (companyDisplay === "masked") out.company = "Undisclosed company";

  if (dateDisplay === "year" && String(story.laidOffAt).length >= 4) out.laidOffAt = String(story.laidOffAt).slice(0, 4);
  if (dateDisplay === "hidden") out.laidOffAt = "Hidden";
  if (dateDisplay === "month" && /^\d{4}-\d{2}-\d{2}$/.test(String(story.laidOffAt))) {
    out.laidOffAt = String(story.laidOffAt).slice(0, 7);
  }
  return out;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function scoreModeration(input) {
  const text = `${input.reason || ""} ${input.story || ""}`.toLowerCase();
  const toxicTokens = ["idiot", "kill", "hate", "stupid", "loser", "trash"];
  const spamTokens = ["buy now", "promo", "discount", "http://", "https://", "telegram.me/", "affiliate"];
  const piiRegex = /(\+?\d[\d\-\s]{7,}\d)|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  const crisisRegex = /(suicide|kill myself|end my life|cannot go on|хочу умереть|покончить с собой)/i;
  const deanonMarkers = [
    /only\s+\d+\s+people/i,
    /exactly\s+\d+\s+people/i,
    /\bmy manager\b/i,
    /\bthe only\b/i,
    /\bon\s+\d{4}-\d{2}-\d{2}\b/i
  ];

  const toxicity = Math.min(1, toxicTokens.reduce((n, token) => n + (text.includes(token) ? 0.2 : 0), 0));
  const spam = Math.min(1, spamTokens.reduce((n, token) => n + (text.includes(token) ? 0.2 : 0), 0));
  const piiHits = [...text.matchAll(piiRegex)].length;
  const pii = piiHits > 0 ? Math.min(1, 0.3 + piiHits * 0.2) : 0;
  const deanonMatches = deanonMarkers.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  const deanonymization = Math.min(1, deanonMatches * 0.25);
  const crisis = crisisRegex.test(text) ? 1 : 0;
  const risk = Math.max(toxicity, spam, pii, deanonymization, crisis);

  return {
    toxicity,
    spam,
    pii,
    deanonymization,
    crisis,
    riskBand: risk >= 0.85 ? "high" : risk >= 0.45 ? "medium" : "low",
    recommendations: deanonymization >= 0.5
      ? [
          "Generalize exact dates to month/year.",
          "Avoid unique team size and project details.",
          "Prefer masked company visibility."
        ]
      : []
  };
}

function mapVisibilityToPrivacy(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const normalizeVis = (value) => String(value || "public").toLowerCase();
  const toNameDisplay = (v) => {
    if (v === "hidden") return "anonymous";
    if (v === "coarse") return "initials";
    return "alias";
  };
  const toCompanyDisplay = (v) => {
    if (v === "hidden") return "masked";
    if (v === "coarse") return "industry_only";
    return "exact";
  };
  const toGeoDisplay = (v) => {
    if (v === "hidden") return "hidden";
    if (v === "coarse") return "country";
    return "city";
  };
  const toDateDisplay = (v) => {
    if (v === "hidden") return "hidden";
    if (v === "coarse") return "year";
    return "exact";
  };
  const nameRaw = normalizeVis(src.nameDisplay || src.name);
  const companyRaw = normalizeVis(src.companyDisplay || src.company);
  const geoRaw = normalizeVis(src.geoDisplay || src.geo);
  const dateRaw = normalizeVis(src.dateDisplay || src.date);
  return {
    nameDisplay: toNameDisplay(nameRaw),
    companyDisplay: toCompanyDisplay(companyRaw),
    geoDisplay: toGeoDisplay(geoRaw),
    dateDisplay: toDateDisplay(dateRaw)
  };
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    return resp.ok;
  } catch (_error) {
    return false;
  }
}

function getTopCompanies(stories, country) {
  const filtered = stories.filter((s) => s.status === "published" && (country === "global" || s.country === country));
  const map = new Map();
  for (const entry of filtered) {
    if (!map.has(entry.company)) {
      map.set(entry.company, { company: entry.company, stories: 0, layoffs: 0, rehired: 0 });
    }
    const row = map.get(entry.company);
    row.stories += 1;
    row.layoffs += Number(entry.estimatedLayoffs || 1);
    row.rehired += entry.foundNewJob ? 1 : 0;
  }
  return [...map.values()].sort((a, b) => b.layoffs - a.layoffs).slice(0, 10);
}

function slugifyCompany(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toCompanyProfile(stories, slug) {
  const rows = stories.filter((s) => slugifyCompany(s.company) === slug && s.status === "published");
  if (!rows.length) return null;
  const first = rows[0];
  const avgTenure = rows.reduce((acc, s) => acc + Number(s.tenureYears || 0), 0) / Math.max(1, rows.filter((s) => s.tenureYears != null).length);
  const professions = new Map();
  const byMonth = new Map();
  let warnedYes = 0;
  let compensationTotal = 0;
  let compensationCount = 0;
  for (const s of rows) {
    professions.set(s.profession, (professions.get(s.profession) || 0) + 1);
    const month = String(s.laidOffAt || "").slice(0, 7) || "unknown";
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
    if (s.warnedAhead === "yes" || s.warnedAhead === "partial") warnedYes += 1;
    if (s.compensationMonths != null) {
      compensationTotal += Number(s.compensationMonths);
      compensationCount += 1;
    }
  }
  const humanityRaw = rows.length
    ? Math.round(((warnedYes / rows.length) * 50) + ((compensationCount ? (compensationTotal / compensationCount) : 0) * 10))
    : 0;
  return {
    slug,
    company: first.company,
    industry: "Technology",
    storiesCount: rows.length,
    averageTenureYears: Number.isFinite(avgTenure) ? Number(avgTenure.toFixed(1)) : null,
    affectedProfessions: [...professions.entries()].map(([profession, count]) => ({ profession, count })).sort((a, b) => b.count - a.count),
    layoffsTimeline: [...byMonth.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    humanityRating: Math.max(0, Math.min(100, humanityRaw)),
    rehiredPeopleCount: rows.filter((s) => s.foundNewJob).length
  };
}

function getDashboard(stories, country) {
  const published = stories.filter((s) => s.status === "published" && (country === "global" || s.country === country));
  const byProfession = new Map();
  const byMonth = new Map();
  const byCountry = new Map();
  const byAiTool = new Map();
  const foundByProfession = new Map();
  const searchMonthsByProfession = new Map();
  let compensationTotal = 0;
  let compensationCount = 0;
  let salaryBeforeTotal = 0;
  let salaryBeforeCount = 0;
  let salaryAfterTotal = 0;
  let salaryAfterCount = 0;

  for (const s of published) {
    byProfession.set(s.profession, (byProfession.get(s.profession) || 0) + 1);
    const month = String(s.laidOffAt || "").slice(0, 7) || "unknown";
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
    byCountry.set(s.country, (byCountry.get(s.country) || 0) + 1);
    if (s.aiTool) byAiTool.set(s.aiTool, (byAiTool.get(s.aiTool) || 0) + 1);

    const foundMeta = foundByProfession.get(s.profession) || { found: 0, total: 0 };
    foundMeta.total += 1;
    if (s.foundNewJob) foundMeta.found += 1;
    foundByProfession.set(s.profession, foundMeta);

    if (s.searchingMonths != null) {
      const meta = searchMonthsByProfession.get(s.profession) || { total: 0, count: 0 };
      meta.total += Number(s.searchingMonths);
      meta.count += 1;
      searchMonthsByProfession.set(s.profession, meta);
    }
    if (s.compensationMonths != null) {
      compensationTotal += Number(s.compensationMonths);
      compensationCount += 1;
    }
    if (s.salaryBefore != null) {
      salaryBeforeTotal += Number(s.salaryBefore);
      salaryBeforeCount += 1;
    }
    if (s.salaryAfter != null) {
      salaryAfterTotal += Number(s.salaryAfter);
      salaryAfterCount += 1;
    }
  }

  return {
    country,
    generatedAt: new Date().toISOString(),
    topCompaniesByLayoffs: getTopCompanies(published, country),
    layoffsByMonth: [...byMonth.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    worldMap: [...byCountry.entries()].map(([countryCode, count]) => ({ country: countryCode, count })).sort((a, b) => b.count - a.count),
    affectedProfessions: [...byProfession.entries()].map(([profession, count]) => ({ profession, count })).sort((a, b) => b.count - a.count),
    averageSearchMonthsByProfession: [...searchMonthsByProfession.entries()]
      .map(([profession, meta]) => ({ profession, months: Number((meta.total / Math.max(1, meta.count)).toFixed(1)) }))
      .sort((a, b) => b.months - a.months),
    foundVsNotFoundByProfession: [...foundByProfession.entries()]
      .map(([profession, meta]) => ({ profession, found: meta.found, notFound: Math.max(0, meta.total - meta.found) }))
      .sort((a, b) => (b.found + b.notFound) - (a.found + a.notFound)),
    aiToolsReplacingPeople: [...byAiTool.entries()].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count),
    averageCompensationMonths: compensationCount ? Number((compensationTotal / compensationCount).toFixed(1)) : null,
    rehiredCompaniesCount: getTopCompanies(published, country).filter((c) => c.rehired > 0).length,
    salaryTrend: {
      beforeAverage: salaryBeforeCount ? Math.round(salaryBeforeTotal / salaryBeforeCount) : null,
      afterAverage: salaryAfterCount ? Math.round(salaryAfterTotal / salaryAfterCount) : null
    }
  };
}

function getCrisisResources(countryCode) {
  const base = ["Global: findahelpline.com"];
  if (countryCode === "us") base.unshift("US: 988 Suicide & Crisis Lifeline");
  if (countryCode === "gb") base.unshift("UK Samaritans: 116 123");
  if (countryCode === "ru") base.unshift("RU: 8-800-2000-122");
  return base;
}

function computeConfidenceScore(story) {
  const s = ensureStoryDefaults(story);
  const tier = s.evidenceTier || "self_report";
  const tierScore = tier === "multi_source" ? 0.45 : tier === "doc_verified" ? 0.32 : 0.2;
  const moderationPenalty = Math.min(0.35, Number(s.moderation?.toxicity || 0) * 0.15 + Number(s.moderation?.spam || 0) * 0.15 + Number(s.moderation?.pii || 0) * 0.05);
  const engagementBoost = Math.min(0.2, ((Number(s.views || 0) / 500) + (Number(s.meToo || 0) / 100)) * 0.1);
  const raw = tierScore + 0.35 + engagementBoost - moderationPenalty;
  return Math.max(0, Math.min(1, Number(raw.toFixed(3))));
}

function buildCounters(stories) {
  const allStories = stories.filter((s) => s.status === "published");
  const verifiedStories = allStories.filter((s) => (s.evidenceTier || "self_report") !== "self_report");
  return {
    all: {
      stories: allStories.length,
      laidOff: allStories.reduce((sum, s) => sum + Number(s.estimatedLayoffs || 1), 0)
    },
    verified: {
      stories: verifiedStories.length,
      laidOff: verifiedStories.reduce((sum, s) => sum + Number(s.estimatedLayoffs || 1), 0)
    }
  };
}

async function storagePatchStory(storyIdValue, patchFn) {
  const stories = await storageGetStories();
  const idx = stories.findIndex((s) => s.id === storyIdValue);
  if (idx < 0) return null;
  const current = ensureStoryDefaults(stories[idx]);
  const next = ensureStoryDefaults({
    ...current,
    ...patchFn(current),
    updatedAt: new Date().toISOString()
  });

  if (!usePostgres) {
    const rows = readJsonArray(storiesPath);
    const rIdx = rows.findIndex((s) => s.id === storyIdValue);
    if (rIdx < 0) return null;
    rows[rIdx] = { ...rows[rIdx], ...next };
    writeJsonArray(storiesPath, rows);
    return next;
  }

  await pgPool.query(
    `UPDATE stories
     SET found_new_job = $1,
         story = $2,
         details = $3,
         metrics = $4,
         status = $5,
         updated_at = $6
     WHERE id = $7;`,
    [
      Boolean(next.foundNewJob),
      next.story,
      JSON.stringify(next.details || {}),
      JSON.stringify(next.metrics || {}),
      next.status || "pending",
      next.updatedAt,
      storyIdValue
    ]
  );
  return next;
}

function detectLocale(req) {
  const headerCountry = normalizeCountry(req.headers["x-country"] || req.headers["cf-ipcountry"]);
  const languageHeader = String(req.headers["accept-language"] || "");
  const guessedLang = languageHeader.split(",")[0].split("-")[0].toLowerCase();
  return {
    country: headerCountry || defaultCountry,
    lang: normalizeLanguage(guessedLang),
    source: headerCountry ? "geo-header" : languageHeader ? "accept-language" : "default"
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isAccountBanned(user) {
  if (!user || !user.bannedUntil) return false;
  return new Date(user.bannedUntil).getTime() > Date.now();
}

function isAccountMuted(user) {
  if (!user || !user.mutedUntil) return false;
  return new Date(user.mutedUntil).getTime() > Date.now();
}

async function authMiddleware(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies.auth_token;
  if (!token) {
    req.user = null;
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, AUTH_SECRET);
    const user = await storageGetUserById(decoded.sub);
    if (!user || isAccountBanned(user)) {
      clearAuthCookie(res);
      req.user = null;
      next();
      return;
    }
    req.user = user;
    next();
  } catch (_error) {
    clearAuthCookie(res);
    req.user = null;
    next();
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  next();
}

async function requireVerifiedPhone(req, res, next) {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const identity = await storageGetIdentityByUserId(req.user.id);
  if (!identity || !identity.phoneVerified) {
    res.status(403).json({ message: "Phone verification required" });
    return;
  }
  req.identity = identity;
  next();
}

function hasAdminToken(req) {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
  return token === ADMIN_TOKEN;
}

function hasModeratorRole(user) {
  return ["moderator", "admin", "superadmin"].includes(String(user?.role || ""));
}

function requireAdminOrToken(req, res, next) {
  if (hasAdminToken(req) || hasModeratorRole(req.user)) {
    next();
    return;
  }
  res.status(401).json({ message: "Unauthorized" });
}

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"]
      }
    },
    strictTransportSecurity: ENABLE_HSTS ? undefined : false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || rawOrigins.length === 0 || rawOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400
  })
);

app.use(morgan("combined"));
app.use(express.json({ limit: "50kb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));
app.use(authMiddleware);

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false
});

const storySubmitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const phoneLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(globalLimiter);
app.use(express.static(publicDir, { extensions: ["html"] }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "aitookmyjob",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/meta", (_req, res) => {
  res.json({ countries, languages, roles });
});

app.get("/api/locale", (req, res) => {
  res.json(detectLocale(req));
});

app.post("/api/auth/register", async (req, res) => {
  const payload = {
    email: normalizeEmail(req.body.email),
    password: String(req.body.password || ""),
    phone: req.body.phone ? normalizePhone(req.body.phone) : undefined
  };
  const parsed = registerSchema.safeParse(payload);
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }

  const email = parsed.data.email;
  const existing = await storageGetUserByEmail(email);
  if (existing) {
    res.status(409).json({ message: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const newUser = {
    id: userId(),
    email,
    phone: parsed.data.phone ? normalizePhone(parsed.data.phone) : null,
    role: "user",
    passwordHash,
    createdAt: new Date().toISOString(),
    mutedUntil: null,
    bannedUntil: null
  };
  await storageInsertUser(newUser);
  await storageUpsertIdentity({
    userId: newUser.id,
    emailVerified: true,
    phone: newUser.phone || null,
    phoneVerified: false
  });
  await storageAudit({
    action: "auth.register",
    actorId: newUser.id,
    targetType: "user",
    targetId: newUser.id,
    metadata: { email },
    ip: req.ip
  });

  const token = makeSessionToken(newUser);
  setAuthCookie(res, token);
  res.status(201).json({ id: newUser.id, email: newUser.email, role: newUser.role });
});

app.post("/api/auth/login", async (req, res) => {
  const payload = {
    email: normalizeEmail(req.body.email),
    password: String(req.body.password || "")
  };
  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  const user = await storageGetUserByEmail(parsed.data.email);
  if (!user) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }
  if (isAccountBanned(user)) {
    res.status(403).json({ message: "Account banned" });
    return;
  }
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }
  const token = makeSessionToken(user);
  setAuthCookie(res, token);
  await storageAudit({
    action: "auth.login",
    actorId: user.id,
    targetType: "user",
    targetId: user.id,
    metadata: {},
    ip: req.ip
  });
  res.json({ id: user.id, email: user.email, role: user.role });
});

app.post("/api/auth/logout", async (req, res) => {
  if (req.user) {
    await storageAudit({
      action: "auth.logout",
      actorId: req.user.id,
      targetType: "user",
      targetId: req.user.id,
      metadata: {},
      ip: req.ip
    });
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.post("/api/auth/delete-account", requireAuth, async (req, res) => {
  const confirmation = sanitizeText(req.body.confirmation || "").toUpperCase();
  if (confirmation !== "DELETE") {
    res.status(422).json({ message: "Set confirmation to DELETE to continue" });
    return;
  }
  if (!usePostgres) {
    writeJsonArray(usersPath, readJsonArray(usersPath).filter((u) => u.id !== req.user.id));
    writeJsonArray(authIdentitiesPath, readJsonArray(authIdentitiesPath).filter((x) => x.userId !== req.user.id));
    writeJsonArray(telegramLinksPath, readJsonArray(telegramLinksPath).filter((x) => x.userId !== req.user.id));
    writeJsonArray(storiesPath, readJsonArray(storiesPath).filter((s) => s.submittedBy !== req.user.id));
  } else {
    await pgPool.query("DELETE FROM users WHERE id = $1;", [req.user.id]);
    await pgPool.query("DELETE FROM stories WHERE submitted_by = $1;", [req.user.id]);
  }
  await storageAudit({
    action: "auth.delete_account",
    actorId: req.user.id,
    targetType: "user",
    targetId: req.user.id,
    metadata: {},
    ip: req.ip
  });
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  (async () => {
    if (!req.user) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    const identity = await storageGetIdentityByUserId(req.user.id);
    const tg = await storageGetTelegramLinkByUserId(req.user.id);
    res.json({
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      muted: isAccountMuted(req.user),
      banned: isAccountBanned(req.user),
      phoneVerified: Boolean(identity?.phoneVerified),
      phone: identity?.phone || req.user.phone || null,
      telegramLinked: Boolean(tg)
    });
  })().catch((_error) => {
    res.status(500).json({ message: "Could not fetch session profile" });
  });
});

app.post("/api/auth/phone/start", requireAuth, async (req, res) => {
  const parsed = phoneStartSchema.safeParse({ phone: normalizePhone(req.body.phone) });
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }

  const identity = (await storageGetIdentityByUserId(req.user.id)) || {
    userId: req.user.id,
    emailVerified: true,
    phoneVerified: false
  };
  const code = phoneOtpCode();
  const hash = await bcrypt.hash(code, 10);
  const nextIdentity = await storageUpsertIdentity({
    ...identity,
    phone: identity.phone || null,
    pendingPhone: parsed.data.phone,
    phoneOtpHash: hash,
    phoneOtpAttempts: 0,
    phoneOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  await storageAudit({
    action: "auth.phone.start",
    actorId: req.user.id,
    targetType: "identity",
    targetId: req.user.id,
    metadata: { phone: parsed.data.phone },
    ip: req.ip
  });

  res.json({
    ok: true,
    expiresAt: nextIdentity.phoneOtpExpiresAt,
    ...(ALLOW_DEV_OTP ? { devCode: code } : {})
  });
});

app.post("/api/auth/phone/request-otp", requireAuth, async (req, res) => {
  req.url = "/api/auth/phone/start";
  const parsed = phoneStartSchema.safeParse({ phone: normalizePhone(req.body.phone) });
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  const identity = (await storageGetIdentityByUserId(req.user.id)) || {
    userId: req.user.id,
    emailVerified: true,
    phoneVerified: false
  };
  const code = phoneOtpCode();
  const hash = await bcrypt.hash(code, 10);
  const nextIdentity = await storageUpsertIdentity({
    ...identity,
    phone: identity.phone || null,
    pendingPhone: parsed.data.phone,
    phoneOtpHash: hash,
    phoneOtpAttempts: 0,
    phoneOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  await storageAudit({
    action: "auth.phone.start",
    actorId: req.user.id,
    targetType: "identity",
    targetId: req.user.id,
    metadata: { phone: parsed.data.phone, alias: "request-otp" },
    ip: req.ip
  });
  res.json({
    ok: true,
    expiresAt: nextIdentity.phoneOtpExpiresAt,
    ...(ALLOW_DEV_OTP ? { devCode: code } : {})
  });
});

app.post("/api/auth/phone/verify", requireAuth, async (req, res) => {
  const parsed = phoneVerifySchema.safeParse({
    phone: normalizePhone(req.body.phone),
    code: sanitizeText(req.body.code)
  });
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }

  const identity = await storageGetIdentityByUserId(req.user.id);
  if (!identity || !identity.phoneOtpHash || !identity.phoneOtpExpiresAt) {
    res.status(400).json({ message: "No active verification challenge" });
    return;
  }
  if ((identity.phoneOtpAttempts || 0) >= 5) {
    res.status(429).json({ message: "Too many verification attempts" });
    return;
  }
  if (new Date(identity.phoneOtpExpiresAt).getTime() < Date.now()) {
    res.status(410).json({ message: "Verification code expired" });
    return;
  }
  if (identity.pendingPhone !== parsed.data.phone) {
    res.status(400).json({ message: "Phone mismatch for active challenge" });
    return;
  }
  const ok = await bcrypt.compare(parsed.data.code, identity.phoneOtpHash);
  if (!ok) {
    await storageUpsertIdentity({
      ...identity,
      phoneOtpAttempts: Number(identity.phoneOtpAttempts || 0) + 1
    });
    res.status(401).json({ message: "Invalid code" });
    return;
  }

  await storageUpsertIdentity({
    ...identity,
    phone: parsed.data.phone,
    pendingPhone: null,
    phoneVerified: true,
    phoneOtpHash: null,
    phoneOtpExpiresAt: null,
    phoneOtpAttempts: 0
  });
  await storageAudit({
    action: "auth.phone.verified",
    actorId: req.user.id,
    targetType: "identity",
    targetId: req.user.id,
    metadata: { phone: parsed.data.phone },
    ip: req.ip
  });
  res.json({ ok: true, phoneVerified: true });
});

app.post("/api/auth/phone/confirm", requireAuth, async (req, res) => {
  const parsed = phoneVerifySchema.safeParse({
    phone: normalizePhone(req.body.phone),
    code: sanitizeText(req.body.code)
  });
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  const identity = await storageGetIdentityByUserId(req.user.id);
  if (!identity || !identity.phoneOtpHash || !identity.phoneOtpExpiresAt) {
    res.status(400).json({ message: "No active verification challenge" });
    return;
  }
  if ((identity.phoneOtpAttempts || 0) >= 5) {
    res.status(429).json({ message: "Too many verification attempts" });
    return;
  }
  if (new Date(identity.phoneOtpExpiresAt).getTime() < Date.now()) {
    res.status(410).json({ message: "Verification code expired" });
    return;
  }
  if (identity.pendingPhone !== parsed.data.phone) {
    res.status(400).json({ message: "Phone mismatch for active challenge" });
    return;
  }
  const ok = await bcrypt.compare(parsed.data.code, identity.phoneOtpHash);
  if (!ok) {
    await storageUpsertIdentity({
      ...identity,
      phoneOtpAttempts: Number(identity.phoneOtpAttempts || 0) + 1
    });
    res.status(401).json({ message: "Invalid code" });
    return;
  }
  await storageUpsertIdentity({
    ...identity,
    phone: parsed.data.phone,
    pendingPhone: null,
    phoneVerified: true,
    phoneOtpHash: null,
    phoneOtpExpiresAt: null,
    phoneOtpAttempts: 0
  });
  await storageAudit({
    action: "auth.phone.verified",
    actorId: req.user.id,
    targetType: "identity",
    targetId: req.user.id,
    metadata: { phone: parsed.data.phone, alias: "confirm" },
    ip: req.ip
  });
  res.json({ ok: true, phoneVerified: true });
});

app.post("/api/integrations/telegram/link/start", requireAuth, async (req, res) => {
  const identity = (await storageGetIdentityByUserId(req.user.id)) || {
    userId: req.user.id,
    emailVerified: true,
    phoneVerified: false
  };
  const code = linkCodeId();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await storageUpsertIdentity({
    ...identity,
    telegramLinkCode: code,
    telegramCodeExpiresAt: expiresAt
  });
  await storageAudit({
    action: "telegram.link.start",
    actorId: req.user.id,
    targetType: "identity",
    targetId: req.user.id,
    metadata: { expiresAt },
    ip: req.ip
  });
  res.json({ ok: true, code, expiresAt, bot: TELEGRAM_BOT_TOKEN ? "configured" : "not-configured" });
});

app.post("/api/integrations/telegram/link-code", requireAuth, async (req, res) => {
  const identity = (await storageGetIdentityByUserId(req.user.id)) || {
    userId: req.user.id,
    emailVerified: true,
    phoneVerified: false
  };
  const code = linkCodeId();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await storageUpsertIdentity({
    ...identity,
    telegramLinkCode: code,
    telegramCodeExpiresAt: expiresAt
  });
  await storageAudit({
    action: "telegram.link.start",
    actorId: req.user.id,
    targetType: "identity",
    targetId: req.user.id,
    metadata: { expiresAt, alias: "link-code" },
    ip: req.ip
  });
  res.json({ ok: true, code, expiresAt, bot: TELEGRAM_BOT_TOKEN ? "configured" : "not-configured" });
});

app.post("/api/integrations/telegram/link", requireAuth, async (req, res) => {
  const identity = (await storageGetIdentityByUserId(req.user.id)) || {
    userId: req.user.id,
    emailVerified: true,
    phoneVerified: false
  };
  const code = linkCodeId();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await storageUpsertIdentity({
    ...identity,
    telegramLinkCode: code,
    telegramCodeExpiresAt: expiresAt
  });
  await storageAudit({
    action: "telegram.link.start",
    actorId: req.user.id,
    targetType: "identity",
    targetId: req.user.id,
    metadata: { expiresAt, alias: "link" },
    ip: req.ip
  });
  res.json({ ok: true, code, expiresAt, bot: TELEGRAM_BOT_TOKEN ? "configured" : "not-configured" });
});

app.get("/api/integrations/telegram/status", requireAuth, async (req, res) => {
  const link = await storageGetTelegramLinkByUserId(req.user.id);
  const identity = await storageGetIdentityByUserId(req.user.id);
  res.json({
    linked: Boolean(link),
    telegram: link ? {
      username: link.telegramUsername || null,
      linkedAt: link.linkedAt
    } : null,
    pendingCode: identity?.telegramLinkCode || null,
    pendingCodeExpiresAt: identity?.telegramCodeExpiresAt || null
  });
});

app.post("/api/integrations/telegram/webhook", async (req, res) => {
  if (TELEGRAM_WEBHOOK_SECRET) {
    const incoming = req.headers["x-telegram-bot-api-secret-token"];
    if (incoming !== TELEGRAM_WEBHOOK_SECRET) {
      res.status(401).json({ message: "Invalid telegram webhook secret" });
      return;
    }
  }
  const parsed = telegramWebhookSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(200).json({ ok: true });
    return;
  }
  const msg = parsed.data.message;
  if (!msg || !msg.text || !msg.from) {
    res.status(200).json({ ok: true });
    return;
  }
  const txt = String(msg.text || "").trim();
  const fromId = String(msg.from.id);
  const username = msg.from.username || null;
  if (!txt.toLowerCase().startsWith("/link")) {
    res.status(200).json({ ok: true });
    return;
  }
  const code = txt.split(" ").slice(1).join("").trim().toUpperCase();
  if (!code) {
    await sendTelegramMessage(String(msg.chat.id), "Usage: /link YOUR_CODE");
    res.status(200).json({ ok: true });
    return;
  }

  let identity = null;
  if (usePostgres) {
    const found = await pgPool.query(
      `SELECT user_id, telegram_link_code, telegram_code_expires_at
       FROM auth_identities
       WHERE telegram_link_code = $1
       LIMIT 1;`,
      [code]
    );
    if (found.rows.length) {
      const r = found.rows[0];
      identity = {
        userId: r.user_id,
        telegramLinkCode: r.telegram_link_code,
        telegramCodeExpiresAt: r.telegram_code_expires_at
      };
    }
  } else {
    identity = readJsonArray(authIdentitiesPath).find((x) => String(x.telegramLinkCode || "").toUpperCase() === code) || null;
  }

  if (!identity || !identity.telegramCodeExpiresAt || new Date(identity.telegramCodeExpiresAt).getTime() < Date.now()) {
    await sendTelegramMessage(String(msg.chat.id), "Code not found or expired. Generate a new code on the website.");
    res.status(200).json({ ok: true });
    return;
  }

  await storageCreateOrUpdateTelegramLink({
    id: auditId(),
    userId: identity.userId,
    telegramUserId: fromId,
    telegramUsername: username,
    status: "linked",
    linkedAt: new Date().toISOString()
  });
  const fullIdentity = await storageGetIdentityByUserId(identity.userId);
  await storageUpsertIdentity({
    ...fullIdentity,
    telegramLinkCode: null,
    telegramCodeExpiresAt: null
  });
  await storageAudit({
    action: "telegram.link.complete",
    actorId: identity.userId,
    targetType: "telegram_link",
    targetId: fromId,
    metadata: { username },
    ip: req.ip
  });
  await sendTelegramMessage(String(msg.chat.id), "Account linked successfully.");
  res.status(200).json({ ok: true });
});

app.get("/api/stats", async (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const stories = (await storageGetStories()).filter((s) => s.status === "published" && (country === "global" || s.country === country));

  const laidOff = stories.reduce((sum, s) => sum + Number(s.estimatedLayoffs || 1), 0);
  const sharedStories = stories.length;
  const foundJob = stories.filter((s) => s.foundNewJob).length;
  const distinctCompanies = new Set(stories.map((s) => s.company)).size;
  const foundRate = sharedStories > 0 ? Math.round((foundJob / sharedStories) * 100) : 0;

  res.json({
    country,
    counters: {
      laidOff,
      sharedStories,
      foundJob,
      distinctCompanies
    },
    foundRate
  });
});

app.get("/api/stories", async (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const limit = Math.min(Number(req.query.limit || 12), 50);
  const stories = (await storageGetStories())
    .filter((s) => s.status === "published" && (country === "global" || s.country === country))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(maskStoryByPrivacy)
    .map((s) => ({ ...s, confidenceScore: computeConfidenceScore(s) }));
  res.json({ country, stories, crisisResources: getCrisisResources(country) });
});

function buildStoryPayload(req, options = {}) {
  const privacyFromRequest = mapVisibilityToPrivacy(req.body.privacy || req.body.visibility || {});
  const city = sanitizeText(req.body.city || "");
  const aiTool = sanitizeText(req.body.aiTool || "");
  const newRoleField = sanitizeText(req.body.newRoleField || "");
  const payload = {
    ...req.body,
    name: sanitizeText(req.body.name),
    profession: sanitizeText(req.body.profession),
    company: sanitizeText(req.body.company || "Undisclosed"),
    reason: sanitizeText(req.body.reason),
    story: sanitizeText(req.body.story),
    laidOffAt: sanitizeText(req.body.laidOffAt),
    city: city || undefined,
    aiTool: aiTool || undefined,
    newRoleField: newRoleField || undefined,
    privacy: privacyFromRequest,
    country: normalizeCountry(req.body.country),
    language: normalizeLanguage(req.body.language),
    foundNewJob: req.body.foundNewJob === true || req.body.foundNewJob === "true",
    tenureYears: req.body.tenureYears === undefined || req.body.tenureYears === "" ? undefined : Number(req.body.tenureYears),
    salaryBefore: req.body.salaryBefore === undefined || req.body.salaryBefore === "" ? undefined : Number(req.body.salaryBefore),
    salaryAfter: req.body.salaryAfter === undefined || req.body.salaryAfter === "" ? undefined : Number(req.body.salaryAfter),
    compensationMonths: req.body.compensationMonths === undefined || req.body.compensationMonths === "" ? undefined : Number(req.body.compensationMonths),
    searchingMonths: req.body.searchingMonths === undefined || req.body.searchingMonths === "" ? undefined : Number(req.body.searchingMonths),
    moodScore: req.body.moodScore === undefined || req.body.moodScore === "" ? undefined : Number(req.body.moodScore),
    layoffType: req.body.layoffType ? sanitizeText(req.body.layoffType) : undefined,
    warnedAhead: req.body.warnedAhead ? sanitizeText(req.body.warnedAhead) : undefined,
    ndaConfirmed: req.body.ndaConfirmed === true || req.body.ndaConfirmed === "true"
    ,
    evidenceTier: req.body.evidenceTier ? sanitizeText(req.body.evidenceTier) : undefined
  };
  const parsed = storySchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((e) => ({ field: e.path[0], message: e.message })) };
  }
  if (!parsed.data.ndaConfirmed && !options.skipNda) {
    return { ok: false, errors: [{ field: "ndaConfirmed", message: "You must confirm NDA/legal notice before submission" }] };
  }
  return { ok: true, data: parsed.data };
}

function buildStoryRecord(parsedData, submittedBy, moderation, initialStatus) {
  const details = {
    city: parsedData.city || null,
    tenureYears: parsedData.tenureYears ?? null,
    salaryBefore: parsedData.salaryBefore ?? null,
    salaryAfter: parsedData.salaryAfter ?? null,
    layoffType: parsedData.layoffType || null,
    aiTool: parsedData.aiTool || null,
    warnedAhead: parsedData.warnedAhead || null,
    compensationMonths: parsedData.compensationMonths ?? null,
    searchingMonths: parsedData.searchingMonths ?? null,
    newRoleField: parsedData.newRoleField || null,
    moodScore: parsedData.moodScore ?? null,
    updateLabel: null,
    evidenceTier: parsedData.evidenceTier || "self_report"
  };
  const metrics = {
    views: 0,
    meToo: 0,
    commentsCount: 0
  };
  return ensureStoryDefaults({
    id: storyId(),
    ...parsedData,
    status: initialStatus,
    estimatedLayoffs: 1,
    moderation,
    details,
    metrics,
    submittedBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

app.post("/api/stories", storySubmitLimiter, requireAuth, requireVerifiedPhone, async (req, res) => {
  if (isAccountMuted(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const prepared = buildStoryPayload(req);
  if (!prepared.ok) {
    res.status(422).json({
      message: "Validation failed",
      errors: prepared.errors
    });
    return;
  }

  const moderation = scoreModeration(prepared.data);
  const initialStatus = moderation.riskBand === "high" ? "rejected" : "pending";
  const newStory = buildStoryRecord(prepared.data, req.user.id, moderation, initialStatus);
  await storageInsertStory(newStory);
  await storageInsertStoryVersion({
    id: auditId(),
    storyId: newStory.id,
    versionNo: 1,
    payload: newStory,
    createdBy: req.user.id,
    createdAt: newStory.createdAt
  });
  await storageAudit({
    action: "story.submit",
    actorId: req.user?.id || null,
    targetType: "story",
    targetId: newStory.id,
    metadata: { country: newStory.country, language: newStory.language, moderation },
    ip: req.ip
  });

  if (moderation.riskBand !== "low" && TELEGRAM_MOD_CHAT_ID) {
    await sendTelegramMessage(
      TELEGRAM_MOD_CHAT_ID,
      `New story flagged (${moderation.riskBand})\nID: ${newStory.id}\nCountry: ${newStory.country}\nRisk: ${JSON.stringify(moderation)}`
    );
  }

  res.status(initialStatus === "rejected" ? 202 : 201).json({
    message: initialStatus === "rejected" ? "Story auto-flagged for high-risk review" : "Story submitted for moderation",
    id: newStory.id,
    status: newStory.status,
    moderation,
    deanonymizationRisk: moderation.deanonymization,
    recommendations: moderation.recommendations,
    crisisResources: moderation.crisis ? getCrisisResources(newStory.country) : []
  });
});

app.post("/api/stories/anonymous", storySubmitLimiter, async (req, res) => {
  if (REQUIRE_CAPTCHA && !sanitizeText(req.body.captchaToken)) {
    res.status(422).json({ message: "Captcha token required" });
    return;
  }
  req.body = {
    ...req.body,
    name: sanitizeText(req.body.name || "Anonymous"),
    company: sanitizeText(req.body.company || "Undisclosed")
  };
  const prepared = buildStoryPayload(req);
  if (!prepared.ok) {
    res.status(422).json({ message: "Validation failed", errors: prepared.errors });
    return;
  }
  const moderation = scoreModeration(prepared.data);
  const initialStatus = moderation.riskBand === "high" ? "rejected" : "pending";
  const newStory = buildStoryRecord(prepared.data, null, moderation, initialStatus);
  await storageInsertStory(newStory);
  await storageAudit({
    action: "story.submit.anonymous",
    actorId: null,
    targetType: "story",
    targetId: newStory.id,
    metadata: { country: newStory.country, language: newStory.language, moderation },
    ip: req.ip
  });
  res.status(initialStatus === "rejected" ? 202 : 201).json({
    message: "Anonymous story submitted for moderation",
    id: newStory.id,
    status: newStory.status,
    moderation
  });
});

app.post("/api/stories/:id/view", async (req, res) => {
  const updated = await storagePatchStory(req.params.id, (story) => ({
    metrics: {
      ...story.metrics,
      views: Number(story.metrics?.views || 0) + 1
    }
  }));
  if (!updated) {
    res.status(404).json({ message: "Story not found" });
    return;
  }
  res.json({ id: updated.id, views: updated.metrics.views });
});

app.post("/api/stories/:id/me-too", async (req, res) => {
  const updated = await storagePatchStory(req.params.id, (story) => ({
    metrics: {
      ...story.metrics,
      meToo: Number(story.metrics?.meToo || 0) + 1
    }
  }));
  if (!updated) {
    res.status(404).json({ message: "Story not found" });
    return;
  }
  res.json({ id: updated.id, meToo: updated.metrics.meToo });
});

app.post("/api/stories/:id/comment", requireAuth, async (req, res) => {
  const body = sanitizeText(req.body.body || "");
  if (body.length < 2) {
    res.status(422).json({ message: "Comment is too short" });
    return;
  }
  const updated = await storagePatchStory(req.params.id, (story) => ({
    metrics: {
      ...story.metrics,
      commentsCount: Number(story.metrics?.commentsCount || 0) + 1
    }
  }));
  if (!updated) {
    res.status(404).json({ message: "Story not found" });
    return;
  }
  await storageAudit({
    action: "story.comment",
    actorId: req.user.id,
    targetType: "story",
    targetId: req.params.id,
    metadata: {},
    ip: req.ip
  });
  res.status(201).json({ ok: true, commentsCount: updated.metrics.commentsCount });
});

app.post("/api/stories/:id/update", requireAuth, async (req, res) => {
  const storyIdValue = sanitizeText(req.params.id);
  const current = (await storageGetStories()).find((s) => s.id === storyIdValue);
  if (!current) {
    res.status(404).json({ message: "Story not found" });
    return;
  }
  if (current.submittedBy && current.submittedBy !== req.user.id && !hasModeratorRole(req.user)) {
    res.status(403).json({ message: "Not allowed" });
    return;
  }
  const foundNewJob = req.body.foundNewJob === true || req.body.foundNewJob === "true";
  const note = sanitizeText(req.body.updateLabel || "");
  const updated = await storagePatchStory(storyIdValue, (story) => ({
    foundNewJob,
    details: {
      ...story.details,
      updateLabel: note || story.details?.updateLabel || null
    }
  }));
  await storageAudit({
    action: "story.update.status",
    actorId: req.user.id,
    targetType: "story",
    targetId: storyIdValue,
    metadata: { foundNewJob },
    ip: req.ip
  });
  res.json({
    id: storyIdValue,
    foundNewJob: Boolean(updated?.foundNewJob),
    updateLabel: updated?.details?.updateLabel || null
  });
});

app.get("/api/companies/top", async (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const companies = getTopCompanies(await storageGetStories(), country);
  res.json({ country, companies });
});

app.get("/api/companies/:slug", async (req, res) => {
  const profile = toCompanyProfile(await storageGetStories(), sanitizeText(req.params.slug));
  if (!profile) {
    res.status(404).json({ message: "Company profile not found" });
    return;
  }
  res.json(profile);
});

app.get("/api/statistics/dashboard", async (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const stories = await storageGetStories();
  res.json(getDashboard(stories, country));
});

app.get("/api/counters", async (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const stories = (await storageGetStories()).filter((s) => country === "global" || s.country === country);
  res.json({ country, counters: buildCounters(stories) });
});

app.get("/api/stories/:id/confidence", async (req, res) => {
  const id = sanitizeText(req.params.id);
  const story = (await storageGetStories()).find((s) => s.id === id);
  if (!story) {
    res.status(404).json({ message: "Story not found" });
    return;
  }
  res.json({
    id,
    confidenceScore: computeConfidenceScore(story),
    evidenceTier: story.evidenceTier || "self_report",
    moderation: story.moderation || {}
  });
});

app.get("/api/companies/:slug/timeline", async (req, res) => {
  const slug = sanitizeText(req.params.slug);
  const stories = (await storageGetStories()).filter((s) => s.status === "published" && slugifyCompany(s.company) === slug);
  if (!stories.length) {
    res.status(404).json({ message: "Company profile not found" });
    return;
  }
  const byMonth = new Map();
  for (const s of stories) {
    const month = String(s.laidOffAt || "").slice(0, 7) || "unknown";
    byMonth.set(month, (byMonth.get(month) || 0) + Number(s.estimatedLayoffs || 1));
  }
  res.json({
    slug,
    company: stories[0].company,
    timeline: [...byMonth.entries()].map(([month, layoffs]) => ({ month, layoffs })).sort((a, b) => a.month.localeCompare(b.month))
  });
});

app.get("/api/companies/:slug/board/topics", async (req, res) => {
  const slug = sanitizeText(req.params.slug);
  const source = readCompanyBoards();
  const rows = source.length ? source : defaultCompanyBoards;
  const topics = rows.filter((x) => x.companySlug === slug).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ companySlug: slug, topics });
});

app.post("/api/companies/:slug/board/topics", requireAuth, async (req, res) => {
  const slug = sanitizeText(req.params.slug);
  const title = sanitizeText(req.body.title);
  const body = sanitizeText(req.body.body);
  if (title.length < 8 || body.length < 20) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  const entry = {
    id: topicId(),
    companySlug: slug,
    title,
    body,
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  const rows = readCompanyBoards();
  rows.push(entry);
  writeJsonArray(companyBoardsPath, rows.slice(-5000));
  res.status(201).json(entry);
});

app.get("/api/resources", (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const source = readResources();
  const rows = source.length ? source : defaultResources;
  const resources = rows.filter((x) => x.region === "global" || x.region === country);
  res.json({ country, resources });
});

app.get("/api/resources/match", (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const profession = sanitizeText(req.query.profession || "").toLowerCase();
  const months = Number(req.query.months || 0);
  const source = readResources();
  const rows = source.length ? source : defaultResources;
  const matched = rows.filter((r) => {
    const regionOk = r.region === "global" || r.region === country;
    const professionOk = !profession || `${r.title} ${r.summary} ${r.type}`.toLowerCase().includes(profession);
    const urgencyBoost = months >= 6 ? (r.type === "jobs" || r.type === "reskilling") : true;
    return regionOk && professionOk && urgencyBoost;
  });
  res.json({ country, profession, months, resources: matched });
});

app.get("/api/news", (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const source = readNews();
  const rows = source.length ? source : defaultNews;
  const news = rows
    .filter((x) => x.region === "global" || x.region === country)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  res.json({ country, news });
});

app.get("/api/legal/methodology", (_req, res) => {
  res.json({
    methodology: {
      storiesCounter: "Counts published stories only.",
      layoffCounter: "Sum of estimatedLayoffs from published stories.",
      verifiedSignal: "Phone-verified submitters are labeled as higher trust in moderation metadata.",
      limitations: [
        "Self-reported stories may contain uncertainty.",
        "Aggregates are directional, not labor-market census values."
      ]
    }
  });
});

app.post("/api/privacy/redaction-assistant", async (req, res) => {
  const text = sanitizeText(req.body.text || "");
  if (text.length < 20) {
    res.status(422).json({ message: "Text too short" });
    return;
  }
  const score = scoreModeration({ reason: text, story: text });
  res.json({
    risk: score,
    suggestions: [
      "Remove exact dates and unique team identifiers.",
      "Mask specific product/project codenames.",
      "Consider switching company visibility to masked."
    ]
  });
});

app.post("/api/anonymous/inbox", async (req, res) => {
  const message = sanitizeText(req.body.message || "");
  const channel = sanitizeText(req.body.channel || "web");
  if (message.length < 20) {
    res.status(422).json({ message: "Message too short" });
    return;
  }
  const trackingCode = `INB-${linkCodeId()}`;
  const row = {
    id: auditId(),
    trackingCode,
    message,
    channel,
    status: "received",
    createdAt: new Date().toISOString()
  };
  const entries = readAnonymousInbox();
  entries.push(row);
  writeJsonArray(anonymousInboxPath, entries.slice(-5000));
  res.status(201).json({ trackingCode, status: row.status });
});

app.get("/api/submission/onion-info", (_req, res) => {
  res.json({
    enabled: false,
    note: "Onion endpoint is not configured yet.",
    guidance: "Use anonymous inbox or secure channel until onion service is enabled."
  });
});

app.get("/api/cohorts", (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const profession = sanitizeText(req.query.profession || "").toLowerCase();
  const source = readCohorts();
  const rows = source.length ? source : defaultCohorts;
  const cohorts = rows.filter((c) => (c.country === "global" || c.country === country) && (!profession || String(c.profession || "").toLowerCase().includes(profession)));
  res.json({ country, cohorts });
});

app.post("/api/cohorts", requireAuth, async (req, res) => {
  const title = sanitizeText(req.body.title || "");
  const profession = sanitizeText(req.body.profession || "");
  const country = normalizeCountry(req.body.country || "global");
  const capacity = Number(req.body.capacity || 0);
  if (title.length < 8 || profession.length < 2 || capacity < 5) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  const row = {
    id: `cohort-${topicId()}`,
    title,
    profession,
    country,
    capacity,
    enrolled: 0,
    startsAt: sanitizeText(req.body.startsAt || ""),
    status: "open"
  };
  const entries = readCohorts();
  entries.push(row);
  writeJsonArray(cohortsPath, entries.slice(-1000));
  res.status(201).json(row);
});

app.get("/api/campaigns/petitions", (_req, res) => {
  const source = readPetitions();
  const petitions = source.length ? source : defaultPetitions;
  res.json({ petitions });
});

app.post("/api/campaigns/petitions", requireAuth, async (req, res) => {
  const title = sanitizeText(req.body.title || "");
  const description = sanitizeText(req.body.description || "");
  const goal = Number(req.body.goal || 0);
  if (title.length < 10 || description.length < 20 || goal < 10) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  const row = {
    id: `pet-${topicId()}`,
    title,
    description,
    goal,
    signatures: 0,
    status: "open",
    createdAt: new Date().toISOString()
  };
  const entries = readPetitions();
  entries.push(row);
  writeJsonArray(petitionsPath, entries.slice(-1000));
  res.status(201).json(row);
});

app.post("/api/campaigns/petitions/:id/sign", async (req, res) => {
  const id = sanitizeText(req.params.id);
  const entries = readPetitions();
  const idx = entries.findIndex((p) => p.id === id);
  if (idx < 0) {
    res.status(404).json({ message: "Petition not found" });
    return;
  }
  entries[idx].signatures = Number(entries[idx].signatures || 0) + 1;
  writeJsonArray(petitionsPath, entries);
  res.json({ id, signatures: entries[idx].signatures });
});

app.get("/api/transparency/center", async (req, res) => {
  const periodDays = Number(req.query.days || 30);
  const from = new Date(Date.now() - periodDays * 24 * 3600 * 1000).toISOString();
  const events = await storageGetAuditRange(from, new Date().toISOString());
  const takedowns = readJsonArray(takedownsPath);
  const counters = buildCounters(await storageGetStories());
  res.json({
    generatedAt: new Date().toISOString(),
    counters,
    moderationActions: events.filter((x) => x.action === "moderation.action").length,
    sanctions: events.filter((x) => x.action === "sanction.create").length,
    takedownsRequested: takedowns.length,
    anomalySignals: events.filter((x) => x.action && x.action.includes("anomaly")).length
  });
});

app.post("/api/legal/takedown", async (req, res) => {
  const payload = {
    email: normalizeEmail(req.body.email),
    reason: sanitizeText(req.body.reason),
    targetUrl: sanitizeText(req.body.targetUrl),
    legalBasis: sanitizeText(req.body.legalBasis)
  };
  if (!payload.email || !payload.reason || !payload.targetUrl) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  const entry = {
    id: auditId(),
    email: payload.email,
    reason: payload.reason,
    targetUrl: payload.targetUrl,
    legalBasis: payload.legalBasis || "unspecified",
    createdAt: new Date().toISOString(),
    status: "pending"
  };
  const rows = readJsonArray(takedownsPath);
  rows.push(entry);
  writeJsonArray(takedownsPath, rows.slice(-5000));
  await storageAudit({
    action: "legal.takedown.request",
    actorId: null,
    targetType: "takedown",
    targetId: entry.id,
    metadata: { targetUrl: entry.targetUrl },
    ip: req.ip
  });
  res.status(201).json({ id: entry.id, status: entry.status });
});

app.get("/api/forum/categories", (_req, res) => {
  res.json({ categories: forumCategories });
});

app.get("/api/forum/topics", async (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const topics = await storageGetForumTopics(country);
  res.json({
    country,
    topics: topics.map((t) => ({
      id: t.id,
      categoryId: t.categoryId,
      title: t.title,
      replies: Number(t.replies || 0),
      lastUpdate: t.lastUpdate
    }))
  });
});

app.post("/api/forum/topics", requireAuth, requireVerifiedPhone, async (req, res) => {
  if (isAccountMuted(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const payload = {
    country: normalizeCountry(req.body.country || defaultCountry),
    language: normalizeLanguage(req.body.language || defaultLang),
    categoryId: sanitizeText(req.body.categoryId),
    title: sanitizeText(req.body.title),
    body: sanitizeText(req.body.body)
  };
  const parsed = forumTopicSchema.safeParse(payload);
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  if (!forumCategories.some((c) => c.id === parsed.data.categoryId)) {
    res.status(422).json({ message: "Unknown category" });
    return;
  }
  const topic = {
    id: topicId(),
    categoryId: parsed.data.categoryId,
    title: parsed.data.title,
    body: parsed.data.body,
    country: parsed.data.country,
    language: parsed.data.language,
    status: "published",
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  await storageInsertForumTopic(topic);
  await storageAudit({
    action: "forum.topic.create",
    actorId: req.user.id,
    targetType: "forum_topic",
    targetId: topic.id,
    metadata: { categoryId: topic.categoryId },
    ip: req.ip
  });
  res.status(201).json({ id: topic.id, status: topic.status });
});

app.post("/api/forum/topics/:id/replies", requireAuth, async (req, res) => {
  if (isAccountMuted(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const topic = (await storageGetForumTopics(null)).find((t) => t.id === req.params.id);
  if (!topic) {
    res.status(404).json({ message: "Topic not found" });
    return;
  }
  const payload = {
    country: normalizeCountry(req.body.country || topic.country || defaultCountry),
    language: normalizeLanguage(req.body.language || topic.language || defaultLang),
    body: sanitizeText(req.body.body)
  };
  const parsed = forumReplySchema.safeParse(payload);
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  const reply = {
    id: replyId(),
    topicId: topic.id,
    body: parsed.data.body,
    country: parsed.data.country,
    language: parsed.data.language,
    status: "published",
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  await storageInsertForumReply(reply);
  await storageAudit({
    action: "forum.reply.create",
    actorId: req.user.id,
    targetType: "forum_reply",
    targetId: reply.id,
    metadata: { topicId: topic.id },
    ip: req.ip
  });
  res.status(201).json({ id: reply.id, topicId: topic.id });
});

app.get("/api/admin/overview", async (req, res) => {
  if (!(hasAdminToken(req) || hasModeratorRole(req.user))) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const stories = await storageGetStories();
  const published = stories.filter((s) => s.status === "published");
  const pending = stories.filter((s) => s.status === "pending");
  const queue = await storageGetModerationQueue();
  const users = await storageGetUsers();

  res.json({
    moderation: {
      pendingStories: pending.length,
      publishedStories: published.length,
      queueItems: queue.length
    },
    users: {
      registeredEstimate: users.length || (published.length * 3 + pending.length)
    },
    system: {
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }
  });
});

app.get("/api/admin/moderation/queue", requireAdminOrToken, async (req, res) => {
  const queue = await storageGetModerationQueue();
  res.json({ queue });
});

app.get("/api/admin/anomalies", requireAdminOrToken, async (req, res) => {
  const now = Date.now();
  const from = new Date(now - 24 * 3600 * 1000).toISOString();
  const events = await storageGetAuditRange(from, new Date(now).toISOString());
  const byIp = new Map();
  const byActor = new Map();

  for (const ev of events) {
    if (!ev.ip) continue;
    byIp.set(ev.ip, (byIp.get(ev.ip) || 0) + 1);
    if (ev.actorId) byActor.set(ev.actorId, (byActor.get(ev.actorId) || 0) + 1);
  }
  const noisyIps = [...byIp.entries()].filter(([, count]) => count >= 20).map(([ip, count]) => ({ ip, count }));
  const noisyActors = [...byActor.entries()].filter(([, count]) => count >= 15).map(([actorId, count]) => ({ actorId, count }));

  const anomalies = [
    ...noisyIps.map((x) => ({ type: "ip_activity_spike", ...x })),
    ...noisyActors.map((x) => ({ type: "actor_activity_spike", ...x }))
  ];
  res.json({ window: "24h", anomalies });
});

app.get("/api/admin/anomaly/signals", requireAdminOrToken, async (req, res) => {
  const now = Date.now();
  const from = new Date(now - 24 * 3600 * 1000).toISOString();
  const events = await storageGetAuditRange(from, new Date(now).toISOString());
  const byIp = new Map();
  for (const ev of events) {
    if (!ev.ip) continue;
    byIp.set(ev.ip, (byIp.get(ev.ip) || 0) + 1);
  }
  const signals = [...byIp.entries()]
    .filter(([, count]) => count >= 20)
    .map(([ip, count]) => ({
      severity: count >= 50 ? "high" : "medium",
      type: "ip_activity_spike",
      summary: `IP ${ip} produced ${count} events in 24h`,
      count,
      createdAt: new Date().toISOString()
    }));
  res.json({ window: "24h", signals });
});

app.get("/api/admin/anomalies/signals", requireAdminOrToken, async (req, res) => {
  const now = Date.now();
  const from = new Date(now - 24 * 3600 * 1000).toISOString();
  const events = await storageGetAuditRange(from, new Date(now).toISOString());
  const byIp = new Map();
  for (const ev of events) {
    if (!ev.ip) continue;
    byIp.set(ev.ip, (byIp.get(ev.ip) || 0) + 1);
  }
  const signals = [...byIp.entries()]
    .filter(([, count]) => count >= 20)
    .map(([ip, count]) => ({
      severity: count >= 50 ? "high" : "medium",
      type: "ip_activity_spike",
      summary: `IP ${ip} produced ${count} events in 24h`,
      count,
      createdAt: new Date().toISOString()
    }));
  res.json({ window: "24h", signals });
});

app.get("/api/antiabuse/anomaly/signals", requireAdminOrToken, async (req, res) => {
  const now = Date.now();
  const from = new Date(now - 24 * 3600 * 1000).toISOString();
  const events = await storageGetAuditRange(from, new Date(now).toISOString());
  const byIp = new Map();
  for (const ev of events) {
    if (!ev.ip) continue;
    byIp.set(ev.ip, (byIp.get(ev.ip) || 0) + 1);
  }
  const signals = [...byIp.entries()]
    .filter(([, count]) => count >= 20)
    .map(([ip, count]) => ({
      severity: count >= 50 ? "high" : "medium",
      type: "ip_activity_spike",
      summary: `IP ${ip} produced ${count} events in 24h`,
      count,
      createdAt: new Date().toISOString()
    }));
  res.json({ window: "24h", signals });
});

app.post("/api/admin/moderation/:id/action", requireAdminOrToken, async (req, res) => {
  const parsed = moderationActionSchema.safeParse({
    action: req.body.action,
    reason: sanitizeText(req.body.reason || "")
  });
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }
  const ok = await storageModerationAction(req.params.id, parsed.data.action, parsed.data.reason);
  if (!ok) {
    res.status(404).json({ message: "Queue entry not found" });
    return;
  }
  await storageAudit({
    action: "moderation.action",
    actorId: req.user?.id || "admin-token",
    targetType: "queue_entry",
    targetId: req.params.id,
    metadata: parsed.data,
    ip: req.ip
  });
  if (String(req.params.id).startsWith("story:")) {
    const storyKey = String(req.params.id).split(":")[1];
    const current = (await storageGetStories()).find((s) => s.id === storyKey);
    if (current) {
      await storageInsertStoryVersion({
        id: auditId(),
        storyId: storyKey,
        versionNo: 2,
        payload: { status: current.status, moderationReason: parsed.data.reason },
        createdBy: req.user?.id || "admin-token",
        createdAt: new Date().toISOString()
      });
    }
    await storageInsertTransparencyEvent({
      id: auditId(),
      eventType: "moderation",
      status: parsed.data.action,
      details: { entryId: req.params.id, reason: parsed.data.reason },
      createdAt: new Date().toISOString()
    });
  }
  res.json({ ok: true });
});

app.get("/api/admin/moderation/:id/scores", requireAdminOrToken, async (req, res) => {
  const [kind, id] = String(req.params.id || "").split(":");
  if (kind !== "story" || !id) {
    res.status(422).json({ message: "Use id format story:<storyId>" });
    return;
  }
  const story = (await storageGetStories()).find((s) => s.id === id);
  if (!story) {
    res.status(404).json({ message: "Story not found" });
    return;
  }
  res.json({
    id: `story:${story.id}`,
    status: story.status,
    moderation: story.moderation || {}
  });
});

app.post("/api/admin/sanctions", requireAdminOrToken, async (req, res) => {
  const parsed = sanctionSchema.safeParse({
    targetUserId: sanitizeText(req.body.targetUserId),
    type: sanitizeText(req.body.type),
    reason: sanitizeText(req.body.reason),
    durationDays: typeof req.body.durationDays === "number" ? req.body.durationDays : Number(req.body.durationDays || 0) || undefined
  });
  if (!parsed.success) {
    res.status(422).json({ message: "Validation failed" });
    return;
  }

  const targetUser = await storageGetUserById(parsed.data.targetUserId);
  if (!targetUser) {
    res.status(404).json({ message: "Target user not found" });
    return;
  }

  const now = Date.now();
  const duration = (parsed.data.durationDays || 0) * 24 * 3600 * 1000;
  const patch = {};
  if (parsed.data.type === "mute" && duration > 0) patch.mutedUntil = new Date(now + duration).toISOString();
  if ((parsed.data.type === "suspend" || parsed.data.type === "ban") && duration > 0) patch.bannedUntil = new Date(now + duration).toISOString();
  if (parsed.data.type === "ban" && !duration) patch.bannedUntil = new Date("2099-12-31T00:00:00.000Z").toISOString();
  if (parsed.data.type === "warn") patch.mutedUntil = targetUser.mutedUntil || null;

  if (Object.keys(patch).length) {
    const updated = await storageUpdateUserSanction(targetUser.id, patch);
    if (!updated) {
      res.status(500).json({ message: "Could not update user sanction" });
      return;
    }
  }

  const sanctionEntry = {
    id: sanctionId(),
    targetUserId: targetUser.id,
    type: parsed.data.type,
    reason: parsed.data.reason,
    durationDays: parsed.data.durationDays || null,
    createdBy: req.user?.id || "admin-token",
    createdAt: new Date().toISOString()
  };
  await storageInsertSanction(sanctionEntry);
  await storageAudit({
    action: "sanction.create",
    actorId: req.user?.id || "admin-token",
    targetType: "user",
    targetId: targetUser.id,
    metadata: sanctionEntry,
    ip: req.ip
  });
  await storageInsertTransparencyEvent({
    id: auditId(),
    eventType: "sanction",
    status: parsed.data.type,
    details: {
      targetUserId: targetUser.id,
      reason: parsed.data.reason,
      durationDays: parsed.data.durationDays || null
    },
    createdAt: sanctionEntry.createdAt
  });
  res.status(201).json({ id: sanctionEntry.id });
});

app.get("/api/research/aggregate", async (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const stories = (await storageGetStories()).filter((s) => s.status === "published" && (country === "global" || s.country === country));
  const byProfession = new Map();
  const byMonth = new Map();
  for (const s of stories) {
    byProfession.set(s.profession, (byProfession.get(s.profession) || 0) + 1);
    const monthKey = String(s.laidOffAt || "").slice(0, 7) || "unknown";
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + 1);
  }
  const topProfessions = [...byProfession.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([profession, storiesCount]) => ({ profession, storiesCount }));
  const monthlyTrend = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, storiesCount]) => ({ month, storiesCount }));

  res.json({
    country,
    generatedAt: new Date().toISOString(),
    totalPublishedStories: stories.length,
    topProfessions,
    monthlyTrend
  });
});

app.get("/api/research/aggregates", async (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const stories = (await storageGetStories()).filter((s) => s.status === "published" && (country === "global" || s.country === country));
  const byProfession = new Map();
  const byMonth = new Map();
  for (const s of stories) {
    byProfession.set(s.profession, (byProfession.get(s.profession) || 0) + 1);
    const monthKey = String(s.laidOffAt || "").slice(0, 7) || "unknown";
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + 1);
  }
  const topProfessions = [...byProfession.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([profession, storiesCount]) => ({ profession, storiesCount }));
  const monthlyTrend = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, storiesCount]) => ({ month, storiesCount }));

  res.json({
    country,
    generatedAt: new Date().toISOString(),
    totalPublishedStories: stories.length,
    topProfessions,
    monthlyTrend
  });
});

app.get("/api/transparency/report", async (req, res) => {
  const now = new Date();
  let from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  let to = req.query.to ? new Date(String(req.query.to)) : now;
  const period = String(req.query.period || "").trim();
  if (period) {
    const quarterMatch = /^(\d{4})-Q([1-4])$/i.exec(period);
    if (quarterMatch) {
      const year = Number(quarterMatch[1]);
      const q = Number(quarterMatch[2]);
      const startMonth = (q - 1) * 3;
      from = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0));
      to = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59));
    }
  }
  const events = await storageGetAuditRange(from.toISOString(), to.toISOString());
  const totals = {
    registrations: 0,
    storiesSubmitted: 0,
    moderationActions: 0,
    sanctions: 0,
    telegramLinks: 0
  };
  for (const ev of events) {
    if (ev.action === "auth.register") totals.registrations += 1;
    if (ev.action === "story.submit") totals.storiesSubmitted += 1;
    if (ev.action === "moderation.action") totals.moderationActions += 1;
    if (ev.action === "sanction.create") totals.sanctions += 1;
    if (ev.action === "telegram.link.complete") totals.telegramLinks += 1;
  }
  res.json({
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      label: period || null
    },
    totals
  });
});

app.get("/", (req, res) => {
  const locale = detectLocale(req);
  res.redirect(`/${locale.country}/${locale.lang}/`);
});

app.get("/:country/:lang", (req, res) => {
  const country = normalizeCountry(req.params.country);
  const lang = normalizeLanguage(req.params.lang);
  if (country !== req.params.country.toLowerCase() || lang !== req.params.lang.toLowerCase()) {
    res.redirect(`/${country}/${lang}/`);
    return;
  }
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get(/^\/([a-z]{2,10})\/([a-z]{2})(?:\/.*)?$/i, (req, res) => {
  const country = normalizeCountry(req.params[0]);
  const lang = normalizeLanguage(req.params[1]);
  const rawCountry = String(req.params[0]).toLowerCase();
  const rawLang = String(req.params[1]).toLowerCase();
  if (country !== rawCountry || lang !== rawLang) {
    res.redirect(`/${country}/${lang}/`);
    return;
  }
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

async function start() {
  if (usePostgres) {
    pgPool = await buildPgPool();
    await initStorage();
    console.log("Storage mode: postgres");
  } else {
    console.log("Storage mode: file-json");
  }
  app.listen(port, () => {
    console.log(`aitookmyjob running on :${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
