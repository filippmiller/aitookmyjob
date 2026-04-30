const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const router = express.Router();
const { requireAuth, requireAdminOrToken } = require("../middleware/auth");
const ctx = require("../lib/context");

const boundaryPolls = [
  { id: "robot-doctor-touch", icon: "ph-stethoscope", question: "Are you ok with robot doctor touching you?" },
  { id: "ai-therapist-crisis", icon: "ph-brain", question: "Would you let an AI therapist guide a crisis conversation?" },
  { id: "driverless-bus", icon: "ph-bus", question: "Would you ride in a bus with no human driver?" },
  { id: "ai-job-interview", icon: "ph-identification-card", question: "Should AI decide who gets a job interview?" },
  { id: "robot-teacher-grade", icon: "ph-graduation-cap", question: "Would you let a robot teacher grade your child?" },
  { id: "ai-judge-sentencing", icon: "ph-scales", question: "Should an AI judge recommend prison sentences?" },
  { id: "ai-firing-worker", icon: "ph-user-minus", question: "Would you trust AI to fire someone at your company?" },
  { id: "robot-elder-care", icon: "ph-hand-heart", question: "Would you let a robot caregiver lift an elderly parent?" },
  { id: "ai-medical-diagnosis", icon: "ph-first-aid-kit", question: "Should AI write your medical diagnosis before a human sees it?" },
  { id: "robot-cooked-food", icon: "ph-cooking-pot", question: "Would you eat food cooked entirely by robots?" },
  { id: "ai-er-triage", icon: "ph-hospital", question: "Should AI choose emergency-room priority when beds are full?" }
];

