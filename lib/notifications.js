/**
 * Notification delivery — templates, providers, preferences, unsubscribe,
 * idempotency, bounce/complaint hooks, delivery tracking.
 *
 * Channels: email (console | smtp | ethereal), telegram.
 * Never claim real send without a configured provider.
 * Never log raw email addresses (use redactEmail / hashEmail).
 *
 * Bead: aitj-z8q.15
 */

"use strict";

const crypto = require("crypto");
const { customAlphabet } = require("nanoid");

const deliveryIdGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 16);
const prefIdGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const unsubIdGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const tokenGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 32);

const DELIVERY_STATUS = Object.freeze({
  PENDING: "pending",
  SENDING: "sending",
  DELIVERED: "delivered",
  FAILED: "failed",
  CANCELLED: "cancelled",
  BOUNCED: "bounced",
  COMPLAINED: "complained",
  SKIPPED: "skipped"
});

const CHANNEL = Object.freeze({
  EMAIL: "email",
  TELEGRAM: "telegram"
});

const TEMPLATE_KEYS = Object.freeze({
  REGISTRATION_WELCOME: "registration.welcome",
  SUPPORT_ACK: "support.ack",
  DIGEST_CONFIRM: "digest.confirm",
  DIGEST_WEEKLY: "digest.weekly",
  FOLLOW_UP: "follow_up.generic",
  SOCIAL_MENTION: "social.mention",
  SOCIAL_REPLY: "social.reply",
  SOCIAL_FOLLOW: "social.follow",
  COHORT_REMINDER: "cohort.reminder",
  COHORT_EVENT: "cohort.event",
  COHORT_OUTCOME: "cohort.outcome",
  COHORT_BUDDY: "cohort.buddy"
});

/** Map template → preference flag / unsubscribe scope */
const TEMPLATE_CATEGORY = Object.freeze({
  [TEMPLATE_KEYS.REGISTRATION_WELCOME]: "transactional",
  [TEMPLATE_KEYS.SUPPORT_ACK]: "support",
  [TEMPLATE_KEYS.DIGEST_CONFIRM]: "digest",
  [TEMPLATE_KEYS.DIGEST_WEEKLY]: "digest",
  [TEMPLATE_KEYS.FOLLOW_UP]: "follow_up",
  [TEMPLATE_KEYS.SOCIAL_MENTION]: "mentions",
  [TEMPLATE_KEYS.SOCIAL_REPLY]: "replies",
  [TEMPLATE_KEYS.SOCIAL_FOLLOW]: "follows",
  [TEMPLATE_KEYS.COHORT_REMINDER]: "cohorts",
  [TEMPLATE_KEYS.COHORT_EVENT]: "cohorts",
  [TEMPLATE_KEYS.COHORT_OUTCOME]: "cohorts",
  [TEMPLATE_KEYS.COHORT_BUDDY]: "cohorts"
});

// ── Memory stores (dev / unit tests without DATABASE_URL) ──

const memory = {
  deliveries: new Map(),
  /** @type {Map<string, string>} idempotencyKey -> deliveryId */
  byIdempotency: new Map(),
  preferences: new Map(),
  /** token -> pref id */
  prefsByToken: new Map(),
  unsubscribes: new Map()
};

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const err = new Error("Notification delivery aborted");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function memoryReset() {
  memory.deliveries.clear();
  memory.byIdempotency.clear();
  memory.preferences.clear();
  memory.prefsByToken.clear();
  memory.unsubscribes.clear();
  _smtpTransport = null;
  _etherealAccount = null;
}

// ── Redaction / hashing (PII-safe logging) ──

/**
 * Redact an email for logs: a***@e***.com style — never full address.
 * @param {string|null|undefined} email
 * @returns {string}
 */
function redactEmail(email) {
  if (!email || typeof email !== "string") return "[no-email]";
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at < 1) return "[redacted-email]";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const localRedacted = local[0] + "***";
  const parts = domain.split(".");
  const domainRedacted =
    parts.length >= 2
      ? `${parts[0][0] || "*"}***.${parts[parts.length - 1]}`
      : `${domain[0] || "*"}***`;
  return `${localRedacted}@${domainRedacted}`;
}

/**
 * Stable SHA-256 hash of normalized email (for lookups without logging PII).
 */
function hashEmail(email) {
  const norm = String(email || "")
    .trim()
    .toLowerCase();
  return crypto.createHash("sha256").update(norm).digest("hex");
}

/**
 * Strip emails from free-form strings before logging.
 */
function redactEmailsInText(text) {
  if (text == null) return text;
  return String(text).replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    (m) => redactEmail(m)
  );
}

function nowIso() {
  return new Date().toISOString();
}

