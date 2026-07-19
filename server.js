const path = require("path");
const crypto = require("crypto");
const express = require("express");
const dotenv = require("dotenv");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const compression = require("compression");

dotenv.config();

const ctx = require("./lib/context");
const logger = require("./lib/logger");
const metrics = require("./lib/metrics");
const alerts = require("./lib/alerts");
const { getRelease } = require("./lib/release");
const { evaluateReadiness, defaultJobsCheck } = require("./lib/readiness");
const { authMiddleware } = require("./middleware/auth");
const authRoutes = require("./routes/auth");
const storiesRoutes = require("./routes/stories");
const expressionRoutes = require("./routes/expression");
const forumRoutes = require("./routes/forum");
const adminRoutes = require("./routes/admin");
const integrationsRoutes = require("./routes/integrations");
const insiderRoutes = require("./routes/insider");
const resourcesRoutes = require("./routes/resources");
const socialRoutes = require("./routes/social");
const jobs = require("./lib/jobs");
const { registerBuiltinHandlers } = require("./lib/job-handlers");
const os = require("os");

const app = express();
const port = Number(process.env.PORT || 8080);
const rawOrigins = (process.env.CORS_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
const ENABLE_HSTS = String(process.env.ENABLE_HSTS || "false").toLowerCase() === "true";
const REQUIRE_STRICT_SECRETS = String(process.env.REQUIRE_STRICT_SECRETS || (ctx.isProduction ? "true" : "false")).toLowerCase() === "true";
const ENABLE_NEWS_INGEST = String(process.env.NEWS_INGEST_ENABLED || (ctx.usePostgres ? "true" : "false")).toLowerCase() === "true";
const NEWS_INGEST_INTERVAL_HOURS = Math.min(Math.max(Number(process.env.NEWS_INGEST_INTERVAL_HOURS || 24), 1), 168);
const ENABLE_WEEKLY_DIGEST = String(process.env.DIGEST_WEEKLY_ENABLED || (ctx.usePostgres ? "true" : "false")).toLowerCase() === "true";
const DIGEST_WEEKLY_INTERVAL_HOURS = Math.min(Math.max(Number(process.env.DIGEST_WEEKLY_INTERVAL_HOURS || 168), 1), 336);
// Default on with Postgres so scheduled news jobs actually execute in single-container
// deploys; SKIP LOCKED keeps multi-replica safe. Prefer dedicated `npm run jobs:worker`
// and set JOBS_WORKER=false on web replicas when scaling out.
const ENABLE_JOBS_WORKER = String(process.env.JOBS_WORKER || (ctx.usePostgres ? "true" : "false")).toLowerCase() === "true";
const log = logger.createLogger({ component: "server" });

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
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Request-Id"],
    maxAge: 86400
  })
);

// Request ID + structured access log (redacted via lib/logger; no bodies/PII).
app.use((req, res, next) => {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && incoming.trim() && incoming.length <= 128
      ? incoming.trim()
      : crypto.randomUUID();
  req.id = requestId;
  req.log = logger.createLogger({ requestId, method: req.method, path: req.path });
  res.setHeader("X-Request-Id", requestId);
  next();
});

// Count all requests (including probes); access-log skips probe noise below.
app.use((req, res, next) => {
  res.on("finish", () => {
    metrics.inc("http_requests_total");
    if (res.statusCode >= 500) metrics.inc("http_errors_5xx");
    else if (res.statusCode >= 400) metrics.inc("http_errors_4xx");
  });
  next();
});

morgan.token("id", (req) => req.id || "-");
app.use(
  morgan(
    (tokens, req, res) => {
      const status = Number(tokens.status(req, res) || 0);
      const durationMs = Number(tokens["response-time"](req, res) || 0);
      return JSON.stringify(
        logger.redact({
          ts: new Date().toISOString(),
          level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
          msg: "http_request",
          service: "aitookmyjob",
          requestId: req.id,
          method: tokens.method(req, res),
          path: tokens.url(req, res),
          status,
          durationMs,
          bytes: Number(tokens.res(req, res, "content-length") || 0) || undefined,
          remote: tokens["remote-addr"](req, res)
        })
      );
    },
    {
      skip: (req) => {
        const p = req.path || "";
        return p === "/live" || p === "/ready" || p === "/health" || p === "/metrics";
      }
    }
  )
);

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
  // Skip CSRF for one-click email unsubscribe (token-authenticated)
  if (req.path.includes("/notifications/unsubscribe")) { next(); return; }
  if (!ctx.validateCsrfToken(req)) {
    res.status(403).json({ message: "CSRF token missing or invalid. Include X-CSRF-Token header." });
    return;
  }
  next();
});

app.use(compression());
app.use(express.static(ctx.publicDir, { extensions: ["html"] }));

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 5000 : 240,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

// ── Health / live / ready / metrics (kept in server.js — small, foundational) ──

