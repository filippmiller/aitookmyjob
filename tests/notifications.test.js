/**
 * Notification delivery unit tests (offline / in-memory).
 * Covers: templates, redaction, idempotency, unsubscribe, console provider.
 *
 * Bead: aitj-z8q.15
 * Run: npm run test:notifications
 */

"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const notifications = require("../lib/notifications");
const jobs = require("../lib/jobs");
const { registerBuiltinHandlers } = require("../lib/job-handlers");
const { loadMigrations } = require("../lib/migrate");

const mem = { useMemory: true, usePostgres: false };

beforeEach(() => {
  notifications.memoryReset();
  jobs.memoryReset();
  process.env.EMAIL_PROVIDER = "console";
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_URL;
});

afterEach(() => {
  notifications.memoryReset();
  jobs.memoryReset();
});

describe("migration 007 present", () => {
  it("loads notifications migration as 007", () => {
    const migrations = loadMigrations();
    const m = migrations.find((x) => x.version === "007");
    assert.ok(m);
    assert.equal(m.name, "notifications");
  });
});

describe("redaction", () => {
  it("redactEmail never returns the full address", () => {
    const raw = "alice.smith@example.com";
    const redacted = notifications.redactEmail(raw);
    assert.notEqual(redacted, raw);
    assert.equal(redacted.includes("alice.smith"), false);
    assert.equal(redacted.includes("@example.com"), false);
    assert.match(redacted, /@/);
    assert.match(redacted, /\*\*\*/);
  });

  it("redactEmailsInText strips addresses from free text", () => {
    const text = "Failed for user bob@corp.io with code 500";
    const out = notifications.redactEmailsInText(text);
    assert.equal(out.includes("bob@corp.io"), false);
    assert.equal(out.includes("bob"), false);
  });

  it("hashEmail is stable and not reversible to plaintext", () => {
    const a = notifications.hashEmail("Test@Example.COM");
    const b = notifications.hashEmail("test@example.com");
    assert.equal(a, b);
    assert.equal(a.length, 64);
    assert.equal(a.includes("@"), false);
  });
});

describe("template render", () => {
  it("renders registration.welcome with subject and unsubscribe", () => {
    const t = notifications.renderTemplate(notifications.TEMPLATE_KEYS.REGISTRATION_WELCOME, {
      displayName: "Sam",
      unsubscribeToken: "tok123"
    });
    assert.match(t.subject, /Welcome/i);
    assert.match(t.bodyText, /Sam/);
    assert.match(t.bodyText, /Unsubscribe/i);
    assert.match(t.bodyHtml, /tok123/);
  });

  it("renders digest.weekly with headlines", () => {
    const t = notifications.renderTemplate(notifications.TEMPLATE_KEYS.DIGEST_WEEKLY, {
      weekLabel: "2026-W29",
      headlines: [{ title: "AI layoffs rise", url: "https://example.com/a" }],
      stories: [{ profession: "Designer", title: "Designer — us" }]
    });
    assert.match(t.subject, /digest/i);
    assert.match(t.bodyText, /AI layoffs rise/);
    assert.match(t.bodyHtml, /Designer/);
  });

  it("renders support.ack and follow_up", () => {
    const s = notifications.renderTemplate(notifications.TEMPLATE_KEYS.SUPPORT_ACK, {
      reference: "inbox_1",
      message: "Got it"
    });
    assert.match(s.bodyText, /Got it/);
    assert.match(s.bodyText, /inbox_1/);

    const f = notifications.renderTemplate(notifications.TEMPLATE_KEYS.FOLLOW_UP, {
      message: "Any update?",
      ctaUrl: "https://example.com/x"
    });
    assert.match(f.bodyText, /Any update/);
    assert.match(f.bodyHtml, /example.com\/x/);
  });

  it("throws on unknown template", () => {
    assert.throws(() => notifications.renderTemplate("nope.template", {}), /Unknown/);
  });
});

