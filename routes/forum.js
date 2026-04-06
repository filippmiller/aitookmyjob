const express = require("express");
const router = express.Router();
const { requireAuth, requireVerifiedPhone } = require("../middleware/auth");
const ctx = require("../lib/context");

router.get("/categories", (_req, res) => {
  res.json({ categories: ctx.forumCategories });
});

router.get("/topics", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const topics = await ctx.storageGetForumTopics(country);
  res.json({
    country,
    topics: topics.map((t) => ({
      id: t.id, categoryId: t.categoryId, title: t.title,
      replies: Number(t.replies || 0), lastUpdate: t.lastUpdate
    }))
  });
});

router.post("/topics", requireAuth, requireVerifiedPhone, async (req, res) => {
  if (ctx.isAccountMuted(req.user)) { res.status(403).json({ message: "Account temporarily muted" }); return; }
  const payload = {
    country: ctx.normalizeCountry(req.body.country || ctx.defaultCountry),
    language: ctx.normalizeLanguage(req.body.language || ctx.defaultLang),
    categoryId: ctx.sanitizeText(req.body.categoryId),
    title: ctx.sanitizeText(req.body.title),
    body: ctx.sanitizeText(req.body.body)
  };
  const parsed = ctx.forumTopicSchema.safeParse(payload);
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
  if (!ctx.forumCategories.some((c) => c.id === parsed.data.categoryId)) { res.status(422).json({ message: "Unknown category" }); return; }
  const topic = {
    id: ctx.topicId(), categoryId: parsed.data.categoryId,
    title: parsed.data.title, body: parsed.data.body,
    country: parsed.data.country, language: parsed.data.language,
    status: "published", createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  await ctx.storageInsertForumTopic(topic);
  await ctx.storageAudit({ action: "forum.topic.create", actorId: req.user.id, targetType: "forum_topic", targetId: topic.id, metadata: { categoryId: topic.categoryId }, ip: req.ip });
  res.status(201).json({ id: topic.id, status: topic.status });
});

router.post("/topics/:id/replies", requireAuth, async (req, res) => {
  if (ctx.isAccountMuted(req.user)) { res.status(403).json({ message: "Account temporarily muted" }); return; }
  const topic = (await ctx.storageGetForumTopics(null)).find((t) => t.id === req.params.id);
  if (!topic) { res.status(404).json({ message: "Topic not found" }); return; }
  const payload = {
    country: ctx.normalizeCountry(req.body.country || topic.country || ctx.defaultCountry),
    language: ctx.normalizeLanguage(req.body.language || topic.language || ctx.defaultLang),
    body: ctx.sanitizeText(req.body.body)
  };
  const parsed = ctx.forumReplySchema.safeParse(payload);
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
  const reply = {
    id: ctx.replyId(), topicId: topic.id, body: parsed.data.body,
    country: parsed.data.country, language: parsed.data.language,
    status: "published", createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  await ctx.storageInsertForumReply(reply);
  await ctx.storageAudit({ action: "forum.reply.create", actorId: req.user.id, targetType: "forum_reply", targetId: reply.id, metadata: { topicId: topic.id }, ip: req.ip });
  res.status(201).json({ id: reply.id, topicId: topic.id });
});

router.get("/topics/:id", async (req, res) => {
  const tid = ctx.sanitizeText(req.params.id);
  const topics = await ctx.storageGetForumTopics(null);
  const topic = topics.find(t => t.id === tid);
  if (!topic) { res.status(404).json({ message: "Topic not found" }); return; }
  const replies = await ctx.storageGetForumReplies(tid);
  res.json({
    ...topic,
    replies: replies.map(reply => ({
      id: reply.id, body: reply.body, author: reply.createdBy,
      createdAt: reply.createdAt, likes: reply.likes || 0
    }))
  });
});

router.put("/topics/:id", requireAuth, async (req, res) => {
  const tid = ctx.sanitizeText(req.params.id);
  const topics = await ctx.storageGetForumTopics(null);
  const topicIndex = topics.findIndex(t => t.id === tid);
  if (topicIndex === -1) { res.status(404).json({ message: "Topic not found" }); return; }
  if (topics[topicIndex].createdBy !== req.user.id && !ctx.hasModeratorRole(req.user)) { res.status(403).json({ message: "Not authorized to edit this topic" }); return; }
  const updates = {
    title: ctx.sanitizeText(req.body.title) || topics[topicIndex].title,
    body: ctx.sanitizeText(req.body.body) || topics[topicIndex].body,
    categoryId: ctx.sanitizeText(req.body.categoryId) || topics[topicIndex].categoryId,
    updatedAt: new Date().toISOString()
  };
  topics[topicIndex] = { ...topics[topicIndex], ...updates };
  if (ctx.usePostgres) {
    const pool = ctx.getPgPool();
    await pool.query("UPDATE forum_topics SET title = $1, body = $2, category_id = $3, updated_at = $4 WHERE id = $5", [updates.title, updates.body, updates.categoryId, updates.updatedAt, tid]);
  } else {
    ctx.writeJsonArray(ctx.forumTopicsPath, topics);
  }
  await ctx.storageAudit({ action: "forum.topic.update", actorId: req.user.id, targetType: "forum_topic", targetId: tid, metadata: { updates }, ip: req.ip });
  res.json({ ...topics[topicIndex] });
});

router.delete("/topics/:id", requireAuth, async (req, res) => {
  const tid = ctx.sanitizeText(req.params.id);
  const topics = await ctx.storageGetForumTopics(null);
  const topicIndex = topics.findIndex(t => t.id === tid);
  if (topicIndex === -1) { res.status(404).json({ message: "Topic not found" }); return; }
  if (topics[topicIndex].createdBy !== req.user.id && !ctx.hasModeratorRole(req.user)) { res.status(403).json({ message: "Not authorized to delete this topic" }); return; }
  topics.splice(topicIndex, 1);
  if (ctx.usePostgres) {
    const pool = ctx.getPgPool();
    await pool.query("DELETE FROM forum_topics WHERE id = $1", [tid]);
    await pool.query("DELETE FROM forum_posts WHERE topic_id = $1", [tid]);
  } else {
    ctx.writeJsonArray(ctx.forumTopicsPath, topics);
    const replies = ctx.readJsonArray(ctx.forumRepliesPath);
    ctx.writeJsonArray(ctx.forumRepliesPath, replies.filter(r => r.topicId !== tid));
  }
  await ctx.storageAudit({ action: "forum.topic.delete", actorId: req.user.id, targetType: "forum_topic", targetId: tid, ip: req.ip });
  res.json({ message: "Topic deleted successfully" });
});

router.post("/topics/:id/like", requireAuth, async (req, res) => {
  const tid = ctx.sanitizeText(req.params.id);
  res.json({ message: "Topic liked", topicId: tid });
});

router.get("/recent-activity", async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  const topics = await ctx.storageGetForumTopics(null);
  const replies = await ctx.storageGetForumReplies(null);
  const activities = [
    ...topics.map(t => ({ ...t, type: 'topic' })),
    ...replies.map(r => ({ ...r, type: 'reply' }))
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(offset, offset + limit);
  res.json({ activities, total: topics.length + replies.length });
});

module.exports = router;