function baseUrl() {
  return String(process.env.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
}

// ── Templates ──

/**
 * Render a known template. Pure function — no I/O.
 * @param {string} templateKey
 * @param {object} vars
 * @returns {{ subject: string, bodyText: string, bodyHtml: string }}
 */
function renderTemplate(templateKey, vars = {}) {
  const site = vars.siteName || process.env.SITE_TITLE || "AI Took My Job";
  const unsubUrl =
    vars.unsubscribeUrl ||
    (vars.unsubscribeToken
      ? `${baseUrl()}/api/notifications/unsubscribe?token=${encodeURIComponent(vars.unsubscribeToken)}`
      : `${baseUrl()}/api/notifications/unsubscribe`);

  switch (templateKey) {
    case TEMPLATE_KEYS.REGISTRATION_WELCOME: {
      const name = vars.displayName || "there";
      const subject = `Welcome to ${site}`;
      const bodyText = [
        `Hi ${name},`,
        "",
        `Thanks for joining ${site}. You can share your story, join the forum, and stay informed about AI displacement.`,
        "",
        vars.nextSteps ||
          "Next steps: verify your phone (optional), share your story, or explore community resources.",
        "",
        `— The ${site} team`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ].join("\n");
      const bodyHtml = `<p>Hi ${escapeHtml(name)},</p>
<p>Thanks for joining <strong>${escapeHtml(site)}</strong>. You can share your story, join the forum, and stay informed about AI displacement.</p>
<p>${escapeHtml(vars.nextSteps || "Next steps: verify your phone (optional), share your story, or explore community resources.")}</p>
<p>— The ${escapeHtml(site)} team</p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.SUPPORT_ACK: {
      const subject = vars.subject || `We received your message — ${site}`;
      const bodyText = [
        "Hello,",
        "",
        vars.message ||
          "Thanks for reaching out. Our team has received your message and will follow up if needed.",
        "",
        vars.reference ? `Reference: ${vars.reference}` : "",
        "",
        `— ${site} support`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ]
        .filter(Boolean)
        .join("\n");
      const bodyHtml = `<p>Hello,</p>
<p>${escapeHtml(vars.message || "Thanks for reaching out. Our team has received your message and will follow up if needed.")}</p>
${vars.reference ? `<p>Reference: <code>${escapeHtml(vars.reference)}</code></p>` : ""}
<p>— ${escapeHtml(site)} support</p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.DIGEST_CONFIRM: {
      const subject = `You're subscribed to the ${site} weekly digest`;
      const bodyText = [
        "You're in!",
        "",
        "You'll receive a weekly digest of AI displacement news, community stories, and action opportunities — typically on Mondays.",
        "",
        `Unsubscribe anytime: ${unsubUrl}`,
        "",
        `— ${site}`
      ].join("\n");
      const bodyHtml = `<p><strong>You're in!</strong></p>
<p>You'll receive a weekly digest of AI displacement news, community stories, and action opportunities — typically on Mondays.</p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe anytime</a></p>
<p>— ${escapeHtml(site)}</p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.DIGEST_WEEKLY: {
      const weekLabel = vars.weekLabel || "this week";
      const headlines = Array.isArray(vars.headlines) ? vars.headlines : [];
      const stories = Array.isArray(vars.stories) ? vars.stories : [];
      const subject = vars.subject || `${site} weekly digest — ${weekLabel}`;
      const lines = [
        `${site} — Weekly digest (${weekLabel})`,
        "",
        headlines.length ? "Headlines:" : "Headlines: (none this week)",
        ...headlines.map((h, i) => `  ${i + 1}. ${h.title || h}${h.url ? ` — ${h.url}` : ""}`),
        "",
        stories.length ? "Community stories:" : "Community stories: (none new)",
        ...stories.map((s, i) => `  ${i + 1}. ${s.title || s.profession || s}`),
        "",
        vars.ctaUrl ? `Explore more: ${vars.ctaUrl}` : `Explore more: ${baseUrl()}`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ];
      const bodyText = lines.join("\n");
      const hlHtml = headlines.length
        ? `<ul>${headlines.map((h) => `<li>${escapeHtml(h.title || h)}${h.url ? ` — <a href="${escapeHtml(h.url)}">read</a>` : ""}</li>`).join("")}</ul>`
        : "<p>(none this week)</p>";
      const stHtml = stories.length
        ? `<ul>${stories.map((s) => `<li>${escapeHtml(s.title || s.profession || String(s))}</li>`).join("")}</ul>`
        : "<p>(none new)</p>";
      const bodyHtml = `<h2>${escapeHtml(site)} — Weekly digest</h2>
<p><em>${escapeHtml(weekLabel)}</em></p>
<h3>Headlines</h3>${hlHtml}
<h3>Community stories</h3>${stHtml}
<p><a href="${escapeHtml(vars.ctaUrl || baseUrl())}">Explore more</a></p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.FOLLOW_UP: {
      const subject = vars.subject || `A follow-up from ${site}`;
      const bodyText = [
        vars.greeting || "Hello,",
        "",
        vars.message || "We wanted to follow up with you.",
        "",
        vars.ctaUrl ? `Link: ${vars.ctaUrl}` : "",
        "",
        `— ${site}`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ]
        .filter((l) => l !== "")
        .join("\n");
      const bodyHtml = `<p>${escapeHtml(vars.greeting || "Hello,")}</p>
<p>${escapeHtml(vars.message || "We wanted to follow up with you.")}</p>
${vars.ctaUrl ? `<p><a href="${escapeHtml(vars.ctaUrl)}">Continue</a></p>` : ""}
<p>— ${escapeHtml(site)}</p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.SOCIAL_MENTION: {
      const subject = vars.subject || `You were mentioned on ${site}`;
      const preview = vars.preview || "";
      const bodyText = [
        "Hello,",
        "",
        "Someone mentioned you in a community comment.",
        preview ? `Preview: ${preview}` : "",
        vars.ctaUrl ? `View: ${vars.ctaUrl}` : `Explore: ${baseUrl()}`,
        "",
        `— ${site}`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ]
        .filter((l) => l !== "")
        .join("\n");
      const bodyHtml = `<p>Hello,</p>
<p>Someone mentioned you in a community comment.</p>
${preview ? `<blockquote>${escapeHtml(preview)}</blockquote>` : ""}
<p><a href="${escapeHtml(vars.ctaUrl || baseUrl())}">View conversation</a></p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.SOCIAL_REPLY: {
      const subject = vars.subject || `New reply on ${site}`;
      const preview = vars.preview || "";
      const bodyText = [
        "Hello,",
        "",
        "Someone replied to your comment.",
        preview ? `Preview: ${preview}` : "",
        vars.ctaUrl ? `View: ${vars.ctaUrl}` : `Explore: ${baseUrl()}`,
        "",
        `— ${site}`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ]
        .filter((l) => l !== "")
        .join("\n");
      const bodyHtml = `<p>Hello,</p>
<p>Someone replied to your comment.</p>
${preview ? `<blockquote>${escapeHtml(preview)}</blockquote>` : ""}
<p><a href="${escapeHtml(vars.ctaUrl || baseUrl())}">View reply</a></p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.SOCIAL_FOLLOW: {
      const subject = vars.subject || `New follower on ${site}`;
      const bodyText = [
        "Hello,",
        "",
        "Someone started following you on the community.",
        vars.ctaUrl ? `Profile: ${vars.ctaUrl}` : `Explore: ${baseUrl()}`,
        "",
        `— ${site}`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ]
        .filter((l) => l !== "")
        .join("\n");
      const bodyHtml = `<p>Hello,</p>
<p>Someone started following you on the community.</p>
<p><a href="${escapeHtml(vars.ctaUrl || baseUrl())}">View community</a></p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.COHORT_REMINDER: {
      const cohortTitle = vars.cohortTitle || vars.title || "your cohort";
      const subject = vars.subject || `Reminder: ${cohortTitle} — ${site}`;
      const bodyText = [
        "Hello,",
        "",
        vars.message || `This is a reminder about ${cohortTitle}.`,
        vars.startsAt ? `When: ${vars.startsAt}` : "",
        vars.ctaUrl ? `Details: ${vars.ctaUrl}` : `Explore: ${baseUrl()}`,
        "",
        `— ${site}`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ]
        .filter((l) => l !== "")
        .join("\n");
      const bodyHtml = `<p>Hello,</p>
<p>${escapeHtml(vars.message || `This is a reminder about ${cohortTitle}.`)}</p>
${vars.startsAt ? `<p><strong>When:</strong> ${escapeHtml(vars.startsAt)}</p>` : ""}
<p><a href="${escapeHtml(vars.ctaUrl || baseUrl())}">View cohort</a></p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.COHORT_EVENT: {
      const eventTitle = vars.eventTitle || vars.title || "cohort event";
      const subject = vars.subject || `Upcoming: ${eventTitle} — ${site}`;
      const bodyText = [
        "Hello,",
        "",
        `Event: ${eventTitle}`,
        vars.startsAt ? `Starts: ${vars.startsAt}` : "",
        vars.location ? `Location: ${vars.location}` : "",
        vars.meetingUrl ? `Join: ${vars.meetingUrl}` : "",
        vars.ctaUrl ? `Details: ${vars.ctaUrl}` : "",
        "",
        `— ${site}`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ]
        .filter((l) => l !== "")
        .join("\n");
      const bodyHtml = `<p>Hello,</p>
<p><strong>${escapeHtml(eventTitle)}</strong></p>
${vars.startsAt ? `<p>Starts: ${escapeHtml(vars.startsAt)}</p>` : ""}
${vars.location ? `<p>Location: ${escapeHtml(vars.location)}</p>` : ""}
${vars.meetingUrl ? `<p><a href="${escapeHtml(vars.meetingUrl)}">Join meeting</a></p>` : ""}
<p><a href="${escapeHtml(vars.ctaUrl || baseUrl())}">View event</a></p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.COHORT_OUTCOME: {
      const cohortTitle = vars.cohortTitle || "your cohort";
      const subject = vars.subject || `Follow-up: ${cohortTitle} — ${site}`;
      const bodyText = [
        "Hello,",
        "",
        vars.message ||
          `Thanks for participating in ${cohortTitle}. We'd love to hear how things are going.`,
        vars.ctaUrl ? `Share an update: ${vars.ctaUrl}` : `Explore: ${baseUrl()}`,
        "",
        `— ${site}`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ]
        .filter((l) => l !== "")
        .join("\n");
      const bodyHtml = `<p>Hello,</p>
<p>${escapeHtml(vars.message || `Thanks for participating in ${cohortTitle}. We'd love to hear how things are going.`)}</p>
<p><a href="${escapeHtml(vars.ctaUrl || baseUrl())}">Share an update</a></p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    case TEMPLATE_KEYS.COHORT_BUDDY: {
      const subject = vars.subject || `You've been matched with a buddy — ${site}`;
      const bodyText = [
        "Hello,",
        "",
        vars.message ||
          "You've been paired with a support buddy in your cohort. Reach out and introduce yourself.",
        vars.cohortTitle ? `Cohort: ${vars.cohortTitle}` : "",
        vars.ctaUrl ? `Open cohort: ${vars.ctaUrl}` : `Explore: ${baseUrl()}`,
        "",
        `— ${site}`,
        "",
        `Unsubscribe: ${unsubUrl}`
      ]
        .filter((l) => l !== "")
        .join("\n");
      const bodyHtml = `<p>Hello,</p>
<p>${escapeHtml(vars.message || "You've been paired with a support buddy in your cohort. Reach out and introduce yourself.")}</p>
${vars.cohortTitle ? `<p>Cohort: ${escapeHtml(vars.cohortTitle)}</p>` : ""}
<p><a href="${escapeHtml(vars.ctaUrl || baseUrl())}">Open cohort</a></p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a></p>`;
      return { subject, bodyText, bodyHtml };
    }
    default:
      throw new Error(`Unknown notification template: ${templateKey}`);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Providers ──

let _smtpTransport = null;
let _etherealAccount = null;

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_URL ||
      process.env.SMTP_HOST ||
      (process.env.EMAIL_PROVIDER &&
        ["smtp", "ethereal"].includes(String(process.env.EMAIL_PROVIDER).toLowerCase()))
  );
}

/**
 * Resolve which email provider to use.
 * - smtp: SMTP_URL / SMTP_HOST set, or EMAIL_PROVIDER=smtp
 * - ethereal: EMAIL_PROVIDER=ethereal (or test staging without SMTP)
 * - console: default when no SMTP — never claims production delivery
 * @returns {'smtp'|'ethereal'|'console'}
 */
function resolveEmailProvider() {
  const forced = String(process.env.EMAIL_PROVIDER || "").toLowerCase();
  if (forced === "console" || forced === "log") return "console";
  if (forced === "ethereal") return "ethereal";
  if (forced === "smtp") return "smtp";
  if (process.env.SMTP_URL || process.env.SMTP_HOST) return "smtp";
  // Default: console — safe for dev/test; never pretend to be a real MTA
  return "console";
}

async function getNodemailer() {
  try {
    // Lazy require so unit tests without the dep still load templates/redaction
    // eslint-disable-next-line global-require
    return require("nodemailer");
  } catch (err) {
    throw new Error(
      "nodemailer is required for SMTP/ethereal email delivery. Run npm install nodemailer."
    );
  }
}

async function getSmtpTransport() {
  if (_smtpTransport) return _smtpTransport;
  const nodemailer = await getNodemailer();
  if (process.env.SMTP_URL) {
    _smtpTransport = nodemailer.createTransport(process.env.SMTP_URL);
  } else {
    _smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
      auth:
        process.env.SMTP_USER || process.env.SMTP_PASS
          ? {
              user: process.env.SMTP_USER || "",
              pass: process.env.SMTP_PASS || ""
            }
          : undefined
    });
  }
  return _smtpTransport;
}

async function getEtherealTransport() {
  const nodemailer = await getNodemailer();
  if (!_etherealAccount) {
    _etherealAccount = await nodemailer.createTestAccount();
  }
  return nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: _etherealAccount.user,
      pass: _etherealAccount.pass
    }
  });
}

/**
 * Send email via resolved provider.
 * @returns {Promise<{ ok: boolean, provider: string, messageId?: string, previewUrl?: string, simulated?: boolean, error?: string }>}
 */
async function sendEmailViaProvider({ to, subject, text, html, from, signal }) {
  throwIfAborted(signal);
  const provider = resolveEmailProvider();
  const fromAddr =
    from ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    `"${process.env.SITE_TITLE || "AI Took My Job"}" <noreply@localhost>`;

  if (provider === "console") {
    // Log without raw recipient email
    console.log(
      `[notifications:console] provider=console simulated=true to=${redactEmail(to)} subject=${redactEmailsInText(subject)}`
    );
    return {
      ok: true,
      provider: "console",
      messageId: `console_${deliveryIdGen()}`,
      simulated: true
    };
  }

  let providerInvoked = false;
  try {
    let transport;
    let providerName = provider;
    if (provider === "ethereal") {
      transport = await getEtherealTransport();
      providerName = "ethereal";
    } else {
      transport = await getSmtpTransport();
      providerName = "smtp";
    }
    // Nodemailer has no reliable in-flight SMTP cancellation API. Check the
    // cooperative signal at the last safe point before the irreversible send.
    throwIfAborted(signal);
    providerInvoked = true;
    const info = await transport.sendMail({
      from: fromAddr,
      to,
      subject,
      text,
      html
    });
    const result = {
      ok: true,
      provider: providerName,
      messageId: info.messageId || null,
      simulated: providerName === "ethereal"
    };
    if (providerName === "ethereal") {
      try {
        const nodemailer = await getNodemailer();
        result.previewUrl = nodemailer.getTestMessageUrl(info) || null;
        console.log(
          `[notifications:ethereal] to=${redactEmail(to)} messageId=${result.messageId} preview=${result.previewUrl || "n/a"}`
        );
      } catch (_e) {
        /* ignore preview helper failures */
      }
    } else {
      console.log(
        `[notifications:smtp] to=${redactEmail(to)} messageId=${result.messageId || "n/a"}`
      );
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[notifications] email send failed provider=${provider} to=${redactEmail(to)} error=${redactEmailsInText(msg)}`
    );
    return {
      ok: false,
      provider,
      error: redactEmailsInText(msg),
      ambiguous: providerInvoked
    };
  }
}

/**
 * Telegram send using existing bot token pattern (or injected send fn).
 */
async function sendTelegramViaProvider({ chatId, text, sendFn, signal }) {
  throwIfAborted(signal);
  if (typeof sendFn === "function") {
    try {
      const ok = await sendFn(chatId, text, { signal });
      return {
        ok: Boolean(ok),
        provider: "telegram",
        messageId: ok ? `tg_${deliveryIdGen()}` : null,
        error: ok ? null : "telegram_send_returned_false"
      };
    } catch (err) {
      return {
        ok: false,
        provider: "telegram",
        error: err instanceof Error ? err.message : String(err),
        // The injected provider was invoked; it may have accepted the message
        // before throwing or losing its response.
        ambiguous: true
      };
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token || !chatId) {
    // No token: console simulation (never claim real Telegram delivery)
    console.log(
      `[notifications:console] provider=telegram-console simulated=true chatId=${chatId ? "set" : "missing"}`
    );
    if (!token) {
      return {
        ok: true,
        provider: "telegram-console",
        messageId: `tg_console_${deliveryIdGen()}`,
        simulated: true
      };
    }
    return { ok: false, provider: "telegram", error: "missing_chat_id" };
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal
    });
    if (!resp.ok) {
      return { ok: false, provider: "telegram", error: `telegram_http_${resp.status}` };
    }
    const body = await resp.json().catch(() => ({}));
    return {
      ok: true,
      provider: "telegram",
      messageId: body?.result?.message_id != null ? String(body.result.message_id) : `tg_${deliveryIdGen()}`
    };
  } catch (err) {
    return {
      ok: false,
      provider: "telegram",
      error: err instanceof Error ? err.message : String(err),
      // Once fetch starts, abort/network failure cannot prove Telegram did not
      // accept the request. Keep the delivery for reconciliation.
      ambiguous: true
    };
  }
}

// ── Pool / mode helpers ──

function resolvePool(options = {}) {
  if (options.pool) return options.pool;
  if (typeof options.getPool === "function") {
    try {
      return options.getPool() || null;
    } catch (_e) {
      return null;
    }
  }
  return null;
}

function usePg(options = {}) {
  if (options.useMemory === true) return false;
  if (options.usePostgres === false) return false;
  const pool = resolvePool(options);
  if (pool) return true;
  if (options.usePostgres === true) return true;
  try {
    // eslint-disable-next-line global-require
    const ctx = require("./context");
    return Boolean(ctx.usePostgres && ctx.getPgPool && ctx.getPgPool());
  } catch (_e) {
    return false;
  }
}

function getPoolOrThrow(options = {}) {
  const pool = resolvePool(options);
  if (pool) return pool;
  // eslint-disable-next-line global-require
  const ctx = require("./context");
  const p = ctx.getPgPool();
  if (!p) throw new Error("PostgreSQL pool not initialized");
  return p;
}

// ── Row mappers ──

function rowToDelivery(row) {
  if (!row) return null;
  return {
    id: row.id,
    channel: row.channel,
    templateKey: row.template_key ?? row.templateKey,
    status: row.status,
    recipientEmail: row.recipient_email ?? row.recipientEmail ?? null,
    recipientUserId: row.recipient_user_id ?? row.recipientUserId ?? null,
    recipientTelegramChatId:
      row.recipient_telegram_chat_id ?? row.recipientTelegramChatId ?? null,
    idempotencyKey: row.idempotency_key ?? row.idempotencyKey ?? null,
    subject: row.subject ?? null,
    bodyText: row.body_text ?? row.bodyText ?? null,
    bodyHtml: row.body_html ?? row.bodyHtml ?? null,
    templateVars:
      typeof row.template_vars === "string"
        ? JSON.parse(row.template_vars)
        : row.template_vars ?? row.templateVars ?? {},
    provider: row.provider ?? null,
    providerMessageId: row.provider_message_id ?? row.providerMessageId ?? null,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? 5),
    lastError: row.last_error ?? row.lastError ?? null,
    jobId: row.job_id ?? row.jobId ?? null,
    scheduledAt: row.scheduled_at
      ? new Date(row.scheduled_at).toISOString()
      : row.scheduledAt || null,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : row.sentAt || null,
    deliveredAt: row.delivered_at
      ? new Date(row.delivered_at).toISOString()
      : row.deliveredAt || null,
    failedAt: row.failed_at ? new Date(row.failed_at).toISOString() : row.failedAt || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : row.createdAt || null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : row.updatedAt || null
  };
}

/** Public admin view — redacts email */
function deliveryToPublic(d) {
  if (!d) return null;
  return {
    ...d,
    recipientEmail: d.recipientEmail ? redactEmail(d.recipientEmail) : null,
    recipientEmailHash: d.recipientEmail ? hashEmail(d.recipientEmail) : null,
    bodyText: d.bodyText ? redactEmailsInText(d.bodyText) : d.bodyText,
    bodyHtml: d.bodyHtml ? redactEmailsInText(d.bodyHtml) : d.bodyHtml,
    lastError: d.lastError ? redactEmailsInText(d.lastError) : d.lastError
  };
}

// ── Preferences & unsubscribe ──

function defaultPreferences(partial = {}) {
  return {
    id: partial.id || `npref_${prefIdGen()}`,
    userId: partial.userId || partial.user_id || null,
    email: partial.email ? String(partial.email).trim().toLowerCase() : null,
    emailTransactional: partial.emailTransactional !== false && partial.email_transactional !== false,
    emailDigest: partial.emailDigest !== false && partial.email_digest !== false,
    emailFollowUp: partial.emailFollowUp !== false && partial.email_follow_up !== false,
    emailSupport: partial.emailSupport !== false && partial.email_support !== false,
    emailMentions: partial.emailMentions !== false && partial.email_mentions !== false,
    emailReplies: partial.emailReplies !== false && partial.email_replies !== false,
    emailFollows: partial.emailFollows !== false && partial.email_follows !== false,
    emailCohorts: partial.emailCohorts !== false && partial.email_cohorts !== false,
    telegramEnabled: partial.telegramEnabled !== false && partial.telegram_enabled !== false,
    unsubscribeToken: partial.unsubscribeToken || partial.unsubscribe_token || tokenGen(),
    createdAt: partial.createdAt || partial.created_at || nowIso(),
    updatedAt: partial.updatedAt || partial.updated_at || nowIso()
  };
}

function rowToPref(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? row.userId ?? null,
    email: row.email ?? null,
    emailTransactional: row.email_transactional ?? row.emailTransactional ?? true,
    emailDigest: row.email_digest ?? row.emailDigest ?? true,
    emailFollowUp: row.email_follow_up ?? row.emailFollowUp ?? true,
    emailSupport: row.email_support ?? row.emailSupport ?? true,
    emailMentions: row.email_mentions ?? row.emailMentions ?? true,
    emailReplies: row.email_replies ?? row.emailReplies ?? true,
    emailFollows: row.email_follows ?? row.emailFollows ?? true,
    emailCohorts: row.email_cohorts ?? row.emailCohorts ?? true,
    telegramEnabled: row.telegram_enabled ?? row.telegramEnabled ?? true,
    unsubscribeToken: row.unsubscribe_token ?? row.unsubscribeToken,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : row.createdAt || null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : row.updatedAt || null
  };
}

async function ensurePreferences({ userId, email }, options = {}) {
  const existing = await getPreferences({ userId, email }, options);
  if (existing) return existing;
  const pref = defaultPreferences({ userId: userId || null, email: email || null });
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    try {
      const res = await pool.query(
        `INSERT INTO notification_preferences (
           id, user_id, email, email_transactional, email_digest, email_follow_up,
           email_support, email_mentions, email_replies, email_follows,
           telegram_enabled, unsubscribe_token, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
         RETURNING *;`,
        [
          pref.id,
          pref.userId,
          pref.email,
          pref.emailTransactional,
          pref.emailDigest,
          pref.emailFollowUp,
          pref.emailSupport,
          pref.emailMentions,
          pref.emailReplies,
          pref.emailFollows,
          pref.telegramEnabled,
          pref.unsubscribeToken
        ]
      );
      return rowToPref(res.rows[0]);
    } catch (err) {
      // Unique on email/user — fetch winner of race
      if (err && err.code === "23505") {
        return getPreferences({ userId, email }, options);
      }
      throw err;
    }
  }
  memory.preferences.set(pref.id, pref);
  memory.prefsByToken.set(pref.unsubscribeToken, pref.id);
  return { ...pref };
}

async function getPreferences({ userId, email, token } = {}, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    if (token) {
      const res = await pool.query(
        `SELECT * FROM notification_preferences WHERE unsubscribe_token = $1 LIMIT 1;`,
        [token]
      );
      return rowToPref(res.rows[0]);
    }
    if (userId) {
      const res = await pool.query(
        `SELECT * FROM notification_preferences WHERE user_id = $1 LIMIT 1;`,
        [userId]
      );
      if (res.rows[0]) return rowToPref(res.rows[0]);
    }
    if (email) {
      const res = await pool.query(
        `SELECT * FROM notification_preferences WHERE email = $1 LIMIT 1;`,
        [String(email).trim().toLowerCase()]
      );
      return rowToPref(res.rows[0]);
    }
    return null;
  }
  if (token) {
    const id = memory.prefsByToken.get(token);
    return id ? { ...memory.preferences.get(id) } : null;
  }
  for (const p of memory.preferences.values()) {
    if (userId && p.userId === userId) return { ...p };
    if (email && p.email === String(email).trim().toLowerCase()) return { ...p };
  }
  return null;
}

async function updatePreferences(idOrQuery, patch, options = {}) {
  const current =
    typeof idOrQuery === "string"
      ? await getPreferencesById(idOrQuery, options)
      : await getPreferences(idOrQuery, options);
  if (!current) return null;
  const next = {
    ...current,
    emailTransactional:
      patch.emailTransactional != null ? Boolean(patch.emailTransactional) : current.emailTransactional,
    emailDigest: patch.emailDigest != null ? Boolean(patch.emailDigest) : current.emailDigest,
    emailFollowUp: patch.emailFollowUp != null ? Boolean(patch.emailFollowUp) : current.emailFollowUp,
    emailSupport: patch.emailSupport != null ? Boolean(patch.emailSupport) : current.emailSupport,
    emailMentions:
      patch.emailMentions != null ? Boolean(patch.emailMentions) : current.emailMentions !== false,
    emailReplies:
      patch.emailReplies != null ? Boolean(patch.emailReplies) : current.emailReplies !== false,
    emailFollows:
      patch.emailFollows != null ? Boolean(patch.emailFollows) : current.emailFollows !== false,
    telegramEnabled:
      patch.telegramEnabled != null ? Boolean(patch.telegramEnabled) : current.telegramEnabled,
    updatedAt: nowIso()
  };
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE notification_preferences SET
         email_transactional = $2,
         email_digest = $3,
         email_follow_up = $4,
         email_support = $5,
         email_mentions = $6,
         email_replies = $7,
         email_follows = $8,
         telegram_enabled = $9,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *;`,
      [
        current.id,
        next.emailTransactional,
        next.emailDigest,
        next.emailFollowUp,
        next.emailSupport,
        next.emailMentions,
        next.emailReplies,
        next.emailFollows,
        next.telegramEnabled
      ]
    );
    return rowToPref(res.rows[0]);
  }
  memory.preferences.set(current.id, next);
  return { ...next };
}

async function getPreferencesById(id, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(`SELECT * FROM notification_preferences WHERE id = $1;`, [id]);
    return rowToPref(res.rows[0]);
  }
  const p = memory.preferences.get(id);
  return p ? { ...p } : null;
}

/**
 * Immediate unsubscribe. scope: all | digest | transactional | follow_up | support
 */
async function unsubscribe({ email, token, scope = "all", reason, source = "link" }, options = {}) {
  let resolvedEmail = email ? String(email).trim().toLowerCase() : null;
  let pref = null;

  if (token) {
    pref = await getPreferences({ token }, options);
    if (pref?.email) resolvedEmail = pref.email;
    // Also allow unsub token stored on email_unsubscribes for one-shot tokens
  }

  if (!resolvedEmail && !token) {
    return { ok: false, reason: "email_or_token_required" };
  }

  // If token points to prefs, flip preference flags immediately
  if (pref) {
    const prefPatch = {};
    if (scope === "all") {
      prefPatch.emailTransactional = false;
      prefPatch.emailDigest = false;
      prefPatch.emailFollowUp = false;
      prefPatch.emailSupport = false;
      prefPatch.emailMentions = false;
      prefPatch.emailReplies = false;
      prefPatch.emailFollows = false;
      prefPatch.telegramEnabled = false;
    } else if (scope === "digest") prefPatch.emailDigest = false;
    else if (scope === "transactional") prefPatch.emailTransactional = false;
    else if (scope === "follow_up") prefPatch.emailFollowUp = false;
    else if (scope === "support") prefPatch.emailSupport = false;
    else if (scope === "mentions") prefPatch.emailMentions = false;
    else if (scope === "replies") prefPatch.emailReplies = false;
    else if (scope === "follows") prefPatch.emailFollows = false;
    await updatePreferences(pref.id, prefPatch, options);
    if (!resolvedEmail) resolvedEmail = pref.email;
  }

  if (!resolvedEmail) {
    return { ok: false, reason: "unknown_token" };
  }

  const entry = {
    id: `unsub_${unsubIdGen()}`,
    email: resolvedEmail,
    emailHash: hashEmail(resolvedEmail),
    scope: scope || "all",
    token: token || null,
    reason: reason || null,
    source: source || "link",
    unsubscribedAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO email_unsubscribes (id, email, email_hash, scope, token, reason, source, unsubscribed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (email, scope) DO UPDATE SET
         reason = EXCLUDED.reason,
         source = EXCLUDED.source,
         token = COALESCE(EXCLUDED.token, email_unsubscribes.token),
         unsubscribed_at = NOW();`,
      [
        entry.id,
        entry.email,
        entry.emailHash,
        entry.scope,
        entry.token,
        entry.reason,
        entry.source
      ]
    );
    // ON CONFLICT needs unique on (email, scope) — we have unique index; use raw conflict target:
    // PostgreSQL unique index name can't be used with ON CONFLICT unless constraint.
    // Recreate with constraint-friendly approach if index-only: use DELETE+INSERT pattern fallback.
    return { ok: true, email: redactEmail(resolvedEmail), scope: entry.scope, immediate: true };
  }

  const key = `${entry.email}::${entry.scope}`;
  memory.unsubscribes.set(key, entry);
  if (scope === "all") {
    // Also record specific scopes for simplicity
    for (const s of [
      "digest",
      "transactional",
      "follow_up",
      "support",
      "mentions",
      "replies",
      "follows"
    ]) {
      memory.unsubscribes.set(`${entry.email}::${s}`, { ...entry, scope: s, id: entry.id + s });
    }
  }
  return { ok: true, email: redactEmail(resolvedEmail), scope: entry.scope, immediate: true };
}

/**
 * Fix PG upsert: unique index is not a constraint. Use a safer upsert.
 * Re-implement unsubscribe PG path with select+insert/update.
 */
async function unsubscribeSafe(input, options = {}) {
  if (!usePg(options)) {
    return unsubscribe(input, options);
  }

  const { token, scope = "all", reason, source = "link" } = input;
  let resolvedEmail = input.email ? String(input.email).trim().toLowerCase() : null;
  let pref = null;

  if (token) {
    pref = await getPreferences({ token }, options);
    if (pref?.email) resolvedEmail = pref.email;
  }
  if (!resolvedEmail && !token) return { ok: false, reason: "email_or_token_required" };

  if (pref) {
    const prefPatch = {};
    if (scope === "all") {
      prefPatch.emailTransactional = false;
      prefPatch.emailDigest = false;
      prefPatch.emailFollowUp = false;
      prefPatch.emailSupport = false;
      prefPatch.emailMentions = false;
      prefPatch.emailReplies = false;
      prefPatch.emailFollows = false;
      prefPatch.telegramEnabled = false;
    } else if (scope === "digest") prefPatch.emailDigest = false;
    else if (scope === "transactional") prefPatch.emailTransactional = false;
    else if (scope === "follow_up") prefPatch.emailFollowUp = false;
    else if (scope === "support") prefPatch.emailSupport = false;
    else if (scope === "mentions") prefPatch.emailMentions = false;
    else if (scope === "replies") prefPatch.emailReplies = false;
    else if (scope === "follows") prefPatch.emailFollows = false;
    await updatePreferences(pref.id, prefPatch, options);
    if (!resolvedEmail) resolvedEmail = pref.email;
  }

  if (!resolvedEmail) return { ok: false, reason: "unknown_token" };

  const pool = getPoolOrThrow(options);
  const emailHash = hashEmail(resolvedEmail);
  const existing = await pool.query(
    `SELECT id FROM email_unsubscribes WHERE email = $1 AND scope = $2 LIMIT 1;`,
    [resolvedEmail, scope]
  );
  if (existing.rows[0]) {
    await pool.query(
      `UPDATE email_unsubscribes SET
         reason = $2, source = $3, token = COALESCE($4, token), unsubscribed_at = NOW()
       WHERE id = $1;`,
      [existing.rows[0].id, reason || null, source || "link", token || null]
    );
  } else {
    await pool.query(
      `INSERT INTO email_unsubscribes (id, email, email_hash, scope, token, reason, source, unsubscribed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW());`,
      [
        `unsub_${unsubIdGen()}`,
        resolvedEmail,
        emailHash,
        scope,
        token || null,
        reason || null,
        source || "link"
      ]
    );
  }

  // When scope=all, also stamp category rows so isUnsubscribed checks hit
  if (scope === "all") {
    for (const s of [
      "digest",
      "transactional",
      "follow_up",
      "support",
      "mentions",
      "replies",
      "follows"
    ]) {
      const ex = await pool.query(
        `SELECT id FROM email_unsubscribes WHERE email = $1 AND scope = $2 LIMIT 1;`,
        [resolvedEmail, s]
      );
      if (!ex.rows[0]) {
        await pool.query(
          `INSERT INTO email_unsubscribes (id, email, email_hash, scope, token, reason, source, unsubscribed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW());`,
          [
            `unsub_${unsubIdGen()}`,
            resolvedEmail,
            emailHash,
            s,
            token || null,
            reason || null,
            source || "link"
          ]
        );
      }
    }
  }

  return { ok: true, email: redactEmail(resolvedEmail), scope, immediate: true };
}

async function isUnsubscribed(email, category, options = {}) {
  if (!email) return false;
  const norm = String(email).trim().toLowerCase();
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT 1 FROM email_unsubscribes
       WHERE email = $1 AND scope IN ('all', $2)
       LIMIT 1;`,
      [norm, category || "all"]
    );
    return res.rows.length > 0;
  }
  if (memory.unsubscribes.has(`${norm}::all`)) return true;
  if (category && memory.unsubscribes.has(`${norm}::${category}`)) return true;
  return false;
}

/**
 * Whether preference + unsubscribe allow this send.
 */
async function maySend({ email, userId, templateKey, channel }, options = {}) {
  const category = TEMPLATE_CATEGORY[templateKey] || "transactional";

  if (channel === CHANNEL.EMAIL && email) {
    if (await isUnsubscribed(email, category, options)) {
      return { allowed: false, reason: "unsubscribed" };
    }
  }

  const pref = await getPreferences({ userId, email }, options);
  if (!pref) return { allowed: true, reason: null };

  if (channel === CHANNEL.TELEGRAM && !pref.telegramEnabled) {
    return { allowed: false, reason: "telegram_disabled" };
  }
  if (channel === CHANNEL.EMAIL) {
    if (category === "digest" && !pref.emailDigest) return { allowed: false, reason: "digest_disabled" };
    if (category === "transactional" && !pref.emailTransactional) {
      return { allowed: false, reason: "transactional_disabled" };
    }
    if (category === "follow_up" && !pref.emailFollowUp) {
      return { allowed: false, reason: "follow_up_disabled" };
    }
    if (category === "support" && !pref.emailSupport) {
      return { allowed: false, reason: "support_disabled" };
    }
    if (category === "mentions" && pref.emailMentions === false) {
      return { allowed: false, reason: "mentions_disabled" };
    }
    if (category === "replies" && pref.emailReplies === false) {
      return { allowed: false, reason: "replies_disabled" };
    }
    if (category === "follows" && pref.emailFollows === false) {
      return { allowed: false, reason: "follows_disabled" };
    }
    if (category === "cohorts" && pref.emailCohorts === false) {
      return { allowed: false, reason: "cohorts_disabled" };
    }
  }
  return { allowed: true, reason: null, preferences: pref };
}

// ── Delivery CRUD ──

async function createDelivery(input, options = {}) {
  const id = input.id || `ndel_${deliveryIdGen()}`;
  const idempotencyKey = input.idempotencyKey || input.idempotency_key || null;

  if (idempotencyKey) {
    const existing = await getDeliveryByIdempotency(idempotencyKey, options);
    if (existing) return { delivery: existing, created: false };
  }

  const channel = input.channel || CHANNEL.EMAIL;
  const templateKey = input.templateKey || input.template_key;
  if (!templateKey) throw new Error("createDelivery requires templateKey");

  const vars = input.templateVars || input.template_vars || {};
  let rendered = input.subject
    ? {
        subject: input.subject,
        bodyText: input.bodyText || input.body_text || "",
        bodyHtml: input.bodyHtml || input.body_html || ""
      }
    : null;
  if (!rendered) {
    rendered = renderTemplate(templateKey, vars);
  }

  const delivery = {
    id,
    channel,
    templateKey,
    status: DELIVERY_STATUS.PENDING,
    recipientEmail: input.recipientEmail || input.recipient_email || null,
    recipientUserId: input.recipientUserId || input.recipient_user_id || null,
    recipientTelegramChatId:
      input.recipientTelegramChatId || input.recipient_telegram_chat_id || null,
    idempotencyKey,
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    bodyHtml: rendered.bodyHtml,
    templateVars: vars,
    provider: null,
    providerMessageId: null,
    attempts: 0,
    maxAttempts: Math.min(20, Math.max(1, Number(input.maxAttempts || input.max_attempts || 5))),
    lastError: null,
    jobId: input.jobId || input.job_id || null,
    scheduledAt: input.scheduledAt || input.scheduled_at || nowIso(),
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    try {
      const res = await pool.query(
        `INSERT INTO notification_deliveries (
           id, channel, template_key, status, recipient_email, recipient_user_id,
           recipient_telegram_chat_id, idempotency_key, subject, body_text, body_html,
           template_vars, attempts, max_attempts, job_id, scheduled_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,NOW(),NOW()
         ) RETURNING *;`,
        [
          delivery.id,
          delivery.channel,
          delivery.templateKey,
          delivery.recipientEmail,
          delivery.recipientUserId,
          delivery.recipientTelegramChatId,
          delivery.idempotencyKey,
          delivery.subject,
          delivery.bodyText,
          delivery.bodyHtml,
          JSON.stringify(delivery.templateVars || {}),
          delivery.attempts,
          delivery.maxAttempts,
          delivery.jobId,
          delivery.scheduledAt
        ]
      );
      return { delivery: rowToDelivery(res.rows[0]), created: true };
    } catch (err) {
      if (err && err.code === "23505" && idempotencyKey) {
        const existing = await getDeliveryByIdempotency(idempotencyKey, options);
        if (existing) return { delivery: existing, created: false };
      }
      throw err;
    }
  }

  if (idempotencyKey && memory.byIdempotency.has(idempotencyKey)) {
    const existingId = memory.byIdempotency.get(idempotencyKey);
    return { delivery: { ...memory.deliveries.get(existingId) }, created: false };
  }
  memory.deliveries.set(id, delivery);
  if (idempotencyKey) memory.byIdempotency.set(idempotencyKey, id);
  return { delivery: { ...delivery }, created: true };
}

async function getDelivery(id, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(`SELECT * FROM notification_deliveries WHERE id = $1;`, [id]);
    return rowToDelivery(res.rows[0]);
  }
  const d = memory.deliveries.get(id);
  return d ? { ...d } : null;
}

async function getDeliveryByIdempotency(key, options = {}) {
  if (!key) return null;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM notification_deliveries WHERE idempotency_key = $1 LIMIT 1;`,
      [key]
    );
    return rowToDelivery(res.rows[0]);
  }
  const id = memory.byIdempotency.get(key);
  return id ? { ...memory.deliveries.get(id) } : null;
}

async function updateDelivery(id, patch, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const fields = [];
    const params = [id];
    const map = {
      status: "status",
      provider: "provider",
      providerMessageId: "provider_message_id",
      attempts: "attempts",
      lastError: "last_error",
      jobId: "job_id",
      sentAt: "sent_at",
      deliveredAt: "delivered_at",
      failedAt: "failed_at"
    };
    for (const [jsKey, col] of Object.entries(map)) {
      if (patch[jsKey] !== undefined) {
        params.push(patch[jsKey]);
        fields.push(`${col} = $${params.length}`);
      }
    }
    if (!fields.length) return getDelivery(id, options);
    fields.push("updated_at = NOW()");
    const res = await pool.query(
      `UPDATE notification_deliveries SET ${fields.join(", ")} WHERE id = $1 RETURNING *;`,
      params
    );
    return rowToDelivery(res.rows[0]);
  }
  const d = memory.deliveries.get(id);
  if (!d) return null;
  Object.assign(d, patch, { updatedAt: nowIso() });
  memory.deliveries.set(id, d);
  return { ...d };
}

async function listDeliveries(filters = {}, options = {}) {
  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
  const offset = Math.max(0, Number(filters.offset) || 0);
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const clauses = [];
    const params = [];
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`status = $${params.length}`);
    }
    if (filters.templateKey || filters.template_key) {
      params.push(filters.templateKey || filters.template_key);
      clauses.push(`template_key = $${params.length}`);
    }
    if (filters.channel) {
      params.push(filters.channel);
      clauses.push(`channel = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notification_deliveries ${where};`,
      params
    );
    params.push(limit);
    params.push(offset);
    const res = await pool.query(
      `SELECT * FROM notification_deliveries ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length};`,
      params
    );
    return {
      deliveries: res.rows.map(rowToDelivery),
      total: countRes.rows[0]?.n || 0
    };
  }
  let rows = [...memory.deliveries.values()];
  if (filters.status) rows = rows.filter((d) => d.status === filters.status);
  if (filters.templateKey) rows = rows.filter((d) => d.templateKey === filters.templateKey);
  if (filters.channel) rows = rows.filter((d) => d.channel === filters.channel);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = rows.length;
  return {
    deliveries: rows.slice(offset, offset + limit).map((d) => ({ ...d })),
    total
  };
}

// ── Core send ──

/**
 * Atomically acquire the right to call the external provider once.
 * Concurrent callers see `sending` and skip rather than duplicate the effect.
 */
async function claimDelivery(deliveryId, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE notification_deliveries SET
         status = $2,
         attempts = attempts + 1,
         updated_at = NOW()
       WHERE id = $1 AND status IN ($3, $4)
       RETURNING *;`,
      [
        deliveryId,
        DELIVERY_STATUS.SENDING,
        DELIVERY_STATUS.PENDING,
        DELIVERY_STATUS.FAILED
      ]
    );
    return res.rows[0] ? rowToDelivery(res.rows[0]) : null;
  }

  // There is no await between check and mutation, making this an atomic claim
  // in the single event loop used by the development memory backend.
  const delivery = memory.deliveries.get(deliveryId);
  if (
    !delivery ||
    (delivery.status !== DELIVERY_STATUS.PENDING &&
      delivery.status !== DELIVERY_STATUS.FAILED)
  ) {
    return null;
  }
  delivery.status = DELIVERY_STATUS.SENDING;
  delivery.attempts = (delivery.attempts || 0) + 1;
  delivery.updatedAt = nowIso();
  memory.deliveries.set(deliveryId, delivery);
  return { ...delivery };
}