describe("idempotent delivery", () => {
  it("createDelivery returns same row for same idempotency key", async () => {
    const a = await notifications.createDelivery(
      {
        channel: "email",
        templateKey: notifications.TEMPLATE_KEYS.DIGEST_CONFIRM,
        recipientEmail: "one@example.com",
        idempotencyKey: "confirm:one"
      },
      mem
    );
    const b = await notifications.createDelivery(
      {
        channel: "email",
        templateKey: notifications.TEMPLATE_KEYS.DIGEST_CONFIRM,
        recipientEmail: "one@example.com",
        idempotencyKey: "confirm:one"
      },
      mem
    );
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.delivery.id, b.delivery.id);
  });

  it("deliver is no-op when already delivered (duplicate send prevented)", async () => {
    const { delivery } = await notifications.createDelivery(
      {
        channel: "email",
        templateKey: notifications.TEMPLATE_KEYS.SUPPORT_ACK,
        recipientEmail: "dup@example.com",
        idempotencyKey: "support:dup"
      },
      mem
    );
    const first = await notifications.deliver(delivery.id, mem);
    assert.equal(first.ok, true);
    assert.equal(first.delivery.status, "delivered");
    assert.equal(first.delivery.provider, "console");

    const second = await notifications.deliver(delivery.id, mem);
    assert.equal(second.ok, true);
    assert.equal(second.skipped, true);
    assert.match(second.reason, /already_delivered/);
  });

  it("notify with same idempotency key does not double-create", async () => {
    const a = await notifications.notify(
      {
        channel: "email",
        templateKey: notifications.TEMPLATE_KEYS.FOLLOW_UP,
        recipientEmail: "x@example.com",
        idempotencyKey: "follow:x",
        templateVars: { message: "hi" }
      },
      mem
    );
    const b = await notifications.notify(
      {
        channel: "email",
        templateKey: notifications.TEMPLATE_KEYS.FOLLOW_UP,
        recipientEmail: "x@example.com",
        idempotencyKey: "follow:x",
        templateVars: { message: "hi again" }
      },
      mem
    );
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.delivery.id, b.delivery.id);
    assert.equal(a.result.ok, true);
    // second notify sees already delivered
    assert.equal(b.result.skipped || b.delivery.status === "delivered", true);
  });
});

describe("unsubscribe immediate", () => {
  it("blocks further email after unsubscribe", async () => {
    const email = "leave@example.com";
    await notifications.ensurePreferences({ email }, mem);
    const before = await notifications.maySend(
      {
        email,
        templateKey: notifications.TEMPLATE_KEYS.DIGEST_WEEKLY,
        channel: "email"
      },
      mem
    );
    assert.equal(before.allowed, true);

    const unsub = await notifications.unsubscribe(
      { email, scope: "digest", source: "link" },
      mem
    );
    assert.equal(unsub.ok, true);
    assert.equal(unsub.immediate, true);
    assert.equal(unsub.email.includes("@"), true);
    assert.equal(unsub.email.includes("leave@example.com"), false);

    const after = await notifications.maySend(
      {
        email,
        templateKey: notifications.TEMPLATE_KEYS.DIGEST_WEEKLY,
        channel: "email"
      },
      mem
    );
    assert.equal(after.allowed, false);
    assert.equal(after.reason, "unsubscribed");

    // deliver marks skipped
    const { delivery } = await notifications.createDelivery(
      {
        channel: "email",
        templateKey: notifications.TEMPLATE_KEYS.DIGEST_WEEKLY,
        recipientEmail: email,
        idempotencyKey: "digest:leave:1"
      },
      mem
    );
    const result = await notifications.deliver(delivery.id, mem);
    assert.equal(result.skipped, true);
    assert.equal(result.delivery.status, "skipped");
  });

  it("token unsubscribe flips preferences immediately", async () => {
    const pref = await notifications.ensurePreferences({ email: "tok@example.com" }, mem);
    const out = await notifications.unsubscribe(
      { token: pref.unsubscribeToken, scope: "all" },
      mem
    );
    assert.equal(out.ok, true);
    const updated = await notifications.getPreferences({ token: pref.unsubscribeToken }, mem);
    assert.equal(updated.emailDigest, false);
    assert.equal(updated.emailTransactional, false);
  });
});

describe("console provider — never claim real SMTP without config", () => {
  it("resolveEmailProvider defaults to console without SMTP", () => {
    assert.equal(notifications.resolveEmailProvider(), "console");
    assert.equal(notifications.smtpConfigured(), false);
  });

  it("sendEmailViaProvider with console is simulated", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      const r = await notifications.sendEmailViaProvider({
        to: "secret.user@company.test",
        subject: "Hello secret.user@company.test",
        text: "body"
      });
      assert.equal(r.ok, true);
      assert.equal(r.provider, "console");
      assert.equal(r.simulated, true);
      const joined = logs.join("\n");
      assert.equal(joined.includes("secret.user@company.test"), false);
      assert.match(joined, /simulated=true/);
    } finally {
      console.log = orig;
    }
  });
});

describe("admin list redacts email", () => {
  it("deliveryToPublic redacts recipientEmail", async () => {
    const { delivery } = await notifications.createDelivery(
      {
        channel: "email",
        templateKey: notifications.TEMPLATE_KEYS.DIGEST_CONFIRM,
        recipientEmail: "visible@not.in.logs",
        idempotencyKey: "pub:1"
      },
      mem
    );
    const pub = notifications.deliveryToPublic(delivery);
    assert.notEqual(pub.recipientEmail, "visible@not.in.logs");
    assert.equal(pub.recipientEmailHash, notifications.hashEmail("visible@not.in.logs"));
  });
});

