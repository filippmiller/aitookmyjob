const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const router = express.Router();
const { requireAuth, requireVerifiedPhone } = require("../middleware/auth");
const ctx = require("../lib/context");

const storySubmitLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const storyReactionLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const reactionTypes = new Set(["support", "useful", "same-industry"]);

function publishActivity(req, event) {
  if (req.app?.locals?.publishActivity) req.app.locals.publishActivity(event);
}

function publicStory(story) {
  const masked = ctx.maskStoryByPrivacy(ctx.ensureStoryDefaults(story));
  const metrics = masked.metrics || {};
  const publicMetrics = {
    views: Number(metrics.views || 0),
    meToo: Number(metrics.meToo || 0),
    commentsCount: Number(metrics.commentsCount || 0),
    reactions: metrics.reactions || {}
  };
  return {
    id: masked.id,
    name: masked.name,
    country: masked.country,
    language: masked.language,
    profession: masked.profession,
    company: masked.company,
    laidOffAt: masked.laidOffAt,
    foundNewJob: Boolean(masked.foundNewJob),
    reason: masked.reason,
    story: masked.story,
    status: masked.status,
    estimatedLayoffs: Number(masked.estimatedLayoffs || 1),
    createdAt: masked.createdAt,
    updatedAt: masked.updatedAt,
    city: masked.city,
    tenureYears: masked.tenureYears,
    salaryBefore: masked.salaryBefore,
    salaryAfter: masked.salaryAfter,
    layoffType: masked.layoffType,
    aiTool: masked.aiTool,
    warnedAhead: masked.warnedAhead,
    compensationMonths: masked.compensationMonths,
    searchingMonths: masked.searchingMonths,
    newRoleField: masked.newRoleField,
    moodScore: masked.moodScore,
    updateLabel: masked.updateLabel,
    evidenceTier: masked.evidenceTier,
    metrics: publicMetrics,
    views: publicMetrics.views,
    meToo: publicMetrics.meToo,
    commentsCount: publicMetrics.commentsCount,
    confidenceScore: ctx.computeConfidenceScore(masked)
  };
}

function getReactionVisitorHash(req, res) {
  const cookies = ctx.parseCookies(req);
  let visitorId = cookies.aitmj_vid;
  if (!visitorId || !/^[a-zA-Z0-9_-]{16,96}$/.test(visitorId)) {
    visitorId = ctx.generateCsrfToken();
    const secure = ctx.isProduction ? "; Secure" : "";
    res.append("Set-Cookie", `aitmj_vid=${encodeURIComponent(visitorId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`);
  }
  const actor = req.user?.id ? `user:${req.user.id}` : `visitor:${visitorId}`;
  return crypto.createHmac("sha256", ctx.AUTH_SECRET).update(actor).digest("hex").slice(0, 32);
}

function applyIdempotentReaction(story, type, visitorHash) {
  const metrics = story.metrics || {};
  const reactedBy = { ...(metrics.reactedBy || {}) };
  const currentActors = Array.isArray(reactedBy[type]) ? reactedBy[type] : [];
  if (currentActors.includes(visitorHash)) {
    return { metrics, duplicate: true };
  }
  const nextActors = [...currentActors, visitorHash].slice(-1000);
  reactedBy[type] = nextActors;
  if (type === "me-too") {
    return {
      duplicate: false,
      metrics: { ...metrics, meToo: Number(metrics.meToo || 0) + 1, reactedBy }
    };
  }
  const reactions = { ...(metrics.reactions || {}) };
  reactions[type] = Number(reactions[type] || 0) + 1;
  return {
    duplicate: false,
    metrics: { ...metrics, reactions, reactedBy }
  };
}

function buildStoryFacets(stories) {
  const countsFor = (field) => {
    const counts = new Map();
    for (const story of stories) {
      const value = story[field];
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count }));
  };
  const foundNewJob = stories.filter((story) => story.foundNewJob).length;
  return {
    total: stories.length,
    professions: countsFor("profession"),
    countries: countsFor("country"),
    companies: countsFor("company").slice(0, 25),
    aiTools: countsFor("aiTool").slice(0, 25),
    outcomes: [
      { value: "found", label: "Found new work", count: foundNewJob },
      { value: "searching", label: "Still searching", count: Math.max(0, stories.length - foundNewJob) }
    ]
  };
}