/**
 * Finish only the exact delivery attempt that won claimDelivery(). This fences
 * a slow/stale provider response from overwriting a newer retry attempt.
 */
async function finishClaimedDelivery(deliveryId, attemptsToken, patch, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const fields = [];
    const params = [deliveryId, attemptsToken];
    const map = {
      status: "status",
      provider: "provider",
      providerMessageId: "provider_message_id",
      lastError: "last_error",
      sentAt: "sent_at",
      deliveredAt: "delivered_at",
      failedAt: "failed_at"
    };
    for (const [jsKey, col] of Object.entries(map)) {
      if (patch[jsKey] !== undefined) {
        params.push(patch[jsKey]);
        fields.push(`${col} = $${params.length}`);
      }
    }
    fields.push("updated_at = NOW()");
    const res = await pool.query(
      `UPDATE notification_deliveries SET ${fields.join(", ")}
       WHERE id = $1 AND status = 'sending' AND attempts = $2
       RETURNING *;`,
      params
    );
    return res.rows[0] ? rowToDelivery(res.rows[0]) : null;
  }

  const delivery = memory.deliveries.get(deliveryId);
  if (
    !delivery ||
    delivery.status !== DELIVERY_STATUS.SENDING ||
    delivery.attempts !== attemptsToken
  ) {
    return null;
  }
  Object.assign(delivery, patch, { updatedAt: nowIso() });
  memory.deliveries.set(deliveryId, delivery);
  return { ...delivery };
}

