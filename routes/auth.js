const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const ctx = require("../lib/context");

const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const phoneLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false });

router.post("/register", authLimiter, async (req, res) => {
  const payload = {
    email: ctx.normalizeEmail(req.body.email),
    password: String(req.body.password || ""),
    phone: req.body.phone ? ctx.normalizePhone(req.body.phone) : undefined
  };
  const parsed = ctx.registerSchema.safeParse(payload);
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
  const email = parsed.data.email;
  const existing = await ctx.storageGetUserByEmail(email);
  if (existing) { res.status(409).json({ message: "Email already registered" }); return; }
  const passwordHash = await ctx.bcrypt.hash(parsed.data.password, 12);
  const newUser = {
    id: ctx.userId(), email,
    phone: parsed.data.phone ? ctx.normalizePhone(parsed.data.phone) : null,
    role: "user", passwordHash,
    createdAt: new Date().toISOString(), mutedUntil: null, bannedUntil: null
  };
  await ctx.storageInsertUser(newUser);
  await ctx.storageUpsertIdentity({ userId: newUser.id, emailVerified: true, phone: newUser.phone || null, phoneVerified: false });
  await ctx.storageAudit({ action: "auth.register", actorId: newUser.id, targetType: "user", targetId: newUser.id, metadata: { email }, ip: req.ip });
  const token = ctx.makeSessionToken(newUser);
  ctx.setAuthCookie(res, token);
  res.status(201).json({ id: newUser.id, email: newUser.email, role: newUser.role });
});

router.post("/login", authLimiter, async (req, res) => {
  const payload = { email: ctx.normalizeEmail(req.body.email), password: String(req.body.password || "") };
  const parsed = ctx.loginSchema.safeParse(payload);
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
  const user = await ctx.storageGetUserByEmail(parsed.data.email);
  if (!user) { res.status(401).json({ message: "Invalid credentials" }); return; }
  if (ctx.isAccountBanned(user)) { res.status(403).json({ message: "Account banned" }); return; }
  const ok = await ctx.bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) { res.status(401).json({ message: "Invalid credentials" }); return; }
  const token = ctx.makeSessionToken(user);
  ctx.setAuthCookie(res, token);
  await ctx.storageAudit({ action: "auth.login", actorId: user.id, targetType: "user", targetId: user.id, metadata: {}, ip: req.ip });
  res.json({ id: user.id, email: user.email, role: user.role });
});

router.post("/logout", async (req, res) => {
  if (req.user) {
    await ctx.storageAudit({ action: "auth.logout", actorId: req.user.id, targetType: "user", targetId: req.user.id, metadata: {}, ip: req.ip });
  }
  ctx.clearAuthCookie(res);
  res.json({ ok: true });
});

router.post("/delete-account", requireAuth, async (req, res) => {
  const confirmation = ctx.sanitizeText(req.body.confirmation || "").toUpperCase();
  if (confirmation !== "DELETE") { res.status(422).json({ message: "Set confirmation to DELETE to continue" }); return; }
  await ctx.storageDeleteUser(req.user.id);
  await ctx.storageAudit({ action: "auth.delete_account", actorId: req.user.id, targetType: "user", targetId: req.user.id, metadata: {}, ip: req.ip });
  ctx.clearAuthCookie(res);
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  (async () => {
    if (!req.user) { res.status(401).json({ message: "Not authenticated" }); return; }
    const identity = await ctx.storageGetIdentityByUserId(req.user.id);
    const tg = await ctx.storageGetTelegramLinkByUserId(req.user.id);
    res.json({
      id: req.user.id, email: req.user.email, role: req.user.role,
      muted: ctx.isAccountMuted(req.user), banned: ctx.isAccountBanned(req.user),
      phoneVerified: Boolean(identity?.phoneVerified),
      phone: identity?.phone || req.user.phone || null,
      telegramLinked: Boolean(tg)
    });
  })().catch(() => { res.status(500).json({ message: "Could not fetch session profile" }); });
});

