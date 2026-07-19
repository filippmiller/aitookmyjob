/**
 * Search, entity discovery pages, and saved searches API.
 *
 * GET  /api/search
 * GET  /api/entities/:type/:slug
 * GET  /api/saved-searches
 * POST /api/saved-searches
 * GET  /api/saved-searches/:id
 * PATCH /api/saved-searches/:id
 * DELETE /api/saved-searches/:id
 * POST /api/saved-searches/:id/notify
 *
 * Bead: aitj-z8q.17
 */

"use strict";

const express = require("express");
const router = express.Router();
const ctx = require("../lib/context");
const searchLib = require("../lib/search");
const { requireAuth } = require("../middleware/auth");

function storageOptions(extra = {}) {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool?.() || null,
    useMemory: !ctx.usePostgres,
    ctx,
    ...extra
  };
}

function sanitizeFilters(query = {}) {
  return {
    country: ctx.normalizeCountry(query.country || "global"),
    company: ctx.sanitizeText(query.company || ""),
    profession: ctx.sanitizeText(query.profession || ""),
    q: ctx.sanitizeText(query.q || query.query || ""),
    types: query.types || query.type || undefined,
    limit: query.limit,
    offset: query.offset
  };
}

// ── Unified search ──────────────────────────────────────────────────────────

router.get("/api/search", async (req, res) => {
  try {
    const filters = sanitizeFilters(req.query);
    const result = await searchLib.search(
      {
        q: filters.q,
        types: filters.types,
        limit: filters.limit,
        offset: filters.offset,
        country: filters.country,
        company: filters.company,
        profession: filters.profession,
        viewerId: req.user?.id || null,
        includeCommunity: Boolean(req.user)
      },
      storageOptions()
    );
    res.json(result);
  } catch (err) {
    console.error("search failed:", err);
    res.status(500).json({ message: "Search failed", requestId: req.id });
  }
});

// ── Entity pages (company / profession / region) ────────────────────────────

router.get("/api/entities/:type/:slug", async (req, res) => {
  try {
    const type = ctx.sanitizeText(req.params.type || "").toLowerCase();
    const slug = ctx.sanitizeText(req.params.slug || "");
    if (!searchLib.ENTITY_PAGE_TYPES.includes(type)) {
      res.status(400).json({
        message: "Invalid entity type",
        allowed: searchLib.ENTITY_PAGE_TYPES
      });
      return;
    }
    const page = await searchLib.getEntityPage(
      type,
      slug,
      {
        country: ctx.normalizeCountry(req.query.country || "global"),
        q: ctx.sanitizeText(req.query.q || req.query.query || ""),
        limit: req.query.limit,
        offset: req.query.offset,
        includeCommunity: Boolean(req.user)
      },
      storageOptions()
    );
    if (!page.ok && page.reason === "invalid_entity") {
      res.status(400).json({ message: "Invalid entity" });
      return;
    }
    res.json(page);
  } catch (err) {
    console.error("entity page failed:", err);
    res.status(500).json({ message: "Failed to load entity", requestId: req.id });
  }
});

// ── Saved searches CRUD ─────────────────────────────────────────────────────

router.get("/api/saved-searches", requireAuth, async (req, res) => {
  try {
    const items = await searchLib.listSavedSearches(req.user.id, storageOptions());
    res.json({ savedSearches: items, total: items.length });
  } catch (err) {
    console.error("list saved searches failed:", err);
    res.status(500).json({ message: "Failed to list saved searches" });
  }
});