/**
 * Execute delivery for a notification_deliveries row (or create+send).
 * Respects unsubscribe, preferences, idempotency (already delivered → no-op).
 */
async function deliver(deliveryId, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  let delivery = await getDelivery(deliveryId, options);
  if (!delivery) return { ok: false, error: "not_found" };

  // Idempotent: already terminal success
  if (
    delivery.status === DELIVERY_STATUS.DELIVERED ||
    delivery.status === DELIVERY_STATUS.CANCELLED ||
    delivery.status === DELIVERY_STATUS.SKIPPED ||
    delivery.status === DELIVERY_STATUS.BOUNCED ||
    delivery.status === DELIVERY_STATUS.COMPLAINED
  ) {
    return { ok: true, delivery, skipped: true, reason: `already_${delivery.status}` };
  }
  if (delivery.status === DELIVERY_STATUS.SENDING) {
    return { ok: true, delivery, skipped: true, reason: "already_sending" };
  }

  throwIfAborted(signal);
  const claimed = await claimDelivery(deliveryId, options);
  if (!claimed) {
    delivery = await getDelivery(deliveryId, options);
    if (!delivery) return { ok: false, error: "not_found" };
    return { ok: true, delivery, skipped: true, reason: `already_${delivery.status}` };
  }
  delivery = claimed;

  let gate;
  try {
    gate = await maySend(
      {
        email: delivery.recipientEmail,
        userId: delivery.recipientUserId,
        templateKey: delivery.templateKey,
        channel: delivery.channel
      },
      options
    );
  } catch (err) {
    // Preference lookup failed before provider invocation, so this attempt is
    // proven safe to retry. The token prevents clobbering a newer attempt.
    await finishClaimedDelivery(
      deliveryId,
      delivery.attempts,
      { status: DELIVERY_STATUS.PENDING, lastError: "preference_check_failed" },
      options
    );
    throw err;
  }
  if (!gate.allowed) {
    const updated = await finishClaimedDelivery(
      deliveryId,
      delivery.attempts,
      {
        status: DELIVERY_STATUS.SKIPPED,
        lastError: gate.reason,
        failedAt: nowIso()
      },
      options
    );
    if (!updated) {
      return {
        ok: false,
        delivery: await getDelivery(deliveryId, options),
        error: "delivery_claim_lost",
        stale: true
      };
    }
    return { ok: true, delivery: updated, skipped: true, reason: gate.reason };
  }

  let sendResult;
  try {
    if (delivery.channel === CHANNEL.TELEGRAM) {
      sendResult = await sendTelegramViaProvider({
        chatId: delivery.recipientTelegramChatId,
        text: delivery.bodyText || delivery.subject || "",
        sendFn: options.sendTelegram,
        signal
      });
    } else {
      if (!delivery.recipientEmail) {
        const updated = await finishClaimedDelivery(
          deliveryId,
          delivery.attempts,
          {
            status: DELIVERY_STATUS.FAILED,
            lastError: "missing_recipient_email",
            failedAt: nowIso()
          },
          options
        );
        if (!updated) {
          return {
            ok: false,
            delivery: await getDelivery(deliveryId, options),
            error: "delivery_claim_lost",
            stale: true
          };
        }
        return { ok: false, delivery: updated, error: "missing_recipient_email" };
      }
      sendResult = await sendEmailViaProvider({
        to: delivery.recipientEmail,
        subject: delivery.subject,
        text: delivery.bodyText,
        html: delivery.bodyHtml,
        signal
      });
    }
  } catch (err) {
    // Provider helpers only throw before invocation; after invocation they
    // return an explicit ambiguous result. This path is therefore safe to
    // return to automatic retry, fenced by the claim attempt token.
    await finishClaimedDelivery(
      deliveryId,
      delivery.attempts,
      { status: DELIVERY_STATUS.PENDING, lastError: "aborted_before_provider" },
      options
    );
    throw err;
  }

  if (sendResult.ok) {
    const updated = await finishClaimedDelivery(
      deliveryId,
      delivery.attempts,
      {
        status: DELIVERY_STATUS.DELIVERED,
        provider: sendResult.provider,
        providerMessageId: sendResult.messageId || null,
        sentAt: nowIso(),
        deliveredAt: nowIso(),
        lastError: null
      },
      options
    );
    if (!updated) {
      return {
        ok: true,
        delivery: await getDelivery(deliveryId, options),
        simulated: Boolean(sendResult.simulated),
        stale: true
      };
    }
    return {
      ok: true,
      delivery: updated,
      simulated: Boolean(sendResult.simulated),
      previewUrl: sendResult.previewUrl || null
    };
  }

  if (sendResult.ambiguous) {
    const updated = await finishClaimedDelivery(
      deliveryId,
      delivery.attempts,
      {
        status: DELIVERY_STATUS.SENDING,
        provider: sendResult.provider || null,
        lastError: sendResult.error || "provider_outcome_ambiguous"
      },
      options
    );
    return {
      ok: false,
      delivery: updated || await getDelivery(deliveryId, options),
      error: "provider_outcome_ambiguous",
      ambiguous: true,
      reconciliationRequired: true,
      stale: !updated
    };
  }

  const attempts = delivery.attempts || 1;
  const exhausted = attempts >= (delivery.maxAttempts || 5);
  const updated = await finishClaimedDelivery(
    deliveryId,
    delivery.attempts,
    {
      status: exhausted ? DELIVERY_STATUS.FAILED : DELIVERY_STATUS.PENDING,
      provider: sendResult.provider || null,
      lastError: sendResult.error || "send_failed",
      failedAt: nowIso()
    },
    options
  );
  if (!updated) {
    return {
      ok: false,
      delivery: await getDelivery(deliveryId, options),
      error: "delivery_claim_lost",
      exhausted: false,
      stale: true
    };
  }
  return {
    ok: false,
    delivery: updated,
    error: sendResult.error || "send_failed",
    exhausted
  };
}

