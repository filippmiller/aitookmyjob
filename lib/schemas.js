// Re-export Zod validation schemas from context.js
// This module provides a focused interface for input validation only.
const ctx = require("./context");

module.exports = {
  storySchema: ctx.storySchema,
  registerSchema: ctx.registerSchema,
  loginSchema: ctx.loginSchema,
  phoneStartSchema: ctx.phoneStartSchema,
  phoneVerifySchema: ctx.phoneVerifySchema,
  forumTopicSchema: ctx.forumTopicSchema,
  forumReplySchema: ctx.forumReplySchema,
  moderationActionSchema: ctx.moderationActionSchema,
  sanctionSchema: ctx.sanctionSchema,
  telegramWebhookSchema: ctx.telegramWebhookSchema,
  digestEmailSchema: ctx.digestEmailSchema,
};