function getVisitorHash(req, res) {
  const cookies = ctx.parseCookies(req);
  let visitorId = cookies.aitmj_vid;
  if (!/^[A-Za-z0-9_-]{16,96}$/.test(visitorId || "")) {
    visitorId = crypto.randomBytes(24).toString("base64url");
    res.cookie("aitmj_vid", visitorId, {
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.isProduction,
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  }
  const subject = req.user?.id ? `user:${req.user.id}` : `visitor:${visitorId}`;
  return crypto.createHmac("sha256", ctx.AUTH_SECRET).update(subject).digest("hex").slice(0, 48);
}

const pollVoteLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// ── Telegram ──

router.post("/api/integrations/telegram/link/start", requireAuth, async (req, res) => {
  const identity = (await ctx.storageGetIdentityByUserId(req.user.id)) || { userId: req.user.id, emailVerified: true, phoneVerified: false };
  const code = ctx.linkCodeId();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await ctx.storageUpsertIdentity({ ...identity, telegramLinkCode: code, telegramCodeExpiresAt: expiresAt });
  await ctx.storageAudit({ action: "telegram.link.start", actorId: req.user.id, targetType: "identity", targetId: req.user.id, metadata: { expiresAt }, ip: req.ip });
  res.json({ ok: true, code, expiresAt, bot: ctx.TELEGRAM_BOT_TOKEN ? "configured" : "not-configured" });
});

router.post("/api/integrations/telegram/link-code", requireAuth, async (req, res) => {
  const identity = (await ctx.storageGetIdentityByUserId(req.user.id)) || { userId: req.user.id, emailVerified: true, phoneVerified: false };
  const code = ctx.linkCodeId();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await ctx.storageUpsertIdentity({ ...identity, telegramLinkCode: code, telegramCodeExpiresAt: expiresAt });
  await ctx.storageAudit({ action: "telegram.link.start", actorId: req.user.id, targetType: "identity", targetId: req.user.id, metadata: { expiresAt, alias: "link-code" }, ip: req.ip });
  res.json({ ok: true, code, expiresAt, bot: ctx.TELEGRAM_BOT_TOKEN ? "configured" : "not-configured" });
});

router.post("/api/integrations/telegram/link", requireAuth, async (req, res) => {
  const identity = (await ctx.storageGetIdentityByUserId(req.user.id)) || { userId: req.user.id, emailVerified: true, phoneVerified: false };
  const code = ctx.linkCodeId();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await ctx.storageUpsertIdentity({ ...identity, telegramLinkCode: code, telegramCodeExpiresAt: expiresAt });
  await ctx.storageAudit({ action: "telegram.link.start", actorId: req.user.id, targetType: "identity", targetId: req.user.id, metadata: { expiresAt, alias: "link" }, ip: req.ip });
  res.json({ ok: true, code, expiresAt, bot: ctx.TELEGRAM_BOT_TOKEN ? "configured" : "not-configured" });
});

router.get("/api/integrations/telegram/status", requireAuth, async (req, res) => {
  const link = await ctx.storageGetTelegramLinkByUserId(req.user.id);
  const identity = await ctx.storageGetIdentityByUserId(req.user.id);
  res.json({
    linked: Boolean(link),
    telegram: link ? { username: link.telegramUsername || null, linkedAt: link.linkedAt } : null,
    pendingCode: identity?.telegramLinkCode || null,
    pendingCodeExpiresAt: identity?.telegramCodeExpiresAt || null
  });
});

router.post("/api/integrations/telegram/webhook", async (req, res) => {
  if (ctx.TELEGRAM_WEBHOOK_SECRET) {
    const incoming = req.headers["x-telegram-bot-api-secret-token"];
    if (incoming !== ctx.TELEGRAM_WEBHOOK_SECRET) { res.status(401).json({ message: "Invalid telegram webhook secret" }); return; }
  }
  const parsed = ctx.telegramWebhookSchema.safeParse(req.body || {});
  if (!parsed.success) { res.status(200).json({ ok: true }); return; }
  const msg = parsed.data.message;
  if (!msg || !msg.text || !msg.from) { res.status(200).json({ ok: true }); return; }
  const txt = String(msg.text || "").trim();
  const fromId = String(msg.from.id);
  const username = msg.from.username || null;
  if (!txt.toLowerCase().startsWith("/link")) { res.status(200).json({ ok: true }); return; }
  const code = txt.split(" ").slice(1).join("").trim().toUpperCase();
  if (!code) { await ctx.sendTelegramMessage(String(msg.chat.id), "Usage: /link YOUR_CODE"); res.status(200).json({ ok: true }); return; }

  let identity = null;
  if (ctx.usePostgres) {
    const pool = ctx.getPgPool();
    const found = await pool.query("SELECT user_id, telegram_link_code, telegram_code_expires_at FROM auth_identities WHERE telegram_link_code = $1 LIMIT 1;", [code]);
    if (found.rows.length) {
      const r = found.rows[0];
      identity = { userId: r.user_id, telegramLinkCode: r.telegram_link_code, telegramCodeExpiresAt: r.telegram_code_expires_at };
    }
  } else {
    identity = ctx.readJsonArray(ctx.authIdentitiesPath).find((x) => String(x.telegramLinkCode || "").toUpperCase() === code) || null;
  }
  if (!identity || !identity.telegramCodeExpiresAt || new Date(identity.telegramCodeExpiresAt).getTime() < Date.now()) {
    await ctx.sendTelegramMessage(String(msg.chat.id), "Code not found or expired. Generate a new code on the website.");
    res.status(200).json({ ok: true }); return;
  }
  await ctx.storageCreateOrUpdateTelegramLink({ id: ctx.auditId(), userId: identity.userId, telegramUserId: fromId, telegramUsername: username, status: "linked", linkedAt: new Date().toISOString() });
  const fullIdentity = await ctx.storageGetIdentityByUserId(identity.userId);
  await ctx.storageUpsertIdentity({ ...fullIdentity, telegramLinkCode: null, telegramCodeExpiresAt: null });
  await ctx.storageAudit({ action: "telegram.link.complete", actorId: identity.userId, targetType: "telegram_link", targetId: fromId, metadata: { username }, ip: req.ip });
  await ctx.sendTelegramMessage(String(msg.chat.id), "Account linked successfully.");
  res.status(200).json({ ok: true });
});

// ── Resources & News ──

router.get("/api/resources", (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const source = ctx.readResources();
  const rows = source.length ? source : ctx.defaultResources;
  res.json({ country, resources: rows.filter((x) => x.region === "global" || x.region === country) });
});

router.get("/api/resources/match", (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const profession = ctx.sanitizeText(req.query.profession || "").toLowerCase();
  const months = Number(req.query.months || 0);
  const source = ctx.readResources();
  const rows = source.length ? source : ctx.defaultResources;
  const matched = rows.filter((r) => {
    const regionOk = r.region === "global" || r.region === country;
    const professionOk = !profession || `${r.title} ${r.summary} ${r.type}`.toLowerCase().includes(profession);
    const urgencyBoost = months >= 6 ? (r.type === "jobs" || r.type === "reskilling") : true;
    return regionOk && professionOk && urgencyBoost;
  });
  res.json({ country, profession, months, resources: matched });
});

router.get("/api/news", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const limit = Math.min(Math.max(Number(req.query.limit || 24), 1), 100);
  const news = await ctx.storageGetNews({ country, limit });
  res.json({ country, news });
});

// ── Community features ──

router.get("/api/legal/methodology", (_req, res) => {
  res.json({
    methodology: {
      storiesCounter: "Counts published stories only.",
      layoffCounter: "Sum of estimatedLayoffs from published stories.",
      verifiedSignal: "Phone-verified submitters are labeled as higher trust in moderation metadata.",
      limitations: ["Self-reported stories may contain uncertainty.", "Aggregates are directional, not labor-market census values."]
    }
  });
});

router.post("/api/privacy/redaction-assistant", async (req, res) => {
  const text = ctx.sanitizeText(req.body.text || "");
  if (text.length < 20) { res.status(422).json({ message: "Text too short" }); return; }
  res.json({
    risk: ctx.scoreModeration({ reason: text, story: text }),
    suggestions: ["Remove exact dates and unique team identifiers.", "Mask specific product/project codenames.", "Consider switching company visibility to masked."]
  });
});

router.post("/api/anonymous/inbox", async (req, res) => {
  const message = ctx.sanitizeText(req.body.message || "");
  const channel = ctx.sanitizeText(req.body.channel || "web");
  if (message.length < 20) { res.status(422).json({ message: "Message too short" }); return; }
  const trackingCode = `INB-${ctx.linkCodeId()}`;
  const row = { id: ctx.auditId(), trackingCode, message, channel, status: "received", createdAt: new Date().toISOString() };
  const entries = ctx.readAnonymousInbox();
  entries.push(row);
  ctx.writeJsonArray(ctx.anonymousInboxPath, entries.slice(-5000));
  res.status(201).json({ trackingCode, status: row.status });
});

router.get("/api/submission/onion-info", (_req, res) => {
  res.json({ enabled: false, note: "Onion endpoint is not configured yet.", guidance: "Use anonymous inbox or secure channel until onion service is enabled." });
});

router.get("/api/cohorts", (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const profession = ctx.sanitizeText(req.query.profession || "").toLowerCase();
  const source = ctx.readCohorts();
  const rows = source.length ? source : ctx.defaultCohorts;
  res.json({ country, cohorts: rows.filter((c) => (c.country === "global" || c.country === country) && (!profession || String(c.profession || "").toLowerCase().includes(profession))) });
});

router.post("/api/cohorts", requireAuth, async (req, res) => {
  const title = ctx.sanitizeText(req.body.title || "");
  const profession = ctx.sanitizeText(req.body.profession || "");
  const country = ctx.normalizeCountry(req.body.country || "global");
  const capacity = Number(req.body.capacity || 0);
  if (title.length < 8 || profession.length < 2 || capacity < 5) { res.status(422).json({ message: "Validation failed" }); return; }
  const row = { id: `cohort-${ctx.topicId()}`, title, profession, country, capacity, enrolled: 0, startsAt: ctx.sanitizeText(req.body.startsAt || ""), status: "open" };
  const entries = ctx.readCohorts();
  entries.push(row);
  ctx.writeJsonArray(ctx.cohortsPath, entries.slice(-1000));
  res.status(201).json(row);
});

router.get("/api/polls/boundary", async (req, res) => {
  const visitorHash = getVisitorHash(req, res);
  const polls = await ctx.storageGetBoundaryPollResults(boundaryPolls, visitorHash);
  res.json({ polls });
});

router.post("/api/polls/boundary/:id/vote", pollVoteLimiter, async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const option = ctx.sanitizeText(req.body.option || "");
  const definition = boundaryPolls.find((poll) => poll.id === id);
  if (!definition) { res.status(404).json({ message: "Poll not found" }); return; }
  if (!["yes", "no", "unsure"].includes(option)) { res.status(422).json({ message: "Invalid poll option" }); return; }

  const visitorHash = getVisitorHash(req, res);
  await ctx.storageUpsertBoundaryPollVote(id, option, visitorHash);
  const [poll] = await ctx.storageGetBoundaryPollResults([definition], visitorHash);
  res.json({ poll });
});