/**
 * High-level: create delivery (idempotent) and optionally send immediately.
 * Prefer enqueue via jobs for production; immediate send is for tests / sync paths.
 */
async function notify(input, options = {}) {
  const { delivery, created } = await createDelivery(input, options);
  if (!created && delivery.status === DELIVERY_STATUS.DELIVERED) {
    return { delivery, created: false, result: { ok: true, skipped: true, reason: "idempotent_already_delivered" } };
  }
  if (options.enqueueOnly) {
    return { delivery, created };
  }
  if (options.send !== false && (created || delivery.status === DELIVERY_STATUS.PENDING || delivery.status === DELIVERY_STATUS.FAILED)) {
    const result = await deliver(delivery.id, options);
    return { delivery: result.delivery || delivery, created, result };
  }
  return { delivery, created };
}

/**
 * Enqueue notification.send job (uses lib/jobs). Idempotent on delivery key.
 */
async function enqueueNotification(input, options = {}) {
  // Ensure preferences/token for unsubscribe links in templates
  if (input.recipientEmail || input.recipient_email || input.recipientUserId || input.recipient_user_id) {
    const pref = await ensurePreferences(
      {
        userId: input.recipientUserId || input.recipient_user_id || null,
        email: input.recipientEmail || input.recipient_email || null
      },
      options
    );
    const vars = { ...(input.templateVars || input.template_vars || {}) };
    if (!vars.unsubscribeToken && pref?.unsubscribeToken) {
      vars.unsubscribeToken = pref.unsubscribeToken;
      vars.unsubscribeUrl = `${baseUrl()}/api/notifications/unsubscribe?token=${encodeURIComponent(pref.unsubscribeToken)}`;
    }
    input = { ...input, templateVars: vars };
  }

  const { delivery, created } = await createDelivery(input, options);

  // eslint-disable-next-line global-require
  const jobs = require("./jobs");
  const jobIdempotency = delivery.idempotencyKey
    ? `notification.send:${delivery.idempotencyKey}`
    : `notification.send:${delivery.id}`;

  const { job, created: jobCreated } = await jobs.enqueue(
    {
      type: "notification.send",
      payload: { deliveryId: delivery.id },
      idempotencyKey: jobIdempotency,
      maxAttempts: delivery.maxAttempts || 5,
      timeoutMs: 60_000
    },
    options.jobsOptions || options
  );

  if (job?.id && !delivery.jobId) {
    await updateDelivery(delivery.id, { jobId: job.id }, options);
  }

  return {
    delivery: (await getDelivery(delivery.id, options)) || delivery,
    created,
    job,
    jobCreated
  };
}

