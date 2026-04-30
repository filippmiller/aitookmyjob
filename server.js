const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const compression = require("compression");

dotenv.config();

const ctx = require("./lib/context");
const { authMiddleware } = require("./middleware/auth");
const authRoutes = require("./routes/auth");
const storiesRoutes = require("./routes/stories");
const forumRoutes = require("./routes/forum");
const adminRoutes = require("./routes/admin");
const integrationsRoutes = require("./routes/integrations");
const { ingestNews } = require("./lib/news-ingest");

const app = express();
const port = Number(process.env.PORT || 8080);
const rawOrigins = (process.env.CORS_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
const ENABLE_HSTS = String(process.env.ENABLE_HSTS || "false").toLowerCase() === "true";
const REQUIRE_STRICT_SECRETS = String(process.env.REQUIRE_STRICT_SECRETS || (ctx.isProduction ? "true" : "false")).toLowerCase() === "true";
const ENABLE_NEWS_INGEST = String(process.env.NEWS_INGEST_ENABLED || (ctx.usePostgres ? "true" : "false")).toLowerCase() === "true";
const NEWS_INGEST_INTERVAL_HOURS = Math.min(Math.max(Number(process.env.NEWS_INGEST_INTERVAL_HOURS || 24), 1), 168);

const activityClients = new Set();
app.locals.activityEvents = [];
app.locals.publishActivity = (event) => {
  const entry = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...event
  };
  app.locals.activityEvents.unshift(entry);
  app.locals.activityEvents = app.locals.activityEvents.slice(0, 40);
  const payload = `event: activity\ndata: ${JSON.stringify(entry)}\n\n`;
  for (const client of activityClients) {
    try {
      client.write(payload);
    } catch (_err) {
      activityClients.delete(client);
    }
  }
  return entry;
};

// ── Security & middleware ──

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://unpkg.com"],
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
      if (!origin || rawOrigins.length === 0 || rawOrigins.includes(origin)) { callback(null, true); return; }
      callback(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    maxAge: 86400
  })
);