router.get("/api/campaigns/petitions", async (req, res) => {
  const visitorHash = getVisitorHash(req, res);
  const petitions = await ctx.storageGetPetitions(visitorHash);
  res.json({ petitions });
});

router.post("/api/campaigns/petitions", requireAuth, async (req, res) => {
  const title = ctx.sanitizeText(req.body.title || "");
  const description = ctx.sanitizeText(req.body.description || "");
  const goal = Number(req.body.goal || 0);
  if (title.length < 10 || description.length < 20 || goal < 10) { res.status(422).json({ message: "Validation failed" }); return; }
  const row = { id: `pet-${ctx.topicId()}`, title, description, goal, signatures: 0, status: "open", createdAt: new Date().toISOString() };
  const petition = await ctx.storageCreatePetition(row);
  res.status(201).json(petition);
});

router.post("/api/campaigns/petitions/:id/sign", async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const visitorHash = getVisitorHash(req, res);
  const signed = await ctx.storageSignPetition(id, visitorHash);
  if (!signed) { res.status(404).json({ message: "Petition not found" }); return; }
  if (!signed.duplicate && req.app?.locals?.publishActivity) {
    req.app.locals.publishActivity({
      type: "petition.signed",
      title: "Petition signed",
      detail: `${signed.petition.signatures} signatures · ${signed.petition.title}`,
      href: "#community"
    });
  }
  res.json({ id, signatures: signed.petition.signatures, viewerSigned: true, duplicate: signed.duplicate, petition: signed.petition });
});