// ── Bounce / complaint hooks ──

/**
 * Handle provider bounce webhook payload (generic).
 * Marks matching deliveries bounced and unsubscribes the address.
 */
async function handleBounce({ email, messageId, reason }, options = {}) {
  if (!email && !messageId) return { ok: false, reason: "email_or_message_id_required" };
  let matched = 0;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    if (messageId) {
      const res = await pool.query(
        `UPDATE notification_deliveries SET
           status = 'bounced', last_error = $2, failed_at = NOW(), updated_at = NOW()
         WHERE provider_message_id = $1
         RETURNING recipient_email;`,
        [messageId, reason || "bounce"]
      );
      matched = res.rows.length;
      for (const row of res.rows) {
        if (row.recipient_email) {
          await unsubscribeSafe(
            { email: row.recipient_email, scope: "all", reason: reason || "bounce", source: "bounce" },
            options
          );
        }
      }
    }
    if (email) {
      const norm = String(email).trim().toLowerCase();
      const res = await pool.query(
        `UPDATE notification_deliveries SET
           status = 'bounced', last_error = $2, failed_at = NOW(), updated_at = NOW()
         WHERE recipient_email = $1 AND status IN ('delivered', 'pending', 'sending', 'failed')
         RETURNING id;`,
        [norm, reason || "bounce"]
      );
      matched += res.rows.length;
      await unsubscribeSafe(
        { email: norm, scope: "all", reason: reason || "bounce", source: "bounce" },
        options
      );
    }
  } else {
    const norm = email ? String(email).trim().toLowerCase() : null;
    for (const d of memory.deliveries.values()) {
      if (
        (messageId && d.providerMessageId === messageId) ||
        (norm && d.recipientEmail === norm)
      ) {
        d.status = DELIVERY_STATUS.BOUNCED;
        d.lastError = reason || "bounce";
        d.failedAt = nowIso();
        d.updatedAt = nowIso();
        matched += 1;
        if (d.recipientEmail) {
          await unsubscribeSafe(
            { email: d.recipientEmail, scope: "all", reason: reason || "bounce", source: "bounce" },
            options
          );
        }
      }
    }
  }
  console.log(
    `[notifications] bounce handled matched=${matched} email=${email ? redactEmail(email) : "n/a"}`
  );
  return { ok: true, matched };
}

