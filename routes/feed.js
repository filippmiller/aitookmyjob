/**
 * Intent + personalized feed API (aitj-z8q.13).
 *
 * GET  /api/me/intent   — current intent (anonymous → privacy-safe fallback)
 * PATCH /api/me/intent  — set intent (auth required)
 * GET  /api/feed        — ranked feed with explanations + next steps
 */

"use strict";

const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const ctx = require("../lib/context");
const personalization = require("../lib/personalization");
const {
  STORY_STATUS,
  VENT_STATUS,
  NEWS_STATUS,
  RESOURCE_STATUS,
  OPPORTUNITY_STATUS,
  DISCUSSION_TOPIC_STATUS,
  PETITION_STATUS,
  SOCIAL_GROUP_STATUS
} = require("../lib/domain-contract");

function opts(req) {
  return {
    ip: req.ip || "",
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool?.() || null
  };
}

function publicStory(story) {
  if (!story || story.status !== STORY_STATUS.PUBLISHED) return null;
  if (story.visibility && story.visibility !== "public" && story.visibility !== "community") {
    return null;
  }
  return ctx.maskStoryByPrivacy ? ctx.maskStoryByPrivacy(story) : story;
}

function publicVent(vent) {
  if (!vent || vent.status !== VENT_STATUS.PUBLISHED) return null;
  // Public list: public + community (community visible to everyone for feed diversity)
  if (vent.visibility === "private" || vent.visibility === "restricted") return null;
  return {
    id: vent.id,
    title: vent.title,
    body: vent.body,
    status: vent.status,
    publicationIntent: vent.publicationIntent,
    desiredResponse: vent.desiredResponse,
    country: vent.country,
    language: vent.language,
    createdAt: vent.createdAt,
    updatedAt: vent.updatedAt,
    visibility: vent.visibility
  };
}

async function loadCandidatePools(req) {
  const country = ctx.normalizeCountry(req.query.country || ctx.defaultCountry || "global");
  const language = ctx.normalizeLanguage(req.query.language || ctx.defaultLang || "en");

  const [
    storiesRaw,
    ventsRaw,
    newsRaw,
    resourcesRaw,
    opportunitiesRaw,
    topicsRaw,
    petitionsRaw
  ] = await Promise.all([
    ctx.storageGetStories().catch(() => []),
    ctx.storageGetVents().catch(() => []),
    ctx.storageGetNews({ country, limit: 40 }).catch(() => []),
    ctx.storageGetResources().catch(() => []),
    ctx.storageGetOpportunities ? ctx.storageGetOpportunities().catch(() => []) : Promise.resolve([]),
    ctx.storageGetForumTopics(country).catch(() => []),
    ctx.storageGetPetitions ? ctx.storageGetPetitions().catch(() => []) : Promise.resolve([])
  ]);

  let groups = [];
  try {
    const social = require("../lib/social");
    if (typeof social.listGroups === "function") {
      const listed = await social.listGroups(
        { status: SOCIAL_GROUP_STATUS.OPEN },
        opts(req)
      );
      groups = Array.isArray(listed) ? listed : listed?.groups || [];
    }
  } catch (_e) {
    groups = [];
  }

  const stories = (storiesRaw || [])
    .map(publicStory)
    .filter(Boolean)
    .filter((s) => country === "global" || s.country === country || s.country === "global")
    .slice(0, 50);

  const vents = (ventsRaw || [])
    .map(publicVent)
    .filter(Boolean)
    .filter((v) => country === "global" || v.country === country || v.country === "global")
    .slice(0, 40);

  const news = (newsRaw || [])
    .filter((n) => !n.status || n.status === NEWS_STATUS.PUBLISHED)
    .slice(0, 40);

  const resources = (resourcesRaw || [])
    .filter((r) => !r.status || r.status === RESOURCE_STATUS.PUBLISHED)
    .slice(0, 40);

  const opportunities = (opportunitiesRaw || [])
    .filter((o) => !o.status || o.status === OPPORTUNITY_STATUS.OPEN)
    .slice(0, 40);

  const topics = (topicsRaw || [])
    .filter(
      (t) =>
        !t.status ||
        t.status === DISCUSSION_TOPIC_STATUS.PUBLISHED ||
        t.status === "open" ||
        t.status === "published"
    )
    .slice(0, 30);

  const petitions = (petitionsRaw || [])
    .filter((p) => !p.status || p.status === PETITION_STATUS.OPEN)
    .slice(0, 20);

  return {
    stories,
    vents,
    news,
    resources,
    opportunities,
    topics,
    groups: Array.isArray(groups) ? groups.slice(0, 30) : [],
    petitions,
    country,
    language
  };
}

// ── GET /api/me/intent ──────────────────────────────────────────────────────