router.get("/api/transparency/center", async (req, res) => {
  const periodDays = Number(req.query.days || 30);
  const from = new Date(Date.now() - periodDays * 24 * 3600 * 1000).toISOString();
  const events = await ctx.storageGetAuditRange(from, new Date().toISOString());
  const takedowns = ctx.readJsonArray(ctx.takedownsPath);
  const counters = ctx.buildCounters(await ctx.storageGetStories());
  res.json({
    generatedAt: new Date().toISOString(), counters,
    moderationActions: events.filter((x) => x.action === "moderation.action").length,
    sanctions: events.filter((x) => x.action === "sanction.create").length,
    takedownsRequested: takedowns.length,
    anomalySignals: events.filter((x) => x.action && x.action.includes("anomaly")).length
  });
});

router.post("/api/legal/takedown", async (req, res) => {
  const payload = { email: ctx.normalizeEmail(req.body.email), reason: ctx.sanitizeText(req.body.reason), targetUrl: ctx.sanitizeText(req.body.targetUrl), legalBasis: ctx.sanitizeText(req.body.legalBasis) };
  if (!payload.email || !payload.reason || !payload.targetUrl) { res.status(422).json({ message: "Validation failed" }); return; }
  const entry = { id: ctx.auditId(), email: payload.email, reason: payload.reason, targetUrl: payload.targetUrl, legalBasis: payload.legalBasis || "unspecified", createdAt: new Date().toISOString(), status: "pending" };
  const rows = ctx.readJsonArray(ctx.takedownsPath);
  rows.push(entry);
  ctx.writeJsonArray(ctx.takedownsPath, rows.slice(-5000));
  await ctx.storageAudit({ action: "legal.takedown.request", actorId: null, targetType: "takedown", targetId: entry.id, metadata: { targetUrl: entry.targetUrl }, ip: req.ip });
  res.status(201).json({ id: entry.id, status: entry.status });
});

// ── Research & Transparency ──

router.get("/api/research/aggregate", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const stories = (await ctx.storageGetStories()).filter((s) => s.status === "published" && (country === "global" || s.country === country));
  const byProfession = new Map();
  const byMonth = new Map();
  for (const s of stories) {
    byProfession.set(s.profession, (byProfession.get(s.profession) || 0) + 1);
    const monthKey = String(s.laidOffAt || "").slice(0, 7) || "unknown";
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + 1);
  }
  res.json({
    country, generatedAt: new Date().toISOString(), totalPublishedStories: stories.length,
    topProfessions: [...byProfession.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([profession, storiesCount]) => ({ profession, storiesCount })),
    monthlyTrend: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, storiesCount]) => ({ month, storiesCount }))
  });
});