router.get("/api/stats", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const stories = (await ctx.storageGetStories()).filter((s) => s.status === "published" && (country === "global" || s.country === country));
  const laidOff = stories.reduce((sum, s) => sum + Number(s.estimatedLayoffs || 1), 0);
  const sharedStories = stories.length;
  const foundJob = stories.filter((s) => s.foundNewJob).length;
  const distinctCompanies = new Set(stories.map((s) => s.company)).size;
  const foundRate = sharedStories > 0 ? Math.round((foundJob / sharedStories) * 100) : 0;
  res.json({ country, counters: { laidOff, sharedStories, foundJob, distinctCompanies }, foundRate });
});

router.get("/api/stories", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const limit = Math.min(Math.max(Number(req.query.limit || 12), 1), 50);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const search = ctx.sanitizeText(req.query.search || "").toLowerCase();
  const profession = ctx.sanitizeText(req.query.profession || "");
  const outcome = ctx.sanitizeText(req.query.outcome || "");
  const countryList = ctx.sanitizeText(req.query.countries || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const all = (await ctx.storageGetStories())
    .filter((s) => s.status === "published" && (country === "global" || s.country === country))
    .filter((s) => !countryList.length || countryList.includes(s.country))
    .filter((s) => !profession || s.profession === profession)
    .filter((s) => outcome !== "found" || s.foundNewJob)
    .filter((s) => outcome !== "searching" || !s.foundNewJob)
    .filter((s) => {
      if (!search) return true;
      const haystack = `${s.name} ${s.company} ${s.profession} ${s.reason || ""} ${s.story || ""} ${s.aiTool || ""}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const stories = all.slice(offset, offset + limit).map(publicStory);
  res.json({ country, stories, total: all.length, crisisResources: ctx.getCrisisResources(country) });
});

router.get("/api/stories/facets", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const stories = (await ctx.storageGetStories())
    .filter((s) => s.status === "published" && (country === "global" || s.country === country))
    .map(ctx.ensureStoryDefaults);
  res.json({ country, facets: buildStoryFacets(stories) });
});

router.get("/api/stories/:id", async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const story = (await ctx.storageGetStories()).find((s) => s.id === id && s.status === "published");
  if (!story) { res.status(404).json({ message: "Story not found" }); return; }
  res.json(publicStory(story));
});

router.post("/api/stories", storySubmitLimiter, requireAuth, requireVerifiedPhone, async (req, res) => {
  if (ctx.isAccountMuted(req.user)) { res.status(403).json({ message: "Account temporarily muted" }); return; }
  const prepared = ctx.buildStoryPayload(req);
  if (!prepared.ok) { res.status(422).json({ message: "Validation failed", errors: prepared.errors }); return; }
  const moderation = ctx.scoreModeration(prepared.data);
  const initialStatus = moderation.riskBand === "high" ? "rejected" : "pending";
  const newStory = ctx.buildStoryRecord(prepared.data, req.user.id, moderation, initialStatus);
  await ctx.storageInsertStory(newStory);
  await ctx.storageInsertStoryVersion({ id: ctx.auditId(), storyId: newStory.id, versionNo: 1, payload: newStory, createdBy: req.user.id, createdAt: newStory.createdAt });
  await ctx.storageAudit({ action: "story.submit", actorId: req.user?.id || null, targetType: "story", targetId: newStory.id, metadata: { country: newStory.country, language: newStory.language, moderation }, ip: req.ip });
  if (moderation.riskBand !== "low" && ctx.TELEGRAM_MOD_CHAT_ID) {
    await ctx.sendTelegramMessage(ctx.TELEGRAM_MOD_CHAT_ID, `New story flagged (${moderation.riskBand})\nID: ${newStory.id}\nCountry: ${newStory.country}\nRisk: ${JSON.stringify(moderation)}`);
  }
  publishActivity(req, {
    type: "story.submitted",
    title: "Story submitted for review",
    detail: `${newStory.profession} · ${newStory.country}`,
    href: `/story/${newStory.id}`
  });
  res.status(initialStatus === "rejected" ? 202 : 201).json({
    message: initialStatus === "rejected" ? "Story auto-flagged for high-risk review" : "Story submitted for moderation",
    id: newStory.id, status: newStory.status, moderation,
    deanonymizationRisk: moderation.deanonymization, recommendations: moderation.recommendations,
    crisisResources: moderation.crisis ? ctx.getCrisisResources(newStory.country) : []
  });
});

router.post("/api/stories/anonymous", storySubmitLimiter, async (req, res) => {
  if (ctx.REQUIRE_CAPTCHA && !ctx.sanitizeText(req.body.captchaToken)) { res.status(422).json({ message: "Captcha token required" }); return; }
  req.body = { ...req.body, name: ctx.sanitizeText(req.body.name || "Anonymous"), company: ctx.sanitizeText(req.body.company || "Undisclosed") };
  const prepared = ctx.buildStoryPayload(req);
  if (!prepared.ok) { res.status(422).json({ message: "Validation failed", errors: prepared.errors }); return; }
  const moderation = ctx.scoreModeration(prepared.data);
  const initialStatus = moderation.riskBand === "high" ? "rejected" : "pending";
  const newStory = ctx.buildStoryRecord(prepared.data, null, moderation, initialStatus);
  await ctx.storageInsertStory(newStory);
  await ctx.storageAudit({ action: "story.submit.anonymous", actorId: null, targetType: "story", targetId: newStory.id, metadata: { country: newStory.country, language: newStory.language, moderation }, ip: req.ip });
  publishActivity(req, {
    type: "story.submitted",
    title: "Anonymous story submitted",
    detail: `${newStory.profession} · ${newStory.country}`,
    href: `/story/${newStory.id}`
  });
  res.status(initialStatus === "rejected" ? 202 : 201).json({ message: "Anonymous story submitted for moderation", id: newStory.id, status: newStory.status, moderation });
});

router.post("/api/stories/:id/view", async (req, res) => {
  const updated = await ctx.storagePatchStory(req.params.id, (story) => ({ metrics: { ...story.metrics, views: Number(story.metrics?.views || 0) + 1 } }));
  if (!updated) { res.status(404).json({ message: "Story not found" }); return; }
  res.json({ id: updated.id, views: updated.metrics.views });
});

router.post("/api/stories/:id/me-too", storyReactionLimiter, async (req, res) => {
  let duplicate = false;
  const visitorHash = getReactionVisitorHash(req, res);
  const updated = await ctx.storagePatchStory(req.params.id, (story) => {
    const result = applyIdempotentReaction(story, "me-too", visitorHash);
    duplicate = result.duplicate;
    return { metrics: result.metrics };
  });
  if (!updated) { res.status(404).json({ message: "Story not found" }); return; }
  if (!duplicate) {
    publishActivity(req, {
      type: "reaction.me-too",
      title: "Someone marked Me too",
      detail: `${updated.profession || "Worker"} story · ${updated.country || "global"}`,
      href: `/story/${updated.id}`
    });
  }
  res.json({ id: updated.id, meToo: updated.metrics.meToo || 0, duplicate });
});

router.post("/api/stories/:id/reactions", storyReactionLimiter, async (req, res) => {
  const type = ctx.sanitizeText(req.body.type || "");
  if (!reactionTypes.has(type)) { res.status(422).json({ message: "Unknown reaction type" }); return; }
  let duplicate = false;
  const visitorHash = getReactionVisitorHash(req, res);
  const updated = await ctx.storagePatchStory(req.params.id, (story) => {
    const result = applyIdempotentReaction(story, type, visitorHash);
    duplicate = result.duplicate;
    return { metrics: result.metrics };
  });
  if (!updated) { res.status(404).json({ message: "Story not found" }); return; }
  if (!duplicate) {
    publishActivity(req, {
      type: `reaction.${type}`,
      title: type === "support" ? "Support sent" : type === "useful" ? "Story saved as useful" : "Same-field signal added",
      detail: `${updated.profession || "Worker"} story · ${updated.country || "global"}`,
      href: `/story/${updated.id}`
    });
  }
  res.json({ id: updated.id, reactions: updated.metrics.reactions || {}, duplicate });
});

router.post("/api/stories/:id/comment", requireAuth, async (req, res) => {
  const body = ctx.sanitizeText(req.body.body || "");
  if (body.length < 2) { res.status(422).json({ message: "Comment is too short" }); return; }
  const updated = await ctx.storagePatchStory(req.params.id, (story) => ({ metrics: { ...story.metrics, commentsCount: Number(story.metrics?.commentsCount || 0) + 1 } }));
  if (!updated) { res.status(404).json({ message: "Story not found" }); return; }
  await ctx.storageAudit({ action: "story.comment", actorId: req.user.id, targetType: "story", targetId: req.params.id, metadata: {}, ip: req.ip });
  res.status(201).json({ ok: true, commentsCount: updated.metrics.commentsCount });
});

router.post("/api/stories/:id/update", requireAuth, async (req, res) => {
  const storyIdValue = ctx.sanitizeText(req.params.id);
  const current = (await ctx.storageGetStories()).find((s) => s.id === storyIdValue);
  if (!current) { res.status(404).json({ message: "Story not found" }); return; }
  if (current.submittedBy && current.submittedBy !== req.user.id && !ctx.hasModeratorRole(req.user)) { res.status(403).json({ message: "Not allowed" }); return; }
  const foundNewJob = req.body.foundNewJob === true || req.body.foundNewJob === "true";
  const note = ctx.sanitizeText(req.body.updateLabel || "");
  const updated = await ctx.storagePatchStory(storyIdValue, (story) => ({ foundNewJob, details: { ...story.details, updateLabel: note || story.details?.updateLabel || null } }));
  await ctx.storageAudit({ action: "story.update.status", actorId: req.user.id, targetType: "story", targetId: storyIdValue, metadata: { foundNewJob }, ip: req.ip });
  res.json({ id: storyIdValue, foundNewJob: Boolean(updated?.foundNewJob), updateLabel: updated?.details?.updateLabel || null });
});

router.get("/api/stories/:id/confidence", async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const story = (await ctx.storageGetStories()).find((s) => s.id === id);
  if (!story) { res.status(404).json({ message: "Story not found" }); return; }
  res.json({ id, confidenceScore: ctx.computeConfidenceScore(story), evidenceTier: story.evidenceTier || "self_report", moderation: story.moderation || {} });
});

// Companies
router.get("/api/companies/top", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  res.json({ country, companies: ctx.getTopCompanies(await ctx.storageGetStories(), country) });
});

router.get("/api/companies/:slug", async (req, res) => {
  const profile = ctx.toCompanyProfile(await ctx.storageGetStories(), ctx.sanitizeText(req.params.slug));
  if (!profile) { res.status(404).json({ message: "Company profile not found" }); return; }
  res.json(profile);
});

router.get("/api/companies/:slug/timeline", async (req, res) => {
  const slug = ctx.sanitizeText(req.params.slug);
  const stories = (await ctx.storageGetStories()).filter((s) => s.status === "published" && ctx.slugifyCompany(s.company) === slug);
  if (!stories.length) { res.status(404).json({ message: "Company profile not found" }); return; }
  const byMonth = new Map();
  for (const s of stories) { const month = String(s.laidOffAt || "").slice(0, 7) || "unknown"; byMonth.set(month, (byMonth.get(month) || 0) + Number(s.estimatedLayoffs || 1)); }
  res.json({ slug, company: stories[0].company, timeline: [...byMonth.entries()].map(([month, layoffs]) => ({ month, layoffs })).sort((a, b) => a.month.localeCompare(b.month)) });
});

router.get("/api/companies/:slug/board/topics", async (req, res) => {
  const slug = ctx.sanitizeText(req.params.slug);
  const source = ctx.readCompanyBoards();
  const rows = source.length ? source : ctx.defaultCompanyBoards;
  res.json({ companySlug: slug, topics: rows.filter((x) => x.companySlug === slug).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
});

router.post("/api/companies/:slug/board/topics", requireAuth, async (req, res) => {
  const slug = ctx.sanitizeText(req.params.slug);
  const title = ctx.sanitizeText(req.body.title);
  const body = ctx.sanitizeText(req.body.body);
  if (title.length < 8 || body.length < 20) { res.status(422).json({ message: "Validation failed" }); return; }
  const entry = { id: ctx.topicId(), companySlug: slug, title, body, createdBy: req.user.id, createdAt: new Date().toISOString() };
  const rows = ctx.readCompanyBoards();
  rows.push(entry);
  ctx.writeJsonArray(ctx.companyBoardsPath, rows.slice(-5000));
  res.status(201).json(entry);
});

// Statistics & counters
router.get("/api/statistics/dashboard", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  res.json(ctx.getDashboard(await ctx.storageGetStories(), country));
});

router.get("/api/counters", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const stories = (await ctx.storageGetStories()).filter((s) => country === "global" || s.country === country);
  res.json({ country, counters: ctx.buildCounters(stories) });
});

// Sitemap
router.get("/sitemap.xml", async (_req, res) => {
  const stories = (await ctx.storageGetStories()).filter((s) => s.status === "published");
  const baseUrl = process.env.BASE_URL || "https://aitookmyjob.filippmiller.com";
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += `  <url><loc>${baseUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
  xml += `  <url><loc>${baseUrl}/forum</loc><changefreq>daily</changefreq><priority>0.7</priority></url>\n`;
  for (const s of stories) {
    const dateVal = s.updatedAt || s.createdAt || new Date();
    const lastmod = (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal)).split("T")[0];
    xml += `  <url><loc>${baseUrl}/story/${s.id}</loc><lastmod>${lastmod}</lastmod><priority>0.8</priority></url>\n`;
  }
  xml += '</urlset>';
  res.set("Content-Type", "application/xml");
  res.send(xml);
});

module.exports = router;
