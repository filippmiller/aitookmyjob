const fs = require("fs");
const path = require("path");
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

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-me-admin-token";
const DATABASE_URL = process.env.DATABASE_URL || "";
const PG_SSL = String(process.env.PG_SSL || "false").toLowerCase() === "true";
const AUTH_SECRET = process.env.AUTH_SECRET || "change-me-auth-secret";
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
const usePostgres = Boolean(DATABASE_URL);
const pgPool = usePostgres
  ? new Pool({
    connectionString: DATABASE_URL,
    ssl: PG_SSL ? { rejectUnauthorized: false } : undefined
  })
  : null;

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

const storySchema = z.object({
  name: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(20),
  language: z.enum(languages),
  profession: z.string().trim().min(2).max(80),
  company: z.string().trim().min(1).max(120),
  laidOffAt: z.string().trim().min(4).max(20),
  foundNewJob: z.boolean(),
  reason: z.string().trim().min(8).max(240),
  story: z.string().trim().min(40).max(3000)
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
    createdAt: row.created_at
  };
}

async function initStorage() {
  if (!usePostgres) {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const defaults = [
      [usersPath, []],
      [forumTopicsPath, forumTopics],
      [forumRepliesPath, []],
      [sanctionsPath, []],
      [auditLogPath, []]
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_stories_status_country_created ON stories(status, country, created_at DESC);");
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
        found_new_job, reason, story, status, estimated_layoffs, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
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
        s.createdAt || new Date().toISOString()
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
  if (!usePostgres) return readStories();
  const res = await pgPool.query("SELECT * FROM stories ORDER BY created_at DESC;");
  return res.rows.map(mapStoryRow);
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
      found_new_job, reason, story, status, estimated_layoffs, created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
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
      newStory.createdAt
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
      createdAt: s.createdAt
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

function sanitizeText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"]
      }
    },
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
    phone: req.body.phone ? sanitizeText(req.body.phone) : undefined
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
    phone: parsed.data.phone || null,
    role: "user",
    passwordHash,
    createdAt: new Date().toISOString(),
    mutedUntil: null,
    bannedUntil: null
  };
  await storageInsertUser(newUser);
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

app.get("/api/auth/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  res.json({
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
    muted: isAccountMuted(req.user),
    banned: isAccountBanned(req.user)
  });
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
    .slice(0, limit);
  res.json({ country, stories });
});

app.post("/api/stories", storySubmitLimiter, async (req, res) => {
  const payload = {
    ...req.body,
    name: sanitizeText(req.body.name),
    profession: sanitizeText(req.body.profession),
    company: sanitizeText(req.body.company),
    reason: sanitizeText(req.body.reason),
    story: sanitizeText(req.body.story),
    laidOffAt: sanitizeText(req.body.laidOffAt),
    country: normalizeCountry(req.body.country),
    language: normalizeLanguage(req.body.language),
    foundNewJob: req.body.foundNewJob === true || req.body.foundNewJob === "true"
  };

  const parsed = storySchema.safeParse(payload);
  if (!parsed.success) {
    res.status(422).json({
      message: "Validation failed",
      errors: parsed.error.issues.map((e) => ({ field: e.path[0], message: e.message }))
    });
    return;
  }

  const newStory = {
    id: storyId(),
    ...parsed.data,
    status: "pending",
    estimatedLayoffs: 1,
    createdAt: new Date().toISOString()
  };
  await storageInsertStory(newStory);
  await storageAudit({
    action: "story.submit",
    actorId: req.user?.id || null,
    targetType: "story",
    targetId: newStory.id,
    metadata: { country: newStory.country, language: newStory.language },
    ip: req.ip
  });

  res.status(201).json({
    message: "Story submitted for moderation",
    id: newStory.id,
    status: newStory.status
  });
});

app.get("/api/companies/top", async (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  const companies = getTopCompanies(await storageGetStories(), country);
  res.json({ country, companies });
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

app.post("/api/forum/topics", requireAuth, async (req, res) => {
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
  res.json({ ok: true });
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
  res.status(201).json({ id: sanctionEntry.id });
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
