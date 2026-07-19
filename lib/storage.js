// Re-export storage functions from context.js
// This module provides a focused interface for data persistence only.
const ctx = require("./context");

module.exports = {
  // Lifecycle
  buildPgPool: ctx.buildPgPool,
  initStorage: ctx.initStorage,
  getPgPool: ctx.getPgPool,
  setPgPool: ctx.setPgPool,
  getSchemaVersion: ctx.getSchemaVersion,
  usePostgres: ctx.usePostgres,
  assertJsonFallbackAllowed: ctx.assertJsonFallbackAllowed,

  // File I/O (low-level — JSON fallback only when !DATABASE_URL)
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
  storageUpdateForumTopic: ctx.storageUpdateForumTopic,
  storageDeleteForumTopic: ctx.storageDeleteForumTopic,

  // Moderation
  storageGetModerationQueue: ctx.storageGetModerationQueue,
  storageModerationAction: ctx.storageModerationAction,

  // Sanctions & Audit
  storageInsertSanction: ctx.storageInsertSanction,
  storageAudit: ctx.storageAudit,
  storageGetAuditRange: ctx.storageGetAuditRange,

  // Transparency
  storageInsertTransparencyEvent: ctx.storageInsertTransparencyEvent,

  // News
  storageGetNews: ctx.storageGetNews,
  storageUpsertNewsItems: ctx.storageUpsertNewsItems,

  // Petitions & polls
  storageGetPetitions: ctx.storageGetPetitions,
  storageCreatePetition: ctx.storageCreatePetition,
  storageSignPetition: ctx.storageSignPetition,
  storageGetBoundaryPollResults: ctx.storageGetBoundaryPollResults,
  storageUpsertBoundaryPollVote: ctx.storageUpsertBoundaryPollVote,

  // Remaining write entities (aitj-z8q.3) + catalog (aitj-z8q.12)
  storageGetResources: ctx.storageGetResources,
  storageGetResourceById: ctx.storageGetResourceById,
  storageUpsertResource: ctx.storageUpsertResource,
  storageDeleteResource: ctx.storageDeleteResource,
  storageUpdateResourceLinkCheck: ctx.storageUpdateResourceLinkCheck,
  storageGetOpportunities: ctx.storageGetOpportunities,
  storageGetOpportunityById: ctx.storageGetOpportunityById,
  storageUpsertOpportunity: ctx.storageUpsertOpportunity,
  storageDeleteOpportunity: ctx.storageDeleteOpportunity,
  storageSaveResource: ctx.storageSaveResource,
  storageUnsaveResource: ctx.storageUnsaveResource,
  storageGetSavedResources: ctx.storageGetSavedResources,
  storageUpsertResourceReview: ctx.storageUpsertResourceReview,
  storageGetResourceReviews: ctx.storageGetResourceReviews,
  storageInsertResourceReport: ctx.storageInsertResourceReport,
  storageGetResourceReports: ctx.storageGetResourceReports,
  storageResolveResourceReport: ctx.storageResolveResourceReport,
  storageGetCohorts: ctx.storageGetCohorts,
  storageInsertCohort: ctx.storageInsertCohort,
  storageGetCompanyBoards: ctx.storageGetCompanyBoards,
  storageInsertCompanyBoard: ctx.storageInsertCompanyBoard,
  storageGetAnonymousInbox: ctx.storageGetAnonymousInbox,
  storageInsertAnonymousInbox: ctx.storageInsertAnonymousInbox,
  storageGetTakedowns: ctx.storageGetTakedowns,
  storageInsertTakedown: ctx.storageInsertTakedown,
  storageGetSubscribers: ctx.storageGetSubscribers,
  storageCountSubscribers: ctx.storageCountSubscribers,
  storageInsertSubscriber: ctx.storageInsertSubscriber,
};
