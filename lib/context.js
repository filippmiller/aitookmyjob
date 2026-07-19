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

// Domain contract v1 (aitj-z8q.1) — lifecycle enums. Runtime still uses a subset
// of STORY_STATUS (pending|published|rejected); see LEGACY_GAPS / docs/domain-contract-v1.md §10.
const {
  DOMAIN_CONTRACT_VERSION,
  STORY_STATUS,
  VENT_STATUS,
  LEGACY_STORY_STATUSES,
  DISCUSSION_TOPIC_STATUS,
  NEWS_STATUS,
  COHORT_STATUS,
  PETITION_STATUS,
  OUTCOME_STATUS,
  EVIDENCE_TIER,
  SANCTION_TYPE,
  PUBLICATION_INTENT,
  DESIRED_RESPONSE,
  ANONYMITY_MODE,
  ADVICE_PERMISSION,
  RETENTION_PREFERENCE,
  VISIBILITY,
  ENTITY,
  RESOURCE_STATUS,
  OPPORTUNITY_STATUS,
  RESOURCE_VERIFICATION_STATE,
  RESOURCE_LINK_STATUS,
  RESOURCE_COST,
  RESOURCE_REPORT_STATUS,
  isValidStatus,
  isPubliclyListable,
  moderationActionToContentStatus,
  outcomeFromFoundNewJob,
  assertValidStatus,
  assertCanTransition,
  canTransition
} = require("./domain-contract");

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
const opportunitiesPath = path.join(dataDir, "opportunities.json");
const resourceSavesPath = path.join(dataDir, "resource-saves.json");
const resourceReviewsPath = path.join(dataDir, "resource-reviews.json");
const resourceReportsPath = path.join(dataDir, "resource-reports.json");
const newsPath = path.join(dataDir, "news.json");
const takedownsPath = path.join(dataDir, "takedowns.json");
const companyBoardsPath = path.join(dataDir, "company-boards.json");
const petitionsPath = path.join(dataDir, "petitions.json");
const petitionSignaturesPath = path.join(dataDir, "petition-signatures.json");
const boundaryPollVotesPath = path.join(dataDir, "boundary-poll-votes.json");
const cohortsPath = path.join(dataDir, "cohorts.json");
const anonymousInboxPath = path.join(dataDir, "anonymous-inbox.json");
const subscribersPath = path.join(dataDir, "subscribers.json");
const ventsPath = path.join(dataDir, "vents.json");
const expressionReportsPath = path.join(dataDir, "expression-reports.json");
const expressionFollowupsPath = path.join(dataDir, "expression-followups.json");

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
const ventId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 12);
const usrId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const topicId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const replyId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const sanctionId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const auditId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const expressionReportId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const expressionFollowupId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
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

/** Days after last_verified_at before a verified resource is treated as stale. */
const RESOURCE_STALE_AFTER_DAYS = Number(process.env.RESOURCE_STALE_AFTER_DAYS || 90);

/**
 * Seeded catalog — real public URLs only. example.com / placeholder hosts are forbidden.
 * Bead: aitj-z8q.12
 */
const defaultResources = [
  {
    id: "res-careeronestop",
    type: "jobs",
    title: "CareerOneStop — Job search & training finder",
    provider: "U.S. Department of Labor",
    region: "us",
    language: "en",
    url: "https://www.careeronestop.org/",
    summary: "Official U.S. DOL career portal: job search, training programs, unemployment info, and local help finders.",
    cost: "free",
    eligibility: "Open to job seekers in the United States; many tools useful internationally.",
    source: "https://www.careeronestop.org/",
    status: "published",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    flaggedReason: "",
    createdBy: "system"
  },
  {
    id: "res-worker-gov",
    type: "legal",
    title: "Worker.gov — Know your workplace rights",
    provider: "U.S. Department of Labor",
    region: "us",
    language: "en",
    url: "https://www.worker.gov/",
    summary: "Plain-language guide to U.S. worker rights, including wages, leave, safety, and how to file a complaint.",
    cost: "free",
    eligibility: "Workers covered by U.S. federal labor laws.",
    source: "https://www.worker.gov/",
    status: "published",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    flaggedReason: "",
    createdBy: "system"
  },
  {
    id: "res-freecodecamp",
    type: "reskilling",
    title: "freeCodeCamp — Free coding curriculum",
    provider: "freeCodeCamp",
    region: "global",
    language: "en",
    url: "https://www.freecodecamp.org/",
    summary: "Self-paced free courses for web development, data, and career-change projects with community support.",
    cost: "free",
    eligibility: "Anyone worldwide with internet access.",
    source: "https://www.freecodecamp.org/",
    status: "published",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    flaggedReason: "",
    createdBy: "system"
  },
  {
    id: "res-google-certs",
    type: "reskilling",
    title: "Google Career Certificates",
    provider: "Google / Coursera",
    region: "global",
    language: "en",
    url: "https://grow.google/certificates/",
    summary: "Professional certificates in IT support, data analytics, UX, project management, and more; financial aid available.",
    cost: "freemium",
    eligibility: "Adult learners; financial aid and scholarships available in many regions.",
    source: "https://grow.google/certificates/",
    status: "published",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    flaggedReason: "",
    createdBy: "system"
  },
  {
    id: "res-eeoc",
    type: "legal",
    title: "EEOC — Discrimination & retaliation complaints",
    provider: "U.S. Equal Employment Opportunity Commission",
    region: "us",
    language: "en",
    url: "https://www.eeoc.gov/",
    summary: "How to file charges of employment discrimination, harassment, or retaliation under U.S. federal law.",
    cost: "free",
    eligibility: "Employees and applicants covered by U.S. EEO laws.",
    source: "https://www.eeoc.gov/",
    status: "published",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    flaggedReason: "",
    createdBy: "system"
  },
  {
    id: "res-citizens-advice",
    type: "legal",
    title: "Citizens Advice — Work & redundancy rights (UK)",
    provider: "Citizens Advice",
    region: "gb",
    language: "en",
    url: "https://www.citizensadvice.org.uk/work/",
    summary: "Guidance on redundancy, unfair dismissal, furlough aftermath, and workplace rights in England and Wales.",
    cost: "free",
    eligibility: "People living or working in the UK (England & Wales primary; Scotland/NI have related services).",
    source: "https://www.citizensadvice.org.uk/work/",
    status: "published",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    flaggedReason: "",
    createdBy: "system"
  },
  {
    id: "res-arbeitsagentur",
    type: "jobs",
    title: "Bundesagentur für Arbeit — Jobs & benefits (DE)",
    provider: "Bundesagentur für Arbeit",
    region: "de",
    language: "de",
    url: "https://www.arbeitsagentur.de/",
    summary: "German federal employment agency: job listings, unemployment benefits (ALG), and career counseling.",
    cost: "free",
    eligibility: "Job seekers and employers in Germany.",
    source: "https://www.arbeitsagentur.de/",
    status: "published",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    flaggedReason: "",
    createdBy: "system"
  },
  {
    id: "res-ilo-skills",
    type: "reskilling",
    title: "ILO Skills & lifelong learning",
    provider: "International Labour Organization",
    region: "global",
    language: "en",
    url: "https://www.ilo.org/topics/skills-and-lifelong-learning",
    summary: "International research and policy resources on skills, reskilling, and just transitions for workers.",
    cost: "free",
    eligibility: "Open public research and guidance; not a direct benefits portal.",
    source: "https://www.ilo.org/",
    status: "published",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    flaggedReason: "",
    createdBy: "system"
  }
];

const defaultOpportunities = [
  {
    id: "opp-usajobs",
    type: "job",
    title: "USAJOBS — U.S. federal government careers",
    provider: "U.S. Office of Personnel Management",
    region: "us",
    language: "en",
    url: "https://www.usajobs.gov/",
    summary: "Official board for U.S. federal civilian job openings across agencies and locations.",
    cost: "free",
    eligibility: "U.S. citizens (and some non-citizens where posted); check each listing.",
    source: "https://www.usajobs.gov/",
    status: "open",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    profession: "multiple",
    closesAt: null,
    createdBy: "system"
  },
  {
    id: "opp-eures",
    type: "job",
    title: "EURES — European job mobility portal",
    provider: "European Commission",
    region: "global",
    language: "en",
    url: "https://eures.europa.eu/",
    summary: "Cross-border job vacancies, living & working guides, and mobility support across Europe.",
    cost: "free",
    eligibility: "Job seekers interested in working in EU/EEA countries (and partners).",
    source: "https://eures.europa.eu/",
    status: "open",
    verificationState: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    linkStatus: "unknown",
    profession: "multiple",
    closesAt: null,
    createdBy: "system"
  }
];

const BANNED_RESOURCE_HOSTS = Object.freeze([
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "127.0.0.1"
]);

function isBannedResourceUrl(url) {
  try {
    const u = new URL(String(url || ""));
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (BANNED_RESOURCE_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) return true;
    if (host.endsWith(".example") || host === "example") return true;
    return false;
  } catch (_e) {
    return true; // invalid URL is not acceptable for catalog
  }
}

function normalizeResourceCost(value) {
  const v = String(value || "free").toLowerCase();
  return Object.values(RESOURCE_COST).includes(v) ? v : RESOURCE_COST.UNKNOWN;
}

function normalizeVerificationState(value) {
  const v = String(value || "unverified").toLowerCase();
  return Object.values(RESOURCE_VERIFICATION_STATE).includes(v)
    ? v
    : RESOURCE_VERIFICATION_STATE.UNVERIFIED;
}

function normalizeLinkStatus(value) {
  const v = String(value || "unknown").toLowerCase();
  return Object.values(RESOURCE_LINK_STATUS).includes(v) ? v : RESOURCE_LINK_STATUS.UNKNOWN;
}

function deriveVerificationState(row) {
  const link = normalizeLinkStatus(row.linkStatus || row.link_status);
  if (link === RESOURCE_LINK_STATUS.BROKEN) return RESOURCE_VERIFICATION_STATE.BROKEN;
  const explicit = normalizeVerificationState(row.verificationState || row.verification_state);
  if (explicit === RESOURCE_VERIFICATION_STATE.BROKEN) return RESOURCE_VERIFICATION_STATE.BROKEN;
  const last = row.lastVerifiedAt || row.last_verified_at;
  if (last && explicit === RESOURCE_VERIFICATION_STATE.VERIFIED) {
    const ageMs = Date.now() - new Date(last).getTime();
    if (Number.isFinite(ageMs) && ageMs > RESOURCE_STALE_AFTER_DAYS * 24 * 3600 * 1000) {
      return RESOURCE_VERIFICATION_STATE.STALE;
    }
  }
  return explicit;
}

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
  { id: "pet-1", title: "Require disclosure when companies replace workers with AI", description: "Public petition for transparent layoff notices and transition support.", goal: 1000, signatures: 128, status: "open", createdAt: "2026-02-09T12:00:00.000Z" },
  { id: "open_letter_ai_reporting", title: "Open Letter: Demand Transparent AI Displacement Reporting", description: "Add your voice to a public demand for honest reporting when AI systems displace workers.", goal: 25000, signatures: 12847, status: "open", createdAt: "2026-02-10T12:00:00.000Z", featured: true }
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
  appendSetCookie(res, cookie.join("; "));
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
  appendSetCookie(res, cookie.join("; "));
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
  appendSetCookie(res, cookie.join("; "));
}