async function handleComplaint({ email, messageId, reason }, options = {}) {
  if (!email && !messageId) return { ok: false, reason: "email_or_message_id_required" };
  let matched = 0;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    if (messageId) {
      const res = await pool.query(
        `UPDATE notification_deliveries SET
           status = 'complained', last_error = $2, failed_at = NOW(), updated_at = NOW()
         WHERE provider_message_id = $1
         RETURNING recipient_email;`,
        [messageId, reason || "complaint"]
      );
      matched = res.rows.length;
      for (const row of res.rows) {
        if (row.recipient_email) {
          await unsubscribeSafe(
            {
              email: row.recipient_email,
              scope: "all",
              reason: reason || "complaint",
              source: "complaint"
            },
            options
          );
        }
      }
    }
    if (email) {
      const norm = String(email).trim().toLowerCase();
      await pool.query(
        `UPDATE notification_deliveries SET
           status = 'complained', last_error = $2, failed_at = NOW(), updated_at = NOW()
         WHERE recipient_email = $1 AND status IN ('delivered', 'pending', 'sending', 'failed');`,
        [norm, reason || "complaint"]
      );
      await unsubscribeSafe(
        { email: norm, scope: "all", reason: reason || "complaint", source: "complaint" },
        options
      );
      matched += 1;
    }
  } else {
    const norm = email ? String(email).trim().toLowerCase() : null;
    for (const d of memory.deliveries.values()) {
      if (
        (messageId && d.providerMessageId === messageId) ||
        (norm && d.recipientEmail === norm)
      ) {
        d.status = DELIVERY_STATUS.COMPLAINED;
        d.lastError = reason || "complaint";
        d.failedAt = nowIso();
        d.updatedAt = nowIso();
        matched += 1;
        if (d.recipientEmail) {
          await unsubscribeSafe(
            {
              email: d.recipientEmail,
              scope: "all",
              reason: reason || "complaint",
              source: "complaint"
            },
            options
          );
        }
      }
    }
  }
  console.log(
    `[notifications] complaint handled matched=${matched} email=${email ? redactEmail(email) : "n/a"}`
  );
  return { ok: true, matched };
}

