// Shared context — exports all state, config, helpers, and storage functions
// used across route modules. This is the single source of truth for server-wide concerns.

const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const { z } = require("zod");
const { customAlphabet } = require("nanoid");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const dataDir = path.join(__dirname, "..", "data");
const publicDir = path.join(__dirname, "..", "public");
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
const subscribersPath = path.join(dataDir, "subscribers.json");

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
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 24 * 7);
const defaultCountry = (process.env.DEFAULT_COUNTRY || "global").toLowerCase();
const defaultLang = (process.env.DEFAULT_LANG || "en").toLowerCase();

const storyId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 12);
const usrId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const topicId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const replyId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const sanctionId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const auditId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const phoneOtpCode = customAlphabet("0123456789", 6);
const linkCodeId = customAlphabet("1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", 8);
const usePostgres = Boolean(DATABASE_URL);

// Mutable — set during start()
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
  "guest", "user", "verified_user", "expert", "community_lead",
  "journalist", "moderator", "admin", "superadmin", "data_analyst"
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

const seedForumTopics = [
  { id: "t1", categoryId: "cop", title: "How to pivot from copywriting to UX writing?", replies: 38, lastUpdate: "2026-02-10" },
  { id: "t2", categoryId: "dev", title: "Junior developers: where to get first role in AI-first market", replies: 54, lastUpdate: "2026-02-11" },
  { id: "t3", categoryId: "law", title: "Can my company train model on my work without consent?", replies: 19, lastUpdate: "2026-02-10" },
  { id: "t4", categoryId: "sup", title: "Call-center layoffs: what countries still hire humans", replies: 27, lastUpdate: "2026-02-09" },
  { id: "t5", categoryId: "succ", title: "I found a new role after 6 months — ask me anything", replies: 66, lastUpdate: "2026-02-11" }
];

const defaultResources = [
  { id: "res-1", type: "reskilling", title: "Career Transition Playbook", provider: "AI Took My Job", region: "global", url: "https://example.com/career-transition-playbook", summary: "Practical weekly plan to pivot to adjacent roles." },
  { id: "res-2", type: "legal", title: "NDA And Layoff Rights Basics", provider: "Worker Legal Aid", region: "us", url: "https://example.com/nda-rights", summary: "How to share your story without exposing protected confidential data." },
  { id: "res-3", type: "jobs", title: "Human-Centered Roles Board", provider: "Community Curated", region: "global", url: "https://example.com/human-jobs-board", summary: "Open positions in customer support, QA, ops, and compliance." }
];

const defaultNews = [
  { id: "news-1", title: { en: "AI-Fueled Layoffs Are Accelerating — Efficiency or Just an Excuse?", ru: "Увольнения из-за ИИ ускоряются — эффективность или просто отговорка?", de: "KI-getriebene Entlassungen nehmen zu — Effizienz oder nur eine Ausrede?", fr: "Les licenciements liés à l'IA s'accélèrent — efficacité ou simple prétexte ?", es: "Los despidos por IA se aceleran — ¿eficiencia o simple excusa?" }, source: "OpenTools.ai", url: "https://opentools.ai/news/ai-fueled-layoffs-are-accelerating-efficiency-or-just-an-excuse", publishedAt: "2026-01-28T10:00:00.000Z", region: "global" },
  { id: "news-2", title: { en: "Companies Are Already Laying Off Workers Because of AI's Potential", ru: "Компании уже увольняют сотрудников из-за потенциала ИИ", de: "Unternehmen entlassen bereits Mitarbeiter wegen des Potenzials von KI", fr: "Les entreprises licencient déjà à cause du potentiel de l'IA", es: "Las empresas ya están despidiendo trabajadores por el potencial de la IA" }, source: "Harvard Business Review", url: "https://hbr.org/2025/09/companies-are-already-laying-off-workers-because-of-ais-potential", publishedAt: "2026-01-25T14:00:00.000Z", region: "global" },
  { id: "news-3", title: { en: "Nearly 4 in 10 Companies Will Replace Workers with AI by 2030", ru: "Почти 4 из 10 компаний заменят сотрудников ИИ к 2030 году", de: "Fast 4 von 10 Unternehmen werden Mitarbeiter bis 2030 durch KI ersetzen", fr: "Près de 4 entreprises sur 10 remplaceront des employés par l'IA d'ici 2030", es: "Casi 4 de cada 10 empresas reemplazarán trabajadores con IA para 2030" }, source: "HR Dive", url: "https://www.hrdive.com/news/world-economic-forum-ai-jobs-replacing-workers/", publishedAt: "2026-01-22T09:00:00.000Z", region: "global" },
  { id: "news-4", title: { en: "AI Layoffs Are Masking a Much Darker Reality for Workers", ru: "Увольнения из-за ИИ скрывают гораздо более мрачную реальность для работников", de: "KI-Entlassungen verbergen eine viel düsterere Realität für Arbeitnehmer", fr: "Les licenciements liés à l'IA masquent une réalité bien plus sombre pour les travailleurs", es: "Los despidos por IA ocultan una realidad mucho más oscura para los trabajadores" }, source: "Fortune / Oxford Economics", url: "https://fortune.com/2025/12/ai-layoffs-masking-darker-reality/", publishedAt: "2026-01-18T11:00:00.000Z", region: "us" },
  { id: "news-5", title: { en: "Investors Predict AI Is Coming for White-Collar Labor in 2026", ru: "Инвесторы предсказывают: ИИ идёт за офисными работниками в 2026 году", de: "Investoren prognostizieren: KI kommt 2026 für Büroarbeitsplätze", fr: "Les investisseurs prédisent que l'IA s'attaquera aux emplois de bureau en 2026", es: "Los inversores predicen que la IA viene por los empleos de oficina en 2026" }, source: "TechCrunch", url: "https://techcrunch.com/2025/12/investors-predict-ai-labor-2026/", publishedAt: "2026-01-15T08:00:00.000Z", region: "us" },
  { id: "news-6", title: { en: "Big Tech Layoffs 2026: Is AI Really to Blame?", ru: "Массовые увольнения в Big Tech 2026: действительно ли виноват ИИ?", de: "Big-Tech-Entlassungen 2026: Ist wirklich die KI schuld?", fr: "Licenciements massifs dans la tech en 2026 : l'IA est-elle vraiment responsable ?", es: "Despidos masivos en Big Tech 2026: ¿es realmente culpa de la IA?" }, source: "TechResearchOnline", url: "https://techresearchonline.com/blog/big-tech-layoffs-2025-is-ai-to-blame/", publishedAt: "2026-01-12T13:00:00.000Z", region: "global" },
  { id: "news-7", title: { en: "AI Won't Replace Most Jobs — but It Will Reshape Nearly All of Them", ru: "ИИ не заменит большинство профессий — но изменит почти все", de: "KI wird die meisten Jobs nicht ersetzen — aber fast alle verändern", fr: "L'IA ne remplacera pas la plupart des emplois — mais les transformera presque tous", es: "La IA no reemplazará la mayoría de empleos — pero los transformará casi todos" }, source: "TechTimes", url: "https://www.techtimes.com/articles/ai-wont-replace-most-jobs-reshape-work.htm", publishedAt: "2026-01-10T10:00:00.000Z", region: "global" },
  { id: "news-8", title: { en: "More Companies Pointing to AI as They Lay Off Employees", ru: "Всё больше компаний ссылаются на ИИ при увольнении сотрудников", de: "Immer mehr Unternehmen nennen KI als Grund für Entlassungen", fr: "De plus en plus d'entreprises invoquent l'IA pour justifier les licenciements", es: "Cada vez más empresas señalan a la IA al despedir empleados" }, source: "CBS News", url: "https://www.cbsnews.com/news/more-companies-pointing-to-ai-layoffs/", publishedAt: "2026-01-08T15:00:00.000Z", region: "us" },
  { id: "news-9", title: { en: "State of AI in 2026: Workforce Disruption Reaches New Heights", ru: "Состояние ИИ в 2026: разрушение рынка труда достигает новых вершин", de: "Stand der KI 2026: Arbeitsmarktumbruch erreicht neue Höhen", fr: "État de l'IA en 2026 : les perturbations du marché du travail atteignent de nouveaux sommets", es: "Estado de la IA en 2026: la disrupción laboral alcanza nuevas cotas" }, source: "AI World Journal", url: "https://aiworldjournal.com/state-of-ai-2026-workforce-disruption/", publishedAt: "2026-01-05T12:00:00.000Z", region: "global" },
  { id: "news-10", title: { en: "Healthcare AI Trends 2026: From Diagnostics to Administrative Layoffs", ru: "Тренды ИИ в здравоохранении 2026: от диагностики до сокращения администрации", de: "Gesundheits-KI-Trends 2026: Von Diagnostik bis zu Verwaltungsentlassungen", fr: "Tendances IA santé 2026 : du diagnostic aux suppressions de postes administratifs", es: "Tendencias de IA en salud 2026: del diagnóstico a los despidos administrativos" }, source: "Healthcare Dive", url: "https://www.healthcaredive.com/news/healthcare-ai-trends-2026/", publishedAt: "2026-01-03T09:00:00.000Z", region: "global" },
  { id: "news-11", title: { en: "11 Things AI Experts Are Watching For in 2026", ru: "11 вещей, за которыми следят эксперты по ИИ в 2026 году", de: "11 Dinge, die KI-Experten 2026 beobachten", fr: "11 tendances IA que les experts surveillent en 2026", es: "11 cosas que los expertos en IA vigilan en 2026" }, source: "University of Cincinnati", url: "https://www.uc.edu/news/articles/2025/11-things-ai-experts-watching-2026.html", publishedAt: "2025-12-28T10:00:00.000Z", region: "global" },
  { id: "news-12", title: { en: "How AI Technology Is Redefining Everyday Life in 2026", ru: "Как технологии ИИ меняют повседневную жизнь в 2026 году", de: "Wie KI-Technologie den Alltag 2026 verändert", fr: "Comment l'IA redéfinit la vie quotidienne en 2026", es: "Cómo la tecnología de IA está redefiniendo la vida diaria en 2026" }, source: "Bolds Media", url: "https://boldsmedia.com/how-ai-technology-is-redefining-everyday-life-in-2026/", publishedAt: "2025-12-20T14:00:00.000Z", region: "global" }
];