router.get("/me/intent", async (req, res) => {
  try {
    const userId = req.user?.id || null;
    // Optional query override for anonymous browsing (not persisted)
    const qIntent = req.query.intent ? String(req.query.intent).trim() : null;
    const state = await personalization.getUserIntent(userId, {
      ...opts(req),
      anonOverrides: qIntent ? { primaryIntent: qIntent } : {}
    });

    res.json({
      ok: true,
      intent: {
        primaryIntent: state.primaryIntent,
        secondaryIntents: state.secondaryIntents || [],
        prefs: state.prefs || {},
        source: state.source,
        updatedAt: state.updatedAt,
        anonymous: Boolean(state.anonymous)
      },
      available: personalization.listIntents(),
      policy: {
        actionRecommendations: personalization.allowsActionRecommendations(state.primaryIntent),
        supportFirst: Boolean(
          (personalization.getIntentMeta(state.primaryIntent) || {}).supportFirst
        ),
        note:
          "You can change intent anytime. Expression and support content stay first-class; action recommendations only appear when relevant."
      }
    });
  } catch (err) {
    req.log?.error?.({ err: err.message }, "intent_get_failed");
    res.status(500).json({ message: "Failed to load intent" });
  }
});

// ── PATCH /api/me/intent ────────────────────────────────────────────────────

router.patch("/me/intent", requireAuth, async (req, res) => {
  try {
    const result = await personalization.setUserIntent(req.user.id, req.body || {}, opts(req));
    if (!result.ok) {
      if (result.reason === "invalid_intent") {
        res.status(422).json({
          message: "Invalid intent",
          reason: result.reason,
          field: result.field,
          available: personalization.listIntents().map((i) => i.id)
        });
        return;
      }
      if (result.reason === "empty_patch") {
        res.status(422).json({ message: "No intent fields to update", reason: result.reason });
        return;
      }
      res.status(422).json({ message: "Validation failed", reason: result.reason });
      return;
    }

    // Optional analytics (no PII)
    await personalization.recordFeedEvent(
      {
        userId: req.user.id,
        eventType: "intent_change",
        itemType: "",
        itemId: "",
        intentAtTime: result.state.primaryIntent,
        metadata: { source: "patch" }
      },
      opts(req)
    );

    res.json({
      ok: true,
      intent: {
        primaryIntent: result.state.primaryIntent,
        secondaryIntents: result.state.secondaryIntents,
        prefs: result.state.prefs,
        source: result.state.source,
        updatedAt: result.state.updatedAt,
        anonymous: false
      },
      available: personalization.listIntents()
    });
  } catch (err) {
    req.log?.error?.({ err: err.message }, "intent_patch_failed");
    res.status(500).json({ message: "Failed to update intent" });
  }
});

// Also accept POST for clients that struggle with PATCH
router.post("/me/intent", requireAuth, async (req, res, next) => {
  req.method = "PATCH";
  // Re-use patch handler by calling next isn't clean — inline delegate:
  try {
    const result = await personalization.setUserIntent(req.user.id, req.body || {}, opts(req));
    if (!result.ok) {
      res.status(422).json({ message: "Validation failed", reason: result.reason, field: result.field });
      return;
    }
    res.json({
      ok: true,
      intent: {
        primaryIntent: result.state.primaryIntent,
        secondaryIntents: result.state.secondaryIntents,
        prefs: result.state.prefs,
        source: result.state.source,
        updatedAt: result.state.updatedAt,
        anonymous: false
      },
      available: personalization.listIntents()
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/feed ───────────────────────────────────────────────────────────

router.get("/feed", async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const qIntent = req.query.intent ? String(req.query.intent).trim() : null;
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 80);

    let intentState = await personalization.getUserIntent(userId, {
      ...opts(req),
      anonOverrides: qIntent && !userId ? { primaryIntent: qIntent } : {}
    });

    // Authenticated users may preview another intent via query without saving
    if (userId && qIntent && personalization.isValidIntent(qIntent)) {
      intentState = {
        ...intentState,
        primaryIntent: qIntent,
        source: intentState.source || "explicit"
      };
    }

    // Merge optional profession/region query into prefs for ranking (not persisted)
    const rankPrefs = { ...intentState.prefs };
    if (req.query.profession) {
      rankPrefs.profession = ctx.sanitizeText(String(req.query.profession)).slice(0, 80);
    }
    if (req.query.region || req.query.country) {
      rankPrefs.region = ctx.normalizeCountry(req.query.region || req.query.country);
    }

    const pools = await loadCandidatePools(req);
    const feed = personalization.buildPersonalizedFeed(
      pools,
      { ...intentState, prefs: rankPrefs },
      { limit }
    );

    res.json({
      ok: true,
      ...feed,
      filters: {
        country: pools.country,
        language: pools.language,
        limit
      }
    });
  } catch (err) {
    req.log?.error?.({ err: err.message }, "feed_get_failed");
    res.status(500).json({ message: "Failed to build feed" });
  }
});

module.exports = router;