router.post("/api/saved-searches", requireAuth, async (req, res) => {
  try {
    if (ctx.isAccountMuted?.(req.user)) {
      res.status(403).json({ message: "Account is muted" });
      return;
    }
    const body = req.body || {};
    const result = await searchLib.createSavedSearch(
      {
        userId: req.user.id,
        name: ctx.sanitizeText(body.name || ""),
        query: ctx.sanitizeText(body.query || body.q || ""),
        types: body.types,
        filters: body.filters,
        country: body.country,
        company: body.company,
        profession: body.profession,
        notify: Boolean(body.notify),
        notifyChannel: body.notifyChannel
      },
      storageOptions()
    );
    if (!result.ok) {
      res.status(400).json({ message: result.reason || "Could not save search" });
      return;
    }

    // If notify requested at create, enqueue stub job
    if (result.savedSearch.notify) {
      const enq = await searchLib.enableSavedSearchNotifications(
        result.savedSearch.id,
        req.user.id,
        storageOptions({ jobs: require("../lib/jobs") })
      );
      res.status(201).json({
        savedSearch: enq.savedSearch || result.savedSearch,
        jobId: enq.jobId || null
      });
      return;
    }

    res.status(201).json({ savedSearch: result.savedSearch });
  } catch (err) {
    console.error("create saved search failed:", err);
    res.status(500).json({ message: "Failed to save search" });
  }
});

router.get("/api/saved-searches/:id", requireAuth, async (req, res) => {
  try {
    const item = await searchLib.getSavedSearch(
      ctx.sanitizeText(req.params.id),
      req.user.id,
      storageOptions()
    );
    if (!item) {
      res.status(404).json({ message: "Saved search not found" });
      return;
    }
    res.json({ savedSearch: item });
  } catch (err) {
    console.error("get saved search failed:", err);
    res.status(500).json({ message: "Failed to load saved search" });
  }
});

router.patch("/api/saved-searches/:id", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await searchLib.updateSavedSearch(
      ctx.sanitizeText(req.params.id),
      req.user.id,
      {
        name: body.name != null ? ctx.sanitizeText(body.name) : undefined,
        query: body.query != null || body.q != null
          ? ctx.sanitizeText(body.query ?? body.q)
          : undefined,
        types: body.types,
        filters: body.filters,
        country: body.country,
        company: body.company,
        profession: body.profession,
        notify: body.notify,
        notifyChannel: body.notifyChannel,
        status: body.status
      },
      storageOptions()
    );
    if (!result.ok) {
      res.status(result.reason === "not_found" ? 404 : 400).json({
        message: result.reason === "not_found" ? "Saved search not found" : "Update failed"
      });
      return;
    }
    res.json({ savedSearch: result.savedSearch });
  } catch (err) {
    console.error("update saved search failed:", err);
    res.status(500).json({ message: "Failed to update saved search" });
  }
});

router.delete("/api/saved-searches/:id", requireAuth, async (req, res) => {
  try {
    const result = await searchLib.deleteSavedSearch(
      ctx.sanitizeText(req.params.id),
      req.user.id,
      storageOptions()
    );
    if (!result.ok) {
      res.status(404).json({ message: "Saved search not found" });
      return;
    }
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error("delete saved search failed:", err);
    res.status(500).json({ message: "Failed to delete saved search" });
  }
});

/**
 * Enable (or re-trigger) notifications for a saved search.
 * Enqueues search.notify job stub.
 */
router.post("/api/saved-searches/:id/notify", requireAuth, async (req, res) => {
  try {
    const result = await searchLib.enableSavedSearchNotifications(
      ctx.sanitizeText(req.params.id),
      req.user.id,
      storageOptions({ jobs: require("../lib/jobs") })
    );
    if (!result.ok) {
      res.status(result.reason === "not_found" ? 404 : 400).json({
        message: result.reason === "not_found" ? "Saved search not found" : "Could not enable notifications"
      });
      return;
    }
    res.json({
      savedSearch: result.savedSearch,
      jobId: result.jobId,
      enqueued: result.enqueued,
      note: "Notification job stub enqueued; delivery will run when worker processes search.notify"
    });
  } catch (err) {
    console.error("saved search notify failed:", err);
    res.status(500).json({ message: "Failed to enable notifications" });
  }
});

module.exports = router;
