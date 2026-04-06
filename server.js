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

const app = express();
const port = Number(process.env.PORT || 8080);
const rawOrigins = (process.env.CORS_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
const ENABLE_HSTS = String(process.env.ENABLE_HSTS || "false").toLowerCase() === "true";
const REQUIRE_STRICT_SECRETS = String(process.env.REQUIRE_STRICT_SECRETS || (ctx.isProduction ? "true" : "false")).toLowerCase() === "true";

// ── Security & middleware ──

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
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
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400
  })
);

app.use(morgan("combined"));
app.use(express.json({ limit: "50kb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));
app.use(authMiddleware);

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);
app.use(compression());
app.use(express.static(ctx.publicDir, { extensions: ["html"] }));

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

app.get("/api/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() })}\n\n`);
  }, 30000);
  req.on("close", () => { clearInterval(interval); });
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
  app.listen(port, () => {
    console.log(`aitookmyjob running on :${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