router.get("/api/research/aggregates", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const stories = (await ctx.storageGetStories()).filter((s) => s.status === "published" && (country === "global" || s.country === country));
  const byProfession = new Map();
  const byMonth = new Map();
  for (const s of stories) {
    byProfession.set(s.profession, (byProfession.get(s.profession) || 0) + 1);
    const monthKey = String(s.laidOffAt || "").slice(0, 7) || "unknown";
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + 1);
  }
  res.json({
    country, generatedAt: new Date().toISOString(), totalPublishedStories: stories.length,
    topProfessions: [...byProfession.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([profession, storiesCount]) => ({ profession, storiesCount })),
    monthlyTrend: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, storiesCount]) => ({ month, storiesCount }))
  });
});

router.get("/api/transparency/report", async (req, res) => {
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
  const events = await ctx.storageGetAuditRange(from.toISOString(), to.toISOString());
  const totals = { registrations: 0, storiesSubmitted: 0, moderationActions: 0, sanctions: 0, telegramLinks: 0 };
  for (const ev of events) {
    if (ev.action === "auth.register") totals.registrations += 1;
    if (ev.action === "story.submit") totals.storiesSubmitted += 1;
    if (ev.action === "moderation.action") totals.moderationActions += 1;
    if (ev.action === "sanction.create") totals.sanctions += 1;
    if (ev.action === "telegram.link.complete") totals.telegramLinks += 1;
  }
  res.json({ period: { from: from.toISOString(), to: to.toISOString(), label: period || null }, totals });
});

// ── Antiabuse (alias for admin anomaly signals) ──

router.get("/api/antiabuse/anomaly/signals", requireAdminOrToken, async (req, res) => {
  const now = Date.now();
  const from = new Date(now - 24 * 3600 * 1000).toISOString();
  const events = await ctx.storageGetAuditRange(from, new Date(now).toISOString());
  const byIp = new Map();
  for (const ev of events) { if (!ev.ip) continue; byIp.set(ev.ip, (byIp.get(ev.ip) || 0) + 1); }
  res.json({ window: "24h", signals: [...byIp.entries()].filter(([, count]) => count >= 20).map(([ip, count]) => ({ severity: count >= 50 ? "high" : "medium", type: "ip_activity_spike", summary: `IP ${ip} produced ${count} events in 24h`, count, createdAt: new Date().toISOString() })) });
});

// ── Digest subscription ──

const digestSubscribeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

router.post("/api/digest/subscribe", digestSubscribeLimiter, (req, res) => {
  const email = ctx.normalizeEmail(req.body.email || "");
  const parsed = ctx.digestEmailSchema.safeParse({ email });
  if (!parsed.success) { res.status(422).json({ message: "Invalid email address" }); return; }
  const subscribers = ctx.readJsonArray(ctx.subscribersPath);
  if (subscribers.some((s) => s.email === parsed.data.email)) { res.status(409).json({ message: "Already subscribed" }); return; }
  const entry = { id: `sub-${ctx.topicId()}`, email: parsed.data.email, subscribedAt: new Date().toISOString(), country: ctx.normalizeCountry(String(req.body.country || ctx.defaultCountry)), language: ctx.normalizeLanguage(String(req.body.language || ctx.defaultLang)) };
  subscribers.push(entry);
  ctx.writeJsonArray(ctx.subscribersPath, subscribers.slice(-50000));
  if (req.app?.locals?.publishActivity) {
    req.app.locals.publishActivity({
      type: "digest.subscribed",
      title: "New weekly digest subscriber",
      detail: `${entry.country} · ${entry.language}`,
      href: "#resources"
    });
  }
  res.status(201).json({ id: entry.id, subscribedAt: entry.subscribedAt });
});

router.get("/api/digest/count", (_req, res) => {
  res.json({ count: ctx.readJsonArray(ctx.subscribersPath).length });
});

module.exports = router;
