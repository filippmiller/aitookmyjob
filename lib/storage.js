// Re-export storage functions from context.js
// This module provides a focused interface for data persistence only.
const ctx = require("./context");

module.exports = {
  // Lifecycle
  buildPgPool: ctx.buildPgPool,
  initStorage: ctx.initStorage,
  getPgPool: ctx.getPgPool,
  setPgPool: ctx.setPgPool,

  // File I/O (low-level)
  readJsonArray: ctx.readJsonArray,
  writeJsonArray: ctx.writeJsonArray,
  lockedJsonUpdate: ctx.lockedJsonUpdate,
  readStories: ctx.readStories,
  writeStories: ctx.writeStories,
  readResources: ctx.readResources,
  readNews: ctx.readNews,
  readCompanyBoards: ctx.readCompanyBoards,
  readPetitions: ctx.readPetitions,
  readCohorts: ctx.readCohorts,
  readAnonymousInbox: ctx.readAnonymousInbox,

  // Stories
  storageGetStories: ctx.storageGetStories,
  storageInsertStory: ctx.storageInsertStory,
  storagePatchStory: ctx.storagePatchStory,
  storageInsertStoryVersion: ctx.storageInsertStoryVersion,

  // Users
  storageGetUsers: ctx.storageGetUsers,
  storageGetUserByEmail: ctx.storageGetUserByEmail,
  storageGetUserById: ctx.storageGetUserById,
  storageInsertUser: ctx.storageInsertUser,
  storageUpdateUserSanction: ctx.storageUpdateUserSanction,
  storageDeleteUser: ctx.storageDeleteUser,

  // Auth identities
  storageGetIdentityByUserId: ctx.storageGetIdentityByUserId,
  storageUpsertIdentity: ctx.storageUpsertIdentity,

  // Telegram
  storageCreateOrUpdateTelegramLink: ctx.storageCreateOrUpdateTelegramLink,
  storageGetTelegramLinkByUserId: ctx.storageGetTelegramLinkByUserId,

  // Forum
  storageGetForumTopics: ctx.storageGetForumTopics,
  storageGetForumReplies: ctx.storageGetForumReplies,
  storageInsertForumTopic: ctx.storageInsertForumTopic,
  storageInsertForumReply: ctx.storageInsertForumReply,

  // Moderation
  storageGetModerationQueue: ctx.storageGetModerationQueue,
  storageModerationAction: ctx.storageModerationAction,

  // Sanctions & Audit
  storageInsertSanction: ctx.storageInsertSanction,
  storageAudit: ctx.storageAudit,
  storageGetAuditRange: ctx.storageGetAuditRange,

  // Transparency
  storageInsertTransparencyEvent: ctx.storageInsertTransparencyEvent,
};