describe("job handlers notification.send + digest.weekly", () => {
  it("notification.send delivers via console provider", async () => {
    const ctx = {
      usePostgres: false,
      getPgPool: () => null,
      sendTelegramMessage: async () => true,
      storageAudit: async () => {}
    };
    // Clear any previous handlers by re-registering
    registerBuiltinHandlers(ctx, jobs);

    const { delivery } = await notifications.createDelivery(
      {
        channel: "email",
        templateKey: notifications.TEMPLATE_KEYS.REGISTRATION_WELCOME,
        recipientEmail: "new@example.com",
        idempotencyKey: "reg:new"
      },
      mem
    );

    const { job } = await jobs.enqueue(
      {
        type: "notification.send",
        payload: { deliveryId: delivery.id },
        idempotencyKey: `notification.send:reg:new`
      },
      mem
    );

    const processed = await jobs.processOnce("test-worker", { concurrency: 1 }, mem);
    assert.equal(processed.processed, 1);
    assert.equal(processed.results[0].ok, true);

    const after = await notifications.getDelivery(delivery.id, mem);
    assert.equal(after.status, "delivered");
    assert.equal(after.provider, "console");

    // duplicate job enqueue same key → same job, already succeeded
    const again = await jobs.enqueue(
      {
        type: "notification.send",
        payload: { deliveryId: delivery.id },
        idempotencyKey: `notification.send:reg:new`
      },
      mem
    );
    assert.equal(again.created, false);
    assert.equal(again.job.id, job.id);
  });

  it("digest.weekly fans out to subscribers with per-email idempotency", async () => {
    const subscribers = [
      { id: "s1", email: "a@example.com" },
      { id: "s2", email: "b@example.com" }
    ];
    const ctx = {
      usePostgres: false,
      getPgPool: () => null,
      storageGetSubscribers: async () => subscribers,
      storageGetNews: async () => [{ title: "Headline 1", url: "https://ex.test/1" }],
      storageGetStories: async () => [{ id: "st1", status: "published", profession: "Dev", country: "us" }],
      storageAudit: async () => {}
    };
    registerBuiltinHandlers(ctx, jobs);

    const { job } = await jobs.enqueue(
      {
        type: "digest.weekly",
        payload: { windowKey: "test-window-1", reason: "test" },
        idempotencyKey: "digest.weekly:test-window-1"
      },
      mem
    );
    assert.ok(job.id);

    const processed = await jobs.processOnce("digest-worker", { concurrency: 1 }, mem);
    assert.equal(processed.processed, 1);
    assert.equal(processed.results[0].ok, true);
    const result = processed.results[0].result;
    assert.equal(result.total, 2);
    assert.equal(result.enqueued, 2);

    // Process notification.send jobs created by fan-out
    let totalNotif = 0;
    for (let i = 0; i < 5; i++) {
      const tick = await jobs.processOnce("digest-worker", { concurrency: 5 }, mem);
      totalNotif += tick.processed;
      if (tick.processed === 0) break;
    }
    assert.ok(totalNotif >= 2);

    const list = await notifications.listDeliveries({ templateKey: "digest.weekly" }, mem);
    assert.equal(list.total, 2);
    assert.ok(list.deliveries.every((d) => d.status === "delivered"));

    // Second digest.weekly with same window does not re-enqueue new deliveries (idempotent keys)
    await jobs.enqueue(
      {
        type: "digest.weekly",
        payload: { windowKey: "test-window-1", reason: "test-again" },
        idempotencyKey: "digest.weekly:test-window-1"
      },
      mem
    );
    // job not recreated
    const listed = await jobs.listJobs({ type: "digest.weekly" }, mem);
    assert.equal(listed.total, 1);
  });
});

describe("bounce / complaint hooks", () => {
  it("handleBounce unsubscribes and marks delivery", async () => {
    const { delivery } = await notifications.notify(
      {
        channel: "email",
        templateKey: notifications.TEMPLATE_KEYS.DIGEST_CONFIRM,
        recipientEmail: "bounce@example.com",
        idempotencyKey: "bounce:1"
      },
      mem
    );
    assert.equal(delivery.status, "delivered");

    const out = await notifications.handleBounce(
      { email: "bounce@example.com", reason: "mailbox full" },
      mem
    );
    assert.equal(out.ok, true);
    assert.ok(out.matched >= 1);

    const after = await notifications.getDelivery(delivery.id, mem);
    assert.equal(after.status, "bounced");

    const gate = await notifications.maySend(
      {
        email: "bounce@example.com",
        templateKey: notifications.TEMPLATE_KEYS.DIGEST_WEEKLY,
        channel: "email"
      },
      mem
    );
    assert.equal(gate.allowed, false);
  });
});