router.post("/phone/start", requireAuth, phoneLimiter, async (req, res) => {
  const parsed = ctx.phoneStartSchema.safeParse({ phone: ctx.normalizePhone(req.body.phone) });
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
  const identity = (await ctx.storageGetIdentityByUserId(req.user.id)) || { userId: req.user.id, emailVerified: true, phoneVerified: false };
  const code = ctx.phoneOtpCode();
  const hash = await ctx.bcrypt.hash(code, 10);
  const nextIdentity = await ctx.storageUpsertIdentity({
    ...identity, phone: identity.phone || null, pendingPhone: parsed.data.phone,
    phoneOtpHash: hash, phoneOtpAttempts: 0,
    phoneOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  await ctx.storageAudit({ action: "auth.phone.start", actorId: req.user.id, targetType: "identity", targetId: req.user.id, metadata: { phone: parsed.data.phone }, ip: req.ip });
  res.json({ ok: true, expiresAt: nextIdentity.phoneOtpExpiresAt, ...(ctx.ALLOW_DEV_OTP ? { devCode: code } : {}) });
});

router.post("/phone/request-otp", requireAuth, phoneLimiter, async (req, res) => {
  const parsed = ctx.phoneStartSchema.safeParse({ phone: ctx.normalizePhone(req.body.phone) });
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
  const identity = (await ctx.storageGetIdentityByUserId(req.user.id)) || { userId: req.user.id, emailVerified: true, phoneVerified: false };
  const code = ctx.phoneOtpCode();
  const hash = await ctx.bcrypt.hash(code, 10);
  const nextIdentity = await ctx.storageUpsertIdentity({
    ...identity, phone: identity.phone || null, pendingPhone: parsed.data.phone,
    phoneOtpHash: hash, phoneOtpAttempts: 0,
    phoneOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  await ctx.storageAudit({ action: "auth.phone.start", actorId: req.user.id, targetType: "identity", targetId: req.user.id, metadata: { phone: parsed.data.phone, alias: "request-otp" }, ip: req.ip });
  res.json({ ok: true, expiresAt: nextIdentity.phoneOtpExpiresAt, ...(ctx.ALLOW_DEV_OTP ? { devCode: code } : {}) });
});

async function handlePhoneVerify(req, res, alias) {
  const parsed = ctx.phoneVerifySchema.safeParse({ phone: ctx.normalizePhone(req.body.phone), code: ctx.sanitizeText(req.body.code) });
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
  const identity = await ctx.storageGetIdentityByUserId(req.user.id);
  if (!identity || !identity.phoneOtpHash || !identity.phoneOtpExpiresAt) { res.status(400).json({ message: "No active verification challenge" }); return; }
  if ((identity.phoneOtpAttempts || 0) >= 5) { res.status(429).json({ message: "Too many verification attempts" }); return; }
  if (new Date(identity.phoneOtpExpiresAt).getTime() < Date.now()) { res.status(410).json({ message: "Verification code expired" }); return; }
  if (identity.pendingPhone !== parsed.data.phone) { res.status(400).json({ message: "Phone mismatch for active challenge" }); return; }
  const ok = await ctx.bcrypt.compare(parsed.data.code, identity.phoneOtpHash);
  if (!ok) {
    await ctx.storageUpsertIdentity({ ...identity, phoneOtpAttempts: Number(identity.phoneOtpAttempts || 0) + 1 });
    res.status(401).json({ message: "Invalid code" }); return;
  }
  await ctx.storageUpsertIdentity({
    ...identity, phone: parsed.data.phone, pendingPhone: null, phoneVerified: true,
    phoneOtpHash: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0
  });
  await ctx.storageAudit({ action: "auth.phone.verified", actorId: req.user.id, targetType: "identity", targetId: req.user.id, metadata: { phone: parsed.data.phone, ...(alias ? { alias } : {}) }, ip: req.ip });
  res.json({ ok: true, phoneVerified: true });
}

router.post("/phone/verify", requireAuth, phoneLimiter, (req, res) => handlePhoneVerify(req, res, null));
router.post("/phone/confirm", requireAuth, phoneLimiter, (req, res) => handlePhoneVerify(req, res, "confirm"));

module.exports = router;