function appendSetCookie(res, cookieStr) {
  const existing = res.getHeader("Set-Cookie");
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
  if (Buffer.byteLength(cookieToken) !== Buffer.byteLength(String(headerToken))) return false;
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

/** Curators who may manage resource/opportunity supply (aitj-z8q.12). */
function hasTrustedCuratorRole(user) {
  return [
    "expert",
    "community_lead",
    "journalist",
    "moderator",
    "admin",
    "superadmin"
  ].includes(String(user?.role || ""));
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
// When DATABASE_URL is set, all production mutations go through PostgreSQL.
// JSON file writes are refused so container recreation cannot drop prod data,
// and so dual-write drift cannot occur (aitj-z8q.3).

function assertJsonFallbackAllowed(operation) {
  if (usePostgres) {
    const msg = `[storage] refused JSON file write while DATABASE_URL is set (${operation})`;
    console.error(msg);
    throw new Error(msg);
  }
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
  assertJsonFallbackAllowed(`writeJsonArray:${path.basename(filePath)}`);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

/** In-memory per-file mutex — serializes read-modify-write cycles per file path. */
const _fileLocks = new Map();
async function lockedJsonUpdate(filePath, mutateFn) {
  assertJsonFallbackAllowed(`lockedJsonUpdate:${path.basename(filePath)}`);
  // Queue behind any pending write on the same file
  const prev = _fileLocks.get(filePath) || Promise.resolve();
  let releaseFn;
  const gate = new Promise((resolve) => { releaseFn = resolve; });
  _fileLocks.set(filePath, gate);
  await prev;
  try {
    const data = readJsonArray(filePath);
    const result = mutateFn(data);
    // Direct write — already passed assert above; avoid double-check noise.
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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
  assertJsonFallbackAllowed("writeStories");
  fs.writeFileSync(storiesPath, JSON.stringify(stories, null, 2));
}

function readResources() { return readJsonArray(resourcesPath); }
function readNews() { return readJsonArray(newsPath); }
function readCompanyBoards() { return readJsonArray(companyBoardsPath); }
function readPetitions() { return readJsonArray(petitionsPath); }
function readCohorts() { return readJsonArray(cohortsPath); }
function readAnonymousInbox() { return readJsonArray(anonymousInboxPath); }

function makeNewsId(url) {
  return `news_${crypto.createHash("sha256").update(String(url || "")).digest("hex").slice(0, 20)}`;
}

function normalizeNewsTitle(title) {
  if (title && typeof title === "object" && !Array.isArray(title)) {
    const clean = {};
    for (const [lang, value] of Object.entries(title)) {
      const sanitized = sanitizeText(value);
      if (sanitized) clean[lang] = sanitized;
    }
    return Object.keys(clean).length ? clean : { en: "" };
  }
  return { en: sanitizeText(title) };
}

function normalizeNewsItem(row) {
  const title = normalizeNewsTitle(row.title);
  const url = sanitizeText(row.url);
  return {
    id: row.id || makeNewsId(url),
    title,
    source: sanitizeText(row.source || row.domain || "Unknown source"),
    url,
    publishedAt: row.publishedAt || row.published_at || row.date || new Date().toISOString(),
    region: normalizeCountry(row.region || "global"),
    language: normalizeLanguage(row.language || "en"),
    summary: sanitizeText(row.summary || row.excerpt || ""),
    status: sanitizeText(row.status || "published") || "published",
    relevanceScore: Number(row.relevanceScore ?? row.relevance_score ?? 0),
    discoveredAt: row.discoveredAt || row.discovered_at || new Date().toISOString(),
    updatedAt: row.updatedAt || row.updated_at || new Date().toISOString()
  };
}

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
    submittedBy: row.submitted_by || null, details, metrics,
    publicationIntent: row.publication_intent || row.publicationIntent || PUBLICATION_INTENT.STORY,
    desiredResponse: row.desired_response || row.desiredResponse || DESIRED_RESPONSE.WITNESS,
    advicePermission: row.advice_permission || row.advicePermission || ADVICE_PERMISSION.OPEN,
    anonymityMode: row.anonymity_mode || row.anonymityMode || ANONYMITY_MODE.ALIAS,
    visibility: row.visibility || VISIBILITY.PUBLIC,
    retentionPreference: row.retention_preference || row.retentionPreference || RETENTION_PREFERENCE.INDEFINITE
  };
}

function mapVentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || null,
    body: row.body,
    status: row.status,
    publicationIntent: row.publication_intent || row.publicationIntent || PUBLICATION_INTENT.VENT,
    desiredResponse: row.desired_response || row.desiredResponse || DESIRED_RESPONSE.EMPATHY,
    advicePermission: row.advice_permission || row.advicePermission || ADVICE_PERMISSION.CLOSED,
    anonymityMode: row.anonymity_mode || row.anonymityMode || ANONYMITY_MODE.ANONYMOUS,
    visibility: row.visibility || VISIBILITY.COMMUNITY,
    retentionPreference: row.retention_preference || row.retentionPreference || RETENTION_PREFERENCE.DAYS_30,
    country: row.country || "global",
    language: row.language || "en",
    displayName: row.display_name || row.displayName || "Anonymous",
    company: row.company || null,
    privacy: row.privacy || {},
    moderation: row.moderation || {},
    metrics: row.metrics || { views: 0, support: 0 },
    details: row.details || {},
    submittedBy: row.submitted_by || row.submittedBy || null,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt || row.created_at || row.createdAt,
    kind: "vent"
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
    evidenceTier: details.evidenceTier || "self_report",
    publicationIntent: story.publicationIntent || PUBLICATION_INTENT.STORY,
    desiredResponse: story.desiredResponse || DESIRED_RESPONSE.WITNESS,
    advicePermission: story.advicePermission || ADVICE_PERMISSION.OPEN,
    anonymityMode: story.anonymityMode || ANONYMITY_MODE.ALIAS,
    visibility: story.visibility || VISIBILITY.PUBLIC,
    retentionPreference: story.retentionPreference || RETENTION_PREFERENCE.INDEFINITE,
    kind: "story"
  };
}