const defaultCompanyBoards = [
  { id: "board-quickhelp-1", companySlug: "quickhelp", title: "Support team layoffs: appeal and rehiring evidence", body: "Collect verifiable reports of post-layoff service quality issues and any rehiring signals.", createdBy: "system", createdAt: "2026-02-10T09:00:00.000Z" }
];

const defaultPetitions = [
  { id: "pet-1", title: "Require disclosure when companies replace workers with AI", description: "Public petition for transparent layoff notices and transition support.", goal: 1000, signatures: 128, status: "open", createdAt: "2026-02-09T12:00:00.000Z" }
];

const defaultCohorts = [
  { id: "cohort-1", title: "30-day Support to QA Transition", profession: "QA Engineer", country: "global", capacity: 50, enrolled: 12, startsAt: "2026-03-01", status: "open" }
];

// ── Zod schemas ──

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

const digestEmailSchema = z.object({
  email: z.string().email().max(254)
});

// ── Helper functions ──

function normalizeCountry(input) {
  const normalized = String(input || "").toLowerCase();
  return countries.some((c) => c.code === normalized) ? normalized : defaultCountry;
}

function normalizeLanguage(input) {
  const normalized = String(input || "").toLowerCase();
  return languages.includes(normalized) ? normalized : defaultLang;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function sanitizeText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAccountBanned(user) {
  if (!user || !user.bannedUntil) return false;
  return new Date(user.bannedUntil).getTime() > Date.now();
}

function isAccountMuted(user) {
  if (!user || !user.mutedUntil) return false;
  return new Date(user.mutedUntil).getTime() > Date.now();
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
  if (isProduction) cookie.push("Secure");
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
  if (isProduction) cookie.push("Secure");
  res.setHeader("Set-Cookie", cookie.join("; "));
}

// ── CSRF protection ──

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function setCsrfCookie(res, token) {
  const cookie = [
    `csrf_token=${token}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_HOURS * 3600}`
  ];
  if (isProduction) cookie.push("Secure");
  // Append to existing Set-Cookie headers instead of overwriting
  const existing = res.getHeader("Set-Cookie");
  const cookieStr = cookie.join("; ");
  if (existing) {
    res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, cookieStr] : [existing, cookieStr]);
  } else {
    res.setHeader("Set-Cookie", cookieStr);
  }
}

function validateCsrfToken(req) {
  const cookies = parseCookies(req);
  const cookieToken = cookies.csrf_token;
  const headerToken = req.headers["x-csrf-token"];
  if (!cookieToken || !headerToken) return false;
  return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}

function hasAdminToken(req) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return false;
  return token === ADMIN_TOKEN;
}

