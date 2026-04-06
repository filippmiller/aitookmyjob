const { parseCookies, isAccountBanned, clearAuthCookie, storageGetUserById, storageGetIdentityByUserId, hasAdminToken, hasModeratorRole } = require("../lib/context");
const jwt = require("jsonwebtoken");

const AUTH_SECRET = process.env.AUTH_SECRET || "change-me-auth-secret";

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

module.exports = { authMiddleware, requireAuth, requireVerifiedPhone, requireAdminOrToken };
