// Re-export Zod validation schemas from context.js
// This module provides a focused interface for input validation only.
// Domain lifecycle enums / transitions: re-exported from domain-contract (aitj-z8q.1).
const ctx = require("./context");
const domainContract = require("./domain-contract");

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

  // Domain contract (canonical statuses — do not invent free-form status strings)
  domainContract,
  DOMAIN_CONTRACT_VERSION: domainContract.DOMAIN_CONTRACT_VERSION,
  STORY_STATUS: domainContract.STORY_STATUS,
  ENTITY: domainContract.ENTITY,
  assertValidStatus: domainContract.assertValidStatus,
  canTransition: domainContract.canTransition,
  LEGACY_STORY_STATUSES: domainContract.LEGACY_STORY_STATUSES,
  LEGACY_GAPS: domainContract.LEGACY_GAPS,
  outcomeFromFoundNewJob: domainContract.outcomeFromFoundNewJob,
  moderationActionToContentStatus: domainContract.moderationActionToContentStatus
};
