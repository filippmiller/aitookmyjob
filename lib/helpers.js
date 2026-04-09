// Re-export helper/utility functions from context.js
// This module provides a focused interface for shared logic only.
const ctx = require("./context");

module.exports = {
  // Normalization
  normalizeCountry: ctx.normalizeCountry,
  normalizeLanguage: ctx.normalizeLanguage,
  normalizeEmail: ctx.normalizeEmail,
  normalizePhone: ctx.normalizePhone,
  sanitizeText: ctx.sanitizeText,

  // Auth helpers
  isAccountBanned: ctx.isAccountBanned,
  isAccountMuted: ctx.isAccountMuted,
  parseCookies: ctx.parseCookies,
  makeSessionToken: ctx.makeSessionToken,
  setAuthCookie: ctx.setAuthCookie,
  clearAuthCookie: ctx.clearAuthCookie,
  hasAdminToken: ctx.hasAdminToken,
  hasModeratorRole: ctx.hasModeratorRole,

  // CSRF
  generateCsrfToken: ctx.generateCsrfToken,
  setCsrfCookie: ctx.setCsrfCookie,
  validateCsrfToken: ctx.validateCsrfToken,

  // Locale
  detectLocale: ctx.detectLocale,

  // Story processing
  maskStoryByPrivacy: ctx.maskStoryByPrivacy,
  scoreModeration: ctx.scoreModeration,
  mapVisibilityToPrivacy: ctx.mapVisibilityToPrivacy,
  computeConfidenceScore: ctx.computeConfidenceScore,
  buildStoryPayload: ctx.buildStoryPayload,
  buildStoryRecord: ctx.buildStoryRecord,
  ensureStoryDefaults: ctx.ensureStoryDefaults,

  // Dashboard & data
  buildCounters: ctx.buildCounters,
  getCrisisResources: ctx.getCrisisResources,
  slugifyCompany: ctx.slugifyCompany,
  getTopCompanies: ctx.getTopCompanies,
  toCompanyProfile: ctx.toCompanyProfile,
  getDashboard: ctx.getDashboard,

  // Telegram
  sendTelegramMessage: ctx.sendTelegramMessage,

  // bcrypt re-export
  bcrypt: ctx.bcrypt,
};
