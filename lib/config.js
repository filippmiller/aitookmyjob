// Re-export configuration constants from context.js
// This module provides a focused interface for config values only.
const ctx = require("./context");

module.exports = {
  // Environment & secrets
  ADMIN_TOKEN: ctx.ADMIN_TOKEN,
  AUTH_SECRET: ctx.AUTH_SECRET,
  ALLOW_DEV_OTP: ctx.ALLOW_DEV_OTP,
  TELEGRAM_BOT_TOKEN: ctx.TELEGRAM_BOT_TOKEN,
  TELEGRAM_MOD_CHAT_ID: ctx.TELEGRAM_MOD_CHAT_ID,
  TELEGRAM_WEBHOOK_SECRET: ctx.TELEGRAM_WEBHOOK_SECRET,
  REQUIRE_CAPTCHA: ctx.REQUIRE_CAPTCHA,
  isProduction: ctx.isProduction,
  SESSION_TTL_HOURS: ctx.SESSION_TTL_HOURS,
  defaultCountry: ctx.defaultCountry,
  defaultLang: ctx.defaultLang,
  usePostgres: ctx.usePostgres,

  // Paths
  publicDir: ctx.publicDir,
  dataDir: ctx.dataDir,
  storiesPath: ctx.storiesPath,
  usersPath: ctx.usersPath,
  forumTopicsPath: ctx.forumTopicsPath,
  forumRepliesPath: ctx.forumRepliesPath,
  sanctionsPath: ctx.sanctionsPath,
  auditLogPath: ctx.auditLogPath,
  authIdentitiesPath: ctx.authIdentitiesPath,
  takedownsPath: ctx.takedownsPath,
  companyBoardsPath: ctx.companyBoardsPath,
  petitionsPath: ctx.petitionsPath,
  cohortsPath: ctx.cohortsPath,
  anonymousInboxPath: ctx.anonymousInboxPath,
  subscribersPath: ctx.subscribersPath,

  // Reference data
  languages: ctx.languages,
  countries: ctx.countries,
  roles: ctx.roles,
  forumCategories: ctx.forumCategories,
  seedForumTopics: ctx.seedForumTopics,
  defaultResources: ctx.defaultResources,
  defaultNews: ctx.defaultNews,
  defaultCompanyBoards: ctx.defaultCompanyBoards,
  defaultPetitions: ctx.defaultPetitions,
  defaultCohorts: ctx.defaultCohorts,

  // ID generators
  storyId: ctx.storyId,
  userId: ctx.userId,
  topicId: ctx.topicId,
  replyId: ctx.replyId,
  sanctionId: ctx.sanctionId,
  auditId: ctx.auditId,
  phoneOtpCode: ctx.phoneOtpCode,
  linkCodeId: ctx.linkCodeId,
};