function maskStoryByPrivacy(story) {
  const privacy = story.privacy || {};
  const nameDisplay = privacy.nameDisplay || "alias";
  const companyDisplay = privacy.companyDisplay || "exact";
  const geoDisplay = privacy.geoDisplay || "country";
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
  if (geoDisplay === "hidden") out.city = null;
  if (geoDisplay === "country") out.city = null;
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

function buildStoryRecord(parsedData, submittedBy, moderation, initialStatus, expressionControls = {}) {
  const details = {
    city: parsedData.city || null, tenureYears: parsedData.tenureYears ?? null,
    salaryBefore: parsedData.salaryBefore ?? null, salaryAfter: parsedData.salaryAfter ?? null,
    layoffType: parsedData.layoffType || null, aiTool: parsedData.aiTool || null,
    warnedAhead: parsedData.warnedAhead || null, compensationMonths: parsedData.compensationMonths ?? null,
    searchingMonths: parsedData.searchingMonths ?? null, newRoleField: parsedData.newRoleField || null,
    moodScore: parsedData.moodScore ?? null, updateLabel: null,
    evidenceTier: parsedData.evidenceTier || "self_report",
    newsUrl: expressionControls.newsUrl || parsedData.newsUrl || null
  };
  const metrics = { views: 0, meToo: 0, commentsCount: 0 };
  const intent = expressionControls.publicationIntent || parsedData.publicationIntent || PUBLICATION_INTENT.STORY;
  return ensureStoryDefaults({
    id: storyId(), ...parsedData,
    status: initialStatus, estimatedLayoffs: 1,
    moderation, details, metrics, submittedBy,
    publicationIntent: intent,
    desiredResponse: expressionControls.desiredResponse || parsedData.desiredResponse || DESIRED_RESPONSE.WITNESS,
    advicePermission: expressionControls.advicePermission || parsedData.advicePermission || ADVICE_PERMISSION.OPEN,
    anonymityMode: expressionControls.anonymityMode || parsedData.anonymityMode || ANONYMITY_MODE.ALIAS,
    visibility: expressionControls.visibility || parsedData.visibility || VISIBILITY.PUBLIC,
    retentionPreference: expressionControls.retentionPreference || parsedData.retentionPreference || RETENTION_PREFERENCE.INDEFINITE,
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

async function storageGetNews(options = {}) {
  const country = normalizeCountry(options.country || "global");
  const status = sanitizeText(options.status || "published");
  const limit = Math.min(Math.max(Number(options.limit || 24), 1), 100);

  if (!usePostgres) {
    const rows = readNews().length ? readNews() : defaultNews;
    return rows
      .map(normalizeNewsItem)
      .filter((item) => item.status === status && (country === "global" || item.region === "global" || item.region === country))
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, limit);
  }

  const res = await pgPool.query(
    `SELECT id, title, source, url, published_at, region, language, summary, status,
      relevance_score, discovered_at, updated_at
     FROM news_items
     WHERE status = $1 AND ($2 = 'global' OR region = 'global' OR region = $2)
     ORDER BY published_at DESC, discovered_at DESC
     LIMIT $3;`,
    [status, country, limit]
  );
  return res.rows.map(normalizeNewsItem);
}

async function storageUpsertNewsItems(items = []) {
  const normalized = items
    .map(normalizeNewsItem)
    .filter((item) => item.url && (item.title.en || Object.values(item.title).some(Boolean)));

  if (!normalized.length) return { inserted: 0, updated: 0, skipped: items.length };

  if (!usePostgres) {
    let inserted = 0;
    let updated = 0;
    await lockedJsonUpdate(newsPath, (rows) => {
      const byUrl = new Map(rows.map((row, idx) => [String(row.url || "").trim().toLowerCase(), idx]));
      for (const item of normalized) {
        const key = item.url.toLowerCase();
        const existingIdx = byUrl.get(key);
        if (existingIdx >= 0) {
          rows[existingIdx] = { ...rows[existingIdx], ...item, updatedAt: new Date().toISOString() };
          updated += 1;
        } else {
          rows.push(item);
          byUrl.set(key, rows.length - 1);
          inserted += 1;
        }
      }
      rows.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      if (rows.length > 500) rows.splice(500);
    });
    return { inserted, updated, skipped: items.length - normalized.length };
  }

  let inserted = 0;
  let updated = 0;
  for (const item of normalized) {
    const result = await pgPool.query(
      `INSERT INTO news_items
        (id, title, source, url, published_at, region, language, summary, status, relevance_score, discovered_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (url) DO UPDATE SET
         title = EXCLUDED.title,
         source = EXCLUDED.source,
         published_at = EXCLUDED.published_at,
         region = EXCLUDED.region,
         language = EXCLUDED.language,
         summary = EXCLUDED.summary,
         status = EXCLUDED.status,
         relevance_score = GREATEST(news_items.relevance_score, EXCLUDED.relevance_score),
         updated_at = NOW()
       RETURNING (xmax = 0) AS inserted;`,
      [
        item.id, JSON.stringify(item.title), item.source, item.url, item.publishedAt,
        item.region, item.language, item.summary, item.status, item.relevanceScore,
        item.discoveredAt
      ]
    );
    if (result.rows[0]?.inserted) inserted += 1;
    else updated += 1;
  }
  return { inserted, updated, skipped: items.length - normalized.length };
}

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
    `INSERT INTO stories (
      id, name, country, language, profession, company, laid_off_at, found_new_job, reason, story, status, estimated_layoffs,
      details, metrics, privacy, moderation, submitted_by, created_at, updated_at,
      publication_intent, desired_response, advice_permission, anonymity_mode, visibility, retention_preference
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25);`,
    [
      newStory.id, newStory.name, newStory.country, newStory.language, newStory.profession, newStory.company,
      newStory.laidOffAt, newStory.foundNewJob, newStory.reason, newStory.story, newStory.status, newStory.estimatedLayoffs,
      JSON.stringify(newStory.details || {}), JSON.stringify(newStory.metrics || {}), JSON.stringify(newStory.privacy || {}),
      JSON.stringify(newStory.moderation || {}), newStory.submittedBy || null, newStory.createdAt, newStory.updatedAt || newStory.createdAt,
      newStory.publicationIntent || PUBLICATION_INTENT.STORY,
      newStory.desiredResponse || DESIRED_RESPONSE.WITNESS,
      newStory.advicePermission || ADVICE_PERMISSION.OPEN,
      newStory.anonymityMode || ANONYMITY_MODE.ALIAS,
      newStory.visibility || VISIBILITY.PUBLIC,
      newStory.retentionPreference || RETENTION_PREFERENCE.INDEFINITE
    ]
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
    ? "SELECT id, topic_id, parent_id, body, country, language, status, created_by, created_at FROM forum_posts WHERE topic_id = $1 ORDER BY created_at ASC;"
    : "SELECT id, topic_id, parent_id, body, country, language, status, created_by, created_at FROM forum_posts ORDER BY created_at DESC LIMIT 100;";
  const params = topicIdValue ? [topicIdValue] : [];
  const res = await pgPool.query(query, params);
  return res.rows.map((r) => ({
    id: r.id,
    topicId: r.topic_id,
    parentId: r.parent_id || null,
    body: r.body,
    country: r.country,
    language: r.language,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at
  }));
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
  await pgPool.query(
    "INSERT INTO forum_posts (id, topic_id, parent_id, body, country, language, status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);",
    [
      reply.id,
      reply.topicId,
      reply.parentId || null,
      reply.body,
      reply.country,
      reply.language,
      reply.status,
      reply.createdBy,
      reply.createdAt
    ]
  );
}

async function storageGetModerationQueue() {
  const stories = await storageGetStories();
  const storyQueue = stories.filter((s) => s.status === "pending").slice(0, 100).map((s) => ({
    id: `story:${s.id}`,
    type: "story",
    title: `${s.profession} · ${s.name}`,
    story: s.story,
    publicationIntent: s.publicationIntent || PUBLICATION_INTENT.STORY,
    desiredResponse: s.desiredResponse || DESIRED_RESPONSE.WITNESS,
    createdAt: s.createdAt,
    moderation: s.moderation || {}
  }));
  const vents = await storageGetVents();
  const ventQueue = vents.filter((v) => v.status === "pending").slice(0, 100).map((v) => ({
    id: `vent:${v.id}`,
    type: "vent",
    title: v.title || `Vent · ${v.displayName || "Anonymous"}`,
    story: v.body,
    publicationIntent: v.publicationIntent || PUBLICATION_INTENT.VENT,
    desiredResponse: v.desiredResponse || DESIRED_RESPONSE.EMPATHY,
    createdAt: v.createdAt,
    moderation: v.moderation || {}
  }));
  const reports = await storageGetExpressionReports({ status: "open", limit: 50 });
  const reportQueue = reports.map((r) => ({
    id: `report:${r.id}`,
    type: "report",
    title: `Report on ${r.targetType}:${r.targetId}`,
    story: r.reason,
    createdAt: r.createdAt,
    metadata: { targetType: r.targetType, targetId: r.targetId, details: r.details }
  }));
  let topicQueue = [];
  if (usePostgres) {
    const res = await pgPool.query("SELECT id, title, body, created_at FROM forum_topics WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100;");
    topicQueue = res.rows.map((t) => ({ id: `topic:${t.id}`, type: "topic", title: t.title, story: t.body, createdAt: t.created_at }));
  } else {
    topicQueue = readJsonArray(forumTopicsPath).filter((t) => t.status === "pending").slice(0, 100).map((t) => ({ id: `topic:${t.id}`, type: "topic", title: t.title, story: t.body, createdAt: t.createdAt }));
  }
  return [...storyQueue, ...ventQueue, ...reportQueue, ...topicQueue].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function storageModerationAction(entryId, action, reason) {
  const [kind, id] = String(entryId || "").split(":");
  if (!kind || !id) return false;
  if (kind === "report") {
    const nextStatus = action === "approve" ? "resolved" : "dismissed";
    return storageUpdateExpressionReport(id, { status: nextStatus, resolution: reason || "" });
  }
  const next = action === "approve" ? "published" : "rejected";
  if (kind === "story") {
    const current = (await storageGetStories()).find((s) => s.id === id);
    if (!current) return false;
    try {
      assertCanTransition(ENTITY.STORY, current.status, next);
    } catch (_e) {
      return false;
    }
    if (!usePostgres) {
      return lockedJsonUpdate(storiesPath, (stories) => {
        const idx = stories.findIndex((s) => s.id === id);
        if (idx < 0) return false;
        stories[idx].status = next; stories[idx].moderationReason = reason || "";
        stories[idx].updatedAt = new Date().toISOString();
        return true;
      });
    }
    const res = await pgPool.query("UPDATE stories SET status=$1, updated_at=NOW() WHERE id=$2;", [next, id]);
    return res.rowCount > 0;
  }
  if (kind === "vent") {
    const current = await storageGetVentById(id);
    if (!current) return false;
    try {
      assertCanTransition(ENTITY.VENT, current.status, next);
    } catch (_e) {
      return false;
    }
    const updated = await storagePatchVent(id, () => ({
      status: next,
      moderationReason: reason || ""
    }));
    return Boolean(updated);
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
  await pgPool.query(
    `UPDATE stories SET
      found_new_job = $1, story = $2, reason = $3, details = $4, metrics = $5, status = $6, privacy = $7,
      publication_intent = $8, desired_response = $9, advice_permission = $10, anonymity_mode = $11,
      visibility = $12, retention_preference = $13, name = $14, profession = $15, company = $16,
      updated_at = $17
     WHERE id = $18;`,
    [
      Boolean(next.foundNewJob), next.story, next.reason || current.reason,
      JSON.stringify(next.details || {}), JSON.stringify(next.metrics || {}),
      next.status || "pending", JSON.stringify(next.privacy || {}),
      next.publicationIntent || PUBLICATION_INTENT.STORY,
      next.desiredResponse || DESIRED_RESPONSE.WITNESS,
      next.advicePermission || ADVICE_PERMISSION.OPEN,
      next.anonymityMode || ANONYMITY_MODE.ALIAS,
      next.visibility || VISIBILITY.PUBLIC,
      next.retentionPreference || RETENTION_PREFERENCE.INDEFINITE,
      next.name || current.name, next.profession || current.profession, next.company || current.company,
      next.updatedAt, storyIdValue
    ]
  );
  return next;
}

// ── Vents storage (aitj-z8q.8) ──

async function storageGetVents() {
  if (!usePostgres) {
    return readJsonArray(ventsPath).map(mapVentRow);
  }
  const res = await pgPool.query("SELECT * FROM vents ORDER BY created_at DESC;");
  return res.rows.map(mapVentRow);
}

async function storageGetVentById(id) {
  if (!usePostgres) {
    return mapVentRow(readJsonArray(ventsPath).find((v) => v.id === id) || null);
  }
  const res = await pgPool.query("SELECT * FROM vents WHERE id = $1 LIMIT 1;", [id]);
  if (!res.rows.length) return null;
  return mapVentRow(res.rows[0]);
}

async function storageInsertVent(vent) {
  const record = mapVentRow({
    ...vent,
    publication_intent: vent.publicationIntent,
    desired_response: vent.desiredResponse,
    advice_permission: vent.advicePermission,
    anonymity_mode: vent.anonymityMode,
    retention_preference: vent.retentionPreference,
    display_name: vent.displayName,
    submitted_by: vent.submittedBy,
    created_at: vent.createdAt,
    updated_at: vent.updatedAt
  }) || vent;
  if (!usePostgres) {
    await lockedJsonUpdate(ventsPath, (rows) => { rows.push(record); });
    return record;
  }
  await pgPool.query(
    `INSERT INTO vents (
      id, title, body, status, publication_intent, desired_response, advice_permission,
      anonymity_mode, visibility, retention_preference, country, language, display_name, company,
      privacy, moderation, metrics, details, submitted_by, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21);`,
    [
      record.id, record.title, record.body, record.status,
      record.publicationIntent, record.desiredResponse, record.advicePermission,
      record.anonymityMode, record.visibility, record.retentionPreference,
      record.country, record.language, record.displayName, record.company,
      JSON.stringify(record.privacy || {}), JSON.stringify(record.moderation || {}),
      JSON.stringify(record.metrics || {}), JSON.stringify(record.details || {}),
      record.submittedBy || null, record.createdAt, record.updatedAt
    ]
  );
  return record;
}

async function storagePatchVent(ventIdValue, patchFn) {
  const current = await storageGetVentById(ventIdValue);
  if (!current) return null;
  const next = mapVentRow({
    ...current,
    ...patchFn(current),
    updatedAt: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  if (!usePostgres) {
    let result = null;
    await lockedJsonUpdate(ventsPath, (rows) => {
      const idx = rows.findIndex((v) => v.id === ventIdValue);
      if (idx < 0) return;
      rows[idx] = next;
      result = next;
    });
    return result;
  }
  await pgPool.query(
    `UPDATE vents SET
      title = $1, body = $2, status = $3, desired_response = $4, advice_permission = $5,
      anonymity_mode = $6, visibility = $7, retention_preference = $8, display_name = $9,
      company = $10, privacy = $11, moderation = $12, metrics = $13, details = $14, updated_at = $15
     WHERE id = $16;`,
    [
      next.title, next.body, next.status, next.desiredResponse, next.advicePermission,
      next.anonymityMode, next.visibility, next.retentionPreference, next.displayName,
      next.company, JSON.stringify(next.privacy || {}), JSON.stringify(next.moderation || {}),
      JSON.stringify(next.metrics || {}), JSON.stringify(next.details || {}),
      next.updatedAt, ventIdValue
    ]
  );
  return next;
}

async function storageGetExpressionReports(options = {}) {
  const status = options.status || null;
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 500);
  if (!usePostgres) {
    return readJsonArray(expressionReportsPath)
      .filter((r) => !status || r.status === status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
  const res = status
    ? await pgPool.query(
      "SELECT * FROM expression_reports WHERE status = $1 ORDER BY created_at DESC LIMIT $2;",
      [status, limit]
    )
    : await pgPool.query(
      "SELECT * FROM expression_reports ORDER BY created_at DESC LIMIT $1;",
      [limit]
    );
  return res.rows.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    details: r.details || "",
    reporterId: r.reporter_id,
    status: r.status,
    createdAt: r.created_at
  }));
}

async function storageInsertExpressionReport(entry) {
  const record = {
    id: entry.id || expressionReportId(),
    targetType: entry.targetType,
    targetId: entry.targetId,
    reason: entry.reason,
    details: entry.details || "",
    reporterId: entry.reporterId || null,
    status: entry.status || "open",
    createdAt: entry.createdAt || new Date().toISOString()
  };
  if (!usePostgres) {
    await lockedJsonUpdate(expressionReportsPath, (rows) => { rows.push(record); });
    return record;
  }
  await pgPool.query(
    `INSERT INTO expression_reports (id, target_type, target_id, reason, details, reporter_id, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8);`,
    [record.id, record.targetType, record.targetId, record.reason, record.details, record.reporterId, record.status, record.createdAt]
  );
  return record;
}

async function storageUpdateExpressionReport(id, patch) {
  if (!usePostgres) {
    return lockedJsonUpdate(expressionReportsPath, (rows) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      rows[idx] = { ...rows[idx], ...patch };
      return true;
    });
  }
  const res = await pgPool.query(
    "UPDATE expression_reports SET status = COALESCE($1, status) WHERE id = $2;",
    [patch.status || null, id]
  );
  return res.rowCount > 0;
}

async function storageGetExpressionFollowups(targetType, targetId) {
  if (!usePostgres) {
    return readJsonArray(expressionFollowupsPath)
      .filter((f) => f.targetType === targetType && f.targetId === targetId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
  const res = await pgPool.query(
    "SELECT * FROM expression_followups WHERE target_type = $1 AND target_id = $2 ORDER BY created_at ASC;",
    [targetType, targetId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    body: r.body,
    outcomeStatus: r.outcome_status,
    createdBy: r.created_by,
    createdAt: r.created_at
  }));
}

async function storageInsertExpressionFollowup(entry) {
  const record = {
    id: entry.id || expressionFollowupId(),
    targetType: entry.targetType,
    targetId: entry.targetId,
    body: entry.body,
    outcomeStatus: entry.outcomeStatus || null,
    createdBy: entry.createdBy || null,
    createdAt: entry.createdAt || new Date().toISOString()
  };
  if (!usePostgres) {
    await lockedJsonUpdate(expressionFollowupsPath, (rows) => { rows.push(record); });
    return record;
  }
  await pgPool.query(
    `INSERT INTO expression_followups (id, target_type, target_id, body, outcome_status, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7);`,
    [record.id, record.targetType, record.targetId, record.body, record.outcomeStatus, record.createdBy, record.createdAt]
  );
  return record;
}

function buildVentRecord(data, submittedBy, moderation, initialStatus) {
  const now = new Date().toISOString();
  return mapVentRow({
    id: ventId(),
    title: data.title || null,
    body: data.body,
    status: initialStatus,
    publication_intent: PUBLICATION_INTENT.VENT,
    desired_response: data.desiredResponse || DESIRED_RESPONSE.EMPATHY,
    advice_permission: data.advicePermission || ADVICE_PERMISSION.CLOSED,
    anonymity_mode: data.anonymityMode || ANONYMITY_MODE.ANONYMOUS,
    visibility: data.visibility || VISIBILITY.COMMUNITY,
    retention_preference: data.retentionPreference || RETENTION_PREFERENCE.DAYS_30,
    country: data.country || "global",
    language: data.language || "en",
    display_name: data.displayName || "Anonymous",
    company: data.company || null,
    privacy: data.privacy || {},
    moderation: moderation || {},
    metrics: { views: 0, support: 0 },
    details: data.details || {},
    submitted_by: submittedBy || null,
    created_at: now,
    updated_at: now
  });
}

function normalizePetition(row, signatureRows = 0, viewerSigned = false) {
  const baseSignatures = Number(row.baseSignatures ?? row.base_signatures ?? row.signatures ?? 0);
  return {
    id: row.id,
    title: row.title,
    description: row.description || row.body || "",
    goal: Number(row.goal || 1000),
    signatures: baseSignatures + Number(signatureRows || 0),
    status: row.status || "open",
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    featured: Boolean(row.featured),
    viewerSigned: Boolean(viewerSigned)
  };
}

function mergeDefaultPetitions(rows) {
  const merged = [...rows];
  for (const petition of defaultPetitions) {
    if (!merged.some((entry) => entry.id === petition.id)) merged.push(petition);
  }
  return merged;
}

async function storageGetPetitions(visitorHash = "") {
  if (!usePostgres) {
    const rows = readPetitions();
    const petitions = mergeDefaultPetitions(rows);
    const signatures = readJsonArray(petitionSignaturesPath);
    return petitions.map((petition) => {
      const petitionSignatures = signatures.filter((entry) => entry.petitionId === petition.id);
      return normalizePetition(
        petition,
        petitionSignatures.length,
        Boolean(visitorHash && petitionSignatures.some((entry) => entry.voterHash === visitorHash))
      );
    });
  }

  const res = await pgPool.query(
    `SELECT p.id, p.title, p.description, p.goal, p.base_signatures, p.status, p.created_at, p.featured,
      COALESCE(COUNT(s.voter_hash), 0)::int AS signature_rows,
      COALESCE(BOOL_OR($1::text IS NOT NULL AND s.voter_hash = $1), false) AS viewer_signed
     FROM petitions p
     LEFT JOIN petition_signatures s ON s.petition_id = p.id
     WHERE p.status <> 'deleted'
     GROUP BY p.id
     ORDER BY p.featured DESC, p.created_at DESC;`,
    [visitorHash || null]
  );
  return res.rows.map((row) => normalizePetition(row, row.signature_rows, row.viewer_signed));
}

async function storageCreatePetition(row) {
  if (!usePostgres) {
    await lockedJsonUpdate(petitionsPath, (petitions) => {
      petitions.push(row);
      if (petitions.length > 1000) petitions.splice(0, petitions.length - 1000);
    });
    return normalizePetition(row);
  }

  await pgPool.query(
    `INSERT INTO petitions (id, title, description, goal, base_signatures, status, created_at, featured)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING;`,
    [row.id, row.title, row.description, Number(row.goal || 1000), Number(row.signatures || 0), row.status || "open", row.createdAt || new Date().toISOString(), Boolean(row.featured)]
  );
  return normalizePetition(row);
}

async function storageSignPetition(petitionIdValue, visitorHash) {
  if (!visitorHash) return null;

  if (!usePostgres) {
    const petitions = await storageGetPetitions(visitorHash);
    if (!petitions.some((petition) => petition.id === petitionIdValue)) return null;
    let duplicate = false;
    await lockedJsonUpdate(petitionSignaturesPath, (signatures) => {
      duplicate = signatures.some((entry) => entry.petitionId === petitionIdValue && entry.voterHash === visitorHash);
      if (!duplicate) {
        signatures.push({ petitionId: petitionIdValue, voterHash: visitorHash, signedAt: new Date().toISOString() });
      }
    });
    const updated = (await storageGetPetitions(visitorHash)).find((petition) => petition.id === petitionIdValue);
    return updated ? { petition: updated, duplicate } : null;
  }

  const petitionRes = await pgPool.query("SELECT id FROM petitions WHERE id = $1 AND status <> 'deleted' LIMIT 1;", [petitionIdValue]);
  if (!petitionRes.rows.length) return null;
  const insertRes = await pgPool.query(
    "INSERT INTO petition_signatures (petition_id, voter_hash) VALUES ($1,$2) ON CONFLICT DO NOTHING;",
    [petitionIdValue, visitorHash]
  );
  const updated = (await storageGetPetitions(visitorHash)).find((petition) => petition.id === petitionIdValue);
  return updated ? { petition: updated, duplicate: insertRes.rowCount === 0 } : null;
}

async function storageGetBoundaryPollResults(definitions, visitorHash = "") {
  const pollIds = definitions.map((poll) => poll.id);
  const byId = new Map(definitions.map((poll) => [poll.id, poll]));
  const totals = new Map(pollIds.map((id) => [id, { yes: 0, no: 0, unsure: 0 }]));
  const selected = new Map();

  if (!usePostgres) {
    const votes = readJsonArray(boundaryPollVotesPath).filter((vote) => byId.has(vote.pollId));
    votes.forEach((vote) => {
      const bucket = totals.get(vote.pollId);
      if (bucket && Object.prototype.hasOwnProperty.call(bucket, vote.choice)) bucket[vote.choice] += 1;
      if (visitorHash && vote.voterHash === visitorHash) selected.set(vote.pollId, vote.choice);
    });
  } else if (pollIds.length) {
    const totalsRes = await pgPool.query(
      "SELECT poll_id, choice, COUNT(*)::int AS count FROM boundary_poll_votes WHERE poll_id = ANY($1::text[]) GROUP BY poll_id, choice;",
      [pollIds]
    );
    totalsRes.rows.forEach((row) => {
      const bucket = totals.get(row.poll_id);
      if (bucket && Object.prototype.hasOwnProperty.call(bucket, row.choice)) bucket[row.choice] = Number(row.count || 0);
    });
    if (visitorHash) {
      const selectedRes = await pgPool.query(
        "SELECT poll_id, choice FROM boundary_poll_votes WHERE voter_hash = $1 AND poll_id = ANY($2::text[]);",
        [visitorHash, pollIds]
      );
      selectedRes.rows.forEach((row) => selected.set(row.poll_id, row.choice));
    }
  }

  return definitions.map((poll) => {
    const pollTotals = totals.get(poll.id) || { yes: 0, no: 0, unsure: 0 };
    return {
      id: poll.id,
      icon: poll.icon,
      question: poll.question,
      totals: pollTotals,
      totalVotes: pollTotals.yes + pollTotals.no + pollTotals.unsure,
      selected: selected.get(poll.id) || null
    };
  });
}

async function storageUpsertBoundaryPollVote(pollIdValue, choice, visitorHash) {
  if (!visitorHash) return false;
  if (!["yes", "no", "unsure"].includes(choice)) return false;

  if (!usePostgres) {
    await lockedJsonUpdate(boundaryPollVotesPath, (votes) => {
      const now = new Date().toISOString();
      const idx = votes.findIndex((vote) => vote.pollId === pollIdValue && vote.voterHash === visitorHash);
      if (idx >= 0) {
        votes[idx] = { ...votes[idx], choice, updatedAt: now };
      } else {
        votes.push({ pollId: pollIdValue, voterHash: visitorHash, choice, createdAt: now, updatedAt: now });
      }
    });
    return true;
  }

  await pgPool.query(
    `INSERT INTO boundary_poll_votes (poll_id, voter_hash, choice)
     VALUES ($1,$2,$3)
     ON CONFLICT (poll_id, voter_hash)
     DO UPDATE SET choice = EXCLUDED.choice, updated_at = NOW();`,
    [pollIdValue, visitorHash, choice]
  );
  return true;
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

async function storageUpdateForumTopic(topicIdValue, updates) {
  if (!usePostgres) {
    let next = null;
    await lockedJsonUpdate(forumTopicsPath, (topics) => {
      const idx = topics.findIndex((t) => t.id === topicIdValue);
      if (idx < 0) return;
      topics[idx] = { ...topics[idx], ...updates };
      next = topics[idx];
    });
    return next;
  }
  const res = await pgPool.query(
    `UPDATE forum_topics
     SET title = COALESCE($1, title),
         body = COALESCE($2, body),
         category_id = COALESCE($3, category_id),
         updated_at = NOW()
     WHERE id = $4
     RETURNING id, category_id, title, body, country, language, status, created_by, created_at, updated_at;`,
    [updates.title || null, updates.body || null, updates.categoryId || null, topicIdValue]
  );
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    categoryId: r.category_id,
    title: r.title,
    body: r.body,
    country: r.country,
    language: r.language,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

async function storageDeleteForumTopic(topicIdValue) {
  if (!usePostgres) {
    await lockedJsonUpdate(forumTopicsPath, (topics) => {
      const idx = topics.findIndex((t) => t.id === topicIdValue);
      if (idx >= 0) topics.splice(idx, 1);
    });
    await lockedJsonUpdate(forumRepliesPath, (replies) => {
      for (let i = replies.length - 1; i >= 0; i--) {
        if (replies[i].topicId === topicIdValue) replies.splice(i, 1);
      }
    });
    return true;
  }
  // forum_posts CASCADE via FK from baseline
  const res = await pgPool.query("DELETE FROM forum_topics WHERE id = $1;", [topicIdValue]);
  return res.rowCount > 0;
}

function mapResourceRow(r) {
  if (!r) return null;
  const mapped = {
    id: r.id,
    type: r.type || "reskilling",
    title: r.title,
    provider: r.provider || "",
    region: r.region || "global",
    language: r.language || "en",
    url: r.url || "",
    summary: r.summary || "",
    cost: normalizeResourceCost(r.cost),
    eligibility: r.eligibility || "",
    source: r.source || "",
    status: r.status || RESOURCE_STATUS.PUBLISHED,
    verificationState: normalizeVerificationState(r.verificationState ?? r.verification_state),
    lastVerifiedAt: r.lastVerifiedAt ?? r.last_verified_at ?? null,
    linkStatus: normalizeLinkStatus(r.linkStatus ?? r.link_status),
    linkCheckedAt: r.linkCheckedAt ?? r.link_checked_at ?? null,
    linkHttpStatus: r.linkHttpStatus ?? r.link_http_status ?? null,
    flaggedReason: r.flaggedReason ?? r.flagged_reason ?? "",
    createdBy: r.createdBy ?? r.created_by ?? "system",
    createdAt: r.createdAt ?? r.created_at ?? null,
    updatedAt: r.updatedAt ?? r.updated_at ?? null
  };
  mapped.verificationState = deriveVerificationState(mapped);
  return mapped;
}

function normalizeResourceInput(row = {}) {
  const url = String(row.url || "").trim();
  if (isBannedResourceUrl(url)) {
    const err = new Error("Banned or invalid resource URL (example.com and placeholders are not allowed)");
    err.code = "BANNED_RESOURCE_URL";
    throw err;
  }
  const status = String(row.status || RESOURCE_STATUS.PUBLISHED).toLowerCase();
  if (!isValidStatus("resource", status)) {
    const err = new Error(`Invalid resource status: ${status}`);
    err.code = "INVALID_STATUS";
    throw err;
  }
  return {
    id: row.id,
    type: String(row.type || "reskilling").slice(0, 40),
    title: String(row.title || "").trim(),
    provider: String(row.provider || "").trim(),
    region: normalizeCountry(row.region || "global"),
    language: normalizeLanguage(row.language || "en"),
    url,
    summary: String(row.summary || "").trim(),
    cost: normalizeResourceCost(row.cost),
    eligibility: String(row.eligibility || "").trim(),
    source: String(row.source || url).trim(),
    status,
    verificationState: normalizeVerificationState(row.verificationState || row.verification_state),
    lastVerifiedAt: row.lastVerifiedAt || row.last_verified_at || null,
    linkStatus: normalizeLinkStatus(row.linkStatus || row.link_status),
    linkCheckedAt: row.linkCheckedAt || row.link_checked_at || null,
    linkHttpStatus: row.linkHttpStatus ?? row.link_http_status ?? null,
    flaggedReason: String(row.flaggedReason || row.flagged_reason || "").trim(),
    createdBy: String(row.createdBy || row.created_by || "system")
  };
}

async function storageGetResources({ includeNonPublic = false, includeDeleted = false } = {}) {
  if (!usePostgres) {
    const rows = readResources();
    const base = (rows.length ? rows : defaultResources).map(mapResourceRow).filter(Boolean);
    return base.filter((r) => {
      if (!includeDeleted && r.status === RESOURCE_STATUS.DELETED) return false;
      if (!includeNonPublic && !isPubliclyListable("resource", r.status)) return false;
      return true;
    });
  }
  let sql =
    "SELECT id, type, title, provider, region, language, url, summary, cost, eligibility, source, status, verification_state, last_verified_at, link_status, link_checked_at, link_http_status, flagged_reason, created_by, created_at, updated_at FROM resources";
  const clauses = [];
  if (!includeDeleted) clauses.push("status <> 'deleted'");
  if (!includeNonPublic) clauses.push("status = 'published'");
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY created_at DESC;";
  const res = await pgPool.query(sql);
  if (!res.rows.length && !includeNonPublic) {
    // Fresh DB before seed — surface defaults without writing
    return defaultResources.map(mapResourceRow);
  }
  return res.rows.map(mapResourceRow);
}

async function storageGetResourceById(id, { includeNonPublic = false } = {}) {
  if (!usePostgres) {
    const rows = await storageGetResources({ includeNonPublic: true, includeDeleted: true });
    const found = rows.find((r) => r.id === id) || null;
    if (!found) return null;
    if (!includeNonPublic && !isPubliclyListable("resource", found.status)) return null;
    return found;
  }
  const res = await pgPool.query(
    `SELECT id, type, title, provider, region, language, url, summary, cost, eligibility, source, status,
            verification_state, last_verified_at, link_status, link_checked_at, link_http_status,
            flagged_reason, created_by, created_at, updated_at
     FROM resources WHERE id = $1;`,
    [id]
  );
  if (!res.rows.length) return null;
  const mapped = mapResourceRow(res.rows[0]);
  if (!includeNonPublic && !isPubliclyListable("resource", mapped.status)) return null;
  return mapped;
}

async function storageUpsertResource(row) {
  const normalized = normalizeResourceInput(row);
  if (!normalized.id || !normalized.title) {
    const err = new Error("Resource id and title are required");
    err.code = "VALIDATION";
    throw err;
  }
  if (!usePostgres) {
    let saved = normalized;
    await lockedJsonUpdate(resourcesPath, (rows) => {
      const idx = rows.findIndex((r) => r.id === normalized.id);
      if (idx >= 0) {
        saved = mapResourceRow({ ...rows[idx], ...normalized });
        rows[idx] = saved;
      } else {
        saved = mapResourceRow(normalized);
        rows.push(saved);
      }
    });
    return saved;
  }
  await pgPool.query(
    `INSERT INTO resources (
       id, type, title, provider, region, language, url, summary, cost, eligibility, source,
       status, verification_state, last_verified_at, link_status, link_checked_at, link_http_status,
       flagged_reason, created_by, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       type = EXCLUDED.type, title = EXCLUDED.title, provider = EXCLUDED.provider,
       region = EXCLUDED.region, language = EXCLUDED.language, url = EXCLUDED.url,
       summary = EXCLUDED.summary, cost = EXCLUDED.cost, eligibility = EXCLUDED.eligibility,
       source = EXCLUDED.source, status = EXCLUDED.status,
       verification_state = EXCLUDED.verification_state,
       last_verified_at = EXCLUDED.last_verified_at,
       link_status = EXCLUDED.link_status, link_checked_at = EXCLUDED.link_checked_at,
       link_http_status = EXCLUDED.link_http_status, flagged_reason = EXCLUDED.flagged_reason,
       updated_at = NOW();`,
    [
      normalized.id,
      normalized.type,
      normalized.title,
      normalized.provider,
      normalized.region,
      normalized.language,
      normalized.url,
      normalized.summary,
      normalized.cost,
      normalized.eligibility,
      normalized.source,
      normalized.status,
      normalized.verificationState,
      normalized.lastVerifiedAt,
      normalized.linkStatus,
      normalized.linkCheckedAt,
      normalized.linkHttpStatus,
      normalized.flaggedReason,
      normalized.createdBy
    ]
  );
  return storageGetResourceById(normalized.id, { includeNonPublic: true });
}

async function storageDeleteResource(id, { hard = false } = {}) {
  if (!usePostgres) {
    let removed = false;
    await lockedJsonUpdate(resourcesPath, (rows) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return;
      removed = true;
      if (hard) rows.splice(idx, 1);
      else rows[idx] = { ...rows[idx], status: RESOURCE_STATUS.DELETED };
    });
    return removed;
  }
  if (hard) {
    const res = await pgPool.query("DELETE FROM resources WHERE id = $1;", [id]);
    return res.rowCount > 0;
  }
  const res = await pgPool.query(
    "UPDATE resources SET status = 'deleted', updated_at = NOW() WHERE id = $1 AND status <> 'deleted';",
    [id]
  );
  return res.rowCount > 0;
}

async function storageUpdateResourceLinkCheck(id, { linkStatus, linkHttpStatus, flaggedReason } = {}) {
  const status = normalizeLinkStatus(linkStatus);
  const verificationState =
    status === RESOURCE_LINK_STATUS.BROKEN
      ? RESOURCE_VERIFICATION_STATE.BROKEN
      : status === RESOURCE_LINK_STATUS.OK
        ? RESOURCE_VERIFICATION_STATE.VERIFIED
        : undefined;
  const now = new Date().toISOString();
  if (!usePostgres) {
    let updated = null;
    await lockedJsonUpdate(resourcesPath, (rows) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return;
      rows[idx] = {
        ...rows[idx],
        linkStatus: status,
        linkCheckedAt: now,
        linkHttpStatus: linkHttpStatus ?? null,
        flaggedReason: flaggedReason != null ? flaggedReason : rows[idx].flaggedReason || "",
        verificationState: verificationState || rows[idx].verificationState || "unverified",
        lastVerifiedAt:
          status === RESOURCE_LINK_STATUS.OK
            ? now
            : rows[idx].lastVerifiedAt || rows[idx].last_verified_at || null
      };
      updated = mapResourceRow(rows[idx]);
    });
    return updated;
  }
  const res = await pgPool.query(
    `UPDATE resources SET
       link_status = $2,
       link_checked_at = NOW(),
       link_http_status = $3,
       flagged_reason = COALESCE($4, flagged_reason),
       verification_state = COALESCE($5, verification_state),
       last_verified_at = CASE WHEN $2 = 'ok' THEN NOW() ELSE last_verified_at END,
       updated_at = NOW()
     WHERE id = $1
     RETURNING id, type, title, provider, region, language, url, summary, cost, eligibility, source, status,
               verification_state, last_verified_at, link_status, link_checked_at, link_http_status,
               flagged_reason, created_by, created_at, updated_at;`,
    [id, status, linkHttpStatus ?? null, flaggedReason ?? null, verificationState || null]
  );
  return res.rows[0] ? mapResourceRow(res.rows[0]) : null;
}

function mapOpportunityRow(r) {
  if (!r) return null;
  const mapped = {
    id: r.id,
    type: r.type || "job",
    title: r.title,
    provider: r.provider || "",
    region: r.region || "global",
    language: r.language || "en",
    url: r.url || "",
    summary: r.summary || "",
    cost: normalizeResourceCost(r.cost),
    eligibility: r.eligibility || "",
    source: r.source || "",
    status: r.status || OPPORTUNITY_STATUS.OPEN,
    verificationState: normalizeVerificationState(r.verificationState ?? r.verification_state),
    lastVerifiedAt: r.lastVerifiedAt ?? r.last_verified_at ?? null,
    linkStatus: normalizeLinkStatus(r.linkStatus ?? r.link_status),
    linkCheckedAt: r.linkCheckedAt ?? r.link_checked_at ?? null,
    linkHttpStatus: r.linkHttpStatus ?? r.link_http_status ?? null,
    profession: r.profession || "",
    closesAt: r.closesAt ?? r.closes_at ?? null,
    createdBy: r.createdBy ?? r.created_by ?? "system",
    createdAt: r.createdAt ?? r.created_at ?? null,
    updatedAt: r.updatedAt ?? r.updated_at ?? null
  };
  mapped.verificationState = deriveVerificationState(mapped);
  return mapped;
}

function readOpportunities() {
  return readJsonArray(opportunitiesPath);
}

function normalizeOpportunityInput(row = {}) {
  const url = String(row.url || "").trim();
  if (isBannedResourceUrl(url)) {
    const err = new Error("Banned or invalid opportunity URL (example.com and placeholders are not allowed)");
    err.code = "BANNED_RESOURCE_URL";
    throw err;
  }
  const status = String(row.status || OPPORTUNITY_STATUS.OPEN).toLowerCase();
  if (!isValidStatus("opportunity", status)) {
    const err = new Error(`Invalid opportunity status: ${status}`);
    err.code = "INVALID_STATUS";
    throw err;
  }
  return {
    id: row.id,
    type: String(row.type || "job").slice(0, 40),
    title: String(row.title || "").trim(),
    provider: String(row.provider || "").trim(),
    region: normalizeCountry(row.region || "global"),
    language: normalizeLanguage(row.language || "en"),
    url,
    summary: String(row.summary || "").trim(),
    cost: normalizeResourceCost(row.cost),
    eligibility: String(row.eligibility || "").trim(),
    source: String(row.source || url).trim(),
    status,
    verificationState: normalizeVerificationState(row.verificationState || row.verification_state),
    lastVerifiedAt: row.lastVerifiedAt || row.last_verified_at || null,
    linkStatus: normalizeLinkStatus(row.linkStatus || row.link_status),
    linkCheckedAt: row.linkCheckedAt || row.link_checked_at || null,
    linkHttpStatus: row.linkHttpStatus ?? row.link_http_status ?? null,
    profession: String(row.profession || "").trim(),
    closesAt: row.closesAt || row.closes_at || null,
    createdBy: String(row.createdBy || row.created_by || "system")
  };
}

async function storageGetOpportunities({ includeNonPublic = false, includeDeleted = false } = {}) {
  if (!usePostgres) {
    const rows = readOpportunities();
    const base = (rows.length ? rows : defaultOpportunities).map(mapOpportunityRow).filter(Boolean);
    return base.filter((o) => {
      if (!includeDeleted && o.status === OPPORTUNITY_STATUS.DELETED) return false;
      if (!includeNonPublic && !isPubliclyListable("opportunity", o.status)) return false;
      return true;
    });
  }
  let sql = `SELECT id, type, title, provider, region, language, url, summary, cost, eligibility, source,
                    status, verification_state, last_verified_at, link_status, link_checked_at, link_http_status,
                    profession, closes_at, created_by, created_at, updated_at FROM opportunities`;
  const clauses = [];
  if (!includeDeleted) clauses.push("status <> 'deleted'");
  if (!includeNonPublic) clauses.push("status = 'open'");
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY created_at DESC;";
  const res = await pgPool.query(sql);
  if (!res.rows.length && !includeNonPublic) return defaultOpportunities.map(mapOpportunityRow);
  return res.rows.map(mapOpportunityRow);
}

async function storageGetOpportunityById(id, { includeNonPublic = false } = {}) {
  const all = await storageGetOpportunities({ includeNonPublic: true, includeDeleted: true });
  const found = all.find((o) => o.id === id) || null;
  if (!found) return null;
  if (!includeNonPublic && !isPubliclyListable("opportunity", found.status)) return null;
  return found;
}

async function storageUpsertOpportunity(row) {
  const normalized = normalizeOpportunityInput(row);
  if (!normalized.id || !normalized.title) {
    const err = new Error("Opportunity id and title are required");
    err.code = "VALIDATION";
    throw err;
  }
  if (!usePostgres) {
    let saved = normalized;
    await lockedJsonUpdate(opportunitiesPath, (rows) => {
      const idx = rows.findIndex((r) => r.id === normalized.id);
      if (idx >= 0) {
        saved = mapOpportunityRow({ ...rows[idx], ...normalized });
        rows[idx] = saved;
      } else {
        saved = mapOpportunityRow(normalized);
        rows.push(saved);
      }
    });
    return saved;
  }
  await pgPool.query(
    `INSERT INTO opportunities (
       id, type, title, provider, region, language, url, summary, cost, eligibility, source,
       status, verification_state, last_verified_at, link_status, link_checked_at, link_http_status,
       profession, closes_at, created_by, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       type = EXCLUDED.type, title = EXCLUDED.title, provider = EXCLUDED.provider,
       region = EXCLUDED.region, language = EXCLUDED.language, url = EXCLUDED.url,
       summary = EXCLUDED.summary, cost = EXCLUDED.cost, eligibility = EXCLUDED.eligibility,
       source = EXCLUDED.source, status = EXCLUDED.status,
       verification_state = EXCLUDED.verification_state, last_verified_at = EXCLUDED.last_verified_at,
       link_status = EXCLUDED.link_status, link_checked_at = EXCLUDED.link_checked_at,
       link_http_status = EXCLUDED.link_http_status, profession = EXCLUDED.profession,
       closes_at = EXCLUDED.closes_at, updated_at = NOW();`,
    [
      normalized.id,
      normalized.type,
      normalized.title,
      normalized.provider,
      normalized.region,
      normalized.language,
      normalized.url,
      normalized.summary,
      normalized.cost,
      normalized.eligibility,
      normalized.source,
      normalized.status,
      normalized.verificationState,
      normalized.lastVerifiedAt,
      normalized.linkStatus,
      normalized.linkCheckedAt,
      normalized.linkHttpStatus,
      normalized.profession,
      normalized.closesAt,
      normalized.createdBy
    ]
  );
  return storageGetOpportunityById(normalized.id, { includeNonPublic: true });
}

async function storageDeleteOpportunity(id, { hard = false } = {}) {
  if (!usePostgres) {
    let removed = false;
    await lockedJsonUpdate(opportunitiesPath, (rows) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return;
      removed = true;
      if (hard) rows.splice(idx, 1);
      else rows[idx] = { ...rows[idx], status: OPPORTUNITY_STATUS.DELETED };
    });
    return removed;
  }
  if (hard) {
    const res = await pgPool.query("DELETE FROM opportunities WHERE id = $1;", [id]);
    return res.rowCount > 0;
  }
  const res = await pgPool.query(
    "UPDATE opportunities SET status = 'deleted', updated_at = NOW() WHERE id = $1 AND status <> 'deleted';",
    [id]
  );
  return res.rowCount > 0;
}

// ── Resource saves / reviews / reports ──────────────────────────────────────

function mapResourceSaveRow(r) {
  return {
    userId: r.userId ?? r.user_id,
    resourceId: r.resourceId ?? r.resource_id,
    createdAt: r.createdAt ?? r.created_at
  };
}

function mapResourceReviewRow(r) {
  return {
    id: r.id,
    userId: r.userId ?? r.user_id,
    resourceId: r.resourceId ?? r.resource_id,
    rating: Number(r.rating),
    body: r.body || "",
    status: r.status || "published",
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at
  };
}

function mapResourceReportRow(r) {
  return {
    id: r.id,
    userId: r.userId ?? r.user_id ?? null,
    resourceId: r.resourceId ?? r.resource_id,
    reason: r.reason,
    details: r.details || "",
    status: r.status || RESOURCE_REPORT_STATUS.OPEN,
    createdAt: r.createdAt ?? r.created_at,
    resolvedAt: r.resolvedAt ?? r.resolved_at ?? null,
    resolvedBy: r.resolvedBy ?? r.resolved_by ?? null
  };
}

async function storageSaveResource(userId, resourceId) {
  const resource = await storageGetResourceById(resourceId, { includeNonPublic: true });
  if (!resource || resource.status === RESOURCE_STATUS.DELETED) {
    return { ok: false, reason: "not_found" };
  }
  if (!usePostgres) {
    let created = true;
    await lockedJsonUpdate(resourceSavesPath, (rows) => {
      if (rows.some((r) => r.userId === userId && r.resourceId === resourceId)) {
        created = false;
        return;
      }
      rows.push({ userId, resourceId, createdAt: new Date().toISOString() });
    });
    return { ok: true, created, resourceId };
  }
  const res = await pgPool.query(
    `INSERT INTO resource_saves (user_id, resource_id, created_at)
     VALUES ($1,$2,NOW())
     ON CONFLICT (user_id, resource_id) DO NOTHING;`,
    [userId, resourceId]
  );
  return { ok: true, created: res.rowCount > 0, resourceId };
}

async function storageUnsaveResource(userId, resourceId) {
  if (!usePostgres) {
    let removed = false;
    await lockedJsonUpdate(resourceSavesPath, (rows) => {
      const idx = rows.findIndex((r) => r.userId === userId && r.resourceId === resourceId);
      if (idx >= 0) {
        rows.splice(idx, 1);
        removed = true;
      }
    });
    return removed;
  }
  const res = await pgPool.query(
    "DELETE FROM resource_saves WHERE user_id = $1 AND resource_id = $2;",
    [userId, resourceId]
  );
  return res.rowCount > 0;
}

async function storageGetSavedResources(userId) {
  if (!usePostgres) {
    const saves = readJsonArray(resourceSavesPath).filter((s) => s.userId === userId);
    const resources = await storageGetResources({ includeNonPublic: true, includeDeleted: true });
    const byId = new Map(resources.map((r) => [r.id, r]));
    return saves
      .map((s) => {
        const r = byId.get(s.resourceId);
        if (!r || r.status === RESOURCE_STATUS.DELETED) return null;
        return { ...r, savedAt: s.createdAt };
      })
      .filter(Boolean);
  }
  const res = await pgPool.query(
    `SELECT r.id, r.type, r.title, r.provider, r.region, r.language, r.url, r.summary, r.cost,
            r.eligibility, r.source, r.status, r.verification_state, r.last_verified_at,
            r.link_status, r.link_checked_at, r.link_http_status, r.flagged_reason, r.created_by,
            r.created_at, r.updated_at, s.created_at AS saved_at
     FROM resource_saves s
     JOIN resources r ON r.id = s.resource_id
     WHERE s.user_id = $1 AND r.status <> 'deleted'
     ORDER BY s.created_at DESC;`,
    [userId]
  );
  return res.rows.map((row) => ({ ...mapResourceRow(row), savedAt: row.saved_at }));
}

async function storageUpsertResourceReview({ id, userId, resourceId, rating, body }) {
  const resource = await storageGetResourceById(resourceId, { includeNonPublic: true });
  if (!resource || resource.status === RESOURCE_STATUS.DELETED) {
    return { ok: false, reason: "not_found" };
  }
  const score = Math.min(5, Math.max(1, Number(rating) || 0));
  if (!Number.isFinite(score) || score < 1) {
    return { ok: false, reason: "invalid_rating" };
  }
  const now = new Date().toISOString();
  const reviewId = id || auditId();
  if (!usePostgres) {
    let review;
    await lockedJsonUpdate(resourceReviewsPath, (rows) => {
      const idx = rows.findIndex((r) => r.userId === userId && r.resourceId === resourceId);
      if (idx >= 0) {
        rows[idx] = {
          ...rows[idx],
          rating: score,
          body: String(body || "").slice(0, 2000),
          updatedAt: now,
          status: "published"
        };
        review = rows[idx];
      } else {
        review = {
          id: reviewId,
          userId,
          resourceId,
          rating: score,
          body: String(body || "").slice(0, 2000),
          status: "published",
          createdAt: now,
          updatedAt: now
        };
        rows.push(review);
      }
    });
    return { ok: true, review: mapResourceReviewRow(review) };
  }
  const res = await pgPool.query(
    `INSERT INTO resource_reviews (id, user_id, resource_id, rating, body, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'published',NOW(),NOW())
     ON CONFLICT (user_id, resource_id) DO UPDATE SET
       rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = NOW(), status = 'published'
     RETURNING id, user_id, resource_id, rating, body, status, created_at, updated_at;`,
    [reviewId, userId, resourceId, score, String(body || "").slice(0, 2000)]
  );
  return { ok: true, review: mapResourceReviewRow(res.rows[0]) };
}

async function storageGetResourceReviews(resourceId, { limit = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  if (!usePostgres) {
    return readJsonArray(resourceReviewsPath)
      .filter((r) => r.resourceId === resourceId && r.status !== "deleted")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, lim)
      .map(mapResourceReviewRow);
  }
  const res = await pgPool.query(
    `SELECT id, user_id, resource_id, rating, body, status, created_at, updated_at
     FROM resource_reviews
     WHERE resource_id = $1 AND status = 'published'
     ORDER BY created_at DESC
     LIMIT $2;`,
    [resourceId, lim]
  );
  return res.rows.map(mapResourceReviewRow);
}

async function storageInsertResourceReport({ id, userId, resourceId, reason, details }) {
  const resource = await storageGetResourceById(resourceId, { includeNonPublic: true });
  if (!resource || resource.status === RESOURCE_STATUS.DELETED) {
    return { ok: false, reason: "not_found" };
  }
  const report = {
    id: id || auditId(),
    userId: userId || null,
    resourceId,
    reason: String(reason || "").trim().slice(0, 200),
    details: String(details || "").trim().slice(0, 2000),
    status: RESOURCE_REPORT_STATUS.OPEN,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null
  };
  if (!report.reason) return { ok: false, reason: "invalid_reason" };
  if (!usePostgres) {
    await lockedJsonUpdate(resourceReportsPath, (rows) => {
      rows.push(report);
    });
    return { ok: true, report: mapResourceReportRow(report) };
  }
  await pgPool.query(
    `INSERT INTO resource_reports (id, user_id, resource_id, reason, details, status, created_at)
     VALUES ($1,$2,$3,$4,$5,'open',NOW());`,
    [report.id, report.userId, report.resourceId, report.reason, report.details]
  );
  return { ok: true, report: mapResourceReportRow(report) };
}

async function storageGetResourceReports({ status, limit = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  if (!usePostgres) {
    let rows = readJsonArray(resourceReportsPath).map(mapResourceReportRow);
    if (status) rows = rows.filter((r) => r.status === status);
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, lim);
  }
  if (status) {
    const res = await pgPool.query(
      `SELECT id, user_id, resource_id, reason, details, status, created_at, resolved_at, resolved_by
       FROM resource_reports WHERE status = $1 ORDER BY created_at DESC LIMIT $2;`,
      [status, lim]
    );
    return res.rows.map(mapResourceReportRow);
  }
  const res = await pgPool.query(
    `SELECT id, user_id, resource_id, reason, details, status, created_at, resolved_at, resolved_by
     FROM resource_reports ORDER BY created_at DESC LIMIT $1;`,
    [lim]
  );
  return res.rows.map(mapResourceReportRow);
}

async function storageResolveResourceReport(reportId, { status, resolvedBy } = {}) {
  const next = Object.values(RESOURCE_REPORT_STATUS).includes(status)
    ? status
    : RESOURCE_REPORT_STATUS.RESOLVED;
  if (!usePostgres) {
    let updated = null;
    await lockedJsonUpdate(resourceReportsPath, (rows) => {
      const idx = rows.findIndex((r) => r.id === reportId);
      if (idx < 0) return;
      rows[idx] = {
        ...rows[idx],
        status: next,
        resolvedAt: new Date().toISOString(),
        resolvedBy: resolvedBy || null
      };
      updated = mapResourceReportRow(rows[idx]);
    });
    return updated;
  }
  const res = await pgPool.query(
    `UPDATE resource_reports
     SET status = $2, resolved_at = NOW(), resolved_by = $3
     WHERE id = $1
     RETURNING id, user_id, resource_id, reason, details, status, created_at, resolved_at, resolved_by;`,
    [reportId, next, resolvedBy || null]
  );
  return res.rows[0] ? mapResourceReportRow(res.rows[0]) : null;
}

function mapCohortRow(r) {
  return {
    id: r.id,
    title: r.title,
    profession: r.profession,
    country: r.country || "global",
    capacity: Number(r.capacity ?? 10),
    enrolled: Number(r.enrolled ?? 0),
    startsAt: r.startsAt ?? r.starts_at ?? "",
    status: r.status || "open"
  };
}

async function storageGetCohorts() {
  if (!usePostgres) {
    const rows = readCohorts();
    return rows.length ? rows : defaultCohorts;
  }
  const res = await pgPool.query(
    "SELECT id, title, profession, country, capacity, enrolled, starts_at, status FROM cohorts WHERE status <> 'cancelled' ORDER BY created_at DESC;"
  );
  if (!res.rows.length) return defaultCohorts;
  return res.rows.map(mapCohortRow);
}

async function storageInsertCohort(row) {
  if (!usePostgres) {
    await lockedJsonUpdate(cohortsPath, (entries) => {
      entries.push(row);
      if (entries.length > 1000) entries.splice(0, entries.length - 1000);
    });
    return row;
  }
  await pgPool.query(
    `INSERT INTO cohorts (id, title, profession, country, capacity, enrolled, starts_at, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
     ON CONFLICT (id) DO NOTHING;`,
    [
      row.id, row.title, row.profession, row.country || "global",
      Number(row.capacity || 10), Number(row.enrolled || 0),
      row.startsAt || "", row.status || "open"
    ]
  );
  return mapCohortRow(row);
}

function mapCompanyBoardRow(r) {
  return {
    id: r.id,
    companySlug: r.companySlug || r.company_slug,
    title: r.title,
    body: r.body,
    createdBy: r.createdBy || r.created_by || "system",
    createdAt: r.createdAt || r.created_at
  };
}

async function storageGetCompanyBoards() {
  if (!usePostgres) {
    const rows = readCompanyBoards();
    return rows.length ? rows : defaultCompanyBoards;
  }
  const res = await pgPool.query(
    "SELECT id, company_slug, title, body, created_by, created_at FROM company_boards ORDER BY created_at DESC;"
  );
  if (!res.rows.length) return defaultCompanyBoards;
  return res.rows.map(mapCompanyBoardRow);
}

async function storageInsertCompanyBoard(entry) {
  if (!usePostgres) {
    await lockedJsonUpdate(companyBoardsPath, (rows) => {
      rows.push(entry);
      if (rows.length > 5000) rows.splice(0, rows.length - 5000);
    });
    return entry;
  }
  await pgPool.query(
    `INSERT INTO company_boards (id, company_slug, title, body, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO NOTHING;`,
    [
      entry.id, entry.companySlug, entry.title, entry.body,
      entry.createdBy || "system", entry.createdAt || new Date().toISOString()
    ]
  );
  return mapCompanyBoardRow(entry);
}

function mapAnonymousInboxRow(r) {
  return {
    id: r.id,
    trackingCode: r.trackingCode || r.tracking_code,
    message: r.message,
    channel: r.channel || "web",
    status: r.status || "received",
    createdAt: r.createdAt || r.created_at
  };
}

async function storageGetAnonymousInbox() {
  if (!usePostgres) return readAnonymousInbox();
  const res = await pgPool.query(
    "SELECT id, tracking_code, message, channel, status, created_at FROM anonymous_inbox ORDER BY created_at DESC LIMIT 5000;"
  );
  return res.rows.map(mapAnonymousInboxRow);
}

async function storageInsertAnonymousInbox(row) {
  if (!usePostgres) {
    await lockedJsonUpdate(anonymousInboxPath, (entries) => {
      entries.push(row);
      if (entries.length > 5000) entries.splice(0, entries.length - 5000);
    });
    return row;
  }
  await pgPool.query(
    `INSERT INTO anonymous_inbox (id, tracking_code, message, channel, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO NOTHING;`,
    [
      row.id, row.trackingCode, row.message, row.channel || "web",
      row.status || "received", row.createdAt || new Date().toISOString()
    ]
  );
  return mapAnonymousInboxRow(row);
}

function mapTakedownRow(r) {
  return {
    id: r.id,
    email: r.email,
    reason: r.reason,
    targetUrl: r.targetUrl || r.target_url,
    legalBasis: r.legalBasis || r.legal_basis || "unspecified",
    status: r.status || "pending",
    createdAt: r.createdAt || r.created_at
  };
}

async function storageGetTakedowns() {
  if (!usePostgres) return readJsonArray(takedownsPath);
  const res = await pgPool.query(
    "SELECT id, email, reason, target_url, legal_basis, status, created_at FROM takedowns ORDER BY created_at DESC LIMIT 5000;"
  );
  return res.rows.map(mapTakedownRow);
}

async function storageInsertTakedown(entry) {
  if (!usePostgres) {
    await lockedJsonUpdate(takedownsPath, (rows) => {
      rows.push(entry);
      if (rows.length > 5000) rows.splice(0, rows.length - 5000);
    });
    return entry;
  }
  await pgPool.query(
    `INSERT INTO takedowns (id, email, reason, target_url, legal_basis, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO NOTHING;`,
    [
      entry.id, entry.email, entry.reason, entry.targetUrl,
      entry.legalBasis || "unspecified", entry.status || "pending",
      entry.createdAt || new Date().toISOString()
    ]
  );
  return mapTakedownRow(entry);
}

function mapSubscriberRow(r) {
  return {
    id: r.id,
    email: r.email,
    subscribedAt: r.subscribedAt || r.subscribed_at,
    country: r.country || "global",
    language: r.language || "en"
  };
}

async function storageGetSubscribers() {
  if (!usePostgres) return readJsonArray(subscribersPath);
  const res = await pgPool.query(
    "SELECT id, email, country, language, subscribed_at FROM subscribers ORDER BY subscribed_at DESC LIMIT 50000;"
  );
  return res.rows.map(mapSubscriberRow);
}

async function storageCountSubscribers() {
  if (!usePostgres) return readJsonArray(subscribersPath).length;
  const res = await pgPool.query("SELECT COUNT(*)::int AS count FROM subscribers;");
  return res.rows[0].count;
}

/**
 * Insert subscriber. Returns { entry, duplicate }.
 * Unique on email for concurrent duplicate submissions.
 */
async function storageInsertSubscriber(entry) {
  if (!usePostgres) {
    let duplicate = false;
    await lockedJsonUpdate(subscribersPath, (subscribers) => {
      duplicate = subscribers.some((s) => s.email === entry.email);
      if (!duplicate) {
        subscribers.push(entry);
        if (subscribers.length > 50000) subscribers.splice(0, subscribers.length - 50000);
      }
    });
    return { entry: duplicate ? null : entry, duplicate };
  }
  const res = await pgPool.query(
    `INSERT INTO subscribers (id, email, country, language, subscribed_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, country, language, subscribed_at;`,
    [
      entry.id, entry.email, entry.country || "global",
      entry.language || "en", entry.subscribedAt || new Date().toISOString()
    ]
  );
  if (!res.rows.length) return { entry: null, duplicate: true };
  return { entry: mapSubscriberRow(res.rows[0]), duplicate: false };
}

/**
 * One-time JSON → PG backfill when a table is empty (preserves existing data
 * after migration). Reads only; never writes under data/ when usePostgres.
 */
async function backfillTableFromJsonIfEmpty(tableName, jsonPath, insertRows) {
  const countRes = await pgPool.query(`SELECT COUNT(*)::int AS count FROM ${tableName};`);
  if (countRes.rows[0].count > 0) return 0;
  const rows = readJsonArray(jsonPath);
  if (!rows.length) return 0;
  await insertRows(rows);
  console.log(`[storage] backfilled ${rows.length} row(s) into ${tableName} from ${path.basename(jsonPath)}`);
  return rows.length;
}

// ── Schema version (set after migrate; null when JSON-only) ──
let schemaVersion = null;

function getSchemaVersion() {
  return schemaVersion;
}

// ── Init storage (versioned migrations + seed) ──
// Primary schema mechanism: lib/migrate.js + /migrations/*.js (aitj-z8q.4).
// Policy: auto-migrate on boot when DATABASE_URL is set (transactional, logged).
// With DATABASE_URL: never mutate data/*.json (aitj-z8q.3).

async function initStorage() {
  if (!usePostgres) {
    schemaVersion = null;
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const defaults = [
      [usersPath, []], [forumTopicsPath, seedForumTopics], [forumRepliesPath, []],
      [sanctionsPath, []], [auditLogPath, []], [authIdentitiesPath, []],
      [storyVersionsPath, []], [telegramLinksPath, []], [transparencyEventsPath, []],
      [resourcesPath, defaultResources], [opportunitiesPath, defaultOpportunities],
      [resourceSavesPath, []], [resourceReviewsPath, []], [resourceReportsPath, []],
      [newsPath, defaultNews], [takedownsPath, []],
      [companyBoardsPath, defaultCompanyBoards], [petitionsPath, defaultPetitions],
      [cohortsPath, defaultCohorts], [anonymousInboxPath, []], [subscribersPath, []],
      [petitionSignaturesPath, []], [boundaryPollVotesPath, []],
      [ventsPath, []], [expressionReportsPath, []], [expressionFollowupsPath, []]
    ];
    defaults.forEach(([file, value]) => {
      if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(value, null, 2));
    });
    return;
  }

  // Production / DATABASE_URL path: schema + seed/backfill in PG only.
  const { migrate } = require("./migrate");
  const migrateResult = await migrate(pgPool, { logger: console });
  schemaVersion = migrateResult.schemaVersion || null;
  if (migrateResult.applied?.length) {
    console.log(
      `[migrate] applied ${migrateResult.applied.length} migration(s); schema version=${schemaVersion}`
    );
  } else {
    console.log(`[migrate] schema up to date; version=${schemaVersion}`);
  }

  for (const petition of defaultPetitions) {
    await storageCreatePetition(petition);
  }

  const newsCount = await pgPool.query("SELECT COUNT(*)::int AS count FROM news_items;");
  if (newsCount.rows[0].count === 0) {
    await storageUpsertNewsItems(defaultNews);
  }

  const countRes = await pgPool.query("SELECT COUNT(*)::int AS count FROM stories;");
  if (countRes.rows[0].count === 0) {
    // Read-only seed from bundled JSON if present (no write under data/)
    const seed = readStories();
    if (seed.length) {
      for (const s of seed) {
        await pgPool.query(
          `INSERT INTO stories (id, name, country, language, profession, company, laid_off_at, found_new_job, reason, story, status, estimated_layoffs, details, metrics, privacy, moderation, submitted_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (id) DO NOTHING;`,
          [s.id, s.name, s.country, s.language, s.profession, s.company, s.laidOffAt, Boolean(s.foundNewJob), s.reason, s.story, s.status || "pending", Number(s.estimatedLayoffs || 1), JSON.stringify(s.details || {}), JSON.stringify(s.metrics || {}), JSON.stringify(s.privacy || {}), JSON.stringify(s.moderation || {}), s.submittedBy || null, s.createdAt || new Date().toISOString(), s.updatedAt || s.createdAt || new Date().toISOString()]
        );
      }
    }
  }

  const topicCount = await pgPool.query("SELECT COUNT(*)::int AS count FROM forum_topics;");
  if (topicCount.rows[0].count === 0) {
    for (const topic of seedForumTopics) {
      await pgPool.query(
        "INSERT INTO forum_topics (id, category_id, title, body, country, language, status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING;",
        [topic.id, topic.categoryId, topic.title, "Seed topic body", "global", "en", "published", "system", topic.lastUpdate || new Date().toISOString()]
      );
    }
  }

  // Backfill remaining entities from existing JSON (one-shot when table empty)
  await backfillTableFromJsonIfEmpty("resources", resourcesPath, async (rows) => {
    for (const row of rows) {
      if (isBannedResourceUrl(row.url)) continue;
      try {
        await storageUpsertResource(row);
      } catch (e) {
        if (e.code === "BANNED_RESOURCE_URL") continue;
        throw e;
      }
    }
  });
  const resourceCount = await pgPool.query("SELECT COUNT(*)::int AS count FROM resources WHERE status <> 'deleted';");
  if (resourceCount.rows[0].count === 0) {
    for (const row of defaultResources) await storageUpsertResource(row);
  } else {
    // One-shot upgrade: replace legacy example.com seeds with real catalog entries
    const banned = await pgPool.query(
      "SELECT COUNT(*)::int AS count FROM resources WHERE url ILIKE '%example.com%' OR url ILIKE '%example.org%' OR url ILIKE '%example.net%';"
    );
    if (banned.rows[0].count > 0) {
      await pgPool.query(
        `UPDATE resources SET status = 'archived', verification_state = 'broken', link_status = 'broken',
         flagged_reason = 'placeholder_url_banned', updated_at = NOW()
         WHERE url ILIKE '%example.com%' OR url ILIKE '%example.org%' OR url ILIKE '%example.net%';`
      );
      for (const row of defaultResources) {
        try {
          await storageUpsertResource(row);
        } catch (_e) {
          /* ignore individual seed failures */
        }
      }
    }
  }

  await backfillTableFromJsonIfEmpty("opportunities", opportunitiesPath, async (rows) => {
    for (const row of rows) {
      if (isBannedResourceUrl(row.url)) continue;
      try {
        await storageUpsertOpportunity(row);
      } catch (e) {
        if (e.code === "BANNED_RESOURCE_URL") continue;
        throw e;
      }
    }
  });
  const oppCount = await pgPool.query("SELECT COUNT(*)::int AS count FROM opportunities WHERE status <> 'deleted';");
  if (oppCount.rows[0].count === 0) {
    for (const row of defaultOpportunities) await storageUpsertOpportunity(row);
  }

  await backfillTableFromJsonIfEmpty("cohorts", cohortsPath, async (rows) => {
    for (const row of rows) await storageInsertCohort(row);
  });
  const cohortCount = await pgPool.query("SELECT COUNT(*)::int AS count FROM cohorts;");
  if (cohortCount.rows[0].count === 0) {
    for (const row of defaultCohorts) await storageInsertCohort(row);
  }

  await backfillTableFromJsonIfEmpty("company_boards", companyBoardsPath, async (rows) => {
    for (const row of rows) await storageInsertCompanyBoard(row);
  });
  const boardCount = await pgPool.query("SELECT COUNT(*)::int AS count FROM company_boards;");
  if (boardCount.rows[0].count === 0) {
    for (const row of defaultCompanyBoards) await storageInsertCompanyBoard(row);
  }

  await backfillTableFromJsonIfEmpty("anonymous_inbox", anonymousInboxPath, async (rows) => {
    for (const row of rows) {
      await storageInsertAnonymousInbox({
        id: row.id,
        trackingCode: row.trackingCode || row.tracking_code,
        message: row.message,
        channel: row.channel || "web",
        status: row.status || "received",
        createdAt: row.createdAt || row.created_at || new Date().toISOString()
      });
    }
  });

  await backfillTableFromJsonIfEmpty("takedowns", takedownsPath, async (rows) => {
    for (const row of rows) {
      await storageInsertTakedown({
        id: row.id,
        email: row.email,
        reason: row.reason,
        targetUrl: row.targetUrl || row.target_url,
        legalBasis: row.legalBasis || row.legal_basis || "unspecified",
        status: row.status || "pending",
        createdAt: row.createdAt || row.created_at || new Date().toISOString()
      });
    }
  });

  await backfillTableFromJsonIfEmpty("subscribers", subscribersPath, async (rows) => {
    for (const row of rows) {
      await storageInsertSubscriber({
        id: row.id,
        email: row.email,
        country: row.country || "global",
        language: row.language || "en",
        subscribedAt: row.subscribedAt || row.subscribed_at || new Date().toISOString()
      });
    }
  });

  // Optional one-shot backfill of core entities that predate migration runner
  await backfillTableFromJsonIfEmpty("users", usersPath, async (rows) => {
    for (const u of rows) {
      await pgPool.query(
        "INSERT INTO users (id, email, phone, role, password_hash, created_at, muted_until, banned_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING;",
        [u.id, u.email, u.phone || null, u.role || "user", u.passwordHash || u.password_hash || "", u.createdAt || u.created_at || new Date().toISOString(), u.mutedUntil || u.muted_until || null, u.bannedUntil || u.banned_until || null]
      );
    }
  });
  await backfillTableFromJsonIfEmpty("auth_identities", authIdentitiesPath, async (rows) => {
    for (const identity of rows) {
      await storageUpsertIdentity(identity);
    }
  });
  await backfillTableFromJsonIfEmpty("sanctions", sanctionsPath, async (rows) => {
    for (const entry of rows) await storageInsertSanction(entry);
  });
  await backfillTableFromJsonIfEmpty("audit_log", auditLogPath, async (rows) => {
    for (const entry of rows) {
      await pgPool.query(
        "INSERT INTO audit_log (id, action, actor_id, target_type, target_id, metadata, ip, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING;",
        [entry.id, entry.action, entry.actorId || null, entry.targetType || null, entry.targetId || null, JSON.stringify(entry.metadata || {}), entry.ip || "", entry.createdAt || new Date().toISOString()]
      );
    }
  });
  await backfillTableFromJsonIfEmpty("story_versions", storyVersionsPath, async (rows) => {
    for (const entry of rows) {
      await pgPool.query(
        "INSERT INTO story_versions (id, story_id, version_no, payload, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING;",
        [entry.id, entry.storyId, entry.versionNo, JSON.stringify(entry.payload || {}), entry.createdBy || null, entry.createdAt]
      );
    }
  });
  await backfillTableFromJsonIfEmpty("telegram_links", telegramLinksPath, async (rows) => {
    for (const entry of rows) await storageCreateOrUpdateTelegramLink(entry);
  });
  await backfillTableFromJsonIfEmpty("transparency_events", transparencyEventsPath, async (rows) => {
    for (const entry of rows) await storageInsertTransparencyEvent(entry);
  });
  await backfillTableFromJsonIfEmpty("forum_topics", forumTopicsPath, async (rows) => {
    for (const topic of rows) {
      await pgPool.query(
        "INSERT INTO forum_topics (id, category_id, title, body, country, language, status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING;",
        [topic.id, topic.categoryId || topic.category_id, topic.title, topic.body || "", topic.country || "global", topic.language || "en", topic.status || "published", topic.createdBy || topic.created_by || "system", topic.createdAt || topic.created_at || topic.lastUpdate || new Date().toISOString()]
      );
    }
  });
  await backfillTableFromJsonIfEmpty("forum_posts", forumRepliesPath, async (rows) => {
    for (const reply of rows) {
      await pgPool.query(
        "INSERT INTO forum_posts (id, topic_id, body, country, language, status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING;",
        [reply.id, reply.topicId || reply.topic_id, reply.body, reply.country || "global", reply.language || "en", reply.status || "published", reply.createdBy || reply.created_by || "system", reply.createdAt || reply.created_at || new Date().toISOString()]
      );
    }
  });
  await backfillTableFromJsonIfEmpty("petition_signatures", petitionSignaturesPath, async (rows) => {
    for (const sig of rows) {
      await pgPool.query(
        "INSERT INTO petition_signatures (petition_id, voter_hash, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING;",
        [sig.petitionId || sig.petition_id, sig.voterHash || sig.voter_hash, sig.signedAt || sig.created_at || new Date().toISOString()]
      );
    }
  });
  await backfillTableFromJsonIfEmpty("boundary_poll_votes", boundaryPollVotesPath, async (rows) => {
    for (const vote of rows) {
      await pgPool.query(
        `INSERT INTO boundary_poll_votes (poll_id, voter_hash, choice, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (poll_id, voter_hash) DO NOTHING;`,
        [vote.pollId || vote.poll_id, vote.voterHash || vote.voter_hash, vote.choice, vote.createdAt || vote.created_at || new Date().toISOString(), vote.updatedAt || vote.updated_at || new Date().toISOString()]
      );
    }
  });
}

module.exports = {
  // Config
  ADMIN_TOKEN, DATABASE_URL, AUTH_SECRET, ALLOW_DEV_OTP, TELEGRAM_BOT_TOKEN,
  TELEGRAM_MOD_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, REQUIRE_CAPTCHA, isProduction,
  SESSION_TTL_HOURS, defaultCountry, defaultLang, usePostgres,
  languages, countries, roles, forumCategories, seedForumTopics,
  defaultResources, defaultOpportunities, defaultNews, defaultCompanyBoards, defaultPetitions, defaultCohorts,
  BANNED_RESOURCE_HOSTS, RESOURCE_STALE_AFTER_DAYS,
  publicDir, dataDir,

  // ID generators
  storyId, ventId, userId: usrId, topicId, replyId, sanctionId, auditId, phoneOtpCode, linkCodeId,
  expressionReportId, expressionFollowupId,

  // Schemas
  storySchema, registerSchema, loginSchema, phoneStartSchema, phoneVerifySchema,
  forumTopicSchema, forumReplySchema, moderationActionSchema, sanctionSchema,
  telegramWebhookSchema, digestEmailSchema,

  // Helpers
  normalizeCountry, normalizeLanguage, normalizeEmail, normalizePhone,
  sanitizeText, isAccountBanned, isAccountMuted, parseCookies,
  makeSessionToken, setAuthCookie, clearAuthCookie,
  generateCsrfToken, setCsrfCookie, validateCsrfToken,
  hasAdminToken, hasModeratorRole, hasTrustedCuratorRole, detectLocale,
  isBannedResourceUrl, normalizeResourceCost, deriveVerificationState,
  maskStoryByPrivacy, scoreModeration, mapVisibilityToPrivacy,
  computeConfidenceScore, buildCounters, getCrisisResources,
  slugifyCompany, getTopCompanies, toCompanyProfile, getDashboard,
  sendTelegramMessage, buildStoryPayload, buildStoryRecord,
  ensureStoryDefaults, makeNewsId, normalizeNewsItem,

  // File I/O
  readJsonArray, writeJsonArray, lockedJsonUpdate, readStories, writeStories,
  readResources, readOpportunities, readNews, readCompanyBoards, readPetitions, readCohorts, readAnonymousInbox,

  // File paths
  storiesPath, usersPath, forumTopicsPath, forumRepliesPath,
  authIdentitiesPath, takedownsPath, companyBoardsPath, petitionsPath,
  petitionSignaturesPath, boundaryPollVotesPath, cohortsPath, anonymousInboxPath, subscribersPath,
  resourcesPath, opportunitiesPath, resourceSavesPath, resourceReviewsPath, resourceReportsPath,

  // Storage
  storageGetNews, storageUpsertNewsItems,
  storageGetStories, storageInsertStory, storageGetUsers,
  storageGetUserByEmail, storageGetUserById, storageInsertUser,
  storageUpdateUserSanction, storageGetIdentityByUserId, storageUpsertIdentity,
  storageInsertStoryVersion, storageCreateOrUpdateTelegramLink,
  storageGetTelegramLinkByUserId, storageInsertTransparencyEvent,
  storageGetForumTopics, storageGetForumReplies, storageInsertForumTopic,
  storageInsertForumReply, storageUpdateForumTopic, storageDeleteForumTopic,
  storageGetModerationQueue, storageModerationAction,
  storageInsertSanction, storageAudit, storageGetAuditRange,
  storagePatchStory, storageGetPetitions, storageCreatePetition,
  storageSignPetition, storageGetBoundaryPollResults, storageUpsertBoundaryPollVote,
  storageDeleteUser,
  storageGetResources, storageGetResourceById, storageUpsertResource, storageDeleteResource,
  storageUpdateResourceLinkCheck,
  storageGetOpportunities, storageGetOpportunityById, storageUpsertOpportunity, storageDeleteOpportunity,
  storageSaveResource, storageUnsaveResource, storageGetSavedResources,
  storageUpsertResourceReview, storageGetResourceReviews,
  storageInsertResourceReport, storageGetResourceReports, storageResolveResourceReport,
  storageGetCohorts, storageInsertCohort,
  storageGetCompanyBoards, storageInsertCompanyBoard,
  storageGetAnonymousInbox, storageInsertAnonymousInbox,
  storageGetTakedowns, storageInsertTakedown,
  storageGetSubscribers, storageCountSubscribers, storageInsertSubscriber,
  storageGetVents, storageGetVentById, storageInsertVent, storagePatchVent,
  storageGetExpressionReports, storageInsertExpressionReport, storageUpdateExpressionReport,
  storageGetExpressionFollowups, storageInsertExpressionFollowup,
  buildVentRecord,
  assertJsonFallbackAllowed,

  // DB lifecycle
  buildPgPool, initStorage, getPgPool, setPgPool, getSchemaVersion,

  // bcrypt re-export for routes
  bcrypt,

  // Domain contract (light wiring — full API via lib/domain-contract.js)
  DOMAIN_CONTRACT_VERSION,
  STORY_STATUS,
  VENT_STATUS,
  LEGACY_STORY_STATUSES,
  DISCUSSION_TOPIC_STATUS,
  NEWS_STATUS,
  COHORT_STATUS,
  PETITION_STATUS,
  OUTCOME_STATUS,
  EVIDENCE_TIER,
  SANCTION_TYPE,
  PUBLICATION_INTENT,
  DESIRED_RESPONSE,
  ANONYMITY_MODE,
  ADVICE_PERMISSION,
  RETENTION_PREFERENCE,
  VISIBILITY,
  ENTITY,
  moderationActionToContentStatus,
  outcomeFromFoundNewJob,
  assertValidStatus,
  assertCanTransition,
  canTransition
};