function hasModeratorRole(user) {
  return ["moderator", "admin", "superadmin"].includes(String(user?.role || ""));
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

// ── Low-level file I/O ──

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

/** In-memory per-file mutex — serializes read-modify-write cycles per file path. */
const _fileLocks = new Map();
async function lockedJsonUpdate(filePath, mutateFn) {
  // Queue behind any pending write on the same file
  const prev = _fileLocks.get(filePath) || Promise.resolve();
  let releaseFn;
  const gate = new Promise((resolve) => { releaseFn = resolve; });
  _fileLocks.set(filePath, gate);
  await prev;
  try {
    const data = readJsonArray(filePath);
    const result = mutateFn(data);
    writeJsonArray(filePath, data);
    return result;
  } finally {
    releaseFn();
  }
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

function readResources() { return readJsonArray(resourcesPath); }
function readNews() { return readJsonArray(newsPath); }
function readCompanyBoards() { return readJsonArray(companyBoardsPath); }
function readPetitions() { return readJsonArray(petitionsPath); }
function readCohorts() { return readJsonArray(cohortsPath); }
function readAnonymousInbox() { return readJsonArray(anonymousInboxPath); }

// ── Story helpers ──

function mapStoryRow(row) {
  const details = row.details || {};
  const metrics = row.metrics || {};
  return {
    id: row.id, name: row.name, country: row.country, language: row.language,
    profession: row.profession, company: row.company, laidOffAt: row.laid_off_at,
    foundNewJob: row.found_new_job, reason: row.reason, story: row.story,
    status: row.status, estimatedLayoffs: row.estimated_layoffs,
    createdAt: row.created_at, updatedAt: row.updated_at || row.created_at,
    city: details.city || null, tenureYears: details.tenureYears ?? null,
    salaryBefore: details.salaryBefore ?? null, salaryAfter: details.salaryAfter ?? null,
    layoffType: details.layoffType || null, aiTool: details.aiTool || null,
    warnedAhead: details.warnedAhead || null, compensationMonths: details.compensationMonths ?? null,
    searchingMonths: details.searchingMonths ?? null, newRoleField: details.newRoleField || null,
    moodScore: details.moodScore ?? null,
    views: Number(metrics.views || 0), meToo: Number(metrics.meToo || 0),
    commentsCount: Number(metrics.commentsCount || 0),
    updateLabel: details.updateLabel || null,
    privacy: row.privacy || {}, moderation: row.moderation || {},
    submittedBy: row.submitted_by || null, details, metrics
  };
}

function ensureStoryDefaults(story) {
  const details = story.details || {
    city: story.city || null, tenureYears: story.tenureYears ?? null,
    salaryBefore: story.salaryBefore ?? null, salaryAfter: story.salaryAfter ?? null,
    layoffType: story.layoffType || null, aiTool: story.aiTool || null,
    warnedAhead: story.warnedAhead || null, compensationMonths: story.compensationMonths ?? null,
    searchingMonths: story.searchingMonths ?? null, newRoleField: story.newRoleField || null,
    moodScore: story.moodScore ?? null, updateLabel: story.updateLabel || null,
    evidenceTier: story.evidenceTier || "self_report"
  };
  const metrics = story.metrics || {
    views: Number(story.views || 0), meToo: Number(story.meToo || 0),
    commentsCount: Number(story.commentsCount || 0)
  };
  return {
    ...story, details, metrics,
    views: Number(metrics.views || 0), meToo: Number(metrics.meToo || 0),
    commentsCount: Number(metrics.commentsCount || 0),
    updatedAt: story.updatedAt || story.createdAt || new Date().toISOString(),
    city: details.city || null, tenureYears: details.tenureYears ?? null,
    salaryBefore: details.salaryBefore ?? null, salaryAfter: details.salaryAfter ?? null,
    layoffType: details.layoffType || null, aiTool: details.aiTool || null,
    warnedAhead: details.warnedAhead || null, compensationMonths: details.compensationMonths ?? null,
    searchingMonths: details.searchingMonths ?? null, newRoleField: details.newRoleField || null,
    moodScore: details.moodScore ?? null, updateLabel: details.updateLabel || null,
    evidenceTier: details.evidenceTier || "self_report"
  };
}

function maskStoryByPrivacy(story) {
  const privacy = story.privacy || {};
  const nameDisplay = privacy.nameDisplay || "alias";
  const companyDisplay = privacy.companyDisplay || "exact";
  const dateDisplay = privacy.dateDisplay || "month";
  const out = { ...story };
  const originalName = String(story.name || "");
  if (nameDisplay === "anonymous") out.name = "Anonymous";
  if (nameDisplay === "initials" && originalName) out.name = originalName.split(" ").filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join(" ");
  if (nameDisplay === "first_name" && originalName) out.name = originalName.split(" ")[0];
  if (nameDisplay === "alias" && originalName.includes(" ")) {
    const [first] = originalName.split(" ");
    out.name = `${first} ${originalName.split(" ").slice(1).map((p) => `${p[0]}.`).join("")}`.trim();
  }
  if (companyDisplay === "industry_only") out.company = "Technology company";
  if (companyDisplay === "masked") out.company = "Undisclosed company";
  if (dateDisplay === "year" && String(story.laidOffAt).length >= 4) out.laidOffAt = String(story.laidOffAt).slice(0, 4);
  if (dateDisplay === "hidden") out.laidOffAt = "Hidden";
  if (dateDisplay === "month" && /^\d{4}-\d{2}-\d{2}$/.test(String(story.laidOffAt))) out.laidOffAt = String(story.laidOffAt).slice(0, 7);
  return out;
}

function scoreModeration(input) {
  const text = `${input.reason || ""} ${input.story || ""}`.toLowerCase();
  const toxicTokens = ["idiot", "kill", "hate", "stupid", "loser", "trash"];
  const spamTokens = ["buy now", "promo", "discount", "http://", "https://", "telegram.me/", "affiliate"];
  const piiRegex = /(\+?\d[\d\-\s]{7,}\d)|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  const crisisRegex = /(suicide|kill myself|end my life|cannot go on|хочу умереть|покончить с собой)/i;
  const deanonMarkers = [/only\s+\d+\s+people/i, /exactly\s+\d+\s+people/i, /\bmy manager\b/i, /\bthe only\b/i, /\bon\s+\d{4}-\d{2}-\d{2}\b/i];
  const toxicity = Math.min(1, toxicTokens.reduce((n, token) => n + (text.includes(token) ? 0.2 : 0), 0));
  const spam = Math.min(1, spamTokens.reduce((n, token) => n + (text.includes(token) ? 0.2 : 0), 0));
  const piiHits = [...text.matchAll(piiRegex)].length;
  const pii = piiHits > 0 ? Math.min(1, 0.3 + piiHits * 0.2) : 0;
  const deanonMatches = deanonMarkers.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  const deanonymization = Math.min(1, deanonMatches * 0.25);
  const crisis = crisisRegex.test(text) ? 1 : 0;
  const risk = Math.max(toxicity, spam, pii, deanonymization, crisis);
  return {
    toxicity, spam, pii, deanonymization, crisis,
    riskBand: risk >= 0.85 ? "high" : risk >= 0.45 ? "medium" : "low",
    recommendations: deanonymization >= 0.5 ? ["Generalize exact dates to month/year.", "Avoid unique team size and project details.", "Prefer masked company visibility."] : []
  };
}

function mapVisibilityToPrivacy(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const normalizeVis = (value) => String(value || "public").toLowerCase();
  const toNameDisplay = (v) => { if (v === "hidden") return "anonymous"; if (v === "coarse") return "initials"; return "alias"; };
  const toCompanyDisplay = (v) => { if (v === "hidden") return "masked"; if (v === "coarse") return "industry_only"; return "exact"; };
  const toGeoDisplay = (v) => { if (v === "hidden") return "hidden"; if (v === "coarse") return "country"; return "city"; };
  const toDateDisplay = (v) => { if (v === "hidden") return "hidden"; if (v === "coarse") return "year"; return "exact"; };
  const nameRaw = normalizeVis(src.nameDisplay || src.name);
  const companyRaw = normalizeVis(src.companyDisplay || src.company);
  const geoRaw = normalizeVis(src.geoDisplay || src.geo);
  const dateRaw = normalizeVis(src.dateDisplay || src.date);
  return { nameDisplay: toNameDisplay(nameRaw), companyDisplay: toCompanyDisplay(companyRaw), geoDisplay: toGeoDisplay(geoRaw), dateDisplay: toDateDisplay(dateRaw) };
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
    all: { stories: allStories.length, laidOff: allStories.reduce((sum, s) => sum + Number(s.estimatedLayoffs || 1), 0) },
    verified: { stories: verifiedStories.length, laidOff: verifiedStories.reduce((sum, s) => sum + Number(s.estimatedLayoffs || 1), 0) }
  };
}

function getCrisisResources(countryCode) {
  const base = ["Global: findahelpline.com"];
  if (countryCode === "us") base.unshift("US: 988 Suicide & Crisis Lifeline");
  if (countryCode === "gb") base.unshift("UK Samaritans: 116 123");
  if (countryCode === "ru") base.unshift("RU: 8-800-2000-122");
  return base;
}

function slugifyCompany(input) {
  return String(input || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getTopCompanies(stories, country) {
  const filtered = stories.filter((s) => s.status === "published" && (country === "global" || s.country === country));
  const map = new Map();
  for (const entry of filtered) {
    if (!map.has(entry.company)) map.set(entry.company, { company: entry.company, stories: 0, layoffs: 0, rehired: 0 });
    const row = map.get(entry.company);
    row.stories += 1;
    row.layoffs += Number(entry.estimatedLayoffs || 1);
    row.rehired += entry.foundNewJob ? 1 : 0;
  }
  return [...map.values()].sort((a, b) => b.layoffs - a.layoffs).slice(0, 10);
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
    if (s.compensationMonths != null) { compensationTotal += Number(s.compensationMonths); compensationCount += 1; }
  }
  const humanityRaw = rows.length ? Math.round(((warnedYes / rows.length) * 50) + ((compensationCount ? (compensationTotal / compensationCount) : 0) * 10)) : 0;
  return {
    slug, company: first.company, industry: "Technology", storiesCount: rows.length,
    averageTenureYears: Number.isFinite(avgTenure) ? Number(avgTenure.toFixed(1)) : null,
    affectedProfessions: [...professions.entries()].map(([profession, count]) => ({ profession, count })).sort((a, b) => b.count - a.count),
    layoffsTimeline: [...byMonth.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    humanityRating: Math.max(0, Math.min(100, humanityRaw)),
    rehiredPeopleCount: rows.filter((s) => s.foundNewJob).length
  };
}

function getDashboard(stories, country) {
  const published = stories.filter((s) => s.status === "published" && (country === "global" || s.country === country));
  const byProfession = new Map(); const byMonth = new Map(); const byCountry = new Map();
  const byAiTool = new Map(); const foundByProfession = new Map(); const searchMonthsByProfession = new Map();
  let compensationTotal = 0, compensationCount = 0;
  let salaryBeforeTotal = 0, salaryBeforeCount = 0;
  let salaryAfterTotal = 0, salaryAfterCount = 0;
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
      meta.total += Number(s.searchingMonths); meta.count += 1;
      searchMonthsByProfession.set(s.profession, meta);
    }
    if (s.compensationMonths != null) { compensationTotal += Number(s.compensationMonths); compensationCount += 1; }
    if (s.salaryBefore != null) { salaryBeforeTotal += Number(s.salaryBefore); salaryBeforeCount += 1; }
    if (s.salaryAfter != null) { salaryAfterTotal += Number(s.salaryAfter); salaryAfterCount += 1; }
  }
  return {
    country, generatedAt: new Date().toISOString(),
    topCompaniesByLayoffs: getTopCompanies(published, country),
    layoffsByMonth: [...byMonth.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    worldMap: [...byCountry.entries()].map(([countryCode, count]) => ({ country: countryCode, count })).sort((a, b) => b.count - a.count),
    affectedProfessions: [...byProfession.entries()].map(([profession, count]) => ({ profession, count })).sort((a, b) => b.count - a.count),
    averageSearchMonthsByProfession: [...searchMonthsByProfession.entries()].map(([profession, meta]) => ({ profession, months: Number((meta.total / Math.max(1, meta.count)).toFixed(1)) })).sort((a, b) => b.months - a.months),
    foundVsNotFoundByProfession: [...foundByProfession.entries()].map(([profession, meta]) => ({ profession, found: meta.found, notFound: Math.max(0, meta.total - meta.found) })).sort((a, b) => (b.found + b.notFound) - (a.found + a.notFound)),
    aiToolsReplacingPeople: [...byAiTool.entries()].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count),
    averageCompensationMonths: compensationCount ? Number((compensationTotal / compensationCount).toFixed(1)) : null,
    rehiredCompaniesCount: getTopCompanies(published, country).filter((c) => c.rehired > 0).length,
    salaryTrend: { beforeAverage: salaryBeforeCount ? Math.round(salaryBeforeTotal / salaryBeforeCount) : null, afterAverage: salaryAfterCount ? Math.round(salaryAfterTotal / salaryAfterCount) : null }
  };
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    return resp.ok;
  } catch (_error) { return false; }
}

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
    ndaConfirmed: req.body.ndaConfirmed === true || req.body.ndaConfirmed === "true",
    evidenceTier: req.body.evidenceTier ? sanitizeText(req.body.evidenceTier) : undefined
  };
  const parsed = storySchema.safeParse(payload);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((e) => ({ field: e.path[0], message: e.message })) };
  if (!parsed.data.ndaConfirmed && !options.skipNda) return { ok: false, errors: [{ field: "ndaConfirmed", message: "You must confirm NDA/legal notice before submission" }] };
  return { ok: true, data: parsed.data };
}