/**
 * Retry a failed/skipped delivery (admin). Resets to pending and re-delivers or re-enqueues.
 */
async function retryDelivery(id, options = {}) {
  const delivery = await getDelivery(id, options);
  if (!delivery) return { ok: false, reason: "not_found" };
  if (delivery.status === DELIVERY_STATUS.DELIVERED) {
    return { ok: false, reason: "already_delivered", delivery };
  }
  if (delivery.status === DELIVERY_STATUS.SENDING) {
    return { ok: false, reason: "already_sending", delivery };
  }
  await updateDelivery(
    id,
    {
      status: DELIVERY_STATUS.PENDING,
      lastError: null,
      failedAt: null
    },
    options
  );

  if (options.enqueue) {
    // eslint-disable-next-line global-require
    const jobs = require("./jobs");
    const { job } = await jobs.enqueue(
      {
        type: "notification.send",
        payload: { deliveryId: id },
        idempotencyKey: `notification.retry:${id}:${Date.now()}`,
        maxAttempts: 3,
        timeoutMs: 60_000
      },
      options.jobsOptions || options
    );
    await updateDelivery(id, { jobId: job.id }, options);
    return { ok: true, enqueued: true, job, delivery: await getDelivery(id, options) };
  }

  const result = await deliver(id, options);
  return { ok: result.ok, result, delivery: result.delivery };
}

/**
 * Build weekly digest content from storage (news + stories).
 */
async function buildWeeklyDigestContent(ctx) {
  const weekLabel = new Date().toISOString().slice(0, 10);
  let headlines = [];
  let stories = [];
  try {
    if (ctx?.storageGetNews) {
      const news = await ctx.storageGetNews({ country: "global", limit: 8 });
      headlines = (news || []).slice(0, 8).map((n) => ({
        title: n.title || n.headline || "Headline",
        url: n.url || n.link || null
      }));
    }
  } catch (_e) {
    headlines = [];
  }
  try {
    if (ctx?.storageGetStories) {
      const all = await ctx.storageGetStories();
      stories = (all || [])
        .filter((s) => s.status === "published")
        .slice(0, 5)
        .map((s) => ({
          title: s.profession ? `${s.profession} — ${s.country || "global"}` : s.id,
          profession: s.profession
        }));
    }
  } catch (_e) {
    stories = [];
  }
  return {
    weekLabel,
    headlines,
    stories,
    ctaUrl: baseUrl(),
    subject: `${process.env.SITE_TITLE || "AI Took My Job"} weekly digest — ${weekLabel}`
  };
}

/**
 * Fan-out weekly digest to all active subscribers.
 * Uses per-subscriber idempotency keys for the week window.
 */
async function runWeeklyDigest(ctx, options = {}) {
  throwIfAborted(options.signal);
  const content = await buildWeeklyDigestContent(ctx);
  const windowKey =
    options.windowKey ||
    `week:${Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000))}`;

  let subscribers = [];
  if (ctx?.storageGetSubscribers) {
    subscribers = await ctx.storageGetSubscribers();
  }

  const results = { total: subscribers.length, enqueued: 0, skipped: 0, errors: 0, windowKey };

  for (const sub of subscribers) {
    throwIfAborted(options.signal);
    const email = sub.email;
    if (!email) {
      results.skipped += 1;
      continue;
    }
    try {
      const gate = await maySend(
        { email, templateKey: TEMPLATE_KEYS.DIGEST_WEEKLY, channel: CHANNEL.EMAIL },
        options
      );
      if (!gate.allowed) {
        results.skipped += 1;
        continue;
      }
      const pref = await ensurePreferences({ email }, options);
      const out = await enqueueNotification(
        {
          channel: CHANNEL.EMAIL,
          templateKey: TEMPLATE_KEYS.DIGEST_WEEKLY,
          recipientEmail: email,
          idempotencyKey: `digest.weekly:${windowKey}:${hashEmail(email)}`,
          templateVars: {
            ...content,
            unsubscribeToken: pref.unsubscribeToken
          }
        },
        options
      );
      if (out.created || out.jobCreated) results.enqueued += 1;
      else results.skipped += 1;
    } catch (err) {
      results.errors += 1;
      console.error(
        `[notifications] digest fanout error for ${redactEmail(email)}:`,
        redactEmailsInText(err instanceof Error ? err.message : String(err))
      );
    }
  }

  return results;
}

module.exports = {
  DELIVERY_STATUS,
  CHANNEL,
  TEMPLATE_KEYS,
  TEMPLATE_CATEGORY,
  redactEmail,
  hashEmail,
  redactEmailsInText,
  renderTemplate,
  resolveEmailProvider,
  smtpConfigured,
  createDelivery,
  getDelivery,
  getDeliveryByIdempotency,
  updateDelivery,
  listDeliveries,
  deliveryToPublic,
  deliver,
  notify,
  enqueueNotification,
  ensurePreferences,
  getPreferences,
  updatePreferences,
  unsubscribe: unsubscribeSafe,
  isUnsubscribed,
  maySend,
  handleBounce,
  handleComplaint,
  retryDelivery,
  buildWeeklyDigestContent,
  runWeeklyDigest,
  memoryReset,
  // test helpers
  sendEmailViaProvider,
  sendTelegramViaProvider
};