app.get("/live", (_req, res) => {
  // Liveness: process is up. Does not check DB or migrations.
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    live: true,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    memory: { rss: mem.rss, heapUsed: mem.heapUsed },
    release: getRelease(),
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "aitookmyjob",
    timestamp: new Date().toISOString(),
    schemaVersion: ctx.getSchemaVersion(),
    storage: ctx.usePostgres ? "postgres" : "file-json",
    release: getRelease()
  });
});

app.get("/ready", async (req, res) => {
  const { getMigrationStatus } = require("./lib/migrate");
  const result = await evaluateReadiness({
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool(),
    getMigrationStatus,
    checkJobs: defaultJobsCheck,
    domainContractVersion: ctx.DOMAIN_CONTRACT_VERSION
  });
  if (!result.ready) {
    metrics.inc("ready_failures");
    // Fire-and-forget; never block the probe response.
    alerts
      .notify({
        severity: "critical",
        type: "readiness_failed",
        message: result.error || "not_ready",
        details: {
          error: result.error,
          storage: result.storage,
          checks: result.checks
        }
      })
      .catch(() => {});
    req.log?.warn("ready_failed", { error: result.error, checks: result.checks });
  }
  const { statusCode, ...body } = result;
  return res.status(statusCode || (result.ready ? 200 : 503)).json({
    ...body,
    release: getRelease(),
    timestamp: new Date().toISOString()
  });
});

app.get("/metrics", (_req, res) => {
  res.json(metrics.snapshot());
});

app.get("/api/meta", (_req, res) => {
  res.json({
    countries: ctx.countries,
    languages: ctx.languages,
    roles: ctx.roles,
    schemaVersion: ctx.getSchemaVersion(),
    domainContractVersion: ctx.DOMAIN_CONTRACT_VERSION,
    storage: ctx.usePostgres ? "postgres" : "file-json",
    release: getRelease()
  });
});

app.get("/api/locale", (req, res) => {
  res.json(ctx.detectLocale(req));
});

// ── Route modules ──