app.use(morgan("combined"));
app.use(express.json({ limit: "50kb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));
app.use(authMiddleware);

// ── CSRF protection ──
// Issue a CSRF token cookie on every request; validate on state-changing methods
app.use((req, res, next) => {
  const cookies = ctx.parseCookies(req);
  if (!cookies.csrf_token) {
    ctx.setCsrfCookie(res, ctx.generateCsrfToken());
  }
  const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
  if (safeMethods.has(req.method)) { next(); return; }
  // Skip CSRF only for requests authenticated with the configured admin API token.
  if (req.headers.authorization && ctx.hasAdminToken(req)) { next(); return; }
  // Skip CSRF for Telegram webhook (uses its own secret validation)
  if (req.path.includes("/telegram/webhook")) { next(); return; }
  if (!ctx.validateCsrfToken(req)) {
    res.status(403).json({ message: "CSRF token missing or invalid. Include X-CSRF-Token header." });
    return;
  }
  next();
});

app.use(compression());
app.use(express.static(ctx.publicDir, { extensions: ["html"] }));

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

// ── Health & meta (kept in server.js — small, foundational) ──

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aitookmyjob", timestamp: new Date().toISOString() });
});

app.get("/api/meta", (_req, res) => {
  res.json({ countries: ctx.countries, languages: ctx.languages, roles: ctx.roles });
});

app.get("/api/locale", (req, res) => {
  res.json(ctx.detectLocale(req));
});

// ── Route modules ──

app.use("/api/auth", authRoutes);
app.use(storiesRoutes);       // mounted at root — routes include /api/stories, /api/stats, /api/companies, /sitemap.xml
app.use("/api/forum", forumRoutes);
app.use("/api/admin", adminRoutes);
app.use(integrationsRoutes);  // mounted at root — routes include /api/integrations/*, /api/resources, /api/news, etc.

// ── PWA assets ──

app.get("/manifest.json", (req, res) => {
  res.sendFile(path.join(ctx.publicDir, "manifest.json"));
});

app.get("/sw.js", (req, res) => {
  res.set("Content-Type", "application/javascript");
  res.sendFile(path.join(ctx.publicDir, "sw.js"));
});

// ── Server-Sent Events ──

app.get("/api/activity", async (_req, res) => {
  const runtimeEvents = app.locals.activityEvents || [];
  const stories = (await ctx.storageGetStories())
    .filter((story) => story.status === "published")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8)
    .map((story) => {
      const visible = ctx.maskStoryByPrivacy(ctx.ensureStoryDefaults(story));
      return {
        id: `story_${visible.id}`,
        type: "story.published",
        title: `${visible.profession || "Worker"} story added`,
        detail: `${visible.country || "global"} · ${visible.company || "Undisclosed"}`,
        href: `/story/${visible.id}`,
        timestamp: visible.createdAt || new Date().toISOString()
      };
    });
  res.json({ events: [...runtimeEvents, ...stories].slice(0, 20) });
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  activityClients.add(res);
  res.write(`event: ready\ndata: ${JSON.stringify({ type: "ready", timestamp: new Date().toISOString() })}\n\n`);
  const interval = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() })}\n\n`);
  }, 30000);
  req.on("close", () => { clearInterval(interval); activityClients.delete(res); });
});

// ── Story page route ──

app.get("/story/:id", (req, res) => {
  res.sendFile(path.join(ctx.publicDir, "story.html"));
});

// ── Page routes ──

app.get("/", (req, res) => {
  const locale = ctx.detectLocale(req);
  res.redirect(`/${locale.country}/${locale.lang}/`);
});

app.get("/:country/:lang", (req, res) => {
  const country = ctx.normalizeCountry(req.params.country);
  const lang = ctx.normalizeLanguage(req.params.lang);
  if (country !== req.params.country.toLowerCase() || lang !== req.params.lang.toLowerCase()) { res.redirect(`/${country}/${lang}/`); return; }
  res.sendFile(path.join(ctx.publicDir, "index.html"));
});

app.get(/^\/([a-z]{2,10})\/([a-z]{2})(?:\/.*)?$/i, (req, res) => {
  const country = ctx.normalizeCountry(req.params[0]);
  const lang = ctx.normalizeLanguage(req.params[1]);
  const rawCountry = String(req.params[0]).toLowerCase();
  const rawLang = String(req.params[1]).toLowerCase();
  if (country !== rawCountry || lang !== rawLang) { res.redirect(`/${country}/${lang}/`); return; }
  res.sendFile(path.join(ctx.publicDir, "index.html"));
});

app.get("/forum", (req, res) => { res.sendFile(path.join(ctx.publicDir, "forum.html")); });
app.get("/research", (req, res) => { res.sendFile(path.join(ctx.publicDir, "research.html")); });
app.get("/support", (req, res) => { res.sendFile(path.join(ctx.publicDir, "index.html")); });
app.get("/events", (req, res) => { res.sendFile(path.join(ctx.publicDir, "index.html")); });
app.get("/dashboard", (req, res) => { res.sendFile(path.join(ctx.publicDir, "index.html")); });
app.get("/stories", (req, res) => { res.sendFile(path.join(ctx.publicDir, "index.html")); });
app.get("/resources", (req, res) => { res.sendFile(path.join(ctx.publicDir, "index.html")); });

// ── Error handlers ──

app.use((_req, res) => {
  res.status(404).sendFile(path.join(ctx.publicDir, "404.html"));
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

// ── Start ──

let newsIngestRunning = false;
async function runScheduledNewsIngest(reason) {
  if (!ENABLE_NEWS_INGEST || !ctx.usePostgres || newsIngestRunning) return;
  newsIngestRunning = true;
  try {
    const result = await ingestNews(ctx);
    await ctx.storageAudit({
      action: "news.ingest.scheduled",
      actorId: "system",
      targetType: "news_items",
      targetId: reason,
      metadata: result,
      ip: ""
    });
    console.log(`News ingest ${reason}: ${result.inserted} inserted, ${result.updated} updated, ${result.errors.length} source errors`);
  } catch (error) {
    console.error(`News ingest ${reason} failed:`, error);
  } finally {
    newsIngestRunning = false;
  }
}

function scheduleNewsIngest() {
  if (!ENABLE_NEWS_INGEST || !ctx.usePostgres) return;
  const intervalMs = NEWS_INGEST_INTERVAL_HOURS * 60 * 60 * 1000;
  setTimeout(() => runScheduledNewsIngest("startup"), 15000);
  const timer = setInterval(() => runScheduledNewsIngest("interval"), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

async function start() {
  if (REQUIRE_STRICT_SECRETS) {
    const weakSecrets = [];
    if (ctx.ADMIN_TOKEN === "change-me-admin-token") weakSecrets.push("ADMIN_TOKEN");
    if (ctx.AUTH_SECRET === "change-me-auth-secret") weakSecrets.push("AUTH_SECRET");
    if (weakSecrets.length > 0) {
      console.error(`FATAL: Refusing to start with default secrets: ${weakSecrets.join(", ")}`);
      console.error("Set real values or REQUIRE_STRICT_SECRETS=false to bypass.");
      process.exit(1);
    }
  }

  if (ctx.usePostgres) {
    ctx.setPgPool(await ctx.buildPgPool());
    await ctx.initStorage();
    console.log("Storage mode: postgres");
  } else {
    await ctx.initStorage();
    console.log("Storage mode: file-json");
  }
  scheduleNewsIngest();
  app.listen(port, () => {
    console.log(`aitookmyjob running on :${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
