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

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8080);
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const storiesPath = path.join(dataDir, "stories.json");

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-me-admin-token";
const DATABASE_URL = process.env.DATABASE_URL || "";
const PG_SSL = String(process.env.PG_SSL || "false").toLowerCase() === "true";
const defaultCountry = (process.env.DEFAULT_COUNTRY || "global").toLowerCase();
const defaultLang = (process.env.DEFAULT_LANG || "en").toLowerCase();
const rawOrigins = (process.env.CORS_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
const storyId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 12);
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
  if (!usePostgres) return;

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

app.get("/api/forum/topics", (req, res) => {
  const country = normalizeCountry(req.query.country || "global");
  res.json({
    country,
    topics: forumTopics
  });
});

app.get("/api/admin/overview", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const stories = await storageGetStories();
  const published = stories.filter((s) => s.status === "published");
  const pending = stories.filter((s) => s.status === "pending");

  res.json({
    moderation: {
      pendingStories: pending.length,
      publishedStories: published.length
    },
    users: {
      registeredEstimate: published.length * 3 + pending.length
    },
    system: {
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }
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