app.use("/api/auth", authRoutes);
app.use(storiesRoutes);       // mounted at root — routes include /api/stories, /api/stats, /api/companies, /sitemap.xml
app.use(expressionRoutes);    // /api/expression/*, /api/vents/* (aitj-z8q.8)
app.use("/api/forum", forumRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/signals", insiderRoutes); // insider signals — public summary only
app.use(resourcesRoutes);     // /api/resources, /api/opportunities (aitj-z8q.12)
app.use("/api/social", socialRoutes); // comments, follows, blocks, saves, reactions, groups (aitj-z8q.11)
app.use(integrationsRoutes);  // mounted at root — /api/integrations/*, /api/news, etc.

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

app.use((err, req, res, _next) => {
  metrics.inc("unhandled_errors");
  const reqLog = req.log || log;
  reqLog.error("unhandled_error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  });
  alerts
    .notify({
      severity: "critical",
      type: "unhandled_error",
      message: err instanceof Error ? err.message : "Internal server error",
      details: { path: req.path, method: req.method, requestId: req.id }
    })
    .catch(() => {});
  res.status(500).json({ message: "Internal server error", requestId: req.id });
});

// ── Start ──

function jobsRuntimeOptions() {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool(),
    useMemory: !ctx.usePostgres
  };
}

/**
 * Enqueue news.ingest with a windowed idempotency key so multi-instance web
 * processes do not create duplicate scheduled work. Execution is left to a
 * durable worker (JOBS_WORKER=1 or scripts/job-worker.js) — setInterval alone
 * is not the production executor.
 */
async function enqueueScheduledNewsIngest(reason) {
  if (!ENABLE_NEWS_INGEST || !ctx.usePostgres) return;
  const intervalMs = NEWS_INGEST_INTERVAL_HOURS * 60 * 60 * 1000;
  const idempotencyKey = jobs.scheduleIdempotencyKey("news.ingest", intervalMs);
  try {
    const { job, created } = await jobs.enqueue(
      {
        type: "news.ingest",
        payload: {
          reason,
          daysBack: Number(process.env.NEWS_INGEST_DAYS_BACK || 14),
          maxRecords: Number(process.env.NEWS_INGEST_MAX_RECORDS || 25)
        },
        idempotencyKey,
        maxAttempts: 3,
        timeoutMs: 5 * 60 * 1000
      },
      jobsRuntimeOptions()
    );
    if (created) {
      log.info("news_ingest_enqueued", { reason, jobId: job.id, idempotencyKey });
    } else {
      log.info("news_ingest_already_queued", { reason, jobId: job.id, idempotencyKey });
    }
  } catch (error) {
    metrics.inc("job_enqueue_failures");
    log.error("news_ingest_enqueue_failed", {
      reason,
      error: error instanceof Error ? error.message : String(error)
    });
    alerts
      .notify({
        severity: "warning",
        type: "job_enqueue_failed",
        message: `news.ingest enqueue failed (${reason})`,
        details: { reason }
      })
      .catch(() => {});
  }
}

function scheduleNewsIngest() {
  if (!ENABLE_NEWS_INGEST || !ctx.usePostgres) return;
  const intervalMs = NEWS_INGEST_INTERVAL_HOURS * 60 * 60 * 1000;
  // Lightweight scheduler: only enqueues durable jobs (not bare side effects).
  setTimeout(() => enqueueScheduledNewsIngest("startup"), 15000);
  const timer = setInterval(() => enqueueScheduledNewsIngest("interval"), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

/**
 * Enqueue digest.weekly with a windowed idempotency key (default 7d window).
 * Fan-out happens in the job handler via durable notification.send jobs.
 */
async function enqueueScheduledWeeklyDigest(reason) {
  if (!ENABLE_WEEKLY_DIGEST || !ctx.usePostgres) return;
  const intervalMs = DIGEST_WEEKLY_INTERVAL_HOURS * 60 * 60 * 1000;
  const idempotencyKey = jobs.scheduleIdempotencyKey("digest.weekly", intervalMs);
  try {
    const { job, created } = await jobs.enqueue(
      {
        type: "digest.weekly",
        payload: { reason, windowKey: idempotencyKey },
        idempotencyKey,
        maxAttempts: 3,
        timeoutMs: 10 * 60 * 1000
      },
      jobsRuntimeOptions()
    );
    if (created) {
      console.log(`Weekly digest job enqueued (${reason}): ${job.id} key=${idempotencyKey}`);
    } else {
      console.log(`Weekly digest job already queued for window (${reason}): ${job.id}`);
    }
  } catch (error) {
    console.error(`Weekly digest enqueue ${reason} failed:`, error);
  }
}

function scheduleWeeklyDigest() {
  if (!ENABLE_WEEKLY_DIGEST || !ctx.usePostgres) return;
  const intervalMs = DIGEST_WEEKLY_INTERVAL_HOURS * 60 * 60 * 1000;
  // Delay first enqueue so boot settles; still durable + idempotent per window.
  setTimeout(() => enqueueScheduledWeeklyDigest("startup"), 45000);
  const timer = setInterval(() => enqueueScheduledWeeklyDigest("interval"), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

function startInProcessJobWorker() {
  if (!ENABLE_JOBS_WORKER) return null;
  const workerId =
    process.env.JOBS_WORKER_ID ||
    `web_${os.hostname()}_${process.pid}`;
  const concurrency = Math.max(1, Math.min(20, Number(process.env.JOBS_CONCURRENCY || 1)));
  const pollMs = Math.max(500, Number(process.env.JOBS_POLL_MS || 2000));
  const leaseMs = Math.max(5000, Number(process.env.JOBS_LEASE_MS || jobs.DEFAULT_LEASE_MS));
  const jobsLog = logger.createLogger({ component: "jobs", workerId });
  log.info("jobs_worker_starting", { workerId, concurrency, pollMs });
  return jobs.startWorkerLoop(
    workerId,
    {
      concurrency,
      pollMs,
      leaseMs,
      unref: true,
      logger: {
        info: (msg) => {
          metrics.inc("jobs_processed");
          jobsLog.info(typeof msg === "string" ? msg : "jobs_tick", typeof msg === "object" ? msg : undefined);
        },
        log: (msg) => jobsLog.info(typeof msg === "string" ? msg : "jobs_tick"),
        error: (msg) => {
          metrics.inc("job_failures");
          jobsLog.error(typeof msg === "string" ? msg : "jobs_error");
          alerts
            .notify({
              severity: "warning",
              type: "job_worker_tick_failed",
              message: typeof msg === "string" ? msg : "jobs worker tick failed",
              details: { workerId }
            })
            .catch(() => {});
        }
      }
    },
    jobsRuntimeOptions()
  );
}

async function start() {
  if (REQUIRE_STRICT_SECRETS) {
    const weakSecrets = [];
    if (ctx.ADMIN_TOKEN === "change-me-admin-token") weakSecrets.push("ADMIN_TOKEN");
    if (ctx.AUTH_SECRET === "change-me-auth-secret") weakSecrets.push("AUTH_SECRET");
    if (weakSecrets.length > 0) {
      log.error("fatal_weak_secrets", { secrets: weakSecrets });
      process.exit(1);
    }
  }

  if (ctx.usePostgres) {
    ctx.setPgPool(await ctx.buildPgPool());
    await ctx.initStorage();
    log.info("storage_mode", { storage: "postgres" });
  } else {
    await ctx.initStorage();
    log.info("storage_mode", { storage: "file-json" });
  }

  // Handlers always registered so admin enqueue / separate worker share types.
  registerBuiltinHandlers(ctx, jobs);
  scheduleNewsIngest();
  scheduleWeeklyDigest();
  startInProcessJobWorker();

  app.listen(port, () => {
    log.info("server_listen", { port, release: getRelease() });
  });
}

start().catch((error) => {
  log.error("server_start_failed", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});