function buildStoryRecord(parsedData, submittedBy, moderation, initialStatus) {
  const details = {
    city: parsedData.city || null, tenureYears: parsedData.tenureYears ?? null,
    salaryBefore: parsedData.salaryBefore ?? null, salaryAfter: parsedData.salaryAfter ?? null,
    layoffType: parsedData.layoffType || null, aiTool: parsedData.aiTool || null,
    warnedAhead: parsedData.warnedAhead || null, compensationMonths: parsedData.compensationMonths ?? null,
    searchingMonths: parsedData.searchingMonths ?? null, newRoleField: parsedData.newRoleField || null,
    moodScore: parsedData.moodScore ?? null, updateLabel: null,
    evidenceTier: parsedData.evidenceTier || "self_report"
  };
  const metrics = { views: 0, meToo: 0, commentsCount: 0 };
  return ensureStoryDefaults({
    id: storyId(), ...parsedData,
    status: initialStatus, estimatedLayoffs: 1,
    moderation, details, metrics, submittedBy,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
}

// ── Database helpers ──

function makeDbSslConfig() {
  if (!PG_SSL) return undefined;
  const rejectUnauthorized = String(process.env.PG_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false";
  return { rejectUnauthorized };
}

async function testPgConnection(connectionString) {
  const client = new Pool({ connectionString, ssl: makeDbSslConfig(), max: 1, idleTimeoutMillis: 3000 });
  try {
    const res = await client.query("SELECT 1 AS ok;");
    return Boolean(res.rows?.[0]?.ok === 1 || res.rows?.[0]?.ok === "1");
  } catch (_error) { return false; }
  finally { await client.end().catch(() => {}); }
}

async function resolvePinnedDatabaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  if (parsed.hostname !== "postgres") return baseUrl;
  const records = await dns.lookup("postgres", { all: true }).catch(() => []);
  if (!records.length) return baseUrl;
  const prioritized = [...records.filter((r) => r.family === 4), ...records.filter((r) => r.family !== 4)];
  for (const rec of prioritized) {
    const candidate = new URL(baseUrl);
    candidate.hostname = rec.address;
    const ok = await testPgConnection(candidate.toString());
    if (ok) return candidate.toString();
  }
  return baseUrl;
}

async function buildPgPool() {
  const pinnedUrl = await resolvePinnedDatabaseUrl(DATABASE_URL);
  return new Pool({ connectionString: pinnedUrl, ssl: makeDbSslConfig() });
}

function getPgPool() { return pgPool; }
function setPgPool(pool) { pgPool = pool; }

// ── Storage abstraction layer ──

async function storageGetStories() {
  if (!usePostgres) return readStories().map(ensureStoryDefaults);
  const res = await pgPool.query("SELECT * FROM stories ORDER BY created_at DESC;");
  return res.rows.map(mapStoryRow).map(ensureStoryDefaults);
}

async function storageInsertStory(newStory) {
  if (!usePostgres) {
    await lockedJsonUpdate(storiesPath, (stories) => { stories.push(newStory); });
    return;
  }
  await pgPool.query(
    `INSERT INTO stories (id, name, country, language, profession, company, laid_off_at, found_new_job, reason, story, status, estimated_layoffs, details, metrics, privacy, moderation, submitted_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18);`,
    [newStory.id, newStory.name, newStory.country, newStory.language, newStory.profession, newStory.company, newStory.laidOffAt, newStory.foundNewJob, newStory.reason, newStory.story, newStory.status, newStory.estimatedLayoffs, JSON.stringify(newStory.details || {}), JSON.stringify(newStory.metrics || {}), JSON.stringify(newStory.privacy || {}), JSON.stringify(newStory.moderation || {}), newStory.submittedBy || null, newStory.createdAt, newStory.updatedAt || newStory.createdAt]
  );
}

async function storageGetUsers() {
  if (!usePostgres) return readJsonArray(usersPath);
  const res = await pgPool.query("SELECT id, email, phone, role, password_hash, created_at, muted_until, banned_until FROM users ORDER BY created_at DESC;");
  return res.rows.map((r) => ({ id: r.id, email: r.email, phone: r.phone, role: r.role, passwordHash: r.password_hash, createdAt: r.created_at, mutedUntil: r.muted_until, bannedUntil: r.banned_until }));
}

async function storageGetUserByEmail(email) {
  if (!usePostgres) return storageGetUsers().then((x) => x.find((u) => u.email === email) || null);
  const res = await pgPool.query("SELECT id, email, phone, role, password_hash, created_at, muted_until, banned_until FROM users WHERE email = $1 LIMIT 1;", [email]);
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return { id: r.id, email: r.email, phone: r.phone, role: r.role, passwordHash: r.password_hash, createdAt: r.created_at, mutedUntil: r.muted_until, bannedUntil: r.banned_until };
}

async function storageGetUserById(id) {
  if (!usePostgres) return storageGetUsers().then((x) => x.find((u) => u.id === id) || null);
  const res = await pgPool.query("SELECT id, email, phone, role, password_hash, created_at, muted_until, banned_until FROM users WHERE id = $1 LIMIT 1;", [id]);
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return { id: r.id, email: r.email, phone: r.phone, role: r.role, passwordHash: r.password_hash, createdAt: r.created_at, mutedUntil: r.muted_until, bannedUntil: r.banned_until };
}

async function storageInsertUser(user) {
  if (!usePostgres) {
    await lockedJsonUpdate(usersPath, (users) => { users.push(user); });
    return;
  }
  await pgPool.query("INSERT INTO users (id, email, phone, role, password_hash, created_at, muted_until, banned_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8);",
    [user.id, user.email, user.phone || null, user.role, user.passwordHash, user.createdAt, user.mutedUntil || null, user.bannedUntil || null]);
}

async function storageUpdateUserSanction(targetUserId, patch) {
  if (!usePostgres) {
    return lockedJsonUpdate(usersPath, (users) => {
      const idx = users.findIndex((u) => u.id === targetUserId);
      if (idx < 0) return false;
      users[idx] = { ...users[idx], ...patch };
      return true;
    });
  }
  const dbPatch = {};
  if (Object.prototype.hasOwnProperty.call(patch, "mutedUntil")) dbPatch.muted_until = patch.mutedUntil;
  if (Object.prototype.hasOwnProperty.call(patch, "bannedUntil")) dbPatch.banned_until = patch.bannedUntil;
  const keys = Object.keys(dbPatch);
  if (!keys.length) return true;
  const fields = [];
  const values = [];
  keys.forEach((k, i) => { fields.push(`${k} = $${i + 1}`); values.push(dbPatch[k]); });
  values.push(targetUserId);
  const res = await pgPool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${values.length};`, values);
  return res.rowCount > 0;
}

async function storageGetIdentityByUserId(userIdValue) {
  if (!usePostgres) return readJsonArray(authIdentitiesPath).find((x) => x.userId === userIdValue) || null;
  const res = await pgPool.query("SELECT user_id, email_verified, phone, phone_verified, pending_phone, phone_otp_hash, phone_otp_expires_at, phone_otp_attempts, telegram_link_code, telegram_code_expires_at, updated_at FROM auth_identities WHERE user_id = $1 LIMIT 1;", [userIdValue]);
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return { userId: r.user_id, emailVerified: r.email_verified, phone: r.phone, phoneVerified: r.phone_verified, pendingPhone: r.pending_phone, phoneOtpHash: r.phone_otp_hash, phoneOtpExpiresAt: r.phone_otp_expires_at, phoneOtpAttempts: r.phone_otp_attempts, telegramLinkCode: r.telegram_link_code, telegramCodeExpiresAt: r.telegram_code_expires_at, updatedAt: r.updated_at };
}

async function storageUpsertIdentity(identity) {
  if (!usePostgres) {
    let next;
    await lockedJsonUpdate(authIdentitiesPath, (rows) => {
      const idx = rows.findIndex((x) => x.userId === identity.userId);
      next = { emailVerified: true, phoneVerified: false, phoneOtpAttempts: 0, ...(idx >= 0 ? rows[idx] : {}), ...identity, updatedAt: new Date().toISOString() };
      if (idx >= 0) rows[idx] = next; else rows.push(next);
    });
    return next;
  }
  await pgPool.query(
    `INSERT INTO auth_identities (user_id, email_verified, phone, phone_verified, pending_phone, phone_otp_hash, phone_otp_expires_at, phone_otp_attempts, telegram_link_code, telegram_code_expires_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT (user_id) DO UPDATE SET email_verified = EXCLUDED.email_verified, phone = EXCLUDED.phone, phone_verified = EXCLUDED.phone_verified, pending_phone = EXCLUDED.pending_phone, phone_otp_hash = EXCLUDED.phone_otp_hash, phone_otp_expires_at = EXCLUDED.phone_otp_expires_at, phone_otp_attempts = EXCLUDED.phone_otp_attempts, telegram_link_code = EXCLUDED.telegram_link_code, telegram_code_expires_at = EXCLUDED.telegram_code_expires_at, updated_at = NOW();`,
    [identity.userId, identity.emailVerified !== false, identity.phone || null, Boolean(identity.phoneVerified), identity.pendingPhone || null, identity.phoneOtpHash || null, identity.phoneOtpExpiresAt || null, Number(identity.phoneOtpAttempts || 0), identity.telegramLinkCode || null, identity.telegramCodeExpiresAt || null]
  );
  return storageGetIdentityByUserId(identity.userId);
}

async function storageInsertStoryVersion(entry) {
  if (!usePostgres) {
    await lockedJsonUpdate(storyVersionsPath, (rows) => {
      rows.push(entry);
      // Trim to last 10000 entries
      if (rows.length > 10000) rows.splice(0, rows.length - 10000);
    });
    return;
  }
  await pgPool.query("INSERT INTO story_versions (id, story_id, version_no, payload, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6);",
    [entry.id, entry.storyId, entry.versionNo, JSON.stringify(entry.payload || {}), entry.createdBy || null, entry.createdAt]);
}

async function storageCreateOrUpdateTelegramLink(entry) {
  if (!usePostgres) {
    const rows = readJsonArray(telegramLinksPath);
    const idx = rows.findIndex((x) => x.userId === entry.userId || x.telegramUserId === entry.telegramUserId);
    const next = { id: entry.id || sanctionId(), status: "linked", linkedAt: new Date().toISOString(), ...rows[idx], ...entry };
    if (idx >= 0) rows[idx] = next; else rows.push(next);
    writeJsonArray(telegramLinksPath, rows);
    return next;
  }
  await pgPool.query(
    `INSERT INTO telegram_links (id, user_id, telegram_user_id, telegram_username, status, linked_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO UPDATE SET telegram_user_id = EXCLUDED.telegram_user_id, telegram_username = EXCLUDED.telegram_username, status = EXCLUDED.status, linked_at = EXCLUDED.linked_at;`,
    [entry.id || sanctionId(), entry.userId, String(entry.telegramUserId), entry.telegramUsername || null, entry.status || "linked", entry.linkedAt || new Date().toISOString()]
  );
  return entry;
}

async function storageGetTelegramLinkByUserId(userIdValue) {
  if (!usePostgres) return readJsonArray(telegramLinksPath).find((x) => x.userId === userIdValue) || null;
  const res = await pgPool.query("SELECT id, user_id, telegram_user_id, telegram_username, status, linked_at FROM telegram_links WHERE user_id = $1 LIMIT 1;", [userIdValue]);
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return { id: r.id, userId: r.user_id, telegramUserId: r.telegram_user_id, telegramUsername: r.telegram_username, status: r.status, linkedAt: r.linked_at };
}

async function storageInsertTransparencyEvent(entry) {
  if (!usePostgres) {
    const rows = readJsonArray(transparencyEventsPath);
    rows.push(entry);
    writeJsonArray(transparencyEventsPath, rows.slice(-5000));
    return;
  }
  await pgPool.query("INSERT INTO transparency_events (id, event_type, status, details, created_at) VALUES ($1,$2,$3,$4,$5);",
    [entry.id || auditId(), entry.eventType, entry.status, JSON.stringify(entry.details || {}), entry.createdAt || new Date().toISOString()]);
}

async function storageGetForumTopics(country) {
  if (!usePostgres) {
    return readJsonArray(forumTopicsPath)
      .filter((t) => !country || t.country === country || t.country === "global")
      .sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate));
  }
  const res = await pgPool.query(
    `SELECT t.id, t.category_id, t.title, t.body, t.country, t.language, t.status, t.created_by, t.created_at, COALESCE(COUNT(p.id),0)::int AS replies, COALESCE(MAX(p.created_at), t.created_at) AS last_update FROM forum_topics t LEFT JOIN forum_posts p ON p.topic_id = t.id WHERE ($1::text IS NULL OR t.country = $1 OR t.country = 'global') AND t.status <> 'deleted' GROUP BY t.id ORDER BY last_update DESC LIMIT 100;`,
    [country || null]
  );
  return res.rows.map((r) => ({ id: r.id, categoryId: r.category_id, title: r.title, body: r.body, country: r.country, language: r.language, status: r.status, createdBy: r.created_by, createdAt: r.created_at, replies: r.replies, lastUpdate: r.last_update }));
}

async function storageGetForumReplies(topicIdValue) {
  if (!usePostgres) {
    const replies = readJsonArray(forumRepliesPath);
    if (!topicIdValue) return replies;
    return replies.filter((r) => r.topicId === topicIdValue);
  }
  const query = topicIdValue
    ? "SELECT id, topic_id, body, country, language, status, created_by, created_at FROM forum_posts WHERE topic_id = $1 ORDER BY created_at ASC;"
    : "SELECT id, topic_id, body, country, language, status, created_by, created_at FROM forum_posts ORDER BY created_at DESC LIMIT 100;";
  const params = topicIdValue ? [topicIdValue] : [];
  const res = await pgPool.query(query, params);
  return res.rows.map((r) => ({ id: r.id, topicId: r.topic_id, body: r.body, country: r.country, language: r.language, status: r.status, createdBy: r.created_by, createdAt: r.created_at }));
}

async function storageInsertForumTopic(topic) {
  if (!usePostgres) {
    await lockedJsonUpdate(forumTopicsPath, (topics) => { topics.push(topic); });
    return;
  }
  await pgPool.query("INSERT INTO forum_topics (id, category_id, title, body, country, language, status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);",
    [topic.id, topic.categoryId, topic.title, topic.body, topic.country, topic.language, topic.status, topic.createdBy, topic.createdAt]);
}

async function storageInsertForumReply(reply) {
  if (!usePostgres) {
    await lockedJsonUpdate(forumRepliesPath, (replies) => { replies.push(reply); });
    await lockedJsonUpdate(forumTopicsPath, (topics) => {
      const idx = topics.findIndex((t) => t.id === reply.topicId);
      if (idx >= 0) { topics[idx].replies = Number(topics[idx].replies || 0) + 1; topics[idx].lastUpdate = reply.createdAt; }
    });
    return;
  }
  await pgPool.query("INSERT INTO forum_posts (id, topic_id, body, country, language, status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8);",
    [reply.id, reply.topicId, reply.body, reply.country, reply.language, reply.status, reply.createdBy, reply.createdAt]);
}

async function storageGetModerationQueue() {
  const stories = await storageGetStories();
  const storyQueue = stories.filter((s) => s.status === "pending").slice(0, 100).map((s) => ({ id: `story:${s.id}`, type: "story", title: `${s.profession} · ${s.name}`, story: s.story, createdAt: s.createdAt, moderation: s.moderation || {} }));
  let topicQueue = [];
  if (usePostgres) {
    const res = await pgPool.query("SELECT id, title, body, created_at FROM forum_topics WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100;");
    topicQueue = res.rows.map((t) => ({ id: `topic:${t.id}`, type: "topic", title: t.title, story: t.body, createdAt: t.created_at }));
  } else {
    topicQueue = readJsonArray(forumTopicsPath).filter((t) => t.status === "pending").slice(0, 100).map((t) => ({ id: `topic:${t.id}`, type: "topic", title: t.title, story: t.body, createdAt: t.createdAt }));
  }
  return [...storyQueue, ...topicQueue].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function storageModerationAction(entryId, action, reason) {
  const [kind, id] = String(entryId || "").split(":");
  if (!kind || !id) return false;
  const next = action === "approve" ? "published" : "rejected";
  if (kind === "story") {
    if (!usePostgres) {
      return lockedJsonUpdate(storiesPath, (stories) => {
        const idx = stories.findIndex((s) => s.id === id);
        if (idx < 0) return false;
        stories[idx].status = next; stories[idx].moderationReason = reason || "";
        return true;
      });
    }
    const res = await pgPool.query("UPDATE stories SET status=$1 WHERE id=$2;", [next, id]);
    return res.rowCount > 0;
  }
  if (kind === "topic") {
    if (!usePostgres) {
      return lockedJsonUpdate(forumTopicsPath, (topics) => {
        const idx = topics.findIndex((t) => t.id === id);
        if (idx < 0) return false;
        topics[idx].status = next; topics[idx].moderationReason = reason || "";
        return true;
      });
    }
    const res = await pgPool.query("UPDATE forum_topics SET status=$1 WHERE id=$2;", [next, id]);
    return res.rowCount > 0;
  }
  return false;
}

async function storageInsertSanction(entry) {
  if (!usePostgres) {
    await lockedJsonUpdate(sanctionsPath, (sanctions) => { sanctions.push(entry); });
    return;
  }
  await pgPool.query("INSERT INTO sanctions (id, target_user_id, type, reason, duration_days, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7);",
    [entry.id, entry.targetUserId, entry.type, entry.reason, entry.durationDays || null, entry.createdBy, entry.createdAt]);
}

async function storageAudit(action) {
  const entry = { id: auditId(), action: action.action, actorId: action.actorId || null, targetType: action.targetType || null, targetId: action.targetId || null, metadata: action.metadata || {}, ip: action.ip || "", createdAt: new Date().toISOString() };
  if (!usePostgres) {
    await lockedJsonUpdate(auditLogPath, (logs) => {
      logs.push(entry);
      if (logs.length > 5000) logs.splice(0, logs.length - 5000);
    });
    return;
  }
  await pgPool.query("INSERT INTO audit_log (id, action, actor_id, target_type, target_id, metadata, ip, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8);",
    [entry.id, entry.action, entry.actorId, entry.targetType, entry.targetId, JSON.stringify(entry.metadata), entry.ip, entry.createdAt]);
}

async function storageGetAuditRange(fromISO, toISO) {
  if (!usePostgres) {
    return readJsonArray(auditLogPath).filter((e) => { const t = new Date(e.createdAt).getTime(); return t >= new Date(fromISO).getTime() && t <= new Date(toISO).getTime(); });
  }
  const res = await pgPool.query("SELECT id, action, actor_id, target_type, target_id, metadata, ip, created_at FROM audit_log WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 10000;", [fromISO, toISO]);
  return res.rows.map((r) => ({ id: r.id, action: r.action, actorId: r.actor_id, targetType: r.target_type, targetId: r.target_id, metadata: r.metadata || {}, ip: r.ip, createdAt: r.created_at }));
}

async function storagePatchStory(storyIdValue, patchFn) {
  const stories = await storageGetStories();
  const idx = stories.findIndex((s) => s.id === storyIdValue);
  if (idx < 0) return null;
  const current = ensureStoryDefaults(stories[idx]);
  const next = ensureStoryDefaults({ ...current, ...patchFn(current), updatedAt: new Date().toISOString() });
  if (!usePostgres) {
    let result = null;
    await lockedJsonUpdate(storiesPath, (rows) => {
      const rIdx = rows.findIndex((s) => s.id === storyIdValue);
      if (rIdx < 0) return;
      rows[rIdx] = { ...rows[rIdx], ...next };
      result = next;
    });
    return result;
  }
  await pgPool.query("UPDATE stories SET found_new_job = $1, story = $2, details = $3, metrics = $4, status = $5, updated_at = $6 WHERE id = $7;",
    [Boolean(next.foundNewJob), next.story, JSON.stringify(next.details || {}), JSON.stringify(next.metrics || {}), next.status || "pending", next.updatedAt, storyIdValue]);
  return next;
}

async function storageDeleteUser(userId) {
  if (!usePostgres) {
    await lockedJsonUpdate(usersPath, (users) => {
      const idx = users.findIndex((u) => u.id === userId);
      if (idx >= 0) users.splice(idx, 1);
    });
    await lockedJsonUpdate(authIdentitiesPath, (rows) => {
      for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].userId === userId) rows.splice(i, 1); }
    });
    await lockedJsonUpdate(telegramLinksPath, (rows) => {
      for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].userId === userId) rows.splice(i, 1); }
    });
    await lockedJsonUpdate(storiesPath, (rows) => {
      for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].submittedBy === userId) rows.splice(i, 1); }
    });
  } else {
    await pgPool.query("DELETE FROM users WHERE id = $1;", [userId]);
    await pgPool.query("DELETE FROM stories WHERE submitted_by = $1;", [userId]);
  }
}

// ── Init storage (DB tables + seed) ──

async function initStorage() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const localDefaults = [
    [resourcesPath, defaultResources], [newsPath, defaultNews], [takedownsPath, []],
    [companyBoardsPath, defaultCompanyBoards], [petitionsPath, defaultPetitions],
    [cohortsPath, defaultCohorts], [anonymousInboxPath, []]
  ];
  localDefaults.forEach(([file, value]) => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(value, null, 2));
  });

  if (!usePostgres) {
    const defaults = [
      [usersPath, []], [forumTopicsPath, seedForumTopics], [forumRepliesPath, []],
      [sanctionsPath, []], [auditLogPath, []], [authIdentitiesPath, []],
      [storyVersionsPath, []], [telegramLinksPath, []], [transparencyEventsPath, []],
      [resourcesPath, defaultResources], [newsPath, defaultNews], [takedownsPath, []],
      [companyBoardsPath, defaultCompanyBoards], [petitionsPath, defaultPetitions],
      [cohortsPath, defaultCohorts], [anonymousInboxPath, []]
    ];
    defaults.forEach(([file, value]) => {
      if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(value, null, 2));
    });
    return;
  }

  await pgPool.query(`CREATE TABLE IF NOT EXISTS stories (id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL, language TEXT NOT NULL, profession TEXT NOT NULL, company TEXT NOT NULL, laid_off_at TEXT NOT NULL, found_new_job BOOLEAN NOT NULL DEFAULT FALSE, reason TEXT NOT NULL, story TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', estimated_layoffs INTEGER NOT NULL DEFAULT 1, details JSONB NOT NULL DEFAULT '{}'::jsonb, metrics JSONB NOT NULL DEFAULT '{}'::jsonb, privacy JSONB NOT NULL DEFAULT '{}'::jsonb, moderation JSONB NOT NULL DEFAULT '{}'::jsonb, submitted_by TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_stories_status_country_created ON stories(status, country, created_at DESC);");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS privacy JSONB NOT NULL DEFAULT '{}'::jsonb;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS moderation JSONB NOT NULL DEFAULT '{}'::jsonb;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS submitted_by TEXT NULL;");
  await pgPool.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();");
  await pgPool.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT UNIQUE NULL, role TEXT NOT NULL DEFAULT 'user', password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), muted_until TIMESTAMPTZ NULL, banned_until TIMESTAMPTZ NULL);`);
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);");
  await pgPool.query(`CREATE TABLE IF NOT EXISTS auth_identities (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, email_verified BOOLEAN NOT NULL DEFAULT TRUE, phone TEXT NULL, phone_verified BOOLEAN NOT NULL DEFAULT FALSE, pending_phone TEXT NULL, phone_otp_hash TEXT NULL, phone_otp_expires_at TIMESTAMPTZ NULL, phone_otp_attempts INTEGER NOT NULL DEFAULT 0, telegram_link_code TEXT NULL, telegram_code_expires_at TIMESTAMPTZ NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS story_versions (id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE, version_no INTEGER NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_by TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS telegram_links (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, telegram_user_id TEXT NOT NULL, telegram_username TEXT NULL, status TEXT NOT NULL DEFAULT 'linked', linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id), UNIQUE(telegram_user_id));`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS transparency_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, status TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS forum_topics (id TEXT PRIMARY KEY, category_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'global', language TEXT NOT NULL DEFAULT 'en', status TEXT NOT NULL DEFAULT 'published', created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS forum_posts (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE, body TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'global', language TEXT NOT NULL DEFAULT 'en', status TEXT NOT NULL DEFAULT 'published', created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS sanctions (id TEXT PRIMARY KEY, target_user_id TEXT NOT NULL, type TEXT NOT NULL, reason TEXT NOT NULL, duration_days INTEGER NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_id TEXT NULL, target_type TEXT NULL, target_id TEXT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, ip TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);

  const countRes = await pgPool.query("SELECT COUNT(*)::int AS count FROM stories;");
  if (countRes.rows[0].count > 0) return;
  const seed = readStories();
  if (seed.length) {
    for (const s of seed) {
      await pgPool.query(
        `INSERT INTO stories (id, name, country, language, profession, company, laid_off_at, found_new_job, reason, story, status, estimated_layoffs, details, metrics, privacy, moderation, submitted_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (id) DO NOTHING;`,
        [s.id, s.name, s.country, s.language, s.profession, s.company, s.laidOffAt, Boolean(s.foundNewJob), s.reason, s.story, s.status || "pending", Number(s.estimatedLayoffs || 1), JSON.stringify(s.details || {}), JSON.stringify(s.metrics || {}), JSON.stringify(s.privacy || {}), JSON.stringify(s.moderation || {}), s.submittedBy || null, s.createdAt || new Date().toISOString(), s.updatedAt || s.createdAt || new Date().toISOString()]
      );
    }
  }
  const topicCount = await pgPool.query("SELECT COUNT(*)::int AS count FROM forum_topics;");
  if (topicCount.rows[0].count === 0) {
    for (const topic of seedForumTopics) {
      await pgPool.query("INSERT INTO forum_topics (id, category_id, title, body, country, language, status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);",
        [topic.id, topic.categoryId, topic.title, "Seed topic body", "global", "en", "published", "system", topic.lastUpdate || new Date().toISOString()]);
    }
  }
}

module.exports = {
  // Config
  ADMIN_TOKEN, DATABASE_URL, AUTH_SECRET, ALLOW_DEV_OTP, TELEGRAM_BOT_TOKEN,
  TELEGRAM_MOD_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, REQUIRE_CAPTCHA, isProduction,
  SESSION_TTL_HOURS, defaultCountry, defaultLang, usePostgres,
  languages, countries, roles, forumCategories, seedForumTopics,
  defaultResources, defaultNews, defaultCompanyBoards, defaultPetitions, defaultCohorts,
  publicDir, dataDir,

  // ID generators
  storyId, userId: usrId, topicId, replyId, sanctionId, auditId, phoneOtpCode, linkCodeId,

  // Schemas
  storySchema, registerSchema, loginSchema, phoneStartSchema, phoneVerifySchema,
  forumTopicSchema, forumReplySchema, moderationActionSchema, sanctionSchema,
  telegramWebhookSchema, digestEmailSchema,

  // Helpers
  normalizeCountry, normalizeLanguage, normalizeEmail, normalizePhone,
  sanitizeText, isAccountBanned, isAccountMuted, parseCookies,
  makeSessionToken, setAuthCookie, clearAuthCookie,
  generateCsrfToken, setCsrfCookie, validateCsrfToken,
  hasAdminToken, hasModeratorRole, detectLocale,
  maskStoryByPrivacy, scoreModeration, mapVisibilityToPrivacy,
  computeConfidenceScore, buildCounters, getCrisisResources,
  slugifyCompany, getTopCompanies, toCompanyProfile, getDashboard,
  sendTelegramMessage, buildStoryPayload, buildStoryRecord,
  ensureStoryDefaults,

  // File I/O
  readJsonArray, writeJsonArray, lockedJsonUpdate, readStories, writeStories,
  readResources, readNews, readCompanyBoards, readPetitions, readCohorts, readAnonymousInbox,

  // File paths
  storiesPath, usersPath, forumTopicsPath, forumRepliesPath,
  authIdentitiesPath, takedownsPath, companyBoardsPath, petitionsPath,
  cohortsPath, anonymousInboxPath, subscribersPath,

  // Storage
  storageGetStories, storageInsertStory, storageGetUsers,
  storageGetUserByEmail, storageGetUserById, storageInsertUser,
  storageUpdateUserSanction, storageGetIdentityByUserId, storageUpsertIdentity,
  storageInsertStoryVersion, storageCreateOrUpdateTelegramLink,
  storageGetTelegramLinkByUserId, storageInsertTransparencyEvent,
  storageGetForumTopics, storageGetForumReplies, storageInsertForumTopic,
  storageInsertForumReply, storageGetModerationQueue, storageModerationAction,
  storageInsertSanction, storageAudit, storageGetAuditRange,
  storagePatchStory, storageDeleteUser,

  // DB lifecycle
  buildPgPool, initStorage, getPgPool, setPgPool,

  // bcrypt re-export for routes
  bcrypt
};
