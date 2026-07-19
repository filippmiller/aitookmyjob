const {
  parseCookies,
  isAccountBanned,
  clearAuthCookie,
  storageGetUserById,
  storageGetIdentityByUserId,
  hasAdminToken,
  hasModeratorRole,
  hasTrustedCuratorRole
} = require("../lib/context");
const jwt = require("jsonwebtoken");

const AUTH_SECRET = process.env.AUTH_SECRET || "change-me-auth-secret";

const ROLE_RANK = Object.freeze({
  user: 0,
  expert: 1,
  community_lead: 1,
  journalist: 1,
  data_analyst: 1,
  moderator: 2,
  admin: 3,
  superadmin: 4
});

function roleRank(role) {
  return ROLE_RANK[String(role || "")] ?? -1;
}

function hasAdminRole(user) {
  return roleRank(user?.role) >= ROLE_RANK.admin;
}

function hasSuperadminRole(user) {
  return String(user?.role || "") === "superadmin";
}

/** Admin API token is treated as superadmin-equivalent for automation. */
function isStaffToken(req) {
  return hasAdminToken(req);
}

function effectiveRole(req) {
  if (isStaffToken(req)) return "superadmin";
  return req.user?.role || null;
}

async function authMiddleware(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies.auth_token;
  if (!token) {
    req.user = null;
    next();
    return;
  }
  try {
    const decoded = jwt.verify(token, AUTH_SECRET);
    const user = await storageGetUserById(decoded.sub);
    if (!user || isAccountBanned(user)) {
      clearAuthCookie(res);
      req.user = null;
      next();
      return;
    }
    req.user = user;
    next();
  } catch (_error) {
    clearAuthCookie(res);
    req.user = null;
    next();
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  next();
}

async function requireVerifiedPhone(req, res, next) {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const identity = await storageGetIdentityByUserId(req.user.id);
  if (!identity || !identity.phoneVerified) {
    res.status(403).json({ message: "Phone verification required" });
    return;
  }
  req.identity = identity;
  next();
}

function requireAdminOrToken(req, res, next) {
  if (hasAdminToken(req) || hasModeratorRole(req.user)) {
    next();
    return;
  }
  res.status(401).json({ message: "Unauthorized" });
}

/** Moderator+ or admin token. */
function requireModerator(req, res, next) {
  if (hasAdminToken(req) || hasModeratorRole(req.user)) {
    next();
    return;
  }
  res.status(403).json({ message: "Moderator role required" });
}

/** Admin / superadmin role or admin token. */
function requireAdminRole(req, res, next) {
  if (hasAdminToken(req) || hasAdminRole(req.user)) {
    next();
    return;
  }
  res.status(403).json({ message: "Admin role required" });
}

/** Superadmin role or admin token. */
function requireSuperadmin(req, res, next) {
  if (hasAdminToken(req) || hasSuperadminRole(req.user)) {
    next();
    return;
  }
  res.status(403).json({ message: "Superadmin role required" });
}

/**
 * Require minimum role rank. Admin token always passes.
 * @param {"moderator"|"admin"|"superadmin"} minRole
 */
function requireMinRole(minRole) {
  const needed = ROLE_RANK[minRole] ?? 99;
  return function requireMinRoleMiddleware(req, res, next) {
    if (hasAdminToken(req)) {
      next();
      return;
    }
    if (roleRank(req.user?.role) >= needed) {
      next();
      return;
    }
    res.status(403).json({
      message: `${minRole} role required`,
      code: "RBAC_DENIED"
    });
  };
}

/**
 * Destructive actions must send `{ confirm: true }` in the JSON body.
 * Use on DELETE-equivalent POSTs (bans, role elevates, hard deletes, completed takedowns).
 */
function requireConfirm(req, res, next) {
  if (req.body && req.body.confirm === true) {
    next();
    return;
  }
  res.status(422).json({
    message: "Destructive action requires confirm: true",
    code: "CONFIRM_REQUIRED"
  });
}

/**
 * Factory: whether actor may assign `targetRole`.
 * - superadmin / token: any role
 * - admin: any role except admin/superadmin
 * - others: no
 */
function canAssignRole(actorReq, targetRole) {
  if (hasAdminToken(actorReq)) return true;
  const actorRole = actorReq.user?.role;
  if (hasSuperadminRole(actorReq.user)) return true;
  if (hasAdminRole(actorReq.user)) {
    return !["admin", "superadmin"].includes(String(targetRole));
  }
  return false;
}

module.exports = {
  authMiddleware,
  requireAuth,
  requireVerifiedPhone,
  requireAdminOrToken,
  requireModerator,
  requireAdminRole,
  requireSuperadmin,
  requireMinRole,
  requireConfirm,
  hasAdminRole,
  hasSuperadminRole,
  hasModeratorRole,
  hasTrustedCuratorRole,
  hasAdminToken,
  isStaffToken,
  effectiveRole,
  canAssignRole,
  roleRank,
  ROLE_RANK
};
